/** Regras para reunir códigos de um item da planilha sem misturar variantes. */
import { normalizarTexto, semelhanca } from "./comparar-textos";
import { limparCodigo, limparEan, type Produto } from "./catalogo";

const TOKENS_GENERICOS = new Set([
  "kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd",
  "produto", "mercadoria", "bov", "bovina", "bovino",
]);

function compactarTexto(valor: string): string {
  return normalizarTexto(valor)
    .replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional")
    .replace(/\bexceto\b.*$/i, "")
    .trim();
}

export function tokensFamilia(valor: string): string[] {
  return [...new Set(compactarTexto(valor).split(/\s+/).filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t)))];
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

function contemTodosTokens(descricao: string, tokens: string[]): boolean {
  const candidatos = new Set(tokensFamilia(descricao));
  return tokens.every((token) => candidatos.has(token));
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

/** Para Kg, prioriza código interno e usa promotion_code curto apenas em cadastros antigos. */
function codigoDoProduto(item: Produto, porQuilo: boolean): string {
  if (porQuilo) {
    const interno = limparCodigo(item.internal_code);
    if (interno && !/^\d{8,14}$/.test(limparEan(interno))) return interno;
    const promocao = limparCodigo(item.promotion_code);
    if (promocao && !/^\d{8,14}$/.test(limparEan(promocao))) return promocao;
    return "";
  }
  return limparEan(item.ean);
}

function candidatosDaFamilia(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean, excecoes: string[][]): Produto[] {
  const tokensOferta = tokensFamilia(nome);
  return catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => Boolean(codigoDoProduto(item, porQuilo)))
    .filter((item) => tamanhosCompativeis(nome, item.description))
    .filter((item) => !tokensOferta.length || contemTodosTokens(item.description, tokensOferta))
    .map((item) => ({ item, score: semelhanca(nome.replace(/\bexceto\b.*$/i, ""), item.description) }))
    .filter(({ item, score }) => {
      if (produto && item.id === produto.id) return true;
      if (porQuilo) return score >= 0.88;
      return tokensOferta.length >= 3 ? score >= 0.45 : score >= 0.60;
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export function codigosDaFamiliaOferta(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean, excecoes: string[][] = []): string[] {
  const produtoCompativel = Boolean(produto && tamanhosCompativeis(nome, produto.description));
  const principal = produto && produtoCompativel ? codigoDoProduto(produto, porQuilo) : "";
  const principalExcluido = produto ? candidatoExcluido(produto, excecoes) : false;

  // Kg é sempre individual: nunca agrupar cortes/produtos parecidos.
  if (porQuilo) {
    if (!principal || principalExcluido) return [];
    return [principal];
  }

  const candidatos = candidatosDaFamilia(nome, produtoCompativel ? produto : undefined, catalogo, false, excecoes);
  const codigos = candidatos.map((item) => codigoDoProduto(item, false)).filter(Boolean);
  const todos = [...codigos, principalExcluido ? "" : principal].filter(Boolean);
  return [...new Set(todos)];
}

export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(codigos.flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/).map((item) => item.trim()).filter(Boolean)))];
}
