/** Seleção dos códigos de uma oferta sem misturar tamanhos, variantes ou exceções. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const TOKENS_GENERICOS = new Set(["kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd", "produto", "produtos", "mercadoria", "bov", "bovina", "bovino"]);
const TOKENS_IGNORADOS = new Set(["a", "as", "o", "os", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "com", "sem", "por", "para", "pra", "ao", "aos", "um", "uma", "uns", "umas"]);

function compactarTexto(valor: string): string {
  return normalizarTexto(valor).replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2").replace(/\btrad\b/g, "tradicional").replace(/\bexceto\b.*$/i, "").trim();
}
export function tokensFamilia(valor: string): string[] { return [...new Set(compactarTexto(valor).split(/\s+/).filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t) && !TOKENS_IGNORADOS.has(t)))]; }
function tamanhosDoProduto(valor: string): string[] { return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((m) => `${m[1].replace(",", ".")}${m[2]}`))]; }
function tamanhosCompativeis(oferta: string, descricao: string): boolean { const tamanhos = tamanhosDoProduto(oferta); return !tamanhos.length || tamanhos.every((t) => tamanhosDoProduto(descricao).includes(t)); }
function tokensExcecao(valor: string): string[][] { const texto = normalizarTexto(valor); if (!texto.includes("exceto")) return []; return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map((parte) => tokensFamilia(parte.trim())).filter((tokens) => tokens.length); }
export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] { return [nome, ...Object.values(linha).map((valor) => String(valor ?? ""))].flatMap(tokensExcecao).filter((tokens) => tokens.length); }
function contemToken(descricao: string, token: string): boolean { const candidatos = tokensFamilia(descricao); return candidatos.includes(token) || candidatos.some((c) => c.length >= 4 && token.length >= 4 && semelhanca(token, c) >= 0.82); }
function contemTodosTokens(descricao: string, tokens: string[]): boolean { return tokens.every((token) => contemToken(descricao, token)); }
function candidatoExcluido(item: Produto, excecoes: string[][]): boolean {
  if (!excecoes.length) return false;
  const descricao = normalizarTexto(item.description);
  const codigos = [limparEan(item.ean), limparCodigo(item.internal_code), limparCodigo(item.promotion_code)];
  return excecoes.some((tokens) => tokens.length && (tokens.join(" ").match(/^\d{8,14}$/) ? codigos.includes(tokens.join(" ")) : tokens.every((token) => descricao.includes(token))));
}

/** Unidade usa EAN; Kg usa código interno. Código promocional nunca substitui os dois. */
function codigoDoProduto(item: Produto, porQuilo: boolean): string {
  if (porQuilo) {
    const interno = limparCodigo(item.internal_code);
    return interno && !/^\d{8,14}$/.test(limparEan(interno)) ? interno : "";
  }
  return limparEan(item.ean);
}

function candidatosDaFamilia(nome: string, produto: Produto | undefined, catalogo: Produto[], excecoes: string[][]): Produto[] {
  const tokensOferta = tokensFamilia(nome);
  const tamanhosOferta = tamanhosDoProduto(nome);
  const referencia = produto?.description || nome;
  return catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => Boolean(codigoDoProduto(item, false)))
    .filter((item) => tamanhosCompativeis(nome, item.description))
    .filter((item) => !tamanhosOferta.length || tamanhosDoProduto(item.description).some((t) => tamanhosOferta.includes(t)))
    .filter((item) => !tokensOferta.length || contemTodosTokens(item.description, tokensOferta))
    .map((item) => ({ item, score: Math.max(semelhanca(nome, item.description), semelhanca(referencia, item.description)) }))
    .filter(({ item, score }) => (produto && item.id === produto.id) || score >= 0.38)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export function codigosDaFamiliaOferta(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean, excecoes: string[][] = []): string[] {
  const principalValido = Boolean(produto && tamanhosCompativeis(nome, produto.description) && !candidatoExcluido(produto, excecoes));
  const principal = principalValido ? codigoDoProduto(produto!, porQuilo) : "";
  if (porQuilo) return principal ? [principal] : [];
  const familia = candidatosDaFamilia(nome, principalValido ? produto : undefined, catalogo, excecoes).map((item) => codigoDoProduto(item, false)).filter(Boolean);
  return [...new Set([...familia, principal].filter(Boolean))];
}

/** Normaliza a edição manual e exporta os códigos sem espaços: 123;456;789. */
export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(codigos.flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/)).map((item) => item.trim()).filter(Boolean))];
}
