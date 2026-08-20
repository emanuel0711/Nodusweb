/** Regras para reunir os códigos de um item da planilha sem incluir produtos marcados como "exceto". */
import { normalizarTexto, semelhanca } from "./comparar-textos";
import { limparCodigo, limparEan, type Produto } from "./catalogo";

const TOKENS_GENERICOS = new Set([
  "kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd",
  "produto", "mercadoria", "bov", "bovina", "bovino",
]);

function compactarTexto(valor: string): string {
  return normalizarTexto(valor)
    .replace(/(\d+)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional")
    .replace(/\bexceto\b.*$/i, "")
    .trim();
}

export function tokensFamilia(valor: string): string[] {
  return [...new Set(compactarTexto(valor).split(/\s+/).filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t)))];
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
    if (/^\d{8,14}$/.test(textoExcecao)) {
      return [ean, interno, promocao].includes(textoExcecao);
    }
    return tokens.length > 0 && tokens.every((token) => descricao.includes(token));
  });
}

/**
 * Retorna todos os códigos da família do item. O nome da oferta define o núcleo
 * da família; tamanho e variantes presentes no nome continuam sendo considerados,
 * portanto TRAD e ZERO só são reunidos quando a própria planilha for genérica.
 */
export function codigosDaFamiliaOferta(
  nome: string,
  produto: Produto | undefined,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][] = [],
): string[] {
  if (!produto) return [];

  const tokensOferta = tokensFamilia(nome);
  if (tokensOferta.length < 2) {
    const principal = porQuilo ? limparCodigo(produto.internal_code) : limparEan(produto.ean);
    return principal ? [principal] : [];
  }

  const principal = porQuilo ? limparCodigo(produto.internal_code) : limparEan(produto.ean);
  const candidatos = catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => contemTodosTokens(item.description, tokensOferta))
    .filter((item) => porQuilo ? Boolean(limparCodigo(item.internal_code)) : Boolean(limparEan(item.ean)))
    .map((item) => ({ item, score: semelhanca(nome.replace(/\bexceto\b.*$/i, ""), item.description) }))
    .filter(({ item, score }) => {
      if (item.id === produto.id) return true;
      // O filtro por tokens já garante a identidade. A pontuação só elimina
      // coincidências muito fracas quando a descrição da oferta é extremamente curta.
      return tokensOferta.length >= 3 || score >= 0.45;
    })
    .sort((a, b) => b.score - a.score);

  const codigos = candidatos
    .map(({ item }) => porQuilo ? limparCodigo(item.internal_code) : limparEan(item.ean))
    .filter(Boolean);

  return [...new Set([principal, ...codigos].filter(Boolean))];
}

export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(codigos.flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/).map((item) => item.trim()).filter(Boolean)))];
}
