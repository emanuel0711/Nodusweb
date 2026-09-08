import { lerPreco, normalizarTexto } from "@/shared/texto";
import { limparCodigo } from "@/shared/codigos";
import type { Produto } from "@/modules/catalogo/catalogo";
import { valorDoCampo, type LinhaPlanilha } from "@/modules/planilhas/planilha";
import { aplicarRegras, ehPorQuilo, type RegraOferta } from "./regras-oferta";
import {
  selecionarCodigosOferta,
  codigoProduto,
  separarVariantesOferta,
  normalizarCodigos,
  extrairExcecoes,
  chaveBaseOferta,
} from "./codigos-oferta";

export interface Oferta extends RegraOferta {
  nome: string;
  preco: number | null;
  precoClube: number | null;
  limiteBruto: string;
  ean: string;
  codigo: string;
  codigoInterno: string;
  codigos: string[];
  codigosEditados?: boolean;
  excecoes: string[][];
  imagem: string;
  encontrado: string | null;
  nota: number;
  motivoRevisao?: string | null;
  linhaOrigem?: LinhaPlanilha;
  nomesPorCodigo?: Record<string, string>;
}
const NOMES = [
  "PRODUTO",
  "Produto",
  "Nome do Produto",
  "Nome",
  "Descrição",
  "Descricao",
  "Mercadoria",
];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];

function valorExato(linha: LinhaPlanilha, nomes: string[]): unknown {
  for (const nome of nomes) {
    const encontrado = Object.entries(linha).find(
      ([chave, valor]) =>
        normalizarTexto(chave) === normalizarTexto(nome) && String(valor ?? "").trim() !== "",
    );
    if (encontrado) return encontrado[1];
  }
  return null;
}

export function cruzarOferta(
  linha: LinhaPlanilha,
  catalogo: Produto[],
  nomeAlternativo?: string,
  excecoesAdicionais: string[][] = [],
): Oferta | null {
  const nome = nomeAlternativo ?? String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;
  const preco = lerPreco(valorExato(linha, PRECOS)),
    precoClube = lerPreco(valorExato(linha, PRECOS_CLUBE));
  const limiteBruto = String(
    valorDoCampo(linha, ["Limite por cliente", "Limite por CPF", "LIMITE", "Limite"]) ?? "",
  ).trim();
  const excecoes = [...extrairExcecoes(linha, nome), ...excecoesAdicionais];
  const textoEAN = String(valorDoCampo(linha, ["EAN", "Código de barras", "GTIN"]) ?? "").trim();
  // O modelo de cartazes usa a coluna EAN para avisos de vigência.
  // A linha original é preservada; outros valores inválidos continuam exigindo revisão.
  const eanOrigem = /^oferta\s+dispon[ií]vel\b/i.test(textoEAN) ? "" : textoEAN;
  const internoOrigem = String(
    valorDoCampo(linha, ["Código Interno", "Cód. Interno", "Código da balança"]) ?? "",
  ).trim();
  let base = catalogo;
  if (eanOrigem) {
    const codigos = normalizarCodigos([eanOrigem]);
    base = catalogo.filter((p) => codigos.includes(String(p.ean ?? "").trim()));
    if (codigos.some((c) => !base.some((p) => p.ean === c))) base = [];
  } else if (internoOrigem)
    base = catalogo.filter((p) => limparCodigo(p.internal_code) === limparCodigo(internoOrigem));
  let porQuilo = ehPorQuilo(nome, limiteBruto, "", "");
  let selecao = selecionarCodigosOferta(nome, base, porQuilo, excecoes, precoClube ?? preco);
  if (
    !selecao.codigos.length &&
    !eanOrigem &&
    !porQuilo &&
    selecao.motivo?.startsWith("Nenhum código")
  ) {
    const porPeso = base.filter((p) => /^(kg|quilo|quilograma)$/i.test(p.unit ?? ""));
    const alternativa = selecionarCodigosOferta(nome, porPeso, true, excecoes, precoClube ?? preco);
    if (alternativa.codigos.length) {
      selecao = alternativa;
      porQuilo = true;
    }
  }
  const itemComImagem = selecao.produtos.find((produto) => produto.image_url?.trim());
  const item = itemComImagem ?? selecao.produtos[0];
  const regras = aplicarRegras(
    nome,
    limiteBruto,
    porQuilo ? (selecao.codigos[0] ?? "") : "",
    porQuilo ? "" : (selecao.codigos[0] ?? ""),
    porQuilo ? "KG" : "UN",
  );
  return {
    nome,
    preco,
    precoClube,
    limiteBruto,
    ...regras,
    ean: porQuilo ? "" : (selecao.codigos[0] ?? ""),
    codigoInterno: porQuilo ? (selecao.codigos[0] ?? "") : "",
    codigos: selecao.codigos,
    codigo: selecao.codigos.join(";"),
    codigosEditados: false,
    excecoes,
    imagem: item?.image_url ?? "",
    encontrado:
      selecao.produtos
        .map((p) => p.description)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(" / ") || null,
    nota: selecao.nota,
    motivoRevisao: selecao.motivo,
    linhaOrigem: linha,
    nomesPorCodigo: Object.fromEntries(
      selecao.produtos.map((p) => [
        porQuilo ? limparCodigo(p.internal_code) : p.ean!,
        p.description,
      ]),
    ),
  };
}
export function agruparOfertasIrmas(ofertas: Oferta[]): Oferta[] {
  const grupos = new Map<string, Oferta>();
  for (const oferta of ofertas) {
    const chave =
      oferta.codigosEditados || !oferta.codigos.length
        ? "individual:" + grupos.size
        : JSON.stringify([
            chaveBaseOferta(oferta.nome),
            oferta.preco,
            oferta.precoClube,
            oferta.limite,
            oferta.limiteBruto,
            oferta.unidade,
            oferta.excecoes,
          ]);
    const anterior = grupos.get(chave);
    const codigos = normalizarCodigos([...(anterior?.codigos ?? []), ...oferta.codigos]);
    grupos.set(chave, {
      ...(anterior ?? oferta),
      codigos,
      codigo: codigos.join(";"),
      nomesPorCodigo: { ...anterior?.nomesPorCodigo, ...oferta.nomesPorCodigo },
      nota: Math.min(anterior?.nota ?? 1, oferta.nota),
      motivoRevisao: anterior?.motivoRevisao || oferta.motivoRevisao || null,
    });
  }
  return [...grupos.values()];
}
export function processarLinhasOfertas(linhas: LinhaPlanilha[], catalogo: Produto[]): Oferta[] {
  return agruparOfertasIrmas(
    linhas.flatMap((linha) => {
      const nome = String(valorDoCampo(linha, NOMES) || "").trim();
      return separarVariantesOferta(nome)
        .map((n) => cruzarOferta(linha, catalogo, n))
        .filter((o): o is Oferta => o !== null);
    }),
  );
}
export function validarCodigosNoCatalogo(oferta: Oferta, catalogo: Produto[]): boolean {
  const permitidos = new Set(
    catalogo.map((p) => codigoProduto(p, oferta.porQuilo)).filter(Boolean),
  );
  const codigos = normalizarCodigos(oferta.codigos);
  return codigos.length > 0 && codigos.every((c) => permitidos.has(c));
}
