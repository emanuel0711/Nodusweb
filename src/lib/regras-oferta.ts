/**
 * Regras de negócio das ofertas: unidade (Kg ou Unidade) e limite por cliente.
 * "Fardo" vira o total de unidades do fardo (ex.: cerveja 473ml = 12 und).
 */
import { normalizarTexto } from "./comparar-textos";

/** Quantas unidades vêm em 1 fardo, deduzido pelo nome do produto. */
export function unidadesPorFardo(nome: string): number {
  const texto = normalizarTexto(nome);
  if (/\b2\s?l\b|\b2000\s?ml\b/.test(texto)) return 8;
  if (/\b473\s?ml\b|\b473\b/.test(texto)) return 12;
  if (/\b(269|300|310|330|350|355|269ml)\b/.test(texto)) return 24;
  if (/\b(1\s?5\s?l|1500\s?ml)\b/.test(texto)) return 6;
  if (/\b(600|1\s?l|1000\s?ml)\b/.test(texto)) return 12;
  return 12;
}

/** O produto é vendido por quilo? Olha o limite, o nome e o código interno. */
export function ehPorQuilo(nome: string, limiteTexto: string, codigoInterno: string, ean: string): boolean {
  const texto = normalizarTexto(`${limiteTexto} ${nome}`);
  if (/\bkg\b|\bquilo\b|\bkilo\b|\bgranel\b|\bpeca\b|\bpeso\b/.test(texto)) return true;
  if (/\bund\b|\bun\b|\bunidade\b|\bfardo\b|\bfd\b|\bpct\b|\bcx\b/.test(texto)) return false;
  // Sem pista no texto: código interno curto (sem EAN) costuma ser produto de balança.
  return !ean && !!codigoInterno && codigoInterno.length <= 7;
}

export interface RegraOferta {
  unidade: "Kg" | "Unidade";
  limite: number | null;
}

/** Traduz o limite escrito na planilha para o número que o Clube espera. */
export function aplicarRegras(nome: string, limiteBruto: unknown, codigoInterno: string, ean: string): RegraOferta {
  const limiteTexto = String(limiteBruto ?? "").trim();
  const normalizado = normalizarTexto(limiteTexto);
  const porQuilo = ehPorQuilo(nome, limiteTexto, codigoInterno, ean);

  let limite: number | null = null;
  if (normalizado && !/segunda unidade|segunda un|na segunda/.test(normalizado)) {
    const numero = Number(limiteTexto.replace(",", ".").match(/\d+([.]\d+)?/)?.[0]);
    if (Number.isFinite(numero) && numero > 0) {
      limite = /fardo|fd\b|caixa|\bcx\b/.test(normalizado)
        ? Math.round(numero * unidadesPorFardo(nome))
        : Math.round(numero);
    }
  }

  return { unidade: porQuilo ? "Kg" : "Unidade", limite };
}
