import { normalizarTexto } from "@/shared/texto";
import type {
  CandidatoImagemServidor,
  TipoProdutoImagem,
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
const FONTES_WEB_TEXTO = new Set(["google_images", "bing_images"]);

function palavrasRelevantes(
  descricao: string,
  tipo: TipoProdutoImagem,
): string[] {
  return normalizarTexto(descricao)
    .split(/\s+/)
    .filter(Boolean)
    .filter((palavra) => palavra.length >= 3)
    .filter((palavra) => !PALAVRAS_IGNORADAS.has(palavra))
    .filter(
      (palavra) => tipo !== "variavel" || !CODIGO_INTERNO_SOLTO.test(palavra),
    );
}

function alvoCandidato(candidato: CandidatoImagemServidor): string {
  let url = candidato.url;

  try {
    url = decodeURIComponent(url);
  } catch {
    // Mantém a URL original quando houver escape inválido.
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
    bing_images: 5,
  };

  return fontes[candidato.source] ?? 3;
}

function pontosQualidade(candidato: CandidatoImagemServidor) {
  const menorDimensao = Math.min(candidato.width ?? 0, candidato.height ?? 0);
  const resolucao = Math.max(
    0,
    Math.min(10, Math.round((menorDimensao / 900) * 10)),
  );
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

export function recalcularScoreImagem(
  candidato: CandidatoImagemServidor,
  descricaoProduto: string,
  tipoProduto: TipoProdutoImagem,
): CandidatoImagemServidor {
  const alvo = alvoCandidato(candidato);
  const termos = palavrasRelevantes(descricaoProduto, tipoProduto);
  const acertos = termos.filter((termo) => alvo.includes(termo)).length;
  const cobertura = termos.length ? acertos / termos.length : 0;
  const detalhes: Array<{ rotulo: string; pontos: number }> = [];

  let correspondencia = 0;

  if (tipoProduto === "industrializado" && candidato.eanExato) {
    const ean = 45;
    const descricao = Math.round(cobertura * 10);
    const peso = pesoCompativel(descricaoProduto, alvo) ? 5 : 0;
    correspondencia = Math.min(60, ean + descricao + peso);

    detalhes.push({ rotulo: "Correspondência · EAN exato", pontos: ean });
    detalhes.push({
      rotulo: `Correspondência · descrição (${acertos}/${termos.length})`,
      pontos: descricao,
    });
    if (peso) {
      detalhes.push({
        rotulo: "Correspondência · peso/volume",
        pontos: peso,
      });
    }
  } else {
    const descricao = Math.round(cobertura * 55);
    const peso =
      tipoProduto === "industrializado" &&
      pesoCompativel(descricaoProduto, alvo)
        ? 5
        : 0;
    correspondencia = Math.min(60, descricao + peso);

    detalhes.push({
      rotulo: `Correspondência · descrição (${acertos}/${termos.length})`,
      pontos: descricao,
    });
    if (peso) {
      detalhes.push({
        rotulo: "Correspondência · peso/volume",
        pontos: peso,
      });
    }
  }

  const qualidade = pontosQualidade(candidato);
  const fonte = pontosFonte(candidato);

  detalhes.push(...qualidade.detalhes);
  detalhes.push({ rotulo: `Fonte · ${candidato.source}`, pontos: fonte });

  let total = Math.min(100, correspondencia + qualidade.total + fonte);

  if (!candidato.eanExato && termos.length > 0 && cobertura < 0.5) {
    total = Math.min(total, 49);
    detalhes.push({
      rotulo: "Proteção · baixa correspondência",
      pontos: 0,
    });
  }

  // Produtos variáveis encontrados apenas por pesquisa textual na web devem
  // passar por revisão humana. Nome parecido em uma busca de imagens não é
  // evidência suficiente para vincular automaticamente frutas, legumes ou
  // cortes por peso ao catálogo.
  if (
    tipoProduto === "variavel" &&
    !candidato.eanExato &&
    FONTES_WEB_TEXTO.has(candidato.source)
  ) {
    total = Math.min(total, 49);
    detalhes.push({
      rotulo: "Proteção · produto variável requer revisão",
      pontos: 0,
    });
  }

  return {
    ...candidato,
    score: total,
    scoreDetails: detalhes.filter(
      (item) =>
        item.pontos !== 0 || item.rotulo.startsWith("Proteção"),
    ),
  };
}
