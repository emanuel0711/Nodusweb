/**
 * Regras do catálogo de produtos: como um produto é lido de uma planilha
 * e como a lista completa é carregada do banco.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto } from "./comparar-textos";
import { lerPreco } from "./comparar-textos";
import { valorDaColuna, valorDoCampo, type LinhaPlanilha } from "./planilha";

export interface Produto {
  id: string;
  internal_code: string | null;
  promotion_code: string | null;
  ean: string | null;
  description: string;
  unit: string | null;
  unit_price: number | null;
  category: string | null;
  image_url: string | null;
}

export const COLUNAS_PRODUTO = "id, internal_code, promotion_code, ean, description, unit, unit_price, category, image_url";

/** Deixa só os dígitos: usado no código de barras. */
export function limparEan(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/** Remove espaços e o ".0" que o Excel costuma acrescentar em códigos. */
export function limparCodigo(valor: unknown): string {
  return String(valor ?? "").trim().replace(/\.0+$/, "");
}

/** Um código com 12-14 dígitos é tratado como EAN/GTIN. */
function pareceEan(valor: unknown): boolean {
  const codigo = limparEan(valor);
  return /^(\d{12}|\d{13}|\d{14})$/.test(codigo);
}

/** Carrega todos os produtos do usuário (o banco devolve no máximo 1000 por vez). */
export async function carregarTodosProdutos(): Promise<Produto[]> {
  const todos: Produto[] = [];
  for (let inicio = 0; ; inicio += 1000) {
    const { data, error } = await supabase.from("products").select(COLUNAS_PRODUTO).range(inicio, inicio + 999);
    if (error) throw error;
    const pagina = (data ?? []) as unknown as Produto[];
    todos.push(...pagina);
    if (pagina.length < 1000) break;
  }
  return todos;
}

export interface ProdutoImportado {
  internal_code: string | null;
  promotion_code: string | null;
  ean: string | null;
  description: string;
  unit: string | null;
  unit_price: number | null;
  category: string;
  image_url: string | null;
}

/**
 * Converte uma linha de CSV/Excel em produto.
 *
 * REGRA IMPORTANTE PARA OS CSVs DO MERCADO:
 * - A coluna A ("Cód. Interno") é ignorada completamente.
 * - O código útil vem da coluna B ("Código") quando ela existir.
 * - Se o código da coluna B tiver 12-14 dígitos, ele é EAN.
 * - Se for um código curto, ele é tratado como código interno.
 * Isso evita que o antigo código da coluna A seja levado para as ofertas.
 */
export function linhaParaProduto(linha: LinhaPlanilha, categoria: string): ProdutoImportado | null {
  const descricao = String(valorDoCampo(linha, ["Descrição", "Descricao", "Produto", "Nome", "Mercadoria"]) || "").trim();
  if (!descricao) return null;

  const eanInformado = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const codigoColunaB = limparCodigo(valorDaColuna(linha, 1));
  const codigoNomeado = limparCodigo(valorDoCampo(linha, ["Código da promoção", "Cód. Promoção", "Código do produto", "Código", "Codigo"]));

  // A coluna A nunca participa do cadastro. O código da coluna B é a fonte
  // principal para estes CSVs: curto = interno; 12-14 dígitos = EAN.
  const codigoBase = codigoColunaB || codigoNomeado;
  const ean = eanInformado || (pareceEan(codigoBase) ? limparEan(codigoBase) : "");
  const interno = !ean && codigoBase ? limparCodigo(codigoBase) : "";
  const codigoPromocao = codigoNomeado || codigoColunaB || ean;

  return {
    internal_code: interno || null,
    promotion_code: codigoPromocao || null,
    ean: ean || null,
    description: descricao,
    unit: String(valorDoCampo(linha, ["Un.", "Un", "Unidade"]) || "").trim() || null,
    unit_price: lerPreco(valorDoCampo(linha, ["Preço Un.", "Preco Un", "Preço", "Preco", "Valor"])),
    category: String(valorDoCampo(linha, ["Categoria"]) || categoria).trim() || categoria,
    image_url: String(valorDoCampo(linha, ["URL da imagem", "URL Imagem", "Imagem", "Foto"]) || "").trim() || null,
  };
}

/** Identidade usada para não importar o mesmo produto duas vezes. */
export function chaveDoProduto(produto: { promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.promotion_code || produto.ean || normalizarTexto(produto.description);
}
