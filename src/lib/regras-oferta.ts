/** Regras de negócio usadas na geração das ofertas do Clube. */
import { normalizarTexto } from "./comparar-textos";

function contem(texto: string, padrao: RegExp): boolean {
  return padrao.test(normalizarTexto(texto));
}

/** Extrai o primeiro número do limite sem perder casas decimais de produtos por Kg. */
export function extrairNumeroLimite(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  if (typeof valor === "number" && Number.isFinite(valor)) return valor;

  const texto = String(valor).trim();
  if (!texto) return null;
  const normalizado = normalizarTexto(texto);
  if (/segunda\s+unidade|segunda\s+un|na\s+segunda/.test(normalizado)) return null;

  const numero = texto.replace(/\s/g, "").replace(/,(?=\d)/, ".").match(/\d+(?:\.\d+)?/)?.[0];
  if (!numero) return null;
  const valorNumerico = Number(numero);
  return Number.isFinite(valorNumerico) ? valorNumerico : null;
}

/** Quantidade de unidades em um fardo quando a planilha informa "fardo". */
export function unidadesPorFardo(nome: string): number {
  const texto = normalizarTexto(nome);
  const tamanho473 = /\b473\s?ml\b|\b473\b/.test(texto);
  const tamanho330 = /\b(330|350|355)\s?ml\b|\b(330|350|355)\b/.test(texto);

  // Energéticos de 473 ml são vendidos em fardos de 6.
  if (/\benergetico\b|\bred horse\b|\bmonster\b|\bred bull\b/.test(texto) && tamanho473) return 6;

  // Cervejas: 473 ml = 12; latas menores = 24.
  if (/\bcerveja\b|\bbeer\b/.test(texto)) {
    if (tamanho473) return 12;
    if (tamanho330) return 24;
  }

  // Refrigerantes e demais bebidas conforme o padrão informado pelo mercado.
  if (/\b2\s?l\b|\b2000\s?ml\b/.test(texto)) return 8;
  if (/\b1\s?5\s?l\b|\b1500\s?ml\b/.test(texto)) return 6;
  return 12;
}

/**
 * Identifica Kg usando a evidência mais confiável disponível.
 * Ordem: unidade do catálogo > limite/nome > código interno sem EAN.
 */
export function ehPorQuilo(
  nome: string,
  limiteTexto: string,
  codigoInterno: string,
  ean: string,
  unidadeCatalogo = "",
): boolean {
  const unidade = normalizarTexto(unidadeCatalogo);
  const texto = normalizarTexto(`${limiteTexto} ${nome}`);

  // O cadastro explícito do catálogo vence heurísticas do nome.
  if (/^kg$|\bkg\b|quilograma|quilo|kilo/.test(unidade)) return true;
  if (/^un$|^und$|^unidade$|\bunidade\b|\bund\b|\bfardo\b|\bfd\b|\bcaixa\b|\bcx\b|\bpct\b/.test(unidade)) return false;

  // A planilha normalmente informa a unidade no limite ou no próprio nome.
  if (/\bkg\b|\bkilo\b|\bquilo\b|\bquilograma\b|\bgranel\b|\bpeso\b/.test(texto)) return true;
  if (/\bfardo\b|\bfardos\b|\bfd\b|\bund\b|\bunidade\b|\bun\b|\bcx\b|\bcaixa\b|\bpct\b|\bpcte\b/.test(texto)) return false;

  // Código interno curto sem EAN é a última evidência para produto de balança.
  const interno = String(codigoInterno ?? "").trim();
  const barras = String(ean ?? "").replace(/\D/g, "");
  return !barras && /^\d{1,7}$/.test(interno);
}

export interface RegraOferta {
  porQuilo: boolean;
  unidade: "Kg" | "Unidade";
  limite: number | null;
}

/** Lê o limite e converte fardo para a quantidade total de unidades. */
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
  const numero = extrairNumeroLimite(limiteTexto);

  if (numero == null || !normalizado) {
    return { porQuilo, unidade: porQuilo ? "Kg" : "Unidade", limite: null };
  }

  const ehFardo = /\bfardo\b|\bfardos\b|\bfd\b|\bcaixa\b|\bcx\b/.test(normalizado);
  const limite = ehFardo ? numero * unidadesPorFardo(nome) : numero;

  return {
    porQuilo,
    unidade: porQuilo ? "Kg" : "Unidade",
    // Kg mantém decimal (ex.: 2,5 kg); unidade/fardo deve ser inteiro.
    limite: porQuilo ? limite : Math.round(limite),
  };
}
