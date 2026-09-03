import { createServerFn } from "@tanstack/react-start";
import sharp from "sharp";
import { z } from "zod";
import { normalizarTexto } from "@/shared/texto";

const entrada = z.object({
  ean: z.string().max(32).optional().default(""),
  descricao: z.string().min(2).max(220),
  categoria: z.string().max(120).nullable().optional(),
});

const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const EAN_PICTURES = "https://www.eanpictures.com.br:9000/api/gtin";
const UPC_SEARCH_API = "https://api.upcitemdb.com/prod/trial/search";
const TIMEOUT_MS = 7000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATOS_ANALISADOS = 18;

const FONTES_PRIORITARIAS = [
  "zaffari.com.br",
  "carrefour.com.br",
  "paodeacucar.com",
  "mercadolivre.com.br",
  "amazon.com.br",
  "magazineluiza.com.br",
];

const IGNORAR_GOOGLE = /gstatic|googleusercontent|google\.com|googleapis|\.svg(\?|$)|sprite|favicon|logo/i;
const EXTENSAO_IMAGEM = /\.(?:jpe?g|png|webp)(?:[?#&]|$)/i;
const PALAVRAS_IGNORADAS = new Set(["de", "do", "da", "com", "sem", "kg", "un", "und", "unidade", "pct", "cx", "produto"]);
const PESO = /(\d+[.,]?\d*)\s?(kg|g|gr|ml|l|lt|litro|litros)\b/gi;

export interface CandidatoImagemServidor {
  url: string;
  titulo: string;
  source: string;
  score: number;
  scoreDetails: Array<{ rotulo: string; pontos: number }>;
  width: number | null;
  height: number | null;
  backgroundScore: number | null;
  eanExato: boolean;
}

type CandidatoBruto = {
  url: string;
  titulo: string;
  source: string;
  eanExato: boolean;
};

function somenteNumeros(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

async function fetchComTimeout(url: string, init?: RequestInit): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function limparUrlGoogle(valor: string): string {
  return valor
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/&amp;/gi, "&");
}

function extrairGoogle(html: string): Array<{ url: string; titulo: string }> {
  const encontrados = new Map<string, string>();
  const urls = html.match(/https?:\\?\/\\?\/[^"'<>\\s\\]+/gi) ?? [];

  for (const bruto of urls) {
    const url = limparUrlGoogle(bruto).replace(/[\\]$/, "");
    if (!EXTENSAO_IMAGEM.test(url) || IGNORAR_GOOGLE.test(url) || encontrados.has(url)) continue;
    encontrados.set(url, "");
  }

  for (const [, bruto] of html.matchAll(/\["(https?:\\?\/\\?\/[^"\\]+?\.(?:jpe?g|png|webp)(?:[?#&][^"\\]*)?)",\d+,\d+\]/gi)) {
    const url = limparUrlGoogle(bruto);
    if (url && !IGNORAR_GOOGLE.test(url) && !encontrados.has(url)) encontrados.set(url, "");
  }

  const titulos = [...html.matchAll(/"(?:pt|2003)":"([^"]{6,200})"/g)].map(([, texto]) =>
    (texto ?? "").replace(/\\u[\dA-Fa-f]{4}/g, " ").trim(),
  );

  return [...encontrados.keys()].slice(0, 18).map((url, indice) => ({
    url,
    titulo: titulos[indice] ?? "",
  }));
}

async function buscarGoogle(termo: string): Promise<Array<{ url: string; titulo: string }>> {
  const resposta = await fetchComTimeout(`https://www.google.com/search?tbm=isch&hl=pt-BR&q=${encodeURIComponent(termo)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
  });
  if (!resposta?.ok) return [];
  return extrairGoogle(await resposta.text());
}

async function candidatosPorEan(ean: string): Promise<CandidatoBruto[]> {
  if (ean.length < 8) return [];

  const tarefas: Array<Promise<CandidatoBruto[]>> = [
    Promise.resolve([
      { url: `${COSMOS_CDN}/${encodeURIComponent(ean)}`, titulo: ean, source: "cosmos", eanExato: true },
      { url: `${EAN_PICTURES}/${encodeURIComponent(ean)}`, titulo: ean, source: "ean_pictures", eanExato: true },
    ]),
    (async () => {
      const resposta = await fetchComTimeout(`${UPC_SEARCH_API}?s=${encodeURIComponent(ean)}&match_mode=1`);
      if (!resposta?.ok) return [];
      const dados = (await resposta.json()) as { items?: Array<{ title?: string; ean?: string; upc?: string; images?: string[] }> };
      return (dados.items ?? []).flatMap((item) =>
        (item.images ?? []).map((url) => ({
          url,
          titulo: item.title ?? "",
          source: "upcitemdb",
          eanExato: [item.ean, item.upc].map(somenteNumeros).includes(ean),
        })),
      );
    })(),
    (async () => {
      const codigos = ean.length === 12 ? [ean, `0${ean}`] : [ean];
      const saida: CandidatoBruto[] = [];
      for (const codigo of codigos) {
        const resposta = await fetchComTimeout(`${OFF_API}/${encodeURIComponent(codigo)}.json?fields=product_name,code,image_front_url,image_url,image_front_small_url`);
        if (!resposta?.ok) continue;
        const dados = (await resposta.json()) as {
          status?: number;
          product?: {
            product_name?: string;
            code?: string;
            image_front_url?: string;
            image_url?: string;
            image_front_small_url?: string;
          };
        };
        if (dados.status !== 1 || !dados.product) continue;
        for (const url of [dados.product.image_front_url, dados.product.image_url, dados.product.image_front_small_url]) {
          if (!url) continue;
          saida.push({
            url,
            titulo: dados.product.product_name ?? "",
            source: "open_food_facts",
            eanExato: somenteNumeros(dados.product.code) === codigo,
          });
        }
      }
      return saida;
    })(),
  ];

  return (await Promise.all(tarefas)).flat();
}

async function candidatosPorDescricao(descricao: string): Promise<CandidatoBruto[]> {
  const tarefas: Array<Promise<CandidatoBruto[]>> = [
    (async () => {
      const resposta = await fetchComTimeout(`${UPC_SEARCH_API}?s=${encodeURIComponent(`${descricao} produto`)}&match_mode=0`);
      if (!resposta?.ok) return [];
      const dados = (await resposta.json()) as { items?: Array<{ title?: string; images?: string[] }> };
      return (dados.items ?? []).flatMap((item) =>
        (item.images ?? []).map((url) => ({ url, titulo: item.title ?? "", source: "upcitemdb_text", eanExato: false })),
      );
    })(),
    (async () => {
      const consultas = [`${descricao} produto embalagem fundo branco`, ...FONTES_PRIORITARIAS.map((dominio) => `${descricao} site:${dominio}`)];
      const encontrados = new Map<string, CandidatoBruto>();
      for (const consulta of consultas) {
        const resultados = await buscarGoogle(consulta);
        for (const resultado of resultados) {
          if (!encontrados.has(resultado.url)) {
            encontrados.set(resultado.url, {
              ...resultado,
              source: "google_images",
              eanExato: false,
            });
          }
        }
        if (encontrados.size >= 18) break;
      }
      return [...encontrados.values()];
    })(),
  ];

  return (await Promise.all(tarefas)).flat();
}

async function analisarImagem(url: string): Promise<{ width: number; height: number; backgroundScore: number } | null> {
  const resposta = await fetchComTimeout(url, {
    headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
  });
  if (!resposta?.ok) return null;

  const tipo = resposta.headers.get("content-type") ?? "";
  if (!tipo.startsWith("image/")) return null;

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
      .resize(64, 64, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let borda = 0;
    let brancos = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const naBorda = x < 8 || x >= info.width - 8 || y < 8 || y >= info.height - 8;
        if (!naBorda) continue;
        borda += 1;
        const offset = (y * info.width + x) * info.channels;
        const r = data[offset] ?? 0;
        const g = data[offset + 1] ?? 0;
        const b = data[offset + 2] ?? 0;
        if (r >= 238 && g >= 238 && b >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 12) brancos += 1;
      }
    }

    return {
      width,
      height,
      backgroundScore: borda ? Number((brancos / borda).toFixed(4)) : 0,
    };
  } catch {
    return null;
  }
}

function palavras(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3 && !PALAVRAS_IGNORADAS.has(palavra));
}

function pontuar(
  candidato: CandidatoBruto,
  produto: { descricao: string; categoria?: string | null; ean: string },
  analise: { width: number; height: number; backgroundScore: number },
): { total: number; detalhes: Array<{ rotulo: string; pontos: number }> } {
  const alvo = normalizarTexto(`${candidato.titulo} ${decodeURIComponent(candidato.url)}`);
  const termos = palavras(produto.descricao);
  const detalhes: Array<{ rotulo: string; pontos: number }> = [];

  const pesoFonte: Record<string, number> = {
    cosmos: 22,
    ean_pictures: 20,
    open_food_facts: 16,
    upcitemdb: 15,
    upcitemdb_text: 8,
    google_images: 5,
  };
  detalhes.push({ rotulo: `Fonte: ${candidato.source}`, pontos: pesoFonte[candidato.source] ?? 0 });

  if (candidato.eanExato) detalhes.push({ rotulo: "EAN exato", pontos: 28 });

  const acertos = termos.filter((termo) => alvo.includes(termo)).length;
  const cobertura = termos.length ? acertos / termos.length : 0;
  detalhes.push({ rotulo: `Descrição (${acertos}/${termos.length} termos)`, pontos: Math.round(cobertura * 24) });

  const pesos = [...produto.descricao.matchAll(PESO)].map(([, numero, medida]) => normalizarTexto(`${numero}${medida}`).replace(",", "."));
  if (pesos.some((peso) => alvo.replace(/\s/g, "").includes(peso.replace(/\s/g, "")))) {
    detalhes.push({ rotulo: "Peso/volume compatível", pontos: 8 });
  }

  const resolucao = Math.min(8, Math.round((Math.min(analise.width, analise.height) / 800) * 8));
  detalhes.push({ rotulo: `Resolução ${analise.width}×${analise.height}`, pontos: resolucao });

  const fundo = Math.round(analise.backgroundScore * 10);
  detalhes.push({ rotulo: `Fundo branco ${Math.round(analise.backgroundScore * 100)}%`, pontos: fundo });

  const total = Math.max(0, Math.min(100, detalhes.reduce((soma, item) => soma + item.pontos, 0)));
  return { total, detalhes: detalhes.filter((item) => item.pontos !== 0) };
}

export const buscarCandidatosImagem = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const ean = somenteNumeros(data.ean);
    const porEan = await candidatosPorEan(ean);
    const porDescricao = porEan.length < 6 ? await candidatosPorDescricao(data.descricao) : [];

    const unicos = new Map<string, CandidatoBruto>();
    for (const candidato of [...porEan, ...porDescricao]) {
      if (!candidato.url || unicos.has(candidato.url)) continue;
      unicos.set(candidato.url, candidato);
    }

    const lista = [...unicos.values()].slice(0, MAX_CANDIDATOS_ANALISADOS);
    const resultado: CandidatoImagemServidor[] = [];
    let indice = 0;

    async function trabalhador() {
      while (indice < lista.length) {
        const candidato = lista[indice++]!;
        const analise = await analisarImagem(candidato.url);
        if (!analise) continue;

        const score = pontuar(candidato, { descricao: data.descricao, categoria: data.categoria, ean }, analise);
        resultado.push({
          url: candidato.url,
          titulo: candidato.titulo,
          source: candidato.source,
          score: score.total,
          scoreDetails: score.detalhes,
          width: analise.width,
          height: analise.height,
          backgroundScore: analise.backgroundScore,
          eanExato: candidato.eanExato,
        });
      }
    }

    await Promise.all(Array.from({ length: Math.min(5, lista.length) }, trabalhador));
    resultado.sort((a, b) => b.score - a.score);

    return { candidatos: resultado.slice(0, 5) };
  });
