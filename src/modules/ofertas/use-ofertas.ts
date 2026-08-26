import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportarModeloDoClube, lerPlanilha, valorDoCampo, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { lerPreco, melhorCorrespondencia, normalizarTexto, semelhanca } from "@/lib/comparar-textos";
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
  return String(valorDoCampo(linha, ["Limite por cliente", "Limite por cliente (CPF)", "Limite por CPF", "Limite cliente", "Limite por pessoa", "Qtd. limite", "Quantidade limite", "LIMITE", "Limite"]) ?? "").trim();
}

/** Só lê campos explicitamente identificados como código interno. */
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

const TOKENS_KG_GENERICO = new Set(["kg", "quilo", "kilo", "quilograma", "carne", "bov", "bovina", "bovino", "suina", "suino", "suina", "res", "resf", "com", "sem", "capa", "pessoa", "por", "cliente"]);

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

/** Custo ausente não bloqueia; custo conhecido acima do preço da oferta bloqueia o candidato. */
function custoCompativel(custo: number | null, precoOferta: number | null): boolean {
  if (custo == null || precoOferta == null || !Number.isFinite(custo) || !Number.isFinite(precoOferta) || precoOferta <= 0) return true;
  return custo <= precoOferta * 1.15;
}

/** Busca textual nunca usa um produto cujo custo conhecido é incompatível com a oferta. */
function melhorCorrespondenciaComCusto(nome: string, catalogo: Produto[], notaMinima: number, precoOferta: number | null): { item: Produto; score: number } | null {
  const alvo = normalizarTexto(nome);
  if (!alvo) return null;
  const candidatos = catalogo
    .filter((item) => custoCompativel(item.cost, precoOferta))
    .map((item) => ({ item, score: semelhanca(alvo, item.description) }))
    .filter(({ score }) => score >= notaMinima)
    .sort((a, b) => b.score - a.score);
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
  const achadoNome = melhorCorrespondenciaComCusto(nome, catalogo, notaMinima, precoParaCusto);
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

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function atualizarComCatalogo(oferta: Oferta, catalogo: Produto[]): Oferta {
  const candidato = oferta.porQuilo
    ? (melhorCorrespondenciaKg(oferta.nome, catalogo) || melhorCorrespondenciaComCusto(oferta.nome, catalogo, 0.72, oferta.precoClube ?? oferta.preco))
    : melhorCorrespondenciaComCusto(oferta.nome, catalogo, 0.72, oferta.precoClube ?? oferta.preco);
  if (!candidato) return oferta;
  if (oferta.encontrado && candidato.item.description !== oferta.encontrado) return oferta;

  const encontrado = oferta.porQuilo ? (recuperarCodigoKg(oferta.nome, candidato.item, catalogo) ?? candidato.item) : candidato.item;
  const produto = oferta.porQuilo ? (produtoComCodigoInterno(encontrado, catalogo) ?? encontrado) : encontrado;
  const codigoCatalogo = limparCodigo(produto.internal_code);
  const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, codigoCatalogo, limparEan(produto.ean), produto.unit || "");
  const descobertos = codigosDaFamiliaOferta(oferta.nome, produto, catalogo, regras.porQuilo, oferta.excecoes || [], oferta.precoClube ?? oferta.preco);
  const codigos = oferta.codigosEditados ? normalizarCodigos(oferta.codigos || []) : normalizarCodigos(descobertos);
  return {
    ...oferta,
    imagem: oferta.imagem || produto.image_url || "",
    encontrado: oferta.encontrado || produto.description,
    nota: Math.max(oferta.nota, candidato.score),
    ean: limparEan(produto.ean) || oferta.ean,
    codigoInterno: regras.porQuilo ? codigoCatalogo : "",
    porQuilo: regras.porQuilo,
    unidade: regras.unidade,
    limite: regras.limite,
    codigos,
    codigo: codigos.join(";"),
  };
}

// ... restante do módulo permanece igual.
