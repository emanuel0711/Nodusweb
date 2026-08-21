/** Domínio do catálogo: tipos, normalização de códigos e importação. */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto, lerPreco } from "@/shared/texto";
import { valorDaColuna, valorDoCampo, type LinhaPlanilha } from "@/modules/planilhas/planilha";

export interface Produto {
  id: string; internal_code: string | null; promotion_code: string | null; ean: string | null;
  description: string; unit: string | null; unit_price: number | null; category: string | null; image_url: string | null;
}

export const COLUNAS_PRODUTO = "id, internal_code, promotion_code, ean, description, unit, unit_price, category, image_url";
export function limparEan(valor: unknown): string { return String(valor ?? "").replace(/\D/g, ""); }
export function limparCodigo(valor: unknown): string { return String(valor ?? "").trim().replace(/\.0+$/, ""); }
export function pareceEan(valor: unknown): boolean { return /^(\d{12}|\d{13}|\d{14})$/.test(limparEan(valor)); }

/** Busca o catálogo completo em páginas de 1000 registros. */
export async function carregarTodosProdutos(): Promise<Produto[]> {
  const todos: Produto[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase.from("products").select(COLUNAS_PRODUTO).range(inicio, inicio + 999);
    if (error) throw error;
    const pagina = (data ?? []) as unknown as Produto[];
    todos.push(...pagina);
    if (pagina.length < 1000) return todos;
  }
}

export interface ProdutoImportado {
  internal_code: string | null; promotion_code: string | null; ean: string | null; description: string;
  unit: string | null; unit_price: number | null; category: string; image_url: string | null;
}

/**
 * Converte uma linha da origem em produto.
 * Coluna A do CSV é ignorada. Código promocional, interno e EAN permanecem independentes.
 */
export function linhaParaProduto(linha: LinhaPlanilha, categoria: string): ProdutoImportado | null {
  const descricao = String(valorDoCampo(linha, ["Descrição", "Descricao", "Produto", "Nome", "Mercadoria"]) || "").trim();
  if (!descricao) return null;

  const eanInformado = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const codigoColunaB = limparCodigo(valorDaColuna(linha, 1));
  const codigoPromocaoExplicito = limparCodigo(valorDoCampo(linha, ["Código da promoção", "Codigo da promocao", "Cód. Promoção", "Cod. Promocao", "Código promoção", "Codigo promocao"]));
  const codigoInternoExplicito = limparCodigo(valorDoCampo(linha, ["Cód. Interno", "Cod. Interno", "Código Interno", "Codigo Interno", "Código da balança", "Codigo da balanca"]));
  const codigoNomeadoGenerico = limparCodigo(valorDoCampo(linha, ["Código do produto", "Codigo do produto", "Código", "Codigo", "Cod.", "Cod"]));

  const codigoOperacional = codigoColunaB || codigoNomeadoGenerico;
  const ean = eanInformado || (pareceEan(codigoOperacional) ? limparEan(codigoOperacional) : "");
  const interno = codigoInternoExplicito || (!ean && codigoOperacional ? limparCodigo(codigoOperacional) : "");

  return {
    internal_code: interno || null,
    promotion_code: codigoPromocaoExplicito || null,
    ean: ean || null,
    description: descricao,
    unit: String(valorDoCampo(linha, ["Un.", "Un", "Unidade"]) || "").trim() || null,
    unit_price: lerPreco(valorDoCampo(linha, ["Preço Un.", "Preco Un", "Preço", "Preco", "Valor"])),
    category: String(valorDoCampo(linha, ["Categoria"]) || categoria).trim() || categoria,
    image_url: String(valorDoCampo(linha, ["URL da imagem", "URL Imagem", "Imagem", "Foto"]) || "").trim() || null,
  };
}

export function chaveDoProduto(produto: { internal_code: string | null; promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.ean || produto.internal_code || produto.promotion_code || normalizarTexto(produto.description);
}
