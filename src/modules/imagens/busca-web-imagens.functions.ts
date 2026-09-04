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
const MAX_URLS = 10;
const MAX_VALIDOS = 5;
const CONCORRENCIA_ANALISE = 3;

const UNIDADES = /\b(?:kg|quilo|quilos|un|und|unidade|unidades|pct|pacote|cx|caixa|bandeja)\b/gi;
const MEDIDAS = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|litro|litros|un|und)\b/gi;
const CODIGO_INTERNO = /\b\d{3,6}\b/g;

function limparDescricao(descricao: string): string {
  return normalizarTexto(descricao)
    .replace(MEDIDAS, " ")
    .replace(UNIDADES, " ")
    .replace(CODIGO_INTERNO, " ")
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

function decodificarHtml(valor: string): string {
  return valor
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u0026/gi, "&")
    .replace(/\\\//g, "/");
}

function extrairUrlsBing(html: string): string[] {
  const texto = decodificarHtml(html);
  const urls = new Set<string>();

  for (const match of texto.matchAll(/"murl"\s*:\s*"(https?:[^"<>]+)"/gi)) {
    const url = decodificarHtml(match[1] ?? "").trim();
    if (!url || urls.has(url)) continue;
    urls.add(url);
    if (urls.size >= MAX_URLS) break;
  }

  return [...urls];
}

async function buscarBing(termo: string): Promise<string[]> {
  const resposta = await fetchComTimeout(
    `https://www.bing.com/images/search?q=${encodeURIComponent(termo)}&form=HDRSC3&first=1`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      },
    },
  );

  if (!resposta?.ok) return [];
  return extrairUrlsBing(await resposta.text());
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

async function analisarComConcorrencia(urls: string[], descricao: string) {
  const resultados: CandidatoImagemServidor[] = [];
  let indice = 0;

  async function trabalhador() {
    while (indice < urls.length && resultados.length < MAX_VALIDOS) {
      const url = urls[indice++]!;
      const analise = await analisarImagem(url);
      if (!analise) continue;

      resultados.push({
        url,
        titulo: descricao,
        source: "bing_images",
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
      { length: Math.min(CONCORRENCIA_ANALISE, urls.length) },
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

    const consultas = [
      `${termoBase} fundo branco`,
      `${termoBase} supermercado`,
    ];

    const urls = new Set<string>();

    for (const consulta of consultas) {
      for (const url of await buscarBing(consulta)) {
        urls.add(url);
        if (urls.size >= MAX_URLS) break;
      }
      if (urls.size >= MAX_URLS) break;
    }

    const candidatos = await analisarComConcorrencia(
      [...urls].slice(0, MAX_URLS),
      termoBase,
    );

    console.info("[Nodus web image fallback]", {
      descricao: data.descricao,
      categoria: data.categoria,
      termoBase,
      urlsEncontradas: urls.size,
      candidatosValidos: candidatos.length,
    });

    return { candidatos };
  });
