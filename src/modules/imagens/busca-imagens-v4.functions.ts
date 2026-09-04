import { normalizarTexto } from "@/shared/texto";
import {
  buscarCandidatosImagem as buscarCandidatosImagemBase,
  type CandidatoImagemServidor,
} from "./busca-imagens.functions";

const PALAVRAS_IGNORADAS = new Set([
  "de",
  "do",
  "da",
  "com",
  "sem",
  "kg",
  "un",
  "und",
  "unidade",
  "unidades",
  "pct",
  "pacote",
  "cx",
  "caixa",
  "produto",
  "embalado",
  "embalada",
  "bandeja",
]);

const PESO = /(\d+[.,]?\d*)\s?(kg|g|gr|ml|l|lt|litro|litros)\b/gi;
const CODIGO_INTERNO_SOLTO = /^\d{3,6}$/;

function palavrasRelevantes(descricao: string, tipo: string): string[] {
  return normalizarTexto(descricao)
    .split(/\s+/)
    .filter(Boolean)
    .filter((palavra) => palavra.length >= 3)
    .filter((palavra) => !PALAVRAS_IGNORADAS.has(palavra))
    .filter((palavra) => tipo !== "variavel" || !CODIGO_INTERNO_SOLTO.test(palavra));
}

function alvoCandidato(candidato: CandidatoImagemServidor): string {
  let url = candidato.url;
  try {
    url = decodeURIComponent(url);
  } catch {
    // Mantém a URL original quando ela contém escape inválido.
  }

  return normalizarTexto(`${candidato.titulo} ${url}`);
}

function pontosFonte(candidato: CandidatoImagemServidor): number {
  const fontes: Record<string, number> = {
    cosmos: 15,
    ean_pictures: 14,
    upcitemdb: candidato.eanExato ? 12 : 8,
    upcitemdb_text: 7,
    google_images: 5,
  };

  return fontes[candidato.source] ?? 3;
}

function pontosQualidade(candidato: CandidatoImagemServidor): {
  total: number;
  detalhes: Array<{ rotulo: string; pontos: number }>;
} {
  const menorDimensao = Math.min(candidato.width ?? 0, candidato.height ?? 0);
  const resolucao = Math.max(0, Math.min(10, Math.round((menorDimensao / 900) * 10)));
  const fundo = Math.max(
    0,
    Math.min(15, Math.round((candidato.backgroundScore ?? 0) * 15)),
  );

  return {
    total: resolucao + fundo,
    detalhes: [
      { rotulo: "Qualidade · resolução", pontos: resolucao },
      { rotulo: "Qualidade · fundo claro", pontos: fundo },
    ],
  };
}

function pesoCompativel(descricao: string, alvo: string): boolean {
  const medidas = [...descricao.matchAll(PESO)].map(([, numero, unidade]) =>
    normalizarTexto(`${numero}${unidade}`).replace(",", "."),
  );
  const alvoCompacto = alvo.replace(/\s/g, "");

  return medidas.some((medida) =>
    alvoCompacto.includes(medida.replace(/\s/g, "")),
  );
}

function recalcularScore(
  candidato: CandidatoImagemServidor,
  produto: { descricao: string },
  tipoProduto: string,
): CandidatoImagemServidor {
  const alvo = alvoCandidato(candidato);
  const termos = palavrasRelevantes(produto.descricao, tipoProduto);
  const acertos = termos.filter((termo) => alvo.includes(termo)).length;
  const cobertura = termos.length ? acertos / termos.length : 0;
  const detalhes: Array<{ rotulo: string; pontos: number }> = [];

  let correspondencia = 0;

  if (tipoProduto === "industrializado" && candidato.eanExato) {
    const ean = 45;
    const descricao = Math.round(cobertura * 10);
    const peso = pesoCompativel(produto.descricao, alvo) ? 5 : 0;
    correspondencia = Math.min(60, ean + descricao + peso);

    detalhes.push({ rotulo: "Correspondência · EAN exato", pontos: ean });
    detalhes.push({
      rotulo: `Correspondência · descrição (${acertos}/${termos.length})`,
      pontos: descricao,
    });
    if (peso) detalhes.push({ rotulo: "Correspondência · peso/volume", pontos: peso });
  } else {
    const descricao = Math.round(cobertura * 55);
    const peso = tipoProduto === "industrializado" && pesoCompativel(produto.descricao, alvo) ? 5 : 0;
    correspondencia = Math.min(60, descricao + peso);

    detalhes.push({
      rotulo: `Correspondência · descrição (${acertos}/${termos.length})`,
      pontos: descricao,
    });
    if (peso) detalhes.push({ rotulo: "Correspondência · peso/volume", pontos: peso });
  }

  const qualidade = pontosQualidade(candidato);
  const fonte = pontosFonte(candidato);

  detalhes.push(...qualidade.detalhes);
  detalhes.push({ rotulo: `Fonte · ${candidato.source}`, pontos: fonte });

  let total = Math.min(100, correspondencia + qualidade.total + fonte);

  // Sem EAN exato, menos da metade dos termos do produto não é suficiente para
  // aprovação automática. Mantemos o candidato para revisão, mas nunca acima
  // do limiar de 50 apenas por ter boa resolução ou uma fonte razoável.
  if (!candidato.eanExato && termos.length > 0 && cobertura < 0.5) {
    total = Math.min(total, 49);
    detalhes.push({ rotulo: "Proteção · baixa correspondência", pontos: 0 });
  }

  return {
    ...candidato,
    score: total,
    scoreDetails: detalhes.filter((item) => item.pontos !== 0 || item.rotulo.startsWith("Proteção")),
  };
}

/**
 * Fase 4 do pipeline: mantém os mecanismos de busca existentes e transforma a
 * nota em três blocos previsíveis: correspondência (60), qualidade (25) e
 * confiabilidade da fonte (15). O limite de aprovação continua sendo definido
 * pelo fluxo de catálogo em 50/100.
 */
export async function buscarCandidatosImagem(
  argumentos: Parameters<typeof buscarCandidatosImagemBase>[0],
) {
  const resultado = await buscarCandidatosImagemBase(argumentos);
  const tipoProduto = resultado.tipoProduto ?? "industrializado";
  const descricao = argumentos.data.descricao;

  return {
    ...resultado,
    candidatos: resultado.candidatos
      .map((candidato) =>
        recalcularScore(candidato, { descricao }, tipoProduto),
      )
      .sort((a, b) => b.score - a.score),
  };
}

export type { CandidatoImagemServidor };
