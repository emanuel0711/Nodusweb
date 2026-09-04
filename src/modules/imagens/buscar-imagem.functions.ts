import {
  buscarCandidatosImagem as buscarCandidatosImagemBase,
  type CandidatoImagemServidor,
  type TipoProdutoImagem,
} from "./busca-imagens.functions";
import { buscarCandidatosFabricante } from "./busca-fabricantes.functions";
import { buscarCandidatosWeb } from "./busca-web-imagens.functions";
import { recalcularScoreImagem } from "./score-imagem";

const CACHE_TTL_MS = 15 * 60 * 1000;
const CACHE_MAX_ITENS = 300;
const MIN_CANDIDATOS_ANTES_FALLBACK = 2;

const DOMINIOS_CONFIAVEIS_VARIAVEIS = [
  "zaffari.com.br",
  "zaffari.vtexassets.com",
  "carrefour.com.br",
  "mercado.carrefour.com.br",
  "paodeacucar.com",
  "paodeacucar.vtexassets.com",
];

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

function dominioConfiavel(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return DOMINIOS_CONFIAVEIS_VARIAVEIS.some(
      (dominio) => host === dominio || host.endsWith(`.${dominio}`),
    );
  } catch {
    return false;
  }
}

function filtrarPrincipaisParaProdutoVariavel(
  candidatos: CandidatoImagemServidor[],
): CandidatoImagemServidor[] {
  return candidatos.filter((candidato) => {
    if (candidato.source !== "google_images") return true;
    return dominioConfiavel(candidato.url);
  });
}

function mesclarCandidatos(
  principais: CandidatoImagemServidor[],
  adicionais: CandidatoImagemServidor[],
): CandidatoImagemServidor[] {
  const mapa = new Map<string, CandidatoImagemServidor>();

  for (const candidato of [...principais, ...adicionais]) {
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

  let candidatos =
    tipoProduto === "variavel"
      ? filtrarPrincipaisParaProdutoVariavel(resultado.candidatos)
      : resultado.candidatos;

  // Quando a descrição contém uma marca conhecida, o site oficial do fabricante
  // é a primeira alternativa depois das fontes por GTIN. A busca só aceita
  // imagens cercadas por texto compatível com o nome do produto.
  if (candidatos.length < MIN_CANDIDATOS_ANTES_FALLBACK) {
    const fabricante = await buscarCandidatosFabricante({
      data: {
        descricao: argumentos.data.descricao,
        categoria: argumentos.data.categoria,
      },
    });

    candidatos = mesclarCandidatos(candidatos, fabricante.candidatos);
  }

  // Se o fabricante não tiver imagem utilizável, tenta catálogos estruturados
  // de grandes supermercados. Não voltamos a usar busca aberta de imagens.
  if (candidatos.length < MIN_CANDIDATOS_ANTES_FALLBACK) {
    const varejistas = await buscarCandidatosWeb({
      data: {
        descricao: argumentos.data.descricao,
        categoria: argumentos.data.categoria,
      },
    });

    candidatos = mesclarCandidatos(candidatos, varejistas.candidatos);
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
 * Ordem de descoberta: bases por GTIN, site oficial do fabricante quando a
 * marca é reconhecida e, por último, catálogos de varejistas confiáveis.
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
