import { createServerFn } from "@tanstack/react-start";
import sharp from "sharp";
import { z } from "zod";
import { normalizarTexto } from "@/shared/texto";
import type { CandidatoImagemServidor } from "./busca-imagens.functions";

const entrada = z.object({
  descricao: z.string().min(2).max(220),
  categoria: z.string().max(120).nullable().optional(),
});

const TIMEOUT_MS = 7_000;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_VALIDOS = 5;
const CONCORRENCIA_ANALISE = 3;

const UNIDADES = /\b(?:kg|quilo|quilos|un|und|unidade|unidades|pct|pacote|cx|caixa|bandeja)\b/gi;
const MEDIDAS = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|litro|litros|un|und)\b/gi;
const CODIGO_INTERNO = /\b\d{3,6}\b/g;

const FONTES = [
  {
    source: "zaffari",
    baseUrl: "https://www.zaffari.com.br",
  },
  {
    source: "carrefour",
    baseUrl: "https://mercado.carrefour.com.br",
  },
] as const;

type ProdutoVtex = {
  productName?: string;
  productTitle?: string;
  linkText?: string;
  items?: Array<{
    ean?: string;
    images?: Array<{
      imageUrl?: string;
      imageLabel?: string;
      imageText?: string;
    }>;
  }>;
};

type CandidatoCatalogo = {
  url: string;
  titulo: string;
  source: string;
};

function limparDescricao(descricao: string): string {
  return normalizarTexto(descricao)
    .replace(MEDIDAS, " ")
    .replace(UNIDADES, " ")
    .replace(CODIGO_INTERNO, " ")
    .replace(/\b(?:aprox|aproximadamente|emb|embalado|embalada)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchComTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: "follow",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function palavras(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3);
}

function coberturaTitulo(termo: string, titulo: string): number {
  const termos = palavras(termo);
  if (!termos.length) return 0;
  const alvo = normalizarTexto(titulo);
  const acertos = termos.filter((palavra) => alvo.includes(palavra)).length;
  return acertos / termos.length;
}

async function consultarVtex(
  baseUrl: string,
  termo: string,
): Promise<ProdutoVtex[]> {
  const consultas = [
    `${baseUrl}/api/catalog_system/pub/products/search/${encodeURIComponent(termo)}`,
    `${baseUrl}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(termo)}`,
  ];

  for (const url of consultas) {
    const resposta = await fetchComTimeout(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; NodusCatalogBot/1.0)",
        Range: "resources=0-9",
      },
    });

    if (!resposta?.ok) continue;

    try {
      const dados = (await resposta.json()) as ProdutoVtex[];
      if (Array.isArray(dados) && dados.length) return dados;
    } catch {
      // Tenta a próxima forma de consulta.
    }
  }

  return [];
}

async function buscarCatalogos(termo: string): Promise<CandidatoCatalogo[]> {
  const resultados = await Promise.all(
    FONTES.map(async ({ source, baseUrl }) => {
      const produtos = await consultarVtex(baseUrl, termo);
      const candidatos: CandidatoCatalogo[] = [];

      for (const produto of produtos) {
        const titulo =
          produto.productName ?? produto.productTitle ?? produto.linkText ?? "";

        // Catálogo de supermercado só entra se o nome real do produto tiver
        // relação mínima com a descrição pesquisada. Isso evita imagens aleatórias.
        if (!titulo || coberturaTitulo(termo, titulo) < 0.5) continue;

        for (const item of produto.items ?? []) {
          for (const imagem of item.images ?? []) {
            const url = imagem.imageUrl?.trim();
            if (!url) continue;

            candidatos.push({
              url,
              titulo,
              source,
            });
          }
        }
      }

      return candidatos;
    }),
  );

  const unicos = new Map<string, CandidatoCatalogo>();
  for (const candidato of resultados.flat()) {
    if (!unicos.has(candidato.url)) unicos.set(candidato.url, candidato);
  }

  return [...unicos.values()].slice(0, 12);
}

async function analisarImagem(url: string) {
  const resposta = await fetchComTimeout(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; NodusImageBot/1.0)",
    },
  });

  if (!resposta?.ok) return null;

  const tamanho = Number(resposta.headers.get("content-length") ?? 0);
  if (tamanho > MAX_BYTES) return null;

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_BYTES) return null;

  try {
    const imagem = sharp(buffer, { failOn: "none" });
    const metadata = await imagem.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width < 160 || height < 160) return null;

    const { data, info } = await imagem
      .resize(48, 48, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let borda = 0;
    let claros = 0;
    const margem = 6;

    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const naBorda =
          x < margem ||
          x >= info.width - margem ||
          y < margem ||
          y >= info.height - margem;
        if (!naBorda) continue;

        borda += 1;
        const offset = (y * info.width + x) * info.channels;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;

        if (r >= 235 && g >= 235 && b >= 235) claros += 1;
      }
    }

    return {
      width,
      height,
      backgroundScore: borda ? Number((claros / borda).toFixed(4)) : 0,
    };
  } catch {
    return null;
  }
}

async function analisarComConcorrencia(
  candidatos: CandidatoCatalogo[],
): Promise<CandidatoImagemServidor[]> {
  const resultados: CandidatoImagemServidor[] = [];
  let indice = 0;

  async function trabalhador() {
    while (indice < candidatos.length && resultados.length < MAX_VALIDOS) {
      const candidato = candidatos[indice++]!;
      const analise = await analisarImagem(candidato.url);
      if (!analise) continue;

      resultados.push({
        url: candidato.url,
        titulo: candidato.titulo,
        source: candidato.source,
        score: 0,
        scoreDetails: [],
        width: analise.width,
        height: analise.height,
        backgroundScore: analise.backgroundScore,
        eanExato: false,
      });
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CONCORRENCIA_ANALISE, candidatos.length) },
      trabalhador,
    ),
  );

  return resultados.slice(0, MAX_VALIDOS);
}

export const buscarCandidatosWeb = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const termoBase = limparDescricao(data.descricao);
    if (!termoBase) return { candidatos: [] as CandidatoImagemServidor[] };

    const candidatosCatalogo = await buscarCatalogos(termoBase);
    const candidatos = await analisarComConcorrencia(candidatosCatalogo);

    console.info("[Nodus retailer image search]", {
      descricao: data.descricao,
      categoria: data.categoria,
      termoBase,
      candidatosCatalogo: candidatosCatalogo.length,
      candidatosValidos: candidatos.length,
      fontes: [...new Set(candidatos.map((item) => item.source))],
    });

    return { candidatos };
  });
