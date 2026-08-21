import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  exportarModeloDoClube,
  lerPlanilha,
  valorDaColuna,
  valorDoCampo,
  type LinhaPlanilha,
  type OfertaParaExportar,
} from "@/lib/planilha";
import { lerPreco, melhorCorrespondencia } from "@/lib/comparar-textos";
import { buscarImagens, buscarImagensPorProduto } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";
import { codigosDaFamiliaOferta, extrairExcecoes, normalizarCodigos } from "@/lib/codigos-oferta";

export interface Oferta extends RegraOferta {
  nome: string;
  preco: number | null;
  precoClube: number | null;
  limiteBruto: string;
  ean: string;
  codigo: string;
  codigoInterno: string;
  codigos: string[];
  codigosEditados?: boolean;
  excecoes: string[][];
  imagem: string;
  encontrado: string | null;
  nota: number;
}

export const CARROSSEIS = [
  "6431 - Promoções",
  "6432 - Pra Você",
  "13533 - Hortifruti",
  "14036 - TERÇA DAS BEBIDAS",
  "13715 - SUPER SABADO",
  "6433 - Especial",
  "6434 - Cashback",
] as const;

const STORAGE_KEY = "ofertaflow:rascunho-ofertas";
const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];

interface Rascunho {
  ofertas: Oferta[];
  nomeArquivo: string;
  carrossel: string;
  ativarEm: string;
  inativarEm: string;
  notaMinima: number;
}

function lerRascunho(): Rascunho | null {
  try {
    const salvo = sessionStorage.getItem(STORAGE_KEY);
    return salvo ? JSON.parse(salvo) as Rascunho : null;
  } catch {
    return null;
  }
}

export function separarCodigos(valor: unknown, ean = false): string[] {
  return normalizarCodigos([
    String(valor ?? "")
      .split(/[;,|\n]+/)
      .map((codigo) => ean ? limparEan(codigo) : limparCodigo(codigo))
      .filter(Boolean)
      .join(";"),
  ]);
}

function valorDeLimite(linha: LinhaPlanilha): string {
  return String(valorDoCampo(linha, [
    "Limite por cliente", "Limite por cliente (CPF)", "Limite por CPF",
    "Limite cliente", "Limite por pessoa", "Qtd. limite", "Quantidade limite",
    "LIMITE", "Limite",
  ]) ?? "").trim();
}

function pareceCodigoNumerico(valor: unknown): boolean {
  const texto = String(valor ?? "").trim();
  return Boolean(texto) && texto.split(/[;,|\n]+/).every((parte) => /^\d{1,14}$/.test(parte.trim()));
}

function valorDeCodigo(linha: LinhaPlanilha): string {
  const prioridades = [
    "Código da promoção", "Cód. Promoção", "Código do produto",
    "Cód. Interno", "Codigo Interno", "Código Interno", "Código", "Codigo", "Cod.", "Cod",
  ];

  for (const prioridade of prioridades) {
    const alvo = prioridade.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const encontrado = Object.entries(linha).find(([cabecalho, valor]) => {
      const h = cabecalho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      return !/ean|gtin|codigo de barras/.test(h) && h === alvo && String(valor ?? "").trim() !== "";
    });
    if (encontrado) return limparCodigo(encontrado[1]);
  }

  const primeiraColuna = valorDaColuna(linha, 0);
  return pareceCodigoNumerico(primeiraColuna) ? limparCodigo(primeiraColuna) : "";
}

function acharPorCodigo(nome: string, codigo: string, catalogo: Produto[], notaMinima: number) {
  for (const alvo of separarCodigos(codigo)) {
    const candidatos = catalogo.filter((p) =>
      limparEan(p.ean) === limparEan(alvo) ||
      limparCodigo(p.internal_code) === limparCodigo(alvo) ||
      limparCodigo(p.promotion_code) === limparCodigo(alvo),
    );
    if (candidatos.length === 1) return { item: candidatos[0], score: 1 };
    if (candidatos.length > 1) {
      const achado = melhorCorrespondencia(nome, candidatos, Math.max(0.55, notaMinima));
      if (achado) return achado;
    }
  }
  return null;
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;

  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigo(linha) || (valorEAN.length > 0 && valorEAN.length < 8 ? valorEAN : "");
  const limiteBruto = valorDeLimite(linha);
  const excecoes = extrairExcecoes(linha, nome);
  const exatoPorEan = eanOrigem ? catalogo.find((p) => limparEan(p.ean) === eanOrigem) : undefined;
  const exatoPorCodigo = !exatoPorEan ? acharPorCodigo(nome, codigoOrigem, catalogo, notaMinima) : null;
  const achado = exatoPorEan ? { item: exatoPorEan, score: 1 } : exatoPorCodigo || melhorCorrespondencia(nome, catalogo, notaMinima);
  const produto = achado?.item;
  const codigoCatalogo = limparCodigo(produto?.internal_code);
  const codigoInterno = !eanOrigem && (codigoOrigem || codigoCatalogo) ? (codigoOrigem || codigoCatalogo) : "";
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");
  const familia = codigosDaFamiliaOferta(nome, produto, catalogo, regras.porQuilo, excecoes);
  const codigos = regras.porQuilo
    ? normalizarCodigos(familia.length ? familia : (codigoOrigem ? [codigoOrigem] : [codigoInterno]))
    : normalizarCodigos(familia);

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)),
    precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limiteBruto,
    ...regras,
    ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigos.join(";"),
    codigoInterno,
    codigos,
    codigosEditados: false,
    excecoes,
    imagem: produto?.image_url ?? "",
    encontrado: produto?.description ?? null,
    nota: achado?.score ?? 0,
  };
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function atualizarComCatalogo(oferta: Oferta, catalogo: Produto[]): Oferta {
  const achado = melhorCorrespondencia(oferta.nome, catalogo, 0.72);
  if (!achado) return oferta;
  const produto = achado.item;
  const codigoCatalogo = limparCodigo(produto.internal_code);
  const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, oferta.codigoInterno || codigoCatalogo, limparEan(produto.ean), produto.unit || "");
  const descobertos = codigosDaFamiliaOferta(oferta.nome, produto, catalogo, regras.porQuilo, oferta.excecoes || []);
  const fallbackKg = regras.porQuilo ? [oferta.codigoInterno, codigoCatalogo].filter(Boolean) : [];
  const codigos = oferta.codigosEditados
    ? normalizarCodigos(oferta.codigos || [])
    : normalizarCodigos(descobertos.length ? descobertos : fallbackKg);

  return {
    ...oferta,
    encontrado: oferta.encontrado || produto.description,
    imagem: oferta.imagem || produto.image_url || "",
    codigos,
    codigo: codigos.join(";"),
    ean: oferta.ean || limparEan(produto.ean),
    codigoInterno: oferta.codigoInterno || codigoCatalogo,
    nota: Math.max(oferta.nota, achado.score),
    porQuilo: regras.porQuilo,
    unidade: regras.unidade,
    limite: regras.limite,
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
    if (!ofertas.length && !nomeArquivo) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
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
      ? { ...oferta, ...mudanca, ...(Object.hasOwn(mudanca, "codigos") ? { codigosEditados: true } : {}) }
      : oferta));
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
      const finais = cruzadas.map((item) => ({
        ...item,
        imagem: item.imagem || item.codigos.map((codigo) => imagens.get(codigo)).find(Boolean) || imagensPorNome.get(item.nome) || "",
      }));

      setOfertas(finais);
      setNomeArquivo(arquivo.name);
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
      setProcessando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function limparOfertas() {
    setOfertas([]);
    setNomeArquivo("");
    toast.success("Planilha removida");
  }

  function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) {
      toast.error("Preencha Carrossel, Ativação automática e Inativar em.");
      return;
    }
    const linhas: OfertaParaExportar[] = ofertas.map((oferta) => ({
      name: oferta.nome,
      price: oferta.preco,
      promotionalPrice: oferta.precoClube,
      limit: oferta.limite,
      imageUrl: oferta.imagem,
      code: normalizarCodigos(oferta.codigos.length ? oferta.codigos : [oferta.codigo]).join(";"),
      codeType: oferta.porQuilo ? "Interno" : "EAN",
      unidade: oferta.unidade,
    }));
    try {
      exportarModeloDoClube(linhas, { carrossel: carrossel.trim(), ativarEm: dataParaClube(ativarEm), inativarEm: dataParaClube(inativarEm) });
      setModalAberto(false);
      toast.success("Arquivo do Clube gerado e enviado para download.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível gerar o arquivo.");
    }
  }

  return {
    campoArquivo, processando, nomeArquivo, ofertas, notaMinima, setNotaMinima,
    modalAberto, setModalAberto, modalVisualizacao, setModalVisualizacao,
    carrossel, setCarrossel, ativarEm, setAtivarEm, inativarEm, setInativarEm,
    alterar, processar, limparOfertas, exportar,
    precisamRevisao: ofertas.filter((item) => !item.codigos.length || !item.imagem || item.nota < notaMinima).length,
  };
}
