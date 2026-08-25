/**
 * Fila de imagens.
 *
 * Produtos que já passaram por uma tentativa de busca ficam registrados no
 * navegador. Isso evita repetir a mesma busca em cada nova importação.
 * A busca só volta a acontecer para um produto já processado quando o usuário
 * solicita explicitamente uma nova tentativa.
 */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarImagemPorEan, buscarImagemPorNome, urlDeImagemValida } from "@/modules/imagens/busca-imagens";
import { buscarCandidatosGoogle } from "@/lib/google-imagens.functions";
import { pontuarCandidato, type Pontuacao } from "@/modules/imagens/confianca-google";

const LOTE = 4;
const PAGINA = 500;
const TODAS_CATEGORIAS = "__all__";
const SEM_CATEGORIA = "__uncategorized__";
const STORAGE_KEY = "nodus:image-search-state:v2";

type ImageStatus = "pending" | "found" | "not_found" | "pending_approval" | "rejected" | "manual";

type ImageSearchState = {
  status: Exclude<ImageStatus, "pending" | "found" | "manual">;
  checkedAt: string;
  fingerprint: string;
};

export interface ProdutoSemImagem {
  id: string;
  ean: string | null;
  description: string;
  category: string | null;
  image_status: ImageStatus;
  image_search_version: number;
}

export interface CandidatoGoogle {
  id: string;
  produto: ProdutoSemImagem;
  url: string;
  titulo: string;
  pontuacao: Pontuacao;
}

function fingerprint(produto: Pick<ProdutoSemImagem, "id" | "ean" | "description">) {
  return `${produto.id}|${produto.ean ?? ""}|${produto.description.trim().toUpperCase()}`;
}

function lerEstados(): Record<string, ImageSearchState> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, ImageSearchState>;
  } catch {
    return {};
  }
}

function gravarEstados(estados: Record<string, ImageSearchState>) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(estados));
}

function salvarEstado(produto: ProdutoSemImagem, status: ImageSearchState["status"]) {
  const estados = lerEstados();
  estados[produto.id] = {
    status,
    checkedAt: new Date().toISOString(),
    fingerprint: fingerprint(produto),
  };
  gravarEstados(estados);
}

async function carregarPendentes(categoria: string): Promise<ProdutoSemImagem[]> {
  const produtos: ProdutoSemImagem[] = [];
  let inicio = 0;

  while (true) {
    let consulta = supabase
      .from("products")
      .select("id, ean, description, category, image_url")
      .is("image_url", null)
      .order("description")
      .range(inicio, inicio + PAGINA - 1);

    if (categoria === SEM_CATEGORIA) consulta = consulta.is("category", null);
    else if (categoria !== TODAS_CATEGORIAS) consulta = consulta.eq("category", categoria);

    const { data, error } = await consulta;
    if (error) throw error;

    const pagina = (data ?? []) as Array<Omit<ProdutoSemImagem, "image_status" | "image_search_version"> & { image_url: string | null }>;
    const estados = lerEstados();

    for (const produto of pagina) {
      const estado = estados[produto.id];
      const atual = produto as Omit<ProdutoSemImagem, "image_status" | "image_search_version"> & { image_url: string | null };

      if (!estado || estado.fingerprint !== fingerprint(atual)) {
        produtos.push({ ...atual, image_status: "pending", image_search_version: 1 });
      }
    }

    if (pagina.length < PAGINA) break;
    inicio += PAGINA;
  }

  return produtos;
}

export function useImagensPendentes(categoria = TODAS_CATEGORIAS) {
  const queryClient = useQueryClient();
  const [rodando, setRodando] = useState(false);
  const [processados, setProcessados] = useState(0);
  const [encontrados, setEncontrados] = useState(0);
  const [semResultado, setSemResultado] = useState(0);
  const [candidatos, setCandidatos] = useState<CandidatoGoogle[]>([]);
  const [versaoFila, setVersaoFila] = useState(0);

  const pendentes = useQuery({
    queryKey: ["imagens-pendentes", categoria, versaoFila],
    queryFn: () => carregarPendentes(categoria),
  });
  const lista = pendentes.data ?? [];

  const atualizarEstado = useCallback(async (produto: ProdutoSemImagem, status: ImageSearchState["status"]) => {
    salvarEstado(produto, status);
  }, []);

  const salvarImagem = useCallback(async (id: string, url: string) => {
    const { error } = await supabase.from("products").update({ image_url: url }).eq("id", id);
    if (error) throw error;
  }, []);

  const completar = useCallback(async () => {
    if (rodando || !lista.length) return;

    setRodando(true);
    setProcessados(0);
    setEncontrados(0);
    setSemResultado(0);
    const fila = lista;
    let indice = 0;

    const trabalhador = async () => {
      while (indice < fila.length) {
        const produto = fila[indice++]!;
        try {
          const url = produto.ean ? await buscarImagemPorEan(produto.ean) : await buscarImagemPorNome(produto.description);

          if (url) {
            await salvarImagem(produto.id, url);
            const estados = lerEstados();
            delete estados[produto.id];
            gravarEstados(estados);
            setEncontrados((valor) => valor + 1);
          } else {
            const { candidatos: achados } = await buscarCandidatosGoogle({ data: { termo: produto.description } });
            const validados: CandidatoGoogle[] = [];

            for (const achado of achados.slice(0, 8)) {
              if (!(await urlDeImagemValida(achado.url))) continue;
              validados.push({
                id: `${produto.id}-${achado.url}`,
                produto,
                url: achado.url,
                titulo: achado.titulo,
                pontuacao: pontuarCandidato(achado, produto),
              });
              if (validados.length >= 3) break;
            }

            if (validados.length) {
              validados.sort((a, b) => b.pontuacao.total - a.pontuacao.total);
              await atualizarEstado(produto, "pending_approval");
              setCandidatos((atual) => [...atual.filter((item) => item.produto.id !== produto.id), ...validados]);
            } else {
              await atualizarEstado(produto, "not_found");
              setSemResultado((valor) => valor + 1);
            }
          }
        } catch (erro) {
          console.error("Falha ao buscar imagem", produto.id, erro);
          await atualizarEstado(produto, "not_found");
          setSemResultado((valor) => valor + 1);
        }
        setProcessados((valor) => valor + 1);
      }
    };

    await Promise.all(Array.from({ length: Math.min(LOTE, fila.length) }, trabalhador));
    setRodando(false);
    setVersaoFila((valor) => valor + 1);
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    toast.success(`Busca concluída: ${fila.length} produto(s) processado(s).`);
  }, [lista, queryClient, rodando, salvarImagem, atualizarEstado]);

  const pesquisarNovamente = useCallback(() => {
    gravarEstados({});
    setCandidatos([]);
    setVersaoFila((valor) => valor + 1);
    toast.success("Histórico de buscas limpo. Os produtos sem imagem podem ser pesquisados novamente.");
  }, []);

  const aprovar = useCallback(async (candidato: CandidatoGoogle) => {
    try {
      await salvarImagem(candidato.produto.id, candidato.url);
      const estados = lerEstados();
      delete estados[candidato.produto.id];
      gravarEstados(estados);
      setCandidatos((atual) => atual.filter((item) => item.produto.id !== candidato.produto.id));
      setVersaoFila((valor) => valor + 1);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Imagem aprovada e salva.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a imagem");
    }
  }, [queryClient, salvarImagem]);

  const rejeitar = useCallback(async (candidato: CandidatoGoogle) => {
    try {
      await atualizarEstado(candidato.produto, "rejected");
      setCandidatos((atual) => atual.filter((item) => item.produto.id !== candidato.produto.id));
      setVersaoFila((valor) => valor + 1);
      toast.success("Candidato rejeitado. O produto não será pesquisado novamente automaticamente.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível registrar a rejeição");
    }
  }, [atualizarEstado]);

  return {
    lista,
    carregando: pendentes.isLoading,
    rodando,
    processados,
    encontrados,
    semResultado,
    candidatos,
    totalSemImagem: lista.length,
    aguardandoAprovacao: new Set(candidatos.map((item) => item.produto.id)).size,
    completar,
    pesquisarNovamente,
    aprovar,
    rejeitar,
  };
}
