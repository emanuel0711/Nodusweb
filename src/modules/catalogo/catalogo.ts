/** Domínio do catálogo: tipos, normalização de códigos e importação. */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto, lerPreco } from "@/shared/texto";
import { valorDoCampo, type LinhaPlanilha } from "@/modules/planilhas/planilha";

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

function unidadeEhKg(unidade: string, descricao: string): boolean {
  return /\b(kg|quilo|kilo|quilograma)\b/.test(normalizarTexto(`${unidade} ${descricao}`));
}

/**
 * Converte uma linha da origem em produto.
 * Coluna A do CSV é ignorada. Código de promoção fica separado.
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
    // Na origem, a coluna EAN pode conter o código interno da balança para produtos por Kg.
    // Código promocional nunca é usado como identificação do produto.
    internalCode = codigoInternoExplicito
      || (!pareceEan(eanInformado) ? eanInformado : "")
      || (!pareceEan(codigoGenerico) ? codigoGenerico : "");
    ean = "";
  } else {
    // Para produtos por unidade, o identificador usado pelo Clube é o EAN.
    ean = eanInformado || (pareceEan(codigoGenerico) ? limparEan(codigoGenerico) : "");
  }

  return {
    internal_code: internalCode || null,
    promotion_code: codigoPromocaoExplicito || null,
    ean: ean || null,
    description: descricao,
    unit: unidade || null,
    unit_price: lerPreco(valorDoCampo(linha, ["Preço Un.", "Preco Un", "Preço", "Preco", "Valor"])),
    category: String(valorDoCampo(linha, ["Categoria"]) || categoria).trim() || categoria,
    image_url: String(valorDoCampo(linha, ["URL da imagem", "URL Imagem", "Imagem", "Foto"]) || "").trim() || null,
  };
}

export function chaveDoProduto(produto: { internal_code: string | null; promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.ean || produto.internal_code || produto.promotion_code || normalizarTexto(produto.description);
}
