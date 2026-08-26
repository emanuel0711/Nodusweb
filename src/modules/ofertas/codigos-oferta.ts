/** Seleção determinística de códigos de oferta por identidade, variante, tamanho e custo. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const TOKENS_GENERICOS = new Set(["kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd", "produto", "produtos", "mercadoria", "bov", "bovina", "bovino"]);
const TOKENS_IGNORADOS = new Set(["a", "as", "o", "os", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "por", "para", "pra", "ao", "aos", "um", "uma", "uns", "umas"]);

export type Variante = "tradicional" | "zero" | "com_gas" | "sem_gas" | "com_alcool" | "sem_alcool";
type FamiliaVariante = "trad_zero" | "gas" | "alcool";

const FAMILIAS_VARIANTE: Array<{ familia: FamiliaVariante; variantes: readonly Variante[] }> = [
  { familia: "trad_zero", variantes: ["tradicional", "zero"] },
  { familia: "gas", variantes: ["com_gas", "sem_gas"] },
  { familia: "alcool", variantes: ["com_alcool", "sem_alcool"] },
];

const TOKENS_VARIANTE = new Set(["com", "sem", "tradicional", "zero", "gas", "alcool"]);

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
  return [...new Set(compactarTexto(valor).split(/\s+/).filter((token) => token.length >= 2 && !TOKENS_GENERICOS.has(token) && !TOKENS_IGNORADOS.has(token) && !TOKENS_VARIANTE.has(token)))];
}

function tamanhosDoProduto(valor: string): string[] {
  return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((match) => `${match[1]!.replace(",", ".")}${match[2]!}`))];
}

function tamanhosCompativeis(oferta: string, descricao: string): boolean {
  const tamanhos = tamanhosDoProduto(oferta);
  return !tamanhos.length || tamanhos.every((tamanho) => tamanhosDoProduto(descricao).includes(tamanho));
}

function tokensExcecao(valor: string): string[][] {
  const texto = normalizarTexto(valor);
  if (!texto.includes("exceto")) return [];
  return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map((parte) => tokensFamilia(parte.trim())).filter((tokens) => tokens.length);
}

export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] {
  return [nome, ...Object.values(linha).map((valor) => String(valor ?? ""))].flatMap(tokensExcecao).filter((tokens) => tokens.length);
}

export function variantesDoTexto(valor: string): Set<Variante> {
  const texto = compactarTexto(valor);
  const variantes = new Set<Variante>();
  if (/\bzero\b/.test(texto)) variantes.add("zero");
  if (/\btradicional\b/.test(texto)) variantes.add("tradicional");

  const comGas = /\bcom\s+gas\b/.test(texto);
  const semGas = /\bsem\s+gas\b/.test(texto);
  if (comGas) variantes.add("com_gas");
  if (semGas) variantes.add("sem_gas");

  const comAlcool = /\bcom\s+alcool\b/.test(texto);
  const semAlcool = /\bsem\s+alcool\b/.test(texto);
  if (comAlcool) variantes.add("com_alcool");
  if (semAlcool) variantes.add("sem_alcool");

  return variantes;
}

function variantesDaOferta(nome: string): Set<Variante> {
  return variantesDoTexto(nome);
}

function variantesDaFamilia(variantes: Set<Variante>, familia: FamiliaVariante): Variante[] {
  const configuracao = FAMILIAS_VARIANTE.find((item) => item.familia === familia);
  return configuracao ? configuracao.variantes.filter((variante) => variantes.has(variante)) : [];
}

function varianteExplicitamenteConflitante(oferta: string, descricao: string): boolean {
  const desejadas = variantesDaOferta(oferta);
  if (!desejadas.size) return false;
  const encontradas = variantesDoTexto(descricao);
  if (!encontradas.size) return false;
  return FAMILIAS_VARIANTE.some(({ familia }) => {
    const ofertaFam = variantesDaFamilia(desejadas, familia);
    const produtoFam = variantesDaFamilia(encontradas, familia);
    return ofertaFam.length > 0 && produtoFam.length > 0 && !produtoFam.some((variante) => ofertaFam.includes(variante));
  });
}

function contemToken(descricao: string, token: string): boolean {
  const candidatos = tokensFamilia(descricao);
  return candidatos.includes(token) || candidatos.some((candidato) => candidato.length >= 4 && token.length >= 4 && semelhanca(token, candidato) >= 0.82);
}

function contemTodosTokens(descricao: string, tokens: string[]): boolean {
  return tokens.every((token) => contemToken(descricao, token));
}

function candidatoExcluido(item: Produto, excecoes: string[][]): boolean {
  if (!excecoes.length) return false;
  const descricao = normalizarTexto(item.description);
  const codigos = [limparEan(item.ean), limparCodigo(item.internal_code), limparCodigo(item.promotion_code)];
  return excecoes.some((tokens) => {
    if (!tokens.length) return false;
    const texto = tokens.join(" ");
    if (/^\d{8,14}$/.test(texto)) return codigos.includes(texto);
    return tokens.every((token) => descricao.includes(token));
  });
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

function pontuacaoCandidato(nome: string, item: Produto, desejadas: Set<Variante>): number {
  const base = semelhanca(nome, item.description);
  const encontradas = variantesDoTexto(item.description);
  if (!desejadas.size || !encontradas.size) return base;
  const varianteCorrespondente = [...desejadas].some((variante) => encontradas.has(variante));
  return varianteCorrespondente ? Math.min(1, base + 0.18) : base;
}

function candidatosDaFamilia(nome: string, produto: Produto | undefined, catalogo: Produto[], excecoes: string[][], precoOferta: number | null, porQuilo: boolean): Array<{ item: Produto; score: number }> {
  const tokensOferta = tokensFamilia(nome);
  const tamanhosOferta = tamanhosDoProduto(nome);
  const desejadas = variantesDaOferta(nome);
  return catalogo
    .filter((item) => !candidatoExcluido(item, excecoes))
    .filter((item) => custoCompativel(item, precoOferta))
    .filter((item) => Boolean(codigoDoProduto(item, porQuilo)))
    .filter((item) => tamanhosCompativeis(nome, item.description))
    .filter((item) => !tamanhosOferta.length || tamanhosDoProduto(item.description).some((tamanho) => tamanhosOferta.includes(tamanho)))
    .filter((item) => !varianteExplicitamenteConflitante(nome, item.description))
    .filter((item) => !tokensOferta.length || contemTodosTokens(item.description, tokensOferta))
    .map((item) => ({ item, score: pontuacaoCandidato(nome, item, desejadas) }))
    .filter(({ item, score }) => (produto?.id === item.id) || score >= 0.38)
    .sort((a, b) => b.score - a.score);
}

function selecionarPorVariante(nome: string, candidatos: Array<{ item: Produto; score: number }>): Produto[] {
  const desejadas = variantesDaOferta(nome);
  if (!desejadas.size) return candidatos.map(({ item }) => item);

  const selecionados = new Map<string, Produto>();
  const neutros = candidatos.filter(({ item }) => !variantesDoTexto(item.description).size);
  for (const { item } of neutros) selecionados.set(item.id, item);

  for (const { familia } of FAMILIAS_VARIANTE) {
    const solicitadas = variantesDaFamilia(desejadas, familia);
    if (!solicitadas.length) continue;
    for (const variante of solicitadas) {
      const explicitos = candidatos.filter(({ item }) => variantesDoTexto(item.description).has(variante));
      if (explicitos.length) {
        selecionados.set(explicitos[0]!.id, explicitos[0]!.item);
        continue;
      }
      // Tradicional pode ser representado por um produto neutro, mas só usa um neutro por família/variante.
      // Para TRAD E ZERO, o neutro escolhido para TRAD não pode ser o mesmo produto já selecionado como ZERO.
      if (variante === "tradicional") {
        const neutro = neutros.find(({ item }) => !selecionados.has(item.id) || solicitadas.length === 1);
        if (neutro) selecionados.set(neutro.item.id, neutro.item);
      }
    }
  }

  return [...selecionados.values()];
}

export function codigosDaFamiliaOferta(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean, excecoes: string[][] = [], precoOferta: number | null = null): string[] {
  const principalValido = Boolean(produto && tamanhosCompativeis(nome, produto.description) && !candidatoExcluido(produto, excecoes) && custoCompativel(produto, precoOferta) && !varianteExplicitamenteConflitante(nome, produto.description) && codigoDoProduto(produto, porQuilo));
  const principal = principalValido ? codigoDoProduto(produto!, porQuilo) : "";
  const candidatos = candidatosDaFamilia(nome, principalValido ? produto : undefined, catalogo, excecoes, precoOferta, porQuilo);
  const selecionados = selecionarPorVariante(nome, candidatos).map((item) => codigoDoProduto(item, porQuilo)).filter(Boolean);
  return [...new Set([...(principal ? [principal] : []), ...selecionados])];
}

export function normalizarCodigos(codigos: string[]): string[] {
  return [...new Set(codigos.flatMap((valor) => String(valor ?? "").split(/[;,|\n]+/)).map((item) => item.trim()).filter(Boolean))];
}

/** Normaliza uma descrição para identificar linhas irmãs da mesma oferta sem depender das variantes. */
export function chaveBaseOferta(nome: string): string {
  return tokensFamilia(nome).join(" ");
}
