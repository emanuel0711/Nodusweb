/** Regras de negócio das ofertas: unidade, limite e conversão de fardos. */
import { normalizarTexto } from "@/shared/texto";

/** Extrai o primeiro número do limite sem perder casas decimais de Kg. */
export function extrairNumeroLimite(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;
  const texto = String(valor).trim();
  if (!texto || /segunda\s+unidade|segunda\s+un|na\s+segunda/.test(normalizarTexto(texto))) return null;
  const numero = texto.replace(/\s/g, "").replace(/,(?=\d)/, ".").match(/\d+(?:\.\d+)?/)?.[0];
  const resultado = Number(numero);
  return Number.isFinite(resultado) ? resultado : null;
}

/** Quantidade de unidades em um fardo, conforme o tamanho e a família do produto. */
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

/** Decide Kg primeiro pela unidade cadastrada e só depois por heurística. */
export function ehPorQuilo(nome: string, limiteTexto: string, codigoInterno: string, ean: string, unidadeCatalogo = ""): boolean {
  const unidade = normalizarTexto(unidadeCatalogo);
  const texto = normalizarTexto(`${limiteTexto} ${nome}`);
  if (/^kg$|\bkg\b|quilograma|quilo|kilo/.test(unidade)) return true;
  if (/^un$|^und$|^unidade$|\bunidade\b|\bund\b|\bfardo\b|\bfd\b|\bcaixa\b|\bcx\b|\bpct\b/.test(unidade)) return false;
  if (/\bkg\b|\bkilo\b|\bquilo\b|\bquilograma\b|\bgranel\b|\bpeso\b/.test(texto)) return true;
  if (/\bfardo\b|\bfardos\b|\bfd\b|\bund\b|\bunidade\b|\bun\b|\bcx\b|\bcaixa\b|\bpct\b|\bpcte\b/.test(texto)) return false;
  const interno = String(codigoInterno ?? "").trim();
  const barras = String(ean ?? "").replace(/\D/g, "");
  return !barras && /^\d{1,7}$/.test(interno);
}

export interface RegraOferta { porQuilo: boolean; unidade: "Kg" | "Unidade"; limite: number | null; }

/** Aplica todas as regras de unidade e limite em um único ponto do sistema. */
export function aplicarRegras(nome: string, limiteBruto: unknown, codigoInterno: string, ean: string, unidadeCatalogo = ""): RegraOferta {
  const limiteTexto = String(limiteBruto ?? "").trim();
  const porQuilo = ehPorQuilo(nome, limiteTexto, codigoInterno, ean, unidadeCatalogo);
  const numero = extrairNumeroLimite(limiteTexto);
  if (numero == null) return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite: null };
  const normalizado = normalizarTexto(limiteTexto);
  const ehFardo = /\bfardo\b|\bfardos\b|\bfd\b|\bcaixa\b|\bcx\b/.test(normalizado);
  const limite = ehFardo ? numero * unidadesPorFardo(nome) : numero;
  return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite: porQuilo ? limite : Math.round(limite) };
}
