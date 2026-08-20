/**
 * Comparação de nomes de produtos e leitura de números (preço, limite).
 */

export function normalizarTexto(valor: string): string {
  return (valor ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pares(valor: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (let i = 0; i < valor.length - 1; i++) {
    const par = valor.slice(i, i + 2);
    mapa.set(par, (mapa.get(par) ?? 0) + 1);
  }
  return mapa;
}

const PALAVRAS_GENERICAS = new Set(["kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd", "bov", "bovina", "bovino", "produto", "mercadoria"]);

function tokensUteis(valor: string): string[] {
  return [...new Set(normalizarTexto(valor).split(" ").filter((t) => t.length >= 2 && !PALAVRAS_GENERICAS.has(t)))];
}

function similaridadeToken(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return 0;
}

/** Nota de semelhança entre dois nomes, reforçando palavras distintivas. */
export function semelhanca(a: string, b: string): number {
  const x = normalizarTexto(a);
  const y = normalizarTexto(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const pa = pares(x);
  const pb = pares(y);
  let iguais = 0;
  let totalA = 0;
  let totalB = 0;
  pa.forEach((qtd, par) => {
    totalA += qtd;
    const outro = pb.get(par);
    if (outro) iguais += Math.min(qtd, outro);
  });
  pb.forEach((qtd) => (totalB += qtd));
  const porLetras = (2 * iguais) / (totalA + totalB);

  const aTokens = tokensUteis(a);
  const bTokens = tokensUteis(b);
  let correspondencias = 0;
  for (const ta of aTokens) {
    let melhor = 0;
    for (const tb of bTokens) melhor = Math.max(melhor, similaridadeToken(ta, tb));
    if (melhor >= 0.72) correspondencias += melhor;
  }
  const coberturaA = aTokens.length ? correspondencias / aTokens.length : 0;
  const coberturaB = bTokens.length ? correspondencias / bTokens.length : 0;
  const porPalavras = (2 * coberturaA * coberturaB) / Math.max(0.0001, coberturaA + coberturaB);

  return porLetras * 0.45 + porPalavras * 0.55;
}

export interface ItemComparavel {
  id: string;
  description: string;
}

export function melhorCorrespondencia<T extends ItemComparavel>(
  nome: string,
  lista: T[],
  notaMinima = 0.55,
): { item: T; score: number } | null {
  const alvo = normalizarTexto(nome);
  if (!alvo) return null;

  let melhor: { item: T; score: number } | null = null;
  for (const item of lista) {
    const nota = semelhanca(alvo, item.description);
    if (!melhor || nota > melhor.score) melhor = { item, score: nota };
    if (nota === 1) break;
  }
  return melhor && melhor.score >= notaMinima ? melhor : null;
}

/** Pega o limite por cliente, ignorando frases como "na segunda unidade". */
export function lerLimite(valor: unknown): number | null {
  if (valor == null) return null;
  const texto = String(valor).trim();
  if (!texto) return null;
  if (/segunda unidade|segunda un|na segunda/.test(normalizarTexto(texto))) return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.trunc(valor);
  const encontrado = texto.replace(",", ".").match(/\d+(\.\d+)?/);
  if (!encontrado) return null;
  const numero = Number(encontrado[0]);
  return Number.isFinite(numero) ? Math.trunc(numero) : null;
}

export function lerPreco(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const limpo = String(valor)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}
