/** Decide quando uma linha representa uma oferta única, agrupada ou variantes separadas. */
import { normalizarTexto } from "@/shared/texto";
import type { Produto } from "@/modules/catalogo/catalogo";

export type ModoAgrupamento = "auto" | "grouped" | "split";
export type ClassificacaoAgrupamento = "single" | "grouped" | "split" | "review";

export interface ResultadoAgrupamento {
  classificacao: ClassificacaoAgrupamento;
  confianca: number;
  motivo: string;
  nomesSeparados: string[];
}

type VarianteDef = { id: string; label: string; aliases: string[] };
type FamiliaDef = { id: string; variantes: VarianteDef[] };

const FAMILIAS: FamiliaDef[] = [
  {
    id: "trad_zero",
    variantes: [
      { id: "tradicional", label: "TRADICIONAL", aliases: ["tradicional", "trad", "original"] },
      { id: "zero", label: "ZERO", aliases: ["zero", "sem acucar", "sem açúcar"] },
    ],
  },
  {
    id: "arroz",
    variantes: [
      { id: "branco", label: "BRANCO", aliases: ["branco"] },
      { id: "parboilizado", label: "PARBOILIZADO", aliases: ["parboilizado", "parbolizado"] },
      { id: "integral", label: "INTEGRAL", aliases: ["integral"] },
    ],
  },
  {
    id: "leite",
    variantes: [
      { id: "integral", label: "INTEGRAL", aliases: ["integral"] },
      { id: "desnatado", label: "DESNATADO", aliases: ["desnatado"] },
      { id: "semidesnatado", label: "SEMIDESNATADO", aliases: ["semidesnatado", "semi desnatado"] },
      { id: "zero_lactose", label: "ZERO LACTOSE", aliases: ["zero lactose", "sem lactose"] },
    ],
  },
  {
    id: "gas",
    variantes: [
      { id: "com_gas", label: "COM GÁS", aliases: ["com gas", "c gas", "c/gas"] },
      { id: "sem_gas", label: "SEM GÁS", aliases: ["sem gas", "s gas", "s/gas"] },
    ],
  },
  {
    id: "alcool",
    variantes: [
      { id: "com_alcool", label: "COM ÁLCOOL", aliases: ["com alcool", "c alcool", "c/alcool"] },
      { id: "sem_alcool", label: "SEM ÁLCOOL", aliases: ["sem alcool", "zero alcool", "s alcool", "s/alcool"] },
    ],
  },
];

const INDICIOS_AGRUPAMENTO = [
  "sabores", "sabor", "sortidos", "sortido", "fragrancias", "fragrancia",
  "cores", "diversos", "diversas", "variedades", "variedade",
];

const TOKENS_GENERICOS = new Set([
  "de", "da", "do", "das", "dos", "e", "ou", "com", "sem", "em", "para", "por",
  "refrigerante", "refrig", "suco", "sucos", "arroz", "leite", "cerveja", "agua", "bebida",
  "kg", "g", "ml", "l", "un", "und", "pct", "pcte", "cx", "caixa", "fardo",
]);

function contemExpressao(texto: string, expressao: string): boolean {
  const alvo = normalizarTexto(texto);
  const termo = normalizarTexto(expressao).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${termo.replace(/\\ /g, "\\s+")}(?:$|\\s)`).test(alvo);
}

function variantesPresentes(nome: string, familia: FamiliaDef): VarianteDef[] {
  return familia.variantes.filter((variante) => variante.aliases.some((alias) => contemExpressao(nome, alias)));
}

function tamanhos(valor: string): string[] {
  const texto = normalizarTexto(valor).replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2");
  return [...new Set([...texto.matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((m) => `${m[1]!.replace(",", ".")}${m[2]!}`))];
}

function tokensBase(nome: string, familia: FamiliaDef): string[] {
  const aliases = new Set(familia.variantes.flatMap((v) => v.aliases.flatMap((a) => normalizarTexto(a).split(/\s+/))));
  return [...new Set(normalizarTexto(nome).split(/\s+/).filter((token) => token.length >= 2 && !TOKENS_GENERICOS.has(token) && !aliases.has(token) && !/^\d/.test(token)))];
}

function produtoConfirmaVariante(nome: string, variante: VarianteDef, familia: FamiliaDef, produto: Produto): boolean {
  const descricao = produto.description || "";
  if (!variante.aliases.some((alias) => contemExpressao(descricao, alias))) return false;
  const tamanhosOferta = tamanhos(nome);
  if (tamanhosOferta.length && !tamanhosOferta.every((t) => tamanhos(descricao).includes(t))) return false;
  const base = tokensBase(nome, familia);
  if (!base.length) return true;
  const textoProduto = normalizarTexto(descricao);
  const encontrados = base.filter((token) => textoProduto.includes(token)).length;
  return encontrados / base.length >= 0.5;
}

function removerAliases(nome: string, variantes: VarianteDef[], manter: VarianteDef): string {
  let resultado = ` ${normalizarTexto(nome)} `;
  for (const variante of variantes) {
    if (variante.id === manter.id) continue;
    for (const alias of [...variante.aliases].sort((a, b) => b.length - a.length)) {
      const termo = normalizarTexto(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\ /g, "\\s+");
      resultado = resultado.replace(new RegExp(`\\s${termo}(?=\\s|/|,|;|$)`, "g"), " ");
    }
  }
  resultado = resultado
    .replace(/\s*[\/|;,]+\s*/g, " ")
    .replace(/\s+e\s+(?=\d|$)/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return resultado.toUpperCase();
}

export function classificarAgrupamento(nome: string, catalogo: Produto[]): ResultadoAgrupamento {
  const normalizado = normalizarTexto(nome);
  if (INDICIOS_AGRUPAMENTO.some((termo) => contemExpressao(normalizado, termo))) {
    return { classificacao: "grouped", confianca: 0.98, motivo: "A descrição indica itens agrupados (sabores, fragrâncias, sortidos ou equivalentes).", nomesSeparados: [] };
  }

  for (const familia of FAMILIAS) {
    const presentes = variantesPresentes(nome, familia);
    if (presentes.length < 2) continue;

    const nomesSeparados = presentes.map((variante) => removerAliases(nome, presentes, variante));
    const confirmadas = presentes.filter((variante) => catalogo.some((produto) => produtoConfirmaVariante(nome, variante, familia, produto)));

    if (confirmadas.length === presentes.length) {
      return {
        classificacao: "split",
        confianca: 0.95,
        motivo: `Foram declaradas ${presentes.length} variantes comerciais distintas e todas existem separadamente no catálogo.`,
        nomesSeparados,
      };
    }

    return {
      classificacao: "review",
      confianca: 0.6,
      motivo: "A linha declara variantes distintas, mas o catálogo não confirmou todas com segurança.",
      nomesSeparados,
    };
  }

  return { classificacao: "single", confianca: 0.9, motivo: "Não há indicação explícita de que a oferta deva ser dividida.", nomesSeparados: [] };
}
