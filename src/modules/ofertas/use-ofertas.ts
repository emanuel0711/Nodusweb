import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportarModeloDoClube, lerPlanilha, valorDoCampo, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { lerPreco, melhorCorrespondencia, normalizarTexto, semelhanca } from "@/lib/comparar-textos";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";
import { codigosDaFamiliaOferta, extrairExcecoes, normalizarCodigos, chaveBaseOferta } from "@/lib/codigos-oferta";
import { classificarAgrupamento, type ClassificacaoAgrupamento, type ModoAgrupamento } from "@/modules/ofertas/agrupamento-oferta";

export interface Oferta extends RegraOferta {
  nome: string; preco: number | null; precoClube: number | null; limiteBruto: string;
  ean: string; codigo: string; codigoInterno: string; codigos: string[]; codigosEditados?: boolean;
  excecoes: string[][]; imagem: string; encontrado: string | null; nota: number;
  origemId?: string; nomeOriginal?: string; modoAgrupamento?: ModoAgrupamento;
  agrupamentoDetectado?: ClassificacaoAgrupamento; motivoAgrupamento?: string; nomesSeparacao?: string[];
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
  return String(valorDoCampo(linha, ["Limite por cliente", "Limite por cliente (CPF)", "Limite por CPF", "Limite cliente", "Limite por pessoa", "Qtd. limite", "Quantidade limite", "LIMITE", "Limite"]) ?? "").trim();
}

function valorDeCodigoInterno(linha: LinhaPlanilha): string {
  const prioridades = ["Cód. Interno", "Cod. Interno", "Codigo Interno", "Código Interno", "Código do produto", "Codigo do produto"];
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

const TOKENS_KG_GENERICO = new Set(["kg", "quilo", "kilo", "quilograma", "carne", "bov", "bovina", "bovino", "suina", "suino", "res", "resf", "com", "sem", "capa", "pessoa", "por", "cliente"]);

function tokensDistintivosKg(nome: string): string[] {
  return [...new Set(normalizarTexto(nome).split(/\s+/).filter((token) => token.length >= 3 && !TOKENS_KG_GENERICO.has(token)))];
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

function melhorCorrespondenciaKg(nome: string, catalogo: Produto[]): { item: Produto; score: number } | null {
  if (!/\bkg\b|\bquilo\b|\bkilo\b|\bquilograma\b/.test(normalizarTexto(nome))) return null;
  const candidatos = catalogo
    .map((item) => ({ item, score: pontuarProdutoKg(nome, item), temCodigo: Boolean(limparCodigo(item.internal_code)) }))
    .filter(({ score }) => score >= 0.42)
    .sort((a, b) => b.score - a.score || Number(b.temCodigo) - Number(a.temCodigo));
  const melhor = candidatos[0];
  return melhor ? { item: melhor.item, score: melhor.score } : null;
}

function recuperarCodigoKg(nome: string, produto: Produto | undefined, catalogo: Produto[]): Produto | undefined {
  if (!produto) return melhorCorrespondenciaKg(nome, catalogo)?.item;
  if (limparCodigo(produto.internal_code)) return produto;
  const exatos = catalogo.filter((item) => unidadeEhKg(item) && normalizarTexto(item.description) === normalizarTexto(produto.description) && Boolean(limparCodigo(item.internal_code)));
  if (exatos.length) return exatos[0];
  return melhorCorrespondenciaKg(nome, catalogo)?.item || produto;
}

function codigoInternoValido(produto: Produto | undefined): boolean {
  const interno = limparCodigo(produto?.internal_code);
  return Boolean(interno) && !/^\d{8,14}$/.test(limparEan(interno));
}

function produtoComCodigoInterno(produto: Produto | undefined, catalogo: Produto[]): Produto | undefined {
  if (!produto || codigoInternoValido(produto)) return produto;
  const descricao = normalizarTexto(produto.description);
  return catalogo.find((item) => normalizarTexto(item.description) === descricao && codigoInternoValido(item));
}

function custoCompativel(custo: number | null, precoOferta: number | null): boolean {
  if (custo == null || precoOferta == null || !Number.isFinite(custo) || !Number.isFinite(precoOferta) || precoOferta <= 0) return true;
  return custo <= precoOferta * 1.15;
}

function melhorCorrespondenciaComCusto(nome: string, catalogo: Produto[], notaMinima: number, precoOferta: number | null): { item: Produto; score: number } | null {
  const alvo = normalizarTexto(nome);
  if (!alvo) return null;
  const candidatos = catalogo
    .map((item) => {
      const texto = semelhanca(alvo, item.description);
      const custoPenalidade = custoCompativel(item.cost, precoOferta) ? 0 : 0.35;
      return { item, score: texto - custoPenalidade, texto };
    })
    .filter(({ texto }) => texto >= notaMinima)
    .sort((a, b) => b.score - a.score || b.texto - a.texto);
  const melhor = candidatos[0];
  return melhor ? { item: melhor.item, score: melhor.score } : null;
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;
  const preco = lerPreco(valorDoCampo(linha, PRECOS));
  const precoClube = lerPreco(valorDoCampo(linha, PRECOS_CLUBE));
  const precoParaCusto = precoClube ?? preco;
  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigoInterno(linha);
  const limiteBruto = valorDeLimite(linha);
  const excecoes = extrairExcecoes(linha, nome);
  const porQuiloPeloNome = /\bkg\b|\bquilo\b|\bkilo\b|\bquilograma\b/.test(normalizarTexto(nome));

  const achadoPorCodigo = acharPorCodigo(nome, codigoOrigem, eanOrigem, catalogo, notaMinima);
  const achadoNome = melhorCorrespondenciaComCusto(nome, catalogo, notaMinima, precoParaCusto) || melhorCorrespondencia(nome, catalogo, notaMinima);
  const achadoKg = porQuiloPeloNome ? melhorCorrespondenciaKg(nome, catalogo) : null;
  const achado = achadoPorCodigo || achadoNome || achadoKg;
  const produtoInicial = achado?.item;
  const produtoBase = porQuiloPeloNome ? (recuperarCodigoKg(nome, produtoInicial, catalogo) ?? produtoInicial) : produtoInicial;

  const regrasPrevias = aplicarRegras(nome, limiteBruto, limparCodigo(produtoBase?.internal_code), limparEan(produtoBase?.ean) || eanOrigem, produtoBase?.unit || "");
  const produto = regrasPrevias.porQuilo
    ? (produtoComCodigoInterno(produtoBase, catalogo) ?? recuperarCodigoKg(nome, produtoBase, catalogo) ?? produtoBase)
    : produtoBase;

  const codigoCatalogo = limparCodigo(produto?.internal_code);
  const codigoInterno = !eanOrigem ? codigoCatalogo : "";
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");
  const familia = codigosDaFamiliaOferta(nome, produto, catalogo, regras.porQuilo, excecoes, precoParaCusto);
  const codigos = normalizarCodigos(familia);

  return {
    nome, preco, precoClube, limiteBruto, ...regras,
    ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigos.join(";"), codigoInterno, codigos, codigosEditados: false, excecoes,
    imagem: produto?.image_url ?? "", encontrado: produto?.description ?? null, nota: achado?.score ?? 0,
  };
}

function linhaComNome(linha: LinhaPlanilha, nome: string): LinhaPlanilha {
  const copia = { ...linha };
  const cabecalho = Object.keys(copia).find((chave) => NOMES.some((nomeCampo) => normalizarTexto(chave) === normalizarTexto(nomeCampo)));
  if (cabecalho) copia[cabecalho] = nome;
  else copia.PRODUTO = nome;
  return copia;
}

function linhaDaOferta(oferta: Oferta, nome: string): LinhaPlanilha {
  return {
    PRODUTO: nome,
    OFERTA: oferta.preco ?? "",
    CLUBE: oferta.precoClube ?? "",
    LIMITE: oferta.limiteBruto,
  };
}

function aplicarMetadadosAgrupamento(oferta: Oferta, dados: {
  origemId: string; nomeOriginal: string; modo: ModoAgrupamento; classificacao: ClassificacaoAgrupamento; motivo: string; nomesSeparacao: string[];
}): Oferta {
  return {
    ...oferta,
    origemId: dados.origemId,
    nomeOriginal: dados.nomeOriginal,
    modoAgrupamento: dados.modo,
    agrupamentoDetectado: dados.classificacao,
    motivoAgrupamento: dados.motivo,
    nomesSeparacao: dados.nomesSeparacao,
  };
}

function cruzarLinhaComAgrupamento(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number, origemId: string): Oferta[] {
  const nomeOriginal = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nomeOriginal) return [];
  const classificacao = classificarAgrupamento(nomeOriginal, catalogo);
  const nomes = classificacao.classificacao === "split" ? classificacao.nomesSeparados : [nomeOriginal];

  return nomes.flatMap((nome) => {
    const oferta = cruzar(linhaComNome(linha, nome), catalogo, notaMinima);
    if (!oferta) return [];
    return [aplicarMetadadosAgrupamento(oferta, {
      origemId,
      nomeOriginal,
      modo: "auto",
      classificacao: classificacao.classificacao,
      motivo: classificacao.motivo,
      nomesSeparacao: classificacao.nomesSeparados,
    })];
  });
}

/** Agrupa linhas irmãs da mesma oferta base e mesmo preço, unindo códigos únicos. */
export function agruparOfertasIrmas(ofertas: Oferta[]): Oferta[] {
  const grupos = new Map<string, Oferta>();
  const ordem: string[] = [];

  for (const oferta of ofertas) {
    if (oferta.codigosEditados) {
      const chave = `manual:${ordem.length}:${oferta.nome}`;
      grupos.set(chave, { ...oferta, codigos: normalizarCodigos(oferta.codigos), codigo: normalizarCodigos(oferta.codigos).join(";") });
      ordem.push(chave);
      continue;
    }

    const separada = oferta.modoAgrupamento === "split" || (oferta.modoAgrupamento !== "grouped" && oferta.agrupamentoDetectado === "split");
    const base = separada ? normalizarTexto(oferta.nome) : chaveBaseOferta(oferta.nome);
    const origem = separada && oferta.origemId ? `|${oferta.origemId}` : "";
    const chave = `${base}|${oferta.preco ?? ""}|${oferta.precoClube ?? ""}${origem}`;
    const existente = grupos.get(chave);

    if (!existente) {
      grupos.set(chave, { ...oferta, codigos: normalizarCodigos(oferta.codigos), codigo: normalizarCodigos(oferta.codigos).join(";") });
      ordem.push(chave);
      continue;
    }

    const codigos = normalizarCodigos([...existente.codigos, ...oferta.codigos]);
    grupos.set(chave, {
      ...existente,
      codigos,
      codigo: codigos.join(";"),
      ean: existente.ean || oferta.ean,
      codigoInterno: existente.codigoInterno || oferta.codigoInterno,
      imagem: existente.imagem || oferta.imagem,
      encontrado: existente.encontrado || oferta.encontrado,
      nota: Math.max(existente.nota, oferta.nota),
      limiteBruto: existente.limiteBruto || oferta.limiteBruto,
      excecoes: [...existente.excecoes, ...oferta.excecoes],
    });
  }

  return ordem.map((chave) => grupos.get(chave)!).filter(Boolean);
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function atualizarComCatalogo(oferta: Oferta, catalogo: Produto[]): Oferta {
  const candidato = oferta.porQuilo
    ? (melhorCorrespondenciaKg(oferta.nome, catalogo) || melhorCorrespondenciaComCusto(oferta.nome, catalogo, 0.72, oferta.precoClube ?? oferta.preco) || melhorCorrespondencia(oferta.nome, catalogo, 0.72))
    : (melhorCorrespondenciaComCusto(oferta.nome, catalogo, 0.72, oferta.precoClube ?? oferta.preco) || melhorCorrespondencia(oferta.nome, catalogo, 0.72));
  if (!candidato) return oferta;
  if (oferta.encontrado && candidato.item.description !== oferta.encontrado) return oferta;

  const encontrado = oferta.porQuilo ? (recuperarCodigoKg(oferta.nome, candidato.item, catalogo) ?? candidato.item) : candidato.item;
  const produto = oferta.porQuilo ? (produtoComCodigoInterno(encontrado, catalogo) ?? encontrado) : encontrado;
  const codigoCatalogo = limparCodigo(produto.internal_code);
  const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, codigoCatalogo, limparEan(produto.ean), produto.unit || "");
  const descobertos = codigosDaFamiliaOferta(oferta.nome, produto, catalogo, regras.porQuilo, oferta.excecoes || [], oferta.precoClube ?? oferta.preco);
  const codigos = oferta.codigosEditados ? normalizarCodigos(oferta.codigos || []) : normalizarCodigos(descobertos);
  return {
    ...oferta, imagem: oferta.imagem || produto.image_url || "", encontrado: oferta.encontrado || produto.description,
    codigos, codigo: codigos.join(";"), ean: oferta.ean || limparEan(produto.ean),
    codigoInterno: regras.porQuilo ? codigoCatalogo : oferta.codigoInterno,
    nota: Math.max(oferta.nota, candidato.score), porQuilo: regras.porQuilo, unidade: regras.unidade, limite: regras.limite,
  };
}

function unirGrupo(ofertas: Oferta[], alvo: Oferta, modo: ModoAgrupamento, classificacao: ClassificacaoAgrupamento, motivo: string): Oferta[] {
  const origemId = alvo.origemId;
  if (!origemId) return ofertas.map((item) => item === alvo ? { ...item, modoAgrupamento: modo, agrupamentoDetectado: classificacao, motivoAgrupamento: motivo } : item);
  const indices = ofertas.map((item, i) => item.origemId === origemId ? i : -1).filter((i) => i >= 0);
  if (!indices.length) return ofertas;
  const irmas = indices.map((i) => ofertas[i]!);
  const primeira = irmas[0]!;
  const codigos = normalizarCodigos(irmas.flatMap((item) => item.codigos));
  const unida: Oferta = {
    ...primeira,
    nome: alvo.nomeOriginal || primeira.nome,
    codigos,
    codigo: codigos.join(";"),
    ean: primeira.porQuilo ? primeira.ean : (codigos[0] || primeira.ean),
    modoAgrupamento: modo,
    agrupamentoDetectado: classificacao,
    motivoAgrupamento: motivo,
    nota: Math.max(...irmas.map((item) => item.nota)),
    imagem: irmas.find((item) => item.imagem)?.imagem || "",
    encontrado: irmas.find((item) => item.encontrado)?.encontrado || null,
  };
  const primeiroIndice = indices[0]!;
  return ofertas.filter((_, i) => !indices.includes(i) || i === primeiroIndice).map((item, i) => i === primeiroIndice ? unida : item);
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
    setOfertas((atual) => atual.map((oferta, i) => i === indice ? { ...oferta, ...mudanca, ...(Object.hasOwn(mudanca, "codigos") ? { codigosEditados: true } : {}) } : oferta));
  }

  async function alterarAgrupamento(indice: number, modo: ModoAgrupamento) {
    const alvo = ofertas[indice];
    if (!alvo) return;
    const catalogo = await carregarTodosProdutos();
    const original = alvo.nomeOriginal || alvo.nome;
    const detectado = classificarAgrupamento(original, catalogo);

    if (modo === "grouped") {
      setOfertas((atuais) => unirGrupo(atuais, alvo, "grouped", "grouped", "Agrupamento definido manualmente pelo usuário."));
      return;
    }

    const nomesSeparacao = alvo.nomesSeparacao?.length ? alvo.nomesSeparacao : detectado.nomesSeparados;
    if ((modo === "split" || (modo === "auto" && detectado.classificacao === "split")) && nomesSeparacao.length >= 2) {
      const origemId = alvo.origemId || `manual-${Date.now()}-${indice}`;
      const novas = nomesSeparacao.flatMap((nome) => {
        const cruzada = cruzar(linhaDaOferta(alvo, nome), catalogo, notaMinima);
        if (!cruzada) return [];
        return [aplicarMetadadosAgrupamento(cruzada, {
          origemId,
          nomeOriginal: original,
          modo,
          classificacao: "split",
          motivo: modo === "split" ? "Separação definida manualmente pelo usuário." : detectado.motivo,
          nomesSeparacao,
        })];
      });
      if (novas.length < 2) { toast.error("Não foi possível encontrar códigos suficientes no catálogo para separar esta oferta."); return; }
      setOfertas((atuais) => {
        const indicesGrupo = atuais.map((item, i) => item.origemId === alvo.origemId && alvo.origemId ? i : -1).filter((i) => i >= 0);
        const remover = indicesGrupo.length ? new Set(indicesGrupo) : new Set([indice]);
        const primeiro = Math.min(...remover);
        const resultado = atuais.filter((_, i) => !remover.has(i));
        resultado.splice(primeiro, 0, ...novas);
        return resultado;
      });
      return;
    }

    if (modo === "split") {
      toast.error("Não encontrei variantes explícitas suficientes para separar esta oferta com segurança.");
      return;
    }

    setOfertas((atuais) => unirGrupo(atuais, alvo, "auto", detectado.classificacao, detectado.motivo));
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]);
      if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");
      const cruzadas = linhas.flatMap((linha, indice) => cruzarLinhaComAgrupamento(linha, catalogo, notaMinima, `linha-${indice}`));
      if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");
      const finais = agruparOfertasIrmas(cruzadas);

      setOfertas(finais); setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter((item) => item.nota >= notaMinima && item.codigos.length > 0).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({ user_id: data.user.id, file_name: arquivo.name, total_items: finais.length, matched_items: correspondidas });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      const separadas = finais.filter((item) => item.agrupamentoDetectado === "split").length;
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado${separadas ? ` — ${separadas} linha(s) separada(s) por variante` : ""}.`);
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
    precisamRevisao: ofertas.filter((item) => item.nota < notaMinima || !item.codigos.length || !item.imagem || item.agrupamentoDetectado === "review").length,
    alterar, alterarAgrupamento, limparOfertas, setModalAberto, processar, modalAberto, carrossel, setCarrossel,
    ativarEm, setAtivarEm, inativarEm, setInativarEm, exportar, modalVisualizacao, setModalVisualizacao,
  };
}
