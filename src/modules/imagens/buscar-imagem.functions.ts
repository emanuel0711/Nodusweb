import {
  buscarCandidatosImagem as buscarCandidatosImagemBase,
  type CandidatoImagemServidor,
  type TipoProdutoImagem,
} from "./busca-imagens.functions";
import { recalcularScoreImagem } from "./score-imagem";

/**
 * Ponto único usado pela interface para pesquisar imagens.
 * A busca encontra/valida candidatos; a pontuação decide a confiança.
 */
export async function buscarCandidatosImagem(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
) {
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

export type { CandidatoImagemServidor };
