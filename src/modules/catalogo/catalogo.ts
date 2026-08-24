/** Domínio do catálogo: tipos, normalização de códigos e importação. */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto, lerPreco } from "@/shared/texto";
import { valorDaColuna, valorDoCampo, type LinhaPlanilha } from "@/modules/planilhas/planilha";

export interface Produto {
  id: string; internal_code: string | null; promotion_code: string | null; ean: string | null;
  description: string; unit: string | null; unit_price: number | null; cost: number | null;
  category: string | null; image_url: string | null;
}

export const COLUNAS_PRODUTO = "id, internal_code, promotion_code, ean, description, unit, unit_price, cost, category, image_url";
export function limparEan(valor: unknown): string { return String(valor ?? "").replace(/\D/g, ""); }
export function limparCodigo(valor: unknown): string { return String(valor ?? "").trim().replace(/\.0+$/, ""); }
export function pareceEan(valor: unknown): boolean { return /^(\d{12}|\d{13}|\d{14})$/.test(limparEan(valor)); }

function unidadeEhKg(unidade: string | null, descricao: string): boolean {
  return /\b(kg|quilo|kilo|quilograma)\b/.test(normalizarTexto(`${unidade ?? ""} ${descricao}`));
}

function normalizarProduto(produto: Produto): Produto {
  if (!unidadeEhKg(produto.unit, produto.description)) return produto;
  const interno = limparCodigo(produto.internal_code);
  if (interno) return { ...produto, ean: null };
  const ean = limparEan(produto.ean);
  if (ean && !pareceEan(ean)) return { ...produto, internal_code: ean, ean: null };
  return { ...produto, ean: null };
}

export async function carregarTodosProdutos(): Promise<Produto[]> {
  const todos: Produto[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase.from("products").select(COLUNAS_PRODUTO).range(inicio, inicio + 999);
    if (error) throw error;
    const pagina = ((data ?? []) as unknown as Produto[]).map(normalizarProduto);
    todos.push(...pagina);
    if (pagina.length < 1000) return todos;
  }
}

export interface ProdutoImportado {
  internal_code: string | null; promotion_code: string | null; ean: string | null; description: string;
  unit: string | null; unit_price: number | null; cost: number | null; category: string; image_url: string | null;
}

/**
 * Converte uma linha da origem em produto.
 * Coluna A do CSV é ignorada. Coluna O é o custo.
 * Produtos por Kg usam código interno e deixam EAN vazio; unidades usam EAN.
 */
export function linhaParaProduto(linha: LinhaPlanilha, categoria: string): ProdutoImportado | null {
  const descricao = String(valorDoCampo(linha, ["Descrição", "Descricao", "Produto", "Nome", "Mercadoria"]) || "").trim();
  if (!descricao) return null;

  const unidade = String(valorDoCampo(linha, ["Un.", "Un", "Unidade"]) || "").trim();
  const porQuilo = unidadeEhKg(unidade, descricao);
  const eanInformado = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const codigoPromocaoExplicito = limparCodigo(valorDoCampo(linha, ["Código da promoção", "Codigo da promocao", "Cód. Promoção", "Cod. Promocao", "Código promoção", "Codigo promocao"]));
  const codigoInternoExplicito = limparCodigo(valorDoCampo(linha, ["Cód. Interno", "Cod. Interno", "Código Interno", "Codigo Interno", "Código da balança", "Codigo da balanca"]));
  const codigoGenerico = limparCodigo(valorDoCampo(linha, ["Código do produto", "Codigo do produto", "Código", "Codigo", "Cod.", "Cod"]));

  let internalCode = codigoInternoExplicito;
  let ean = eanInformado;
  if (porQuilo) {
    internalCode = codigoInternoExplicito || (!pareceEan(eanInformado) ? eanInformado : "") || (!pareceEan(codigoGenerico) ? codigoGenerico : "");
    ean = "";
  } else {
    ean = eanInformado || (pareceEan(codigoGenerico) ? limparEan(codigoGenerico) : "");
  }

  const custoPorCabecalho = valorDoCampo(linha, ["Custo", "Custo unitário", "Custo unitario", "Custo Un.", "Preço de custo", "Preco de custo", "Valor de custo"]);
  // Depois de ignorar a coluna A, a coluna O original ocupa o índice 13 nos valores do registro.
  const custoPorPosicao = valorDaColuna(linha, 13);
  const custo = lerPreco(custoPorCabecalho || custoPorPosicao);

  return {
    internal_code: internalCode || null,
    promotion_code: codigoPromocaoExplicito || null,
    ean: ean || null,
    description: descricao,
    unit: unidade || null,
    unit_price: lerPreco(valorDoCampo(linha, ["Preço Un.", "Preco Un", "Preço", "Preco", "Valor"])),
    cost,
    category: String(valorDoCampo(linha, ["Categoria"]) || categoria).trim() || categoria,
    image_url: String(valorDoCampo(linha, ["URL da imagem", "URL Imagem", "Imagem", "Foto"]) || "").trim() || null,
  };
}

export function chaveDoProduto(produto: { internal_code: string | null; promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.ean || produto.internal_code || produto.promotion_code || normalizarTexto(produto.description);
}
