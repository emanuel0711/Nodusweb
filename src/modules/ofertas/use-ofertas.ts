import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  exportarModeloDoClube,
  lerPlanilha,
  valorDoCampo,
  type LinhaPlanilha,
  type OfertaParaExportar,
} from "@/lib/planilha";
import { lerPreco, melhorCorrespondencia, normalizarTexto, semelhanca } from "@/lib/comparar-textos";
import { buscarImagens, buscarImagensPorProduto } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";
import { codigosDaFamiliaOferta, extrairExcecoes, normalizarCodigos } from "@/lib/codigos-oferta";

export interface Oferta extends RegraOferta {
  nome: string; preco: number | null; precoClube: number | null; limiteBruto: string;
  ean: string; codigo: string; codigoInterno: string; codigos: string[]; codigosEditados?: boolean;
  excecoes: string[][]; imagem: string; encontrado: string | null; nota: number;
}

export const CARROSSEIS = [
  "6431 - Promoções", "6432 - Pra Você", "13533 - Hortifruti", "14036 - TERÇA DAS BEBIDAS",
  "13715 - SUPER SABADO", "6433 - Especial", "6434 - Cashback",
] as const;

const STORAGE_KEY = "ofertaflow:rascunho-ofertas";
const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];

interface Rascunho { ofertas: Oferta[]; nomeArquivo: string; carrossel: string; ativarEm: string; inativarEm: string; notaMinima: number; }

function lerRascunho(): Rascunho | null {
  try { const salvo = sessionStorage.getItem(STORAGE_KEY); return salvo ? JSON.parse(salvo) as Rascunho : null; }
  catch { return null; }
}

export function separarCodigos(valor: unknown, ean = false): string[] {
  return normalizarCodigos([String(valor ?? "").split(/[;,|\n]+/).map((codigo) => ean ? limparEan(codigo) : limparCodigo(codigo)).filter(Boolean).join(";")]);
}

function valorDeLimite(linha: LinhaPlanilha): string {
  return String(valorDoCampo(linha, [
    "Limite por cliente", "Limite por cliente (CPF)", "Limite por CPF", "Limite cliente", "Limite por pessoa",
    "Qtd. limite", "Quantidade limite", "LIMITE", "Limite",
  ]) ?? "").trim();
}

/** Só lê campos explicitamente identificados como código interno. */
function valorDeCodigoInterno(linha: LinhaPlanilha): string {
  const prioridades = [
    "Cód. Interno", "Cod. Interno", "Codigo Interno", "Código Interno",
    "Código do produto", "Codigo do produto",
  ];
  for (const prioridade of prioridades) {
    const alvo = prioridade.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    const encontrado = Object.entries(linha).find(([cabecalho, valor]) => {
      const h = cabecalho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      return h === alvo && String(valor ?? "").trim() !== "";
    });
    if (encontrado) return limparCodigo(encontrado[1]);
  }
  return "";
}

/** EAN procura EAN; código interno procura código interno. Código de promoção nunca identifica produto. */
function acharPorCodigo(nome: string, codigoInterno: string, ean: string, catalogo: Produto[], notaMinima: number) {
  const eanLimpo = limparEan(ean);
  if (eanLimpo.length >= 8) {
    const porEan = catalogo.filter((p) => limparEan(p.ean) === eanLimpo);
    if (porEan.length === 1) return { item: porEan[0], score: 1 };
    if (porEan.length > 1) {
      const achado = melhorCorrespondencia(nome, porEan, Math.max(0.55, notaMinima));
      if (achado) return achado;
    }
  }
  const interno = limparCodigo(codigoInterno);
  if (interno) {
    const porInterno = catalogo.filter((p) => limparCodigo(p.internal_code) === interno);
    if (porInterno.length === 1) return { item: porInterno[0], score: 1 };
    if (porInterno.length > 1) {
      const achado = melhorCorrespondencia(nome, porInterno, Math.max(0.55, notaMinima));
      if (achado) return achado;
    }
  }
  return null;
}

const TOKENS_KG_GENERICO = new Set([
  "kg", "quilo", "kilo", "quilograma", "carne", "bov", "bovina", "bovino", "suina", "suino",
  "suina", "res", "resf", "com", "sem", "capa", "pessoa", "por", "cliente",
]);

/**
 * Carnes e outros produtos de Kg costumam ter descrições comerciais diferentes.
 * Em vez de exigir o nome inteiro, usa as palavras distintivas do corte/produto.
 * O código só é aceito depois que o produto do catálogo foi identificado.
 */
function tokensDistintivosKg(nome: string): string[] {
  return [...new Set(normalizarTexto(nome)
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !TOKENS_KG_GENERICO.has(token)))];
}

function unidadeEhKg(produto: Produto): boolean {
  const unidade = normalizarTexto(produto.unit || "");
  return /^(kg|quilo|kilo|quilograma)$/.test(unidade) || /\bkg\b|\bquilograma\b/.test(normalizarTexto(produto.description));
}

function pontuarProdutoKg(nome: string, produto: Produto): number {
  if (!unidadeEhKg(produto)) return 0;
  const alvo = normalizarTexto(nome);
  const descricao = normalizarTexto(produto.description);
  if (alvo === descricao) return 1;

  const tokens = tokensDistintivosKg(nome);
  if (!tokens.length) return 0;
  const candidatos = [...new Set(descricao.split(/\s+/))];
  let correspondencias = 0;
  for (const token of tokens) {
    if (candidatos.includes(token)) { correspondencias += 1; continue; }
    if (candidatos.some((candidato) => token.length >= 4 && candidato.length >= 4 && semelhanca(token, candidato) >= 0.82)) correspondencias += 0.75;
  }
  const cobertura = correspondencias / tokens.length;
  if (correspondencias === 0) return 0;
  return cobertura * 0.7 + semelhanca(alvo, descricao) * 0.3;
}

/** Busca específica para Kg quando a descrição completa da planilha diverge do catálogo. */
function melhorCorrespondenciaKg(nome: string, catalogo: Produto[]): { item: Produto; score: number } | null {
  if (!/\bkg\b|\bquilo\b|\bkilo\b|\bquilograma\b/.test(normalizarTexto(nome))) return null;
  const candidatos = catalogo
    .map((item) => ({ item, score: pontuarProdutoKg(nome, item), temCodigo: Boolean(limparCodigo(item.internal_code)) }))
    .filter(({ score }) => score >= 0.42)
    .sort((a, b) => b.score - a.score || Number(b.temCodigo) - Number(a.temCodigo));
  const melhor = candidatos[0];
  return melhor ? { item: melhor.item, score: melhor.score } : null;
}

/**
 * Para Kg, se o primeiro produto encontrado não tiver código interno, procura
 * uma correspondência equivalente no catálogo que realmente possua internal_code.
 */
function recuperarCodigoKg(nome: string, produto: Produto | undefined, catalogo: Produto[]): Produto | undefined {
  if (!produto) return melhorCorrespondenciaKg(nome, catalogo)?.item;
  if (limparCodigo(produto.internal_code)) return produto;

  const exatos = catalogo.filter((item) =>
    unidadeEhKg(item) &&
    normalizarTexto(item.description) === normalizarTexto(produto.description) &&
    Boolean(limparCodigo(item.internal_code)),
  );
  if (exatos.length) return exatos[0];

  return melhorCorrespondenciaKg(nome, catalogo)?.item || produto;
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;
  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigoInterno(linha);
  const limiteBruto = valorDeLimite(linha);
  const excecoes = extrairExcecoes(linha, nome);
  const porQuiloPeloNome = /\bkg\b|\bquilo\b|\bkilo\b|\bquilograma\b/.test(normalizarTexto(nome));

  // Ordem: código correto da origem → nome completo → busca específica de Kg.
  const achadoPorCodigo = acharPorCodigo(nome, codigoOrigem, eanOrigem, catalogo, notaMinima);
  const achadoNome = melhorCorrespondencia(nome, catalogo, notaMinima);
  const achadoKg = porQuiloPeloNome ? melhorCorrespondenciaKg(nome, catalogo) : null;
  const achado = achadoPorCodigo || achadoNome || achadoKg;
  const produtoInicial = achado?.item;
  const produtoBase = porQuiloPeloNome ? (recuperarCodigoKg(nome, produtoInicial, catalogo) ?? produtoInicial) : produtoInicial;

  // Se as regras apontarem Kg (mesmo sem "kg" no nome), garante um produto com código interno válido.
  const regrasPrevias = aplicarRegras(nome, limiteBruto, limparCodigo(produtoBase?.internal_code), limparEan(produtoBase?.ean) || eanOrigem, produtoBase?.unit || "");
  const produto = regrasPrevias.porQuilo
    ? (produtoComCodigoInterno(produtoBase, catalogo) ?? recuperarCodigoKg(nome, produtoBase, catalogo) ?? produtoBase)
    : produtoBase;

  // O código exportado nunca vem do nome do arquivo, da promoção ou de um fallback de coluna.
  const codigoCatalogo = limparCodigo(produto?.internal_code);
  const codigoInterno = !eanOrigem ? codigoCatalogo : "";
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");
  const familia = codigosDaFamiliaOferta(nome, produto, catalogo, regras.porQuilo, excecoes);
  const codigos = normalizarCodigos(familia);

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)), precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limiteBruto, ...regras, ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigos.join(";"), codigoInterno, codigos, codigosEditados: false, excecoes,
    imagem: produto?.image_url ?? "", encontrado: produto?.description ?? null, nota: achado?.score ?? 0,
  };
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

/** Complementa imagem/códigos sem trocar um produto já encontrado por outro de nome parecido. */
function atualizarComCatalogo(oferta: Oferta, catalogo: Produto[]): Oferta {
  const candidato = oferta.porQuilo
    ? (melhorCorrespondenciaKg(oferta.nome, catalogo) || melhorCorrespondencia(oferta.nome, catalogo, 0.72))
    : melhorCorrespondencia(oferta.nome, catalogo, 0.72);
  if (!candidato) return oferta;
  if (oferta.encontrado && candidato.item.description !== oferta.encontrado) return oferta;

  const produto = oferta.porQuilo ? (recuperarCodigoKg(oferta.nome, candidato.item, catalogo) ?? candidato.item) : candidato.item;
  const codigoCatalogo = limparCodigo(produto.internal_code);
  const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, codigoCatalogo, limparEan(produto.ean), produto.unit || "");
  const descobertos = codigosDaFamiliaOferta(oferta.nome, produto, catalogo, regras.porQuilo, oferta.excecoes || []);
  const codigos = oferta.codigosEditados ? normalizarCodigos(oferta.codigos || []) : normalizarCodigos(descobertos);
  return {
    ...oferta, imagem: oferta.imagem || produto.image_url || "", encontrado: oferta.encontrado || produto.description,
    codigos, codigo: codigos.join(";"), ean: oferta.ean || limparEan(produto.ean),
    codigoInterno: regras.porQuilo ? codigoCatalogo : oferta.codigoInterno,
    nota: Math.max(oferta.nota, candidato.score), porQuilo: regras.porQuilo, unidade: regras.unidade, limite: regras.limite,
  };
}

export function useOfertas() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const rascunho = lerRascunho();
  const [processando, setProcessando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState(rascunho?.nomeArquivo ?? "");
  const [ofertas, setOfertas] = useState<Oferta[]>(rascunho?.ofertas ?? []);
  const [notaMinima, setNotaMinima] = useState(rascunho?.notaMinima ?? 0.55);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalVisualizacao, setModalVisualizacao] = useState<Oferta | null>(null);
  const [carrossel, setCarrossel] = useState(rascunho?.carrossel ?? "");
  const [ativarEm, setAtivarEm] = useState(rascunho?.ativarEm ?? "");
  const [inativarEm, setInativarEm] = useState(rascunho?.inativarEm ?? "");

  useEffect(() => {
    if (!ofertas.length && !nomeArquivo) { sessionStorage.removeItem(STORAGE_KEY); return; }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima }));
  }, [ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima]);

  useEffect(() => {
    if (!ofertas.length) return;
    let ativo = true;
    carregarTodosProdutos().then((catalogo) => {
      if (ativo) setOfertas((atuais) => atuais.map((oferta) => atualizarComCatalogo(oferta, catalogo)));
    }).catch(() => undefined);
    return () => { ativo = false; };
  }, []);

  function alterar(indice: number, mudanca: Partial<Oferta>) {
    setOfertas((atual) => atual.map((oferta, i) => i === indice
      ? { ...oferta, ...mudanca, ...(Object.hasOwn(mudanca, "codigos") ? { codigosEditados: true } : {}) } : oferta));
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]);
      if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");
      const cruzadas = linhas.map((linha) => cruzar(linha, catalogo, notaMinima)).filter((item): item is Oferta => item !== null);
      if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");
      const eans = cruzadas.filter((item) => !item.imagem && !item.porQuilo).flatMap((item) => item.codigos.filter((codigo) => codigo.length >= 8));
      const [imagens, imagensPorNome] = await Promise.all([
        buscarImagens(eans),
        buscarImagensPorProduto(cruzadas.filter((item) => !item.imagem && item.porQuilo).map((item) => ({ ean: "", nome: item.nome }))),
      ]);
      const finais = cruzadas.map((item) => ({ ...item, imagem: item.imagem || item.codigos.map((codigo) => imagens.get(codigo)).find(Boolean) || imagensPorNome.get(item.nome) || "" }));
      setOfertas(finais); setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter((item) => item.nota >= notaMinima && item.codigos.length > 0).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({ user_id: data.user.id, file_name: arquivo.name, total_items: finais.length, matched_items: correspondidas });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha");
    } finally {
      setProcessando(false); if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function limparOfertas() { setOfertas([]); setNomeArquivo(""); toast.success("Planilha removida"); }

  function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) { toast.error("Preencha Carrossel, Ativação automática e Inativar em."); return; }
    const linhas: OfertaParaExportar[] = ofertas.map((oferta) => ({
      name: oferta.nome, price: oferta.preco, promotionalPrice: oferta.precoClube, limit: oferta.limite, imageUrl: oferta.imagem,
      code: normalizarCodigos(oferta.codigos.length ? oferta.codigos : [oferta.codigo]).join(";"),
      codeType: oferta.porQuilo ? "Interno" : "EAN", unidade: oferta.unidade,
    }));
    exportarModeloDoClube(linhas, { carrossel, ativarEm: dataParaClube(ativarEm), inativarEm: dataParaClube(inativarEm) });
    setModalAberto(false); toast.success("Planilha do Clube gerada.");
  }

  return {
    campoArquivo, processando, ofertas, notaMinima, setNotaMinima, nomeArquivo,
    precisamRevisao: ofertas.filter((item) => item.nota < notaMinima || !item.codigos.length || !item.imagem).length,
    alterar, limparOfertas, setModalAberto, processar, modalAberto, carrossel, setCarrossel,
    ativarEm, setAtivarEm, inativarEm, setInativarEm, exportar, modalVisualizacao, setModalVisualizacao,
  };
}
