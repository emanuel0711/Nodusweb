import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarCandidatosImagem, type CandidatoImagemServidor } from "@/modules/imagens/busca-imagens.functions";
import type { Json } from "@/integrations/supabase/types";

const PAGINA = 500;
const CONCORRENCIA = 6;
const LIMITE_POR_EXECUCAO = 100;
const TODAS_CATEGORIAS = "__all__";
const SEM_CATEGORIA = "__uncategorized__";

/**
 * Score mínimo para uma imagem ser considerada confiável o suficiente para aprovação automática.
 *
 * Com a fórmula atual, candidatos provenientes apenas de busca textual não conseguem atingir este
 * valor. Na prática, o limiar exige uma fonte associada a EAN exato, além de boa resolução e fundo
 * predominantemente branco.
 */
export const PONTUACAO_MINIMA_APROVACAO = 85;
const FUNDO_BRANCO_MINIMO = 0.75;
const MENOR_DIMENSAO_MINIMA = 250;

export type ImageStatus = "pending" | "processing" | "pending_approval" | "not_found" | "found" | "manual";

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

async function carregarProdutos(categoria: string): Promise<ProdutoImagem[]> {
  const produtos: ProdutoImagem[] = [];
  let inicio = 0;

  while (true) {
    let query = supabase
      .from("products")
      .select("id, user_id, ean, description, category, image_url, image_status, image_last_checked_at, image_search_version")
      .order("description")
      .range(inicio, inicio + PAGINA - 1);

    if (categoria === SEM_CATEGORIA) query = query.is("category", null);
    else if (categoria !== TODAS_CATEGORIAS) query = query.eq("category", categoria);

    const { data, error } = await query;
    if (error) throw error;

    const pagina = (data ?? []) as ProdutoImagem[];
    produtos.push(...pagina);
    if (pagina.length < PAGINA) break;
    inicio += PAGINA;
  }

  return produtos;
}

async function carregarCandidatos(): Promise<CandidatoPersistido[]> {
  const { data, error } = await supabase
    .from("image_candidates")
    .select("id, product_id, url, source, score, score_details, width, height, background_score, status, created_at")
    .eq("status", "pending")
    .order("score", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as CandidatoPersistido[];
}

async function atualizarProduto(
  id: string,
  dados: Partial<Pick<ProdutoImagem, "image_url" | "image_status" | "image_last_checked_at" | "image_search_version">>,
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

function dimensaoSuficiente(width: number | null, height: number | null): boolean {
  return width != null && height != null && Math.min(width, height) >= MENOR_DIMENSAO_MINIMA;
}

function candidatoPersistidoConfiavel(candidato: CandidatoPersistido): boolean {
  return Boolean(
    candidato.score >= PONTUACAO_MINIMA_APROVACAO &&
      candidato.background_score != null &&
      candidato.background_score >= FUNDO_BRANCO_MINIMO &&
      dimensaoSuficiente(candidato.width, candidato.height),
  );
}

function podeAprovarAutomaticamente(candidato: CandidatoImagemServidor): boolean {
  return Boolean(
    candidato.eanExato &&
      candidato.score >= PONTUACAO_MINIMA_APROVACAO &&
      candidato.backgroundScore != null &&
      candidato.backgroundScore >= FUNDO_BRANCO_MINIMO &&
      dimensaoSuficiente(candidato.width, candidato.height),
  );
}

export function useImagensPendentes(categoria = TODAS_CATEGORIAS) {
  const queryClient = useQueryClient();
  const [rodando, setRodando] = useState(false);
  const [aprovandoTodos, setAprovandoTodos] = useState(false);
  const [processados, setProcessados] = useState(0);
  const [encontrados, setEncontrados] = useState(0);
  const [semResultadoExecucao, setSemResultadoExecucao] = useState(0);

  const produtosQuery = useQuery({
    queryKey: ["image-products", categoria],
    queryFn: () => carregarProdutos(categoria),
  });

  const candidatosQuery = useQuery({
    queryKey: ["image-candidates"],
    queryFn: carregarCandidatos,
  });

  const produtos = produtosQuery.data ?? [];
  const candidatos = candidatosQuery.data ?? [];

  const semImagem = useMemo(() => produtos.filter((produto) => !produto.image_url?.trim()), [produtos]);
  const naFila = useMemo(() => semImagem.filter((produto) => produto.image_status === "pending"), [semImagem]);
  const processando = useMemo(() => semImagem.filter((produto) => produto.image_status === "processing"), [semImagem]);
  const aguardandoAprovacao = useMemo(() => semImagem.filter((produto) => produto.image_status === "pending_approval"), [semImagem]);
  const semResultado = useMemo(() => semImagem.filter((produto) => produto.image_status === "not_found"), [semImagem]);
  const concluidos = useMemo(() => produtos.filter((produto) => Boolean(produto.image_url?.trim())), [produtos]);
  const jaProcessados = useMemo(
    () => semImagem.filter((produto) => Boolean(produto.image_last_checked_at) && !["pending", "processing"].includes(produto.image_status)),
    [semImagem],
  );

  const gruposRevisao = useMemo<GrupoRevisao[]>(() => {
    const produtosPorId = new Map(produtos.map((produto) => [produto.id, produto]));
    const grupos = new Map<string, CandidatoPersistido[]>();

    for (const candidato of candidatos) {
      const produto = produtosPorId.get(candidato.product_id);
      if (!produto || produto.image_status !== "pending_approval") continue;
      const atuais = grupos.get(candidato.product_id) ?? [];
      atuais.push(candidato);
      grupos.set(candidato.product_id, atuais);
    }

    return [...grupos.entries()]
      .map(([productId, itens]) => ({ produto: produtosPorId.get(productId)!, candidatos: itens.sort((a, b) => b.score - a.score) }))
      .filter((grupo) => Boolean(grupo.produto));
  }, [candidatos, produtos]);

  const candidatosParaAprovacaoEmMassa = useMemo(
    () =>
      gruposRevisao
        .map((grupo) => grupo.candidatos[0])
        .filter((candidato): candidato is CandidatoPersistido => Boolean(candidato && candidatoPersistidoConfiavel(candidato))),
    [gruposRevisao],
  );

  const invalidar = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["image-products"] }),
      queryClient.invalidateQueries({ queryKey: ["image-candidates"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
    ]);
  }, [queryClient]);

  const completar = useCallback(async () => {
    if (rodando || !naFila.length) return;

    const fila = naFila.slice(0, LIMITE_POR_EXECUCAO);
    const agora = new Date().toISOString();
    setRodando(true);
    setProcessados(0);
    setEncontrados(0);
    setSemResultadoExecucao(0);

    try {
      const { error: erroFila } = await supabase
        .from("products")
        .update({ image_status: "processing", image_last_checked_at: agora, image_search_version: 2 })
        .in("id", fila.map((produto) => produto.id));
      if (erroFila) throw erroFila;

      let indice = 0;
      const trabalhador = async () => {
        while (indice < fila.length) {
          const produto = fila[indice++]!;

          try {
            const { candidatos: achados } = await buscarCandidatosImagem({
              data: {
                ean: produto.ean ?? "",
                descricao: produto.description,
                categoria: produto.category,
              },
            });

            const melhor = achados[0];
            if (melhor && podeAprovarAutomaticamente(melhor)) {
              await persistirCandidatos(produto, achados);
              await atualizarProduto(produto.id, {
                image_url: melhor.url,
                image_status: "found",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: 2,
              });

              const { error: erroAprovacao } = await supabase
                .from("image_candidates")
                .update({ status: "approved", reviewed_at: new Date().toISOString() })
                .eq("product_id", produto.id)
                .eq("url", melhor.url);
              if (erroAprovacao) throw erroAprovacao;
              setEncontrados((valor) => valor + 1);
            } else if (achados.length) {
              await persistirCandidatos(produto, achados);
              await atualizarProduto(produto.id, {
                image_status: "pending_approval",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: 2,
              });
            } else {
              await atualizarProduto(produto.id, {
                image_status: "not_found",
                image_last_checked_at: new Date().toISOString(),
                image_search_version: 2,
              });
              setSemResultadoExecucao((valor) => valor + 1);
            }
          } catch (erro) {
            console.error("Falha ao pesquisar imagem", produto.id, erro);
            await atualizarProduto(produto.id, {
              image_status: "not_found",
              image_last_checked_at: new Date().toISOString(),
              image_search_version: 2,
            });
            setSemResultadoExecucao((valor) => valor + 1);
          } finally {
            setProcessados((valor) => valor + 1);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, fila.length) }, trabalhador));
      await invalidar();
      toast.success(`Lote concluído: ${fila.length} produto(s) processado(s).`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível iniciar a fila de imagens.");
      await invalidar();
    } finally {
      setRodando(false);
    }
  }, [invalidar, naFila, rodando]);

  const aprovarCandidato = useCallback(async (candidato: CandidatoPersistido, invalidarDepois = true) => {
    const agora = new Date().toISOString();

    await atualizarProduto(candidato.product_id, {
      image_url: candidato.url,
      image_status: "found",
      image_last_checked_at: agora,
      image_search_version: 2,
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
  }, [invalidar]);

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

    try {
      for (const candidato of candidatosParaAprovacaoEmMassa) {
        await aprovarCandidato(candidato, false);
        aprovados += 1;
      }

      await invalidar();
      toast.success(`${aprovados} produto(s) aprovados em massa com score mínimo ${PONTUACAO_MINIMA_APROVACAO}.`);
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
          .update({ status: "rejected", reviewed_at: new Date().toISOString() })
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
          .update({ image_status: "pending", image_last_checked_at: null, image_search_version: 2 })
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
        toast.success(productId ? "Produto devolvido para a fila." : "Produtos sem resultado foram devolvidos para a fila.");
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : "Não foi possível reenfileirar os produtos.");
      }
    },
    [invalidar],
  );

  return {
    carregando: produtosQuery.isLoading || candidatosQuery.isLoading,
    rodando,
    aprovandoTodos,
    processados,
    encontrados,
    semResultadoExecucao,
    limitePorExecucao: LIMITE_POR_EXECUCAO,
    pontuacaoMinimaAprovacao: PONTUACAO_MINIMA_APROVACAO,
    totalAprovaveisEmMassa: candidatosParaAprovacaoEmMassa.length,
    totalSemImagem: semImagem.length,
    totalNaFila: naFila.length,
    totalProcessando: processando.length,
    jaProcessados: jaProcessados.length,
    aguardandoAprovacao: aguardandoAprovacao.length,
    totalSemResultado: semResultado.length,
    totalConcluidos: concluidos.length,
    gruposRevisao,
    completar,
    pesquisarNovamente,
    aprovar,
    aprovarTodos,
    rejeitar,
  };
}
