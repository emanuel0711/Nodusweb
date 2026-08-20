/** Regras para reunir códigos de um item da planilha sem misturar variantes. */
import { normalizarTexto, semelhanca } from "./comparar-textos";
import { limparCodigo, limparEan, type Produto } from "./catalogo";

const TOKENS_GENERICOS = new Set([
  "kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd",
  "produto", "produtos", "mercadoria", "bov", "bovina", "bovino",
]);

const TOKENS_IGNORADOS = new Set([
  "a", "as", "o", "os", "e", "de", "da", "do", "das", "dos", "em", "no", "na",
  "nos", "nas", "com", "sem", "por", "para", "pra", "ao", "aos", "um", "uma", "uns", "umas",
]);

function compactarTexto(valor: string): string {
  return normalizarTexto(valor)
    .replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional")
    .replace(/\bexceto\b.*$/i, "")
    .trim();
}

export function tokensFamilia(valor: string): string[] {
  return [...new Set(
    compactarTexto(valor)
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t) && !TOKENS_IGNORADOS.has(t)),
  )];
}

function tamanhosDoProduto(valor: string): string[] {
  const texto = compactarTexto(valor);
  return [...new Set(
    [...texto.matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((m) => `${m[1].replace(",", ".")}${m[2]}`),
  )];
}

function tamanhosCompativeis(oferta: string, descricao: string): boolean {
  const tamanhosOferta = tamanhosDoProduto(oferta);
  if (!tamanhosOferta.length) return true;
  const tamanhosProduto = tamanhosDoProduto(descricao);
  return tamanhosOferta.every((tamanho) => tamanhosProduto.includes(tamanho));
}

function tokensExcecao(valor: string): string[][] {
  const normalizado = normalizarTexto(valor);
  if (!normalizado.includes("exceto")) return [];
  const depois = normalizado.split(/\bexceto\b/).slice(1).join(" exceto ");
  return depois
    .split(/[,;|]|\s+e\s+|\s+\/\s+/)
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => tokensFamilia(parte));
}

export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] {
  const textos = [nome, ...Object.values(linha).map((valor) => String(valor ?? ""))];
  return textos.flatMap(tokensExcecao).filter((tokens) => tokens.length > 0);
}

function contemToken(descricao: string, token: string): boolean {
  const candidatos = tokensFamilia(descricao);
  if (candidatos.includes(token)) return true;
  return candidatos.some((candidato) => candidato.length >= 4 && token.length >= 4 && semelhanca(token, candidato) >= 0.82);
}

function contemTodosTokens(descricao: string, tokens: string[]): boolean {
  return tokens.every((token) => contemToken(descricao, token));
}

function candidatoExcluido(item: Produto, excecoes: string[][]): boolean {
  if (!excecoes.length) return false;
  const descricao = normalizarTexto(item.description);
  const ean = limparEan(item.ean);
  const interno = limparCodigo(item.internal_code);
  const promocao = limparCodigo(item.promotion_code);

  return excecoes.some((tokens) => {
    const textoExcecao = tokens.join(" ");
    if (/^\d{8,14}$/.test(textoExcecao)) return [ean, interno, promocao].includes(textoExcecao);
    return tokens.length > 0 && tokens.every((token) => descricao.includes(token));
  });
}

/**
 * Define o código que pode ser exportado para o Clube.
 * Unidade = somente EAN. Kg = somente código interno.
 * Código de promoção nunca entra como fallback de nenhum dos dois.
 */
function codigoDoProduto(item: Produto, porQuilo: boolean): string {
  if (porQuilo) {
    const interno = limparCodigo(item.internal_code);
    return interno && !/^\d{8,14}$/.test(limparEan(interno)) ? interno : "";
  }
  return limparEan(item.ean);
}

function candidatosDaFamilia(
  nome: string,
  produto: Produto | undefined,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][],
): Produto[] {
  if (porQuilo) return [];

  const tokensOferta = tokensFamilia(nome);
  const tamanhoOferta = tamanhosDoProduto(nome);
  const referencia = produto?.description || nome;

  return catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => Boolean(codigoDoProduto(item, false)))
    .filter((item) => tamanhosCompativeis(nome, item.description))
    .filter((item) => !tamanhoOferta.length || tamanhosDoProduto(item.description).some((t) => tamanhoOferta.includes(t)))
    .filter((item) => !tokensOferta.length || contemTodosTokens(item.description, tokensOferta))
    .map((item) => ({ item, scoreNome: semelhanca(nome, item.description), scoreReferencia: semelhanca(referencia, item.description) }))
    .filter(({ item, scoreNome, scoreReferencia }) => {
      if (produto && item.id === produto.id) return true;
      return scoreNome >= 0.38 || scoreReferencia >= 0.58;
    })
    .sort((a, b) => Math.max(b.scoreNome, b.scoreReferencia) - Math.max(a.scoreNome, a.scoreReferencia))
    .map(({ item }) => item);
}

export function codigosDaFamiliaOferta(
  nome: string,
  produto: Produto | undefined,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][] = [],
): string[] {
  const produtoCompativel = Boolean(produto && tamanhosCompativeis(nome, produto.description));
  const principal = produto && produtoCompativel ? codigoDoProduto(produto, porQuilo) : "";
  const principalExcluido = produto ? candidatoExcluido(produto, excecoes) : false;

  if (porQuilo) {
    if (!principal || principalExcluido) return [];
    return [principal];
  }

  const candidatos = candidatosDaFamilia(nome, produtoCompativel ? produto : undefined, catalogo, false, excecoes);
  const codigos = candidatos.map((item) => codigoDoProduto(item, false)).filter(Boolean);
  const todos = [...codigos, principalExcluido ? "" : principal].filter(Boolean);
  return [...new Set(todos)];
}

/** Normaliza códigos digitados/importados e mantém o formato exigido pelo Clube: codigo1;codigo2;codigo3. */
export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(
    codigos
      .flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/))
      .map((item) => item.trim())
      .filter(Boolean),
  )];
}
