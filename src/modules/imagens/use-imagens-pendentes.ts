/** Fila de imagens pendentes: processa todos os produtos sem limite artificial de 1.000 registros. */
import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { buscarImagemPorEan, buscarImagemPorNome, urlDeImagemValida } from "@/modules/imagens/busca-imagens";
import { buscarCandidatosGoogle } from "@/lib/google-imagens.functions";
import { pontuarCandidato, type Pontuacao } from "@/modules/imagens/confianca-google";

const LOTE = 4;
const PAGINA = 500;

export interface ProdutoSemImagem { id: string; ean: string | null; description: string; category: string | null }
export interface CandidatoGoogle { id: string; produto: ProdutoSemImagem; url: string; titulo: string; pontuacao: Pontuacao }

async function carregarSemImagem(): Promise<ProdutoSemImagem[]> {
  const produtos: ProdutoSemImagem[] = [];
  let inicio = 0;

  while (true) {
    const { data, error } = await supabase.from("products")
      .select("id, ean, description, category")
      .is("image_url", null)
      .order("description")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw error;
    const pagina = (data ?? []) as ProdutoSemImagem[];
    produtos.push(...pagina);
    if (pagina.length < PAGINA) break;
    inicio += PAGINA;
  }

  return produtos;
}

export function useImagensPendentes() {
  const queryClient = useQueryClient();
  const [rodando, setRodando] = useState(false);
  const [processados, setProcessados] = useState(0);
  const [encontrados, setEncontrados] = useState(0);
  const [semResultado, setSemResultado] = useState(0);
  const [candidatos, setCandidatos] = useState<CandidatoGoogle[]>([]);

  const pendentes = useQuery({ queryKey: ["imagens-pendentes"], queryFn: carregarSemImagem });
  const lista = pendentes.data ?? [];

  const salvarImagem = useCallback(async (id: string, url: string) => {
    const { error } = await supabase.from("products").update({ image_url: url }).eq("id", id);
    if (error) throw error;
  }, []);

  const completar = useCallback(async () => {
    if (rodando || !lista.length) return;
    setRodando(true); setProcessados(0); setEncontrados(0); setSemResultado(0);
    const fila = [...lista];
    let indice = 0;

    const trabalhador = async () => {
      while (indice < fila.length) {
        const produto = fila[indice++]!;
        try {
          const url = produto.ean ? await buscarImagemPorEan(produto.ean) : await buscarImagemPorNome(produto.description);
          if (url) {
            await salvarImagem(produto.id, url);
            setEncontrados((valor) => valor + 1);
          } else {
            const { candidatos: achados } = await buscarCandidatosGoogle({ data: { termo: produto.description } });
            const validados: CandidatoGoogle[] = [];
            for (const achado of achados.slice(0, 8)) {
              if (!(await urlDeImagemValida(achado.url))) continue;
              validados.push({ id: `${produto.id}-${achado.url}`, produto, url: achado.url, titulo: achado.titulo, pontuacao: pontuarCandidato(achado, produto) });
              if (validados.length >= 3) break;
            }
            if (validados.length) {
              validados.sort((a, b) => b.pontuacao.total - a.pontuacao.total);
              setCandidatos((atual) => [...atual.filter((item) => item.produto.id !== produto.id), ...validados]);
            } else {
              setSemResultado((valor) => valor + 1);
            }
          }
        } catch (erro) {
          console.error("Falha ao buscar imagem", produto.id, erro);
          setSemResultado((valor) => valor + 1);
        }
        setProcessados((valor) => valor + 1);
      }
    };

    await Promise.all(Array.from({ length: Math.min(LOTE, fila.length) }, trabalhador));
    setRodando(false);
    queryClient.invalidateQueries({ queryKey: ["imagens-pendentes"] });
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    toast.success(`Busca concluída: ${fila.length} produto(s) processado(s).`);
  }, [lista, queryClient, rodando, salvarImagem]);

  const aprovar = useCallback(async (candidato: CandidatoGoogle) => {
    try {
      await salvarImagem(candidato.produto.id, candidato.url);
      setCandidatos((atual) => atual.filter((item) => item.produto.id !== candidato.produto.id));
      queryClient.invalidateQueries({ queryKey: ["imagens-pendentes"] });
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Imagem aprovada e salva.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível salvar a imagem");
    }
  }, [queryClient, salvarImagem]);

  const rejeitar = useCallback((candidato: CandidatoGoogle) => {
    setCandidatos((atual) => atual.filter((item) => item.id !== candidato.id));
  }, []);

  return {
    lista, carregando: pendentes.isLoading, rodando, processados, encontrados, semResultado,
    candidatos, totalSemImagem: lista.length, aguardandoAprovacao: new Set(candidatos.map((item) => item.produto.id)).size,
    completar, aprovar, rejeitar,
  };
}
