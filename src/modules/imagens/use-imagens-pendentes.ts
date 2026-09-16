import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buscarCandidatosImagem,
  type CandidatoImagemServidor,
} from "@/modules/imagens/buscar-imagem.functions";
import type { Json } from "@/integrations/supabase/types";

const CONCORRENCIA = 12;
const CONCORRENCIA_APROVACAO = 10;
const LIMITE_POR_EXECUCAO = 250;
const RETENTATIVA_APOS_MS = 15 * 60 * 1000;
const VERSAO_BUSCA = 4;
const TODAS_CATEGORIAS = "__all__";
const SEM_CATEGORIA = "__uncategorized__";

/**
 * Candidatos com score igual ou superior a este valor são aprovados
 * automaticamente. Abaixo dele, permanecem disponíveis para revisão manual.
 */
export const PONTUACAO_MINIMA_APROVACAO = 50;

export type ImageStatus =
  "pending" | "processing" | "pending_approval" | "not_found" | "found" | "manual";

export interface ProdutoImagem {
  id: string;
  user_id: string;
  ean: string | null;
  description: string;
  category: string | null;
  image_url: string | null;
  image_status: ImageStatus;
  image_last_checked_at: string | null;
  image_search_version: number;
}

export interface CandidatoPersistido {
  id: string;
  product_id: string;
  url: string;
  source: string;
  score: number;
  score_details: Json;
  width: number | null;
  height: number | null;
  background_score: number | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface GrupoRevisao {
  produto: ProdutoImagem;
  candidatos: CandidatoPersistido[];
}

const SEM_PRODUTOS: ProdutoImagem[] = [];
const SEM_CANDIDATOS: CandidatoPersistido[] = [];

type FiltroContagem =
  "com_imagem" | "sem_imagem" | "fila" | "processando" | "revisao" | "sem_resultado";

async function contarProdutos(categoria: string, filtro: FiltroContagem): Promise<number> {
  let query = supabase.from("products").select("id", { count: "exact", head: true });
  if (categoria === SEM_CATEGORIA) query = query.is("category", null);
  else if (categoria !== TODAS_CATEGORIAS) query = query.eq("category", categoria);

  if (filtro === "com_imagem") query = query.not("image_url", "is", null);
  else query = query.is("image_url", null);
  if (filtro === "fila") {
    const limite = new Date(Date.now() - RETENTATIVA_APOS_MS).toISOString();
    query = query
      .eq("image_status", "pending")
      .or(`image_last_checked_at.is.null,image_last_checked_at.lt.${limite}`);
  } else if (filtro === "processando") query = query.eq("image_status", "processing");
  else if (filtro === "revisao") query = query.eq("image_status", "pending_approval");
  else if (filtro === "sem_resultado") query = query.eq("image_status", "not_found");
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

interface ResumoImagens {
  comImagem: number;
  semImagem: number;
  naFila: number;
  processando: number;
  revisao: number;
  semResultado: number;
}

async function carregarResumo(categoria: string): Promise<ResumoImagens> {
  const [comImagem, semImagem, naFila, processando, revisao, semResultado] = await Promise.all([
    contarProdutos(categoria, "com_imagem"),
    contarProdutos(categoria, "sem_imagem"),
    contarProdutos(categoria, "fila"),
    contarProdutos(categoria, "processando"),
    contarProdutos(categoria, "revisao"),
    contarProdutos(categoria, "sem_resultado"),
  ]);
  return { comImagem, semImagem, naFila, processando, revisao, semResultado };
}

const COLUNAS_IMAGEM =
  "id, user_id, ean, description, category, image_url, image_status, image_last_checked_at, image_search_version";

async function carregarFila(categoria: string): Promise<ProdutoImagem[]> {
  const limite = new Date(Date.now() - RETENTATIVA_APOS_MS).toISOString();
  let query = supabase
    .from("products")
    .select(COLUNAS_IMAGEM)
    .is("image_url", null)
    .eq("image_status", "pending")
    .or(`image_last_checked_at.is.null,image_last_checked_at.lt.${limite}`)
    .order("description")
    .limit(LIMITE_POR_EXECUCAO);
  if (categoria === SEM_CATEGORIA) query = query.is("category", null);
  else if (categoria !== TODAS_CATEGORIAS) query = query.eq("category", categoria);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProdutoImagem[];
}

async function carregarProdutosParaRevisao(categoria: string): Promise<ProdutoImagem[]> {
  let query = supabase
    .from("products")
    .select(COLUNAS_IMAGEM)
    .is("image_url", null)
    .eq("image_status", "pending_approval")
    .order("description")
    .limit(500);
  if (categoria === SEM_CATEGORIA) query = query.is("category", null);
  else if (categoria !== TODAS_CATEGORIAS) query = query.eq("category", categoria);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProdutoImagem[];
}

async function carregarCandidatos(productIds: string[]): Promise<CandidatoPersistido[]> {
  if (!productIds.length) return [];
  const lotes: string[][] = [];
  for (let inicio = 0; inicio < productIds.length; inicio += 100)
    lotes.push(productIds.slice(inicio, inicio + 100));
  const paginas = await Promise.all(
    lotes.map(async (ids) => {
      const { data, error } = await supabase
        .from("image_candidates")
        .select(
          "id, product_id, url, source, score, score_details, width, height, background_score, status, created_at",
        )
        .eq("status", "pending")
        .in("product_id", ids)
        .order("score", { ascending: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CandidatoPersistido[];
    }),
  );
  return paginas.flat();
}

async function atualizarProduto(
  id: string,
  dados: Partial<
    Pick<
      ProdutoImagem,
      "image_url" | "image_status" | "image_last_checked_at" | "image_search_version"
    >
  >,
) {
  const { error } = await supabase.from("products").update(dados).eq("id", id);
  if (error) throw error;
}

async function persistirCandidatos(produto: ProdutoImagem, candidatos: CandidatoImagemServidor[]) {
  if (!candidatos.length) return;

  const linhas = candidatos.map((candidato) => ({
    user_id: produto.user_id,
    product_id: produto.id,
    url: candidato.url,
    source: candidato.source,
    score: candidato.score,
    score_details: candidato.scoreDetails as unknown as Json,
    width: candidato.width,
    height: candidato.height,
    background_score: candidato.backgroundScore,
    status: "pending",
  }));

  const { error } = await supabase
    .from("image_candidates")
    .upsert(linhas, { onConflict: "product_id,url", ignoreDuplicates: true });

  if (error) throw error;
}

function candidatoAprovavel(candidato: { score: number }): boolean {
  return candidato.score >= PONTUACAO_MINIMA_APROVACAO;
}

export function useImagensPendentes(categoria = TODAS_CATEGORIAS) {
  const queryClient = useQueryClient();
  const [rodando, setRodando] = useState(false);
  const [aprovandoTodos, setAprovandoTodos] = useState(false);
  const [processados, setProcessados] = useState(0);
  const [encontrados, setEncontrados] = useState(0);
  const [semResultadoExecucao, setSemResultadoExecucao] = useState(0);

  const resumoQuery = useQuery({
    queryKey: ["image-summary", categoria],
    queryFn: () => carregarResumo(categoria),
  });
  const filaQuery = useQuery({
    queryKey: ["image-queue", categoria],
    queryFn: () => carregarFila(categoria),
  });
  const revisaoQuery = useQuery({
    queryKey: ["image-review", categoria],
    queryFn: () => carregarProdutosParaRevisao(categoria),
  });

  const produtosRevisao = revisaoQuery.data ?? SEM_PRODUTOS;
  const idsRevisao = produtosRevisao.map((produto) => produto.id);

  const candidatosQuery = useQuery({
    queryKey: ["image-candidates", categoria, idsRevisao],
    queryFn: () => carregarCandidatos(idsRevisao),
  });

  const resumo = resumoQuery.data;
  const fila = filaQuery.data ?? SEM_PRODUTOS;
  const candidatos = candidatosQuery.data ?? SEM_CANDIDATOS;

  const gruposRevisao = useMemo<GrupoRevisao[]>(() => {
    const produtosPorId = new Map(produtosRevisao.map((produto) => [produto.id, produto]));
    const grupos = new Map<string, CandidatoPersistido[]>();

    for (const candidato of candidatos) {
      const produto = produtosPorId.get(candidato.product_id);
      if (!produto || produto.image_status !== "pending_approval") continue;

      const atuais = grupos.get(candidato.product_id) ?? [];
      atuais.push(candidato);
      grupos.set(candidato.product_id, atuais);
    }

    return [...grupos.entries()]
      .map(([productId, itens]) => ({
        produto: produtosPorId.get(productId)!,
        candidatos: itens.sort((a, b) => b.score - a.score),
      }))
      .filter((grupo) => Boolean(grupo.produto));
  }, [candidatos, produtosRevisao]);

  const candidatosParaAprovacaoEmMassa = useMemo(
    () =>
      gruposRevisao
        .map((grupo) => grupo.candidatos[0])
        .filter((candidato): candidato is CandidatoPersistido =>
          Boolean(candidato && candidatoAprovavel(candidato)),
        ),
    [gruposRevisao],
  );

  const invalidar = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["image-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["image-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["image-review"] }),
      queryClient.invalidateQueries({ queryKey: ["image-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
    ]);
  }, [queryClient]);

  const completar = useCallback(async () => {
    if (rodando || !fila.length) return;

    const lote = fila.slice(0, LIMITE_POR_EXECUCAO);
    const agora = new Date().toISOString();

    setRodando(true);
    setProcessados(0);
    setEncontrados(0);
    setSemResultadoExecucao(0);

    try {
      const { error: erroFila } = await supabase
        .from("products")
        .update({
          image_status: "processing",
          image_last_checked_at: agora,
          image_search_version: VERSAO_BUSCA,
        })
        .in(
          "id",
          lote.map((produto) => produto.id),
        );

      if (erroFila) throw erroFila;

      let indice = 0;

      const trabalhador = async () => {
        while (indice < lote.length) {
          const produto = lote[indice++]!;

          try {
            const { candidatos: achados } = await buscarCandidatosImagem({
              data: {
                ean: produto.ean ?? "",
                descricao: produto.description,
                categoria: produto.category,
              },
            });

            const melhor = achados[0];

            if (melhor && candidatoAprovavel(melhor)) {
              await persistirCandidatos(produto, achados);
              await atualizarProduto(produto.id, {
                image_url: melhor.url,
                image_status: "found",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: VERSAO_BUSCA,
              });

              const { error: erroAprovacao } = await supabase
                .from("image_candidates")
                .update({
                  status: "approved",
                  reviewed_at: new Date().toISOString(),
                })
                .eq("product_id", produto.id)
                .eq("url", melhor.url);

              if (erroAprovacao) throw erroAprovacao;
              setEncontrados((valor) => valor + 1);
            } else if (achados.length) {
              await persistirCandidatos(produto, achados);
              await atualizarProduto(produto.id, {
                image_status: "pending_approval",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: VERSAO_BUSCA,
              });
            } else {
              await atualizarProduto(produto.id, {
                image_status: "not_found",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: VERSAO_BUSCA,
              });
              setSemResultadoExecucao((valor) => valor + 1);
            }
          } catch (erro) {
            console.error("Falha transitória ao pesquisar imagem", produto.id, erro);

            // Falha técnica não é o mesmo que "nenhuma imagem encontrada".
            // O item volta para pending e respeita um cooldown antes de nova tentativa.
            await atualizarProduto(produto.id, {
              image_status: "pending",
              image_last_checked_at: new Date().toISOString(),
              image_search_version: VERSAO_BUSCA,
            });
          } finally {
            setProcessados((valor) => valor + 1);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, lote.length) }, trabalhador));

      await invalidar();
      toast.success(`Lote concluído: ${lote.length} produto(s) processado(s).`);
    } catch (erro) {
      toast.error(
        erro instanceof Error ? erro.message : "Não foi possível iniciar a fila de imagens.",
      );
      await invalidar();
    } finally {
      setRodando(false);
    }
  }, [fila, invalidar, rodando]);

  const aprovarCandidato = useCallback(
    async (candidato: CandidatoPersistido, invalidarDepois = true) => {
      const agora = new Date().toISOString();

      await atualizarProduto(candidato.product_id, {
        image_url: candidato.url,
        image_status: "found",
        image_last_checked_at: agora,
        image_search_version: VERSAO_BUSCA,
      });

      const { error: erroAprovado } = await supabase
        .from("image_candidates")
        .update({ status: "approved", reviewed_at: agora })
        .eq("id", candidato.id);
      if (erroAprovado) throw erroAprovado;

      const { error: erroOutros } = await supabase
        .from("image_candidates")
        .update({ status: "rejected", reviewed_at: agora })
        .eq("product_id", candidato.product_id)
        .eq("status", "pending")
        .neq("id", candidato.id);
      if (erroOutros) throw erroOutros;

      if (invalidarDepois) await invalidar();
    },
    [invalidar],
  );

  const aprovar = useCallback(
    async (candidato: CandidatoPersistido) => {
      try {
        await aprovarCandidato(candidato);
        toast.success("Imagem aprovada e vinculada ao produto.");
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : "Não foi possível aprovar a imagem.");
      }
    },
    [aprovarCandidato],
  );

  const aprovarTodos = useCallback(async () => {
    if (aprovandoTodos || !candidatosParaAprovacaoEmMassa.length) return;

    setAprovandoTodos(true);
    let aprovados = 0;
    let indice = 0;

    try {
      const trabalhadores = Array.from(
        {
          length: Math.min(CONCORRENCIA_APROVACAO, candidatosParaAprovacaoEmMassa.length),
        },
        async () => {
          while (indice < candidatosParaAprovacaoEmMassa.length) {
            const candidato = candidatosParaAprovacaoEmMassa[indice++]!;
            await aprovarCandidato(candidato, false);
            aprovados += 1;
          }
        },
      );

      await Promise.all(trabalhadores);
      await invalidar();
      toast.success(
        `${aprovados} produto(s) aprovados em massa com score mínimo ${PONTUACAO_MINIMA_APROVACAO}.`,
      );
    } catch (erro) {
      await invalidar();
      toast.error(
        erro instanceof Error
          ? `Aprovação em massa interrompida após ${aprovados} item(ns): ${erro.message}`
          : `Aprovação em massa interrompida após ${aprovados} item(ns).`,
      );
    } finally {
      setAprovandoTodos(false);
    }
  }, [aprovandoTodos, aprovarCandidato, candidatosParaAprovacaoEmMassa, invalidar]);

  const rejeitar = useCallback(
    async (candidato: CandidatoPersistido) => {
      try {
        const { error } = await supabase
          .from("image_candidates")
          .update({
            status: "rejected",
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", candidato.id);
        if (error) throw error;

        const { count, error: erroContagem } = await supabase
          .from("image_candidates")
          .select("id", { count: "exact", head: true })
          .eq("product_id", candidato.product_id)
          .eq("status", "pending");
        if (erroContagem) throw erroContagem;

        if (!count) {
          await atualizarProduto(candidato.product_id, {
            image_status: "not_found",
            image_last_checked_at: new Date().toISOString(),
            image_search_version: VERSAO_BUSCA,
          });
        }

        await invalidar();
        toast.success("Candidato rejeitado.");
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : "Não foi possível rejeitar a imagem.");
      }
    },
    [invalidar],
  );

  const pesquisarNovamente = useCallback(
    async (productId?: string) => {
      try {
        let query = supabase
          .from("products")
          .update({
            image_status: "pending",
            image_last_checked_at: null,
            image_search_version: VERSAO_BUSCA,
          })
          .is("image_url", null);

        if (productId) query = query.eq("id", productId);
        else query = query.in("image_status", ["not_found", "pending_approval"]);

        const { error } = await query;
        if (error) throw error;

        if (productId) {
          const { error: erroCandidatos } = await supabase
            .from("image_candidates")
            .delete()
            .eq("product_id", productId)
            .eq("status", "pending");
          if (erroCandidatos) throw erroCandidatos;
        }

        await invalidar();
        toast.success(
          productId
            ? "Produto devolvido para a fila."
            : "Produtos sem resultado foram devolvidos para a fila.",
        );
      } catch (erro) {
        toast.error(
          erro instanceof Error ? erro.message : "Não foi possível reenfileirar os produtos.",
        );
      }
    },
    [invalidar],
  );

  return {
    carregando:
      resumoQuery.isLoading ||
      filaQuery.isLoading ||
      revisaoQuery.isLoading ||
      candidatosQuery.isLoading,
    rodando,
    aprovandoTodos,
    processados,
    encontrados,
    semResultadoExecucao,
    limitePorExecucao: LIMITE_POR_EXECUCAO,
    pontuacaoMinimaAprovacao: PONTUACAO_MINIMA_APROVACAO,
    totalAprovaveisEmMassa: candidatosParaAprovacaoEmMassa.length,
    totalSemImagem: resumo?.semImagem ?? 0,
    totalNaFila: resumo?.naFila ?? 0,
    totalProcessando: resumo?.processando ?? 0,
    jaProcessados: (resumo?.revisao ?? 0) + (resumo?.semResultado ?? 0),
    aguardandoAprovacao: resumo?.revisao ?? 0,
    totalSemResultado: resumo?.semResultado ?? 0,
    totalConcluidos: resumo?.comImagem ?? 0,
    gruposRevisao,
    completar,
    pesquisarNovamente,
    aprovar,
    aprovarTodos,
    rejeitar,
  };
}
