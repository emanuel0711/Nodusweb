/** Seleção dos códigos de uma oferta sem misturar tamanhos, variantes ou exceções. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const TOKENS_GENERICOS = new Set(["kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd", "produto", "produtos", "mercadoria", "bov", "bovina", "bovino"]);
const TOKENS_IGNORADOS = new Set(["a", "as", "o", "os", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "por", "para", "pra", "ao", "aos", "um", "uma", "uns", "umas"]);

type Variante = "tradicional" | "zero" | "com_gas" | "sem_gas" | "com_alcool" | "sem_alcool";

function compactarTexto(valor: string): string {
  return normalizarTexto(valor)
    .replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional")
    .replace(/\bc\s*\/\s*gas\b/g, "com gas")
    .replace(/\bs\s*\/\s*gas\b/g, "sem gas")
    .replace(/\bc\s*\/\s*alcool\b/g, "com alcool")
    .replace(/\bs\s*\/\s*alcool\b/g, "sem alcool")
    .replace(/\bcom\s+e\s+sem\s+gas\b/g, "com sem gas")
    .replace(/\bcom\s+e\s+sem\s+alcool\b/g, "com sem alcool")
    .replace(/\bexceto\b.*$/i, "")
    .trim();
}

export function tokensFamilia(valor: string): string[] {
  return [...new Set(compactarTexto(valor).split(/\s+/).filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t) && !TOKENS_IGNORADOS.has(t) && !["com", "sem", "tradicional", "zero"].includes(t)))];
}

function tamanhosDoProduto(valor: string): string[] {
  return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((m) => `${m[1]!.replace(",", ".")}${m[2]!}`))];
}

function tamanhosCompativeis(oferta: string, descricao: string): boolean {
  const tamanhos = tamanhosDoProduto(oferta);
  return !tamanhos.length || tamanhos.every((t) => tamanhosDoProduto(descricao).includes(t));
}

function tokensExcecao(valor: string): string[][] {
  const texto = normalizarTexto(valor);
  if (!texto.includes("exceto")) return [];
  return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map((parte) => tokensFamilia(parte.trim())).filter((tokens) => tokens.length);
}

export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] {
  return [nome, ...Object.values(linha).map((valor) => String(valor ?? ""))].flatMap(tokensExcecao).filter((tokens) => tokens.length);
}

function variantesDoTexto(valor: string): Set<Variante> {
  const texto = compactarTexto(valor);
  const variantes = new Set<Variante>();
  if (/\bzero\b/.test(texto)) variantes.add("zero");
  if (/\btradicional\b/.test(texto)) variantes.add("tradicional");
  if (/\bcom\s+gas\b/.test(texto) || /\bcom\s+sem\s+gas\b/.test(texto)) variantes.add("com_gas");
  if (/\bsem\s+gas\b/.test(texto) || /\bcom\s+sem\s+gas\b/.test(texto)) variantes.add("sem_gas");
  if (/\bcom\s+alcool\b/.test(texto) || /\bcom\s+sem\s+alcool\b/.test(texto)) variantes.add("com_alcool");
  if (/\bsem\s+alcool\b/.test(texto) || /\bcom\s+sem\s+alcool\b/.test(texto)) variantes.add("sem_alcool");
  return variantes;
}

function variantesDaOferta(nome: string): Set<Variante> {
  return variantesDoTexto(nome);
}

function varianteExplicitamenteConflitante(oferta: string, descricao: string): boolean {
  const desejadas = variantesDaOferta(oferta);
  if (!desejadas.size) return false;
  const encontradas = variantesDoTexto(descricao);

  // Se o catálogo não descreve a variante, não usamos esse produto para uma oferta
  // que exige uma variante específica. Sem descrição na oferta, todos continuam válidos.
  if (!encontradas.size) return true;

  // Para cada família de variantes, o candidato precisa pertencer a pelo menos uma
  // das variantes explicitamente solicitadas pela oferta.
  const familias: Array<Set<Variante>> = [
    new Set(["tradicional", "zero"]),
    new Set(["com_gas", "sem_gas"]),
    new Set(["com_alcool", "sem_alcool"]),
  ];

  return familias.some((familia) => {
    const ofertaFam = [...desejadas].filter((v) => familia.has(v));
    const produtoFam = [...encontradas].filter((v) => familia.has(v));
    return ofertaFam.length > 0 && produtoFam.length > 0 && !produtoFam.some((v) => ofertaFam.includes(v));
  });
}

function contemToken(descricao: string, token: string): boolean {
  const candidatos = tokensFamilia(descricao);
  return candidatos.includes(token) || candidatos.some((c) => c.length >= 4 && token.length >= 4 && semelhanca(token, c) >= 0.82);
}

function contemTodosTokens(descricao: string, tokens: string[]): boolean {
  return tokens.every((token) => contemToken(descricao, token));
}

function candidatoExcluido(item: Produto, excecoes: string[][]): boolean {
  if (!excecoes.length) return false;
  const descricao = normalizarTexto(item.description);
  const codigos = [limparEan(item.ean), limparCodigo(item.internal_code), limparCodigo(item.promotion_code)];
  return excecoes.some((tokens) => tokens.length && (tokens.join(" ").match(/^\d{8,14}$/) ? codigos.includes(tokens.join(" ")) : tokens.every((token) => descricao.includes(token))));
}

function codigoDoProduto(item: Produto, porQuilo: boolean): string {
  if (porQuilo) {
    const interno = limparCodigo(item.internal_code);
    return interno && !/^\d{8,14}$/.test(limparEan(interno)) ? interno : "";
  }
  return limparEan(item.ean);
}

function custoCompativel(item: Produto, precoOferta: number | null): boolean {
  if (precoOferta == null || !Number.isFinite(precoOferta) || precoOferta <= 0) return true;
  if (item.cost == null || !Number.isFinite(item.cost)) return true;
  return item.cost <= precoOferta * 1.15;
}

function candidatosDaFamilia(nome: string, produto: Produto | undefined, catalogo: Produto[], excecoes: string[][], precoOferta: number | null): Produto[] {
  const tokensOferta = tokensFamilia(nome);
  const tamanhosOferta = tamanhosDoProduto(nome);
  const referencia = produto?.description || nome;
  return catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => custoCompativel(item, precoOferta))
    .filter((item) => Boolean(codigoDoProduto(item, false)))
    .filter((item) => tamanhosCompativeis(nome, item.description))
    .filter((item) => !tamanhosOferta.length || tamanhosDoProduto(item.description).some((t) => tamanhosOferta.includes(t)))
    .filter((item) => !varianteExplicitamenteConflitante(nome, item.description))
    .filter((item) => !tokensOferta.length || contemTodosTokens(item.description, tokensOferta))
    .map((item) => ({ item, score: Math.max(semelhanca(nome, item.description), semelhanca(referencia, item.description)) }))
    .filter(({ item, score }) => (produto && item.id === produto.id) || score >= 0.38)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

export function codigosDaFamiliaOferta(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean, excecoes: string[][] = [], precoOferta: number | null = null): string[] {
  const principalValido = Boolean(produto && tamanhosCompativeis(nome, produto.description) && !candidatoExcluido(produto, excecoes) && custoCompativel(produto, precoOferta));
  const principal = principalValido ? codigoDoProduto(produto!, porQuilo) : "";
  if (porQuilo) return principal ? [principal] : [];
  const familia = candidatosDaFamilia(nome, principalValido ? produto : undefined, catalogo, excecoes, precoOferta).map((item) => codigoDoProduto(item, false)).filter(Boolean);
  return [...new Set([...familia, principal].filter(Boolean))];
}

export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(codigos.flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/)).map((item) => item.trim()).filter(Boolean))];
}
