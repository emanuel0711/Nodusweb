/** Regras de negócio usadas na geração das ofertas do Clube. */
import { normalizarTexto } from "./comparar-textos";

function contem(texto: string, padrao: RegExp): boolean {
  return padrao.test(normalizarTexto(texto));
}

/** Extrai o primeiro limite numérico de um valor da planilha. */
export function extrairNumeroLimite(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return Math.trunc(valor);
  const texto = String(valor).trim();
  if (!texto || /segunda\s+unidade|segunda\s+un|na\s+segunda/.test(normalizarTexto(texto))) return null;
  const numero = texto.replace(",", ".").match(/\d+(?:\.\d+)?/)?.[0];
  if (!numero) return null;
  const valorNumerico = Number(numero);
  return Number.isFinite(valorNumerico) ? valorNumerico : null;
}

/** Quantidade de unidades em um fardo quando a planilha informa "fardo". */
export function unidadesPorFardo(nome: string): number {
  const texto = normalizarTexto(nome);
  const tamanho473 = /\b473\s?ml\b|\b473\b/.test(texto);
  const tamanho330 = /\b(330|350|355)\s?ml\b|\b(330|350|355)\b/.test(texto);

  if (/\benergetico\b|\bred horse\b|\bmonster\b|\bred bull\b/.test(texto) && tamanho473) return 6;
  if (/\bcerveja\b|\bbeer\b/.test(texto)) {
    if (tamanho473) return 12;
    if (tamanho330) return 24;
  }
  if (/\b2\s?l\b|\b2000\s?ml\b/.test(texto)) return 8;
  if (/\b1\s?5\s?l\b|\b1500\s?ml\b/.test(texto)) return 6;
  return 12;
}

/** Decide se a oferta é vendida por Kg. Tudo que não for claramente Kg vira Unidade. */
export function ehPorQuilo(nome: string, limiteTexto: string, codigoInterno: string, ean: string, unidadeCatalogo = ""): boolean {
  const texto = `${limiteTexto} ${nome}`;
  const unidade = normalizarTexto(unidadeCatalogo);
  if (contem(texto, /\bkg\b|\bkilo\b|\bquilo\b|\bgranel\b|\bpeso\b/)) return true;
  if (/^kg$|\bkg\b|quilograma|quilo/.test(unidade)) return true;
  if (contem(texto, /\bfardo\b|\bfardos\b|\bfd\b|\bund\b|\bunidade\b|\bun\b|\bcx\b|\bcaixa\b|\bpct\b|\bpcte\b/)) return false;
  return !ean && Boolean(codigoInterno) && codigoInterno.length <= 7;
}

export interface RegraOferta {
  porQuilo: boolean;
  unidade: "Kg" | "Unidade";
  limite: number | null;
}

/** Lê o limite e converte fardo para a quantidade total de unidades. */
export function aplicarRegras(nome: string, limiteBruto: unknown, codigoInterno: string, ean: string, unidadeCatalogo = ""): RegraOferta {
  const limiteTexto = String(limiteBruto ?? "").trim();
  const normalizado = normalizarTexto(limiteTexto);
  const porQuilo = ehPorQuilo(nome, limiteTexto, codigoInterno, ean, unidadeCatalogo);
  const numero = extrairNumeroLimite(limiteTexto);

  if (numero == null || !normalizado) return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite: null };

  const ehFardo = /\bfardo\b|\bfardos\b|\bfd\b|\bcaixa\b|\bcx\b/.test(normalizado);
  const limite = ehFardo ? numero * unidadesPorFardo(nome) : numero;
  return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite: porQuilo ? limite : Math.round(limite) };
}
