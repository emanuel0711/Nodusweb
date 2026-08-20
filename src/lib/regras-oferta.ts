/**
 * Regras de negócio das ofertas: unidade (Kg ou Unidade) e limite por cliente.
 * "Fardo" vira o total de unidades do fardo.
 */
import { normalizarTexto } from "./comparar-textos";

/** Quantas unidades vêm em 1 fardo, deduzido pelo nome do produto. */
export function unidadesPorFardo(nome: string): number {
  const texto = normalizarTexto(nome);
  const energetico = /\benergetico\b|\bred\s+horse\b|\bmonster\b|\bred\s+bull\b/.test(texto);

  // Regra específica do mercado: energéticos de 473 ml vêm em fardos de 6.
  if (energetico && /\b473\s?ml\b|\b473\b/.test(texto)) return 6;

  // Cervejas de 473 ml vêm em fardos de 12.
  if (/\bcerveja\b|\bbeer\b/.test(texto)) {
    if (/\b473\s?ml\b|\b473\b/.test(texto)) return 12;
    if (/\b(330|350|355)\s?ml\b|\b(330|350|355)\b/.test(texto)) return 24;
  }

  // Refrigerantes de 2 L: 8 unidades por fardo.
  if (/\b2\s?l\b|\b2000\s?ml\b/.test(texto)) return 8;
  if (/\b1\s?5\s?l\b|\b1500\s?ml\b/.test(texto)) return 6;

  // Para outros fardos, mantém a regra padrão de 12 unidades.
  return 12;
}

/**
 * Determina KG com as pistas realmente usadas pelo negócio:
 * - KG/KILO no limite ou no nome;
 * - unidade do catálogo marcada como KG;
 * - código interno sem EAN, quando não há outra pista de unidade.
 * Tudo que não for claramente KG é Unidade.
 */
export function ehPorQuilo(
  nome: string,
  limiteTexto: string,
  codigoInterno: string,
  ean: string,
  unidadeCatalogo = "",
): boolean {
  const texto = normalizarTexto(`${limiteTexto} ${nome}`);
  const unidade = normalizarTexto(unidadeCatalogo);

  if (/\bkg\b|\bkilo\b|\bquilo\b|\bgranel\b|\bpeso\b/.test(texto)) return true;
  if (/^kg$|\bkg\b|quilograma|quilo/.test(unidade)) return true;
  if (/\bfardo\b|\bfardos\b|\bund\b|\bunidade\b|\bun\b|\bcx\b|\bcaixa\b|\bpct\b|\bpcte\b/.test(texto)) return false;

  // Produtos de balança normalmente chegam sem EAN e com código interno curto.
  return !ean && !!codigoInterno && codigoInterno.length <= 7;
}

export interface RegraOferta {
  porQuilo: boolean;
  unidade: "Kg" | "Unidade";
  limite: number | null;
}

/** Traduz o limite escrito na planilha para o número que o Clube espera. */
export function aplicarRegras(
  nome: string,
  limiteBruto: unknown,
  codigoInterno: string,
  ean: string,
  unidadeCatalogo = "",
): RegraOferta {
  const limiteTexto = String(limiteBruto ?? "").trim();
  const normalizado = normalizarTexto(limiteTexto);
  const porQuilo = ehPorQuilo(nome, limiteTexto, codigoInterno, ean, unidadeCatalogo);

  let limite: number | null = null;
  if (normalizado && !/segunda unidade|segunda un|na segunda/.test(normalizado)) {
    const numeroTexto = limiteTexto.replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0];
    const numero = numeroTexto ? Number(numeroTexto) : NaN;
    if (Number.isFinite(numero) && numero > 0) {
      const porFardo = /\bfardo\b|\bfardos\b|\bfd\b|\bcaixa\b|\bcx\b/.test(normalizado);
      limite = porFardo ? numero * unidadesPorFardo(nome) : numero;
      // Limites de unidade/fardo são inteiros; produtos por Kg podem ter fração.
      if (!porQuilo) limite = Math.round(limite);
    }
  }

  return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite };
}
