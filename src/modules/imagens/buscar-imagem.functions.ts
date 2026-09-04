import {
  buscarCandidatosImagem as buscarCandidatosImagemBase,
  type CandidatoImagemServidor,
  type TipoProdutoImagem,
} from "./busca-imagens.functions";
import { buscarCandidatosWeb } from "./busca-web-imagens.functions";
import { recalcularScoreImagem } from "./score-imagem";

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ITENS = 300;
const MIN_CANDIDATOS_ANTES_FALLBACK = 2;

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

function mesclarCandidatos(
  principais: CandidatoImagemServidor[],
  fallback: CandidatoImagemServidor[],
): CandidatoImagemServidor[] {
  const mapa = new Map<string, CandidatoImagemServidor>();

  for (const candidato of [...principais, ...fallback]) {
    if (!candidato.url || mapa.has(candidato.url)) continue;
    mapa.set(candidato.url, candidato);
  }

  return [...mapa.values()];
}

async function executarBusca(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
): Promise<ResultadoBusca> {
  const resultado = await buscarCandidatosImagemBase(argumentos);
  const tipoProduto: TipoProdutoImagem =
    resultado.tipoProduto ?? "industrializado";

  let candidatos = resultado.candidatos;

  // Se as fontes principais trouxerem pouco ou nenhum resultado, buscamos uma
  // segunda fonte web. Isso evita transformar falha do scraping do Google em
  // "não existe imagem" e aumenta a chance de gerar opções para revisão manual.
  if (candidatos.length < MIN_CANDIDATOS_ANTES_FALLBACK) {
    const fallback = await buscarCandidatosWeb({
      data: {
        descricao: argumentos.data.descricao,
        categoria: argumentos.data.categoria,
      },
    });

    candidatos = mesclarCandidatos(candidatos, fallback.candidatos);
  }

  return {
    ...resultado,
    candidatos: candidatos
      .map((candidato) =>
        recalcularScoreImagem(
          candidato,
          argumentos.data.descricao,
          tipoProduto,
        ),
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 5),
  };
}

/**
 * Ponto único usado pela interface para pesquisar imagens.
 *
 * A camada evita repetir a mesma consulta enquanto uma busca idêntica está em
 * andamento, mantém cache curto e aciona um fallback web quando as fontes
 * principais não produzem candidatos suficientes.
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
