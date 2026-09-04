import {
  buscarCandidatosImagem as buscarCandidatosImagemBase,
  type CandidatoImagemServidor,
  type TipoProdutoImagem,
} from "./busca-imagens.functions";
import { recalcularScoreImagem } from "./score-imagem";

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ITENS = 300;

type ResultadoBusca = Awaited<ReturnType<typeof buscarCandidatosImagemBase>> & {
  candidatos: CandidatoImagemServidor[];
};

type CacheItem = {
  expiraEm: number;
  resultado: ResultadoBusca;
};

const cache = new Map<string, CacheItem>();
const buscasEmAndamento = new Map<string, Promise<ResultadoBusca>>();

function chaveBusca(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
): string {
  const { ean = "", descricao, categoria = "" } = argumentos.data;
  return `${ean}|${descricao.trim().toLowerCase()}|${categoria ?? ""}`;
}

function lerCache(chave: string): ResultadoBusca | null {
  const item = cache.get(chave);
  if (!item) return null;

  if (item.expiraEm <= Date.now()) {
    cache.delete(chave);
    return null;
  }

  return item.resultado;
}

function salvarCache(chave: string, resultado: ResultadoBusca) {
  if (cache.size >= CACHE_MAX_ITENS) {
    const primeiraChave = cache.keys().next().value;
    if (primeiraChave) cache.delete(primeiraChave);
  }

  cache.set(chave, {
    expiraEm: Date.now() + CACHE_TTL_MS,
    resultado,
  });
}

async function executarBusca(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
): Promise<ResultadoBusca> {
  const resultado = await buscarCandidatosImagemBase(argumentos);
  const tipoProduto: TipoProdutoImagem =
    resultado.tipoProduto ?? "industrializado";
  const descricao = argumentos.data.descricao;

  return {
    ...resultado,
    candidatos: resultado.candidatos
      .map((candidato) =>
        recalcularScoreImagem(candidato, descricao, tipoProduto),
      )
      .sort((a, b) => b.score - a.score),
  };
}

/**
 * Ponto único usado pela interface para pesquisar imagens.
 *
 * A camada também evita repetir a mesma consulta enquanto uma busca idêntica
 * está em andamento e mantém um cache curto durante a sessão. Isso reduz custo
 * e latência em reprocessamentos acidentais sem transformar o cache em fonte de
 * verdade; o Supabase continua sendo responsável pelo estado persistente.
 */
export async function buscarCandidatosImagem(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
): Promise<ResultadoBusca> {
  const chave = chaveBusca(argumentos);
  const emCache = lerCache(chave);
  if (emCache) return emCache;

  const existente = buscasEmAndamento.get(chave);
  if (existente) return existente;

  const promessa = executarBusca(argumentos)
    .then((resultado) => {
      salvarCache(chave, resultado);
      return resultado;
    })
    .finally(() => {
      buscasEmAndamento.delete(chave);
    });

  buscasEmAndamento.set(chave, promessa);
  return promessa;
}

export type { CandidatoImagemServidor };
