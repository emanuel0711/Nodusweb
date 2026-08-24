/** Domínio do catálogo: tipos, normalização de códigos e importação. */
import { supabase } from "@/integrations/supabase/client";
import { normalizarTexto, lerPreco } from "@/shared/texto";
import { valorDaColuna, valorDoCampo, type LinhaPlanilha } from "@/modules/planilhas/planilha";

export interface Produto {
  id: string; internal_code: string | null; promotion_code: string | null; ean: string | null;
  description: string; unit: string | null; unit_price: number | null; cost: number | null;
  category: string | null; image_url: string | null;
}

export const COLUNAS_PRODUTO_BASE = "id, internal_code, promotion_code, ean, description, unit, unit_price, category, image_url";
export const COLUNAS_PRODUTO = `${COLUNAS_PRODUTO_BASE}, cost`;

/** Identifica erros do PostgREST causados pela ausência da coluna de custo. */
export function erroDeCustoAusente(error: { code?: string | null; message?: string | null; details?: string | null } | null): boolean {
  if (!error) return false;
  const texto = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (error.code === "PGRST204" || error.code === "42703") && /\bcost\b|custo/.test(texto);
}

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

/** Carrega o catálogo em páginas, usando custo quando a coluna existe. */
export async function carregarTodosProdutos(): Promise<Produto[]> {
  const todos: Produto[] = [];
  let usarCusto = true;

  for (let inicio = 0; ; inicio += 1000) {
    const colunas = usarCusto ? COLUNAS_PRODUTO : COLUNAS_PRODUTO_BASE;
    let { data, error } = await supabase.from("products").select(colunas).range(inicio, inicio + 999);

    if (error && usarCusto && erroDeCustoAusente(error)) {
      usarCusto = false;
      ({ data, error } = await supabase.from("products").select(COLUNAS_PRODUTO_BASE).range(inicio, inicio + 999));
    }

    if (error) throw error;

    const pagina = ((data ?? []) as unknown as Produto[]).map((produto) =>
      normalizarProduto({ ...produto, cost: produto.cost ?? null }),
    );
    todos.push(...pagina);
    if (pagina.length < 1000) return todos;
  }
}

export interface ProdutoImportado {
  internal_code: string | null; promotion_code: string | null; ean: string | null; description: string;
  unit: string | null; unit_price: number | null; cost: number | null; category: string; image_url: string | null;
}

function primeiroCustoValido(...valores: unknown[]): number | null {
  for (const valor of valores) {
    const custo = lerPreco(valor);
    if (custo != null && custo >= 0) return custo;
  }
  return null;
}

/**
 * Converte uma linha da origem em produto.
 * Coluna A do CSV é ignorada. A coluna O da origem é o custo.
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

  const custoPorCabecalho = valorDoCampo(linha, [
    "Custo", "Custo unitário", "Custo unitario", "Custo Un.",
    "Custo médio", "Custo medio", "Custo produto", "Custo do produto",
    "Preço de custo", "Preco de custo", "Valor de custo", "CMV",
  ]);

  // CSV: a coluna A é removida pelo leitor, então O original vira índice 13.
  // XLSX: a coluna A permanece no registro, então O original fica no índice 14.
  // O cabeçalho continua tendo prioridade; os índices são apenas fallback.
  const custoPorPosicaoCsv = valorDaColuna(linha, 13);
  const custoPorPosicaoXlsx = valorDaColuna(linha, 14);
  const custoImportado = primeiroCustoValido(custoPorCabecalho, custoPorPosicaoCsv, custoPorPosicaoXlsx);

  return {
    internal_code: internalCode || null,
    promotion_code: codigoPromocaoExplicito || null,
    ean: ean || null,
    description: descricao,
    unit: unidade || null,
    unit_price: lerPreco(valorDoCampo(linha, ["Preço Un.", "Preco Un", "Preço", "Preco", "Valor"])),
    cost: custoImportado,
    category: String(valorDoCampo(linha, ["Categoria"]) || categoria).trim() || categoria,
    image_url: String(valorDoCampo(linha, ["URL da imagem", "URL Imagem", "Imagem", "Foto"]) || "").trim() || null,
  };
}

export function chaveDoProduto(produto: { internal_code: string | null; promotion_code: string | null; ean: string | null; description: string }): string {
  return produto.ean || produto.internal_code || produto.promotion_code || normalizarTexto(produto.description);
}
