/**
 * Regras do catálogo de produtos: como um produto é lido de uma planilha
 * e como a lista completa é carregada do banco.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto, lerPreco } from "./comparar-textos";
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
export function pareceEan(valor: unknown): boolean {
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
 * REGRAS DE CÓDIGO:
 * - A coluna A continua ignorada completamente.
 * - Um campo explicitamente chamado "Código da promoção" / "Cód. Promoção"
 *   alimenta SOMENTE promotion_code.
 * - O campo genérico "Código" da coluna B é a referência operacional do CSV:
 *   12-14 dígitos = EAN; código curto = código interno.
 * - EAN nunca é copiado para promotion_code.
 * - promotion_code nunca é usado como substituto automático de internal_code.
 *
 * Assim os três identificadores permanecem independentes e a busca consegue
 * distinguir EAN, código promocional e código interno sem criar colisões.
 */
export function linhaParaProduto(linha: LinhaPlanilha, categoria: string): ProdutoImportado | null {
  const descricao = String(valorDoCampo(linha, ["Descrição", "Descricao", "Produto", "Nome", "Mercadoria"]) || "").trim();
  if (!descricao) return null;

  const eanInformado = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));

  // A coluna A nunca participa do cadastro.
  const codigoColunaB = limparCodigo(valorDaColuna(linha, 1));

  // Só estes cabeçalhos explícitos representam código promocional.
  const codigoPromocaoExplicito = limparCodigo(valorDoCampo(linha, [
    "Código da promoção",
    "Codigo da promocao",
    "Cód. Promoção",
    "Cod. Promocao",
    "Código promoção",
    "Codigo promocao",
  ]));

  // Campos explicitamente nomeados como interno têm prioridade sobre a coluna B.
  const codigoInternoExplicito = limparCodigo(valorDoCampo(linha, [
    "Cód. Interno",
    "Cod. Interno",
    "Código Interno",
    "Codigo Interno",
    "Código da balança",
    "Codigo da balanca",
  ]));

  // "Código" genérico é usado apenas como fallback operacional da coluna B.
  const codigoNomeadoGenerico = limparCodigo(valorDoCampo(linha, [
    "Código do produto",
    "Codigo do produto",
    "Código",
    "Codigo",
    "Cod.",
    "Cod",
  ]));

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

/** Identidade usada para não importar o mesmo produto duas vezes. */
export function chaveDoProduto(produto: { internal_code: string | null; promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.ean || produto.internal_code || produto.promotion_code || normalizarTexto(produto.description);
}
