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
const MAX_BRUTOS = 12;
const MAX_VALIDOS = 5;
const CONCORRENCIA_ANALISE = 3;

const UNIDADES = /\b(?:kg|quilo|quilos|un|und|unidade|unidades|pct|pacote|cx|caixa|bandeja|bdj)\b/gi;
const MEDIDAS = /\b\d+(?:[.,]\d+)?\s*(?:kg|g|gr|ml|l|lt|litro|litros|un|und)\b/gi;
const CODIGO_INTERNO = /\b\d{3,6}\b/g;
const TERMOS_FRACOS = new Set([
  "carne",
  "frango",
  "cong",
  "congelado",
  "congelada",
  "resf",
  "resfriado",
  "resfriada",
  "temp",
  "temperado",
  "temperada",
]);

type FonteFabricante = {
  marca: string;
  aliases: string[];
  baseUrl: string;
  paginas: string[];
};

const FABRICANTES: FonteFabricante[] = [
  {
    marca: "AGROSUL",
    aliases: ["AGROSUL"],
    baseUrl: "https://www.agrosul.com.br",
    paginas: ["/produtos", "/"],
  },
  {
    marca: "AVE SERRA",
    aliases: ["AVE SERRA", "AVESERRA"],
    baseUrl: "https://aveserra.com.br",
    paginas: ["/produtos/", "/"],
  },
  {
    marca: "LAR",
    aliases: ["LAR"],
    baseUrl: "https://www.lar.ind.br",
    paginas: ["/produtos/"],
  },
  {
    marca: "AURORA",
    aliases: ["AURORA"],
    baseUrl: "https://www.auroraalimentos.com.br",
    paginas: ["/produtos/"],
  },
  {
    marca: "SEARA",
    aliases: ["SEARA"],
    baseUrl: "https://www.seara.com.br",
    paginas: ["/produtos/", "/categoria/aves/"],
  },
  {
    marca: "SADIA",
    aliases: ["SADIA"],
    baseUrl: "https://www.sadia.com.br",
    paginas: ["/produtos/", "/produtos/aves/linha-frango-facil/"],
  },
  {
    marca: "PERDIGAO",
    aliases: ["PERDIGAO", "PERDIGÃO"],
    baseUrl: "https://www.perdigao.com.br",
    paginas: ["/produtos/", "/produtos/frango/"],
  },
  {
    marca: "LANGUIRU",
    aliases: ["LANGUIRU"],
    baseUrl: "https://www.languiru.com.br",
    paginas: ["/", "/produtos/"],
  },
];

type CandidatoFabricante = {
  url: string;
  titulo: string;
  source: string;
};

function compactar(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function limparDescricao(descricao: string): string {
  return compactar(
    normalizarTexto(descricao)
      .replace(MEDIDAS, " ")
      .replace(UNIDADES, " ")
      .replace(CODIGO_INTERNO, " ")
      .replace(/\b(?:aprox|aproximadamente|emb|embalado|embalada)\b/gi, " "),
  );
}

function detectarFabricante(descricao: string): FonteFabricante | null {
  const alvo = ` ${normalizarTexto(descricao)} `;

  return (
    FABRICANTES.find((fabricante) =>
      fabricante.aliases.some((alias) =>
        alvo.includes(` ${normalizarTexto(alias)} `),
      ),
    ) ?? null
  );
}

function removerMarca(termo: string, fabricante: FonteFabricante): string {
  let resultado = ` ${termo} `;
  for (const alias of fabricante.aliases) {
    const normalizado = normalizarTexto(alias);
    resultado = resultado.replace(new RegExp(`\\b${normalizado.replace(/\s+/g, "\\s+")}\\b`, "gi"), " ");
  }
  return compactar(resultado);
}

function palavrasRelevantes(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter((palavra) => palavra.length >= 3)
    .filter((palavra) => !TERMOS_FRACOS.has(palavra));
}

function cobertura(termo: string, alvo: string): number {
  const termos = palavrasRelevantes(termo);
  if (!termos.length) return 0;
  const normalizado = normalizarTexto(alvo);
  const acertos = termos.filter((palavra) => normalizado.includes(palavra)).length;
  return acertos / termos.length;
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

function atributo(tag: string, nome: string): string {
  const match = tag.match(new RegExp(`${nome}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1]?.trim() ?? "";
}

function limparHtml(texto: string): string {
  return compactar(
    texto
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"'),
  );
}

function resolverUrl(valor: string, baseUrl: string): string | null {
  if (!valor || valor.startsWith("data:")) return null;

  try {
    return new URL(valor.replace(/&amp;/gi, "&"), baseUrl).toString();
  } catch {
    return null;
  }
}

function extrairImagensHtml(
  html: string,
  paginaUrl: string,
  termo: string,
  source: string,
): CandidatoFabricante[] {
  const candidatos = new Map<string, CandidatoFabricante>();
  const regex = /<img\b[^>]*>/gi;

  for (const match of html.matchAll(regex)) {
    const tag = match[0];
    const indice = match.index ?? 0;
    const src =
      atributo(tag, "src") ||
      atributo(tag, "data-src") ||
      atributo(tag, "data-lazy-src") ||
      atributo(tag, "data-original");
    const url = resolverUrl(src, paginaUrl);
    if (!url || candidatos.has(url)) continue;

    const alt = atributo(tag, "alt") || atributo(tag, "title");
    const inicio = Math.max(0, indice - 260);
    const fim = Math.min(html.length, indice + tag.length + 260);
    const contexto = limparHtml(html.slice(inicio, fim));
    const titulo = compactar(`${alt} ${contexto}`);

    if (cobertura(termo, titulo) < 0.5) continue;

    candidatos.set(url, { url, titulo: alt || contexto, source });
    if (candidatos.size >= MAX_BRUTOS) break;
  }

  return [...candidatos.values()];
}

function extrairJsonLd(
  html: string,
  paginaUrl: string,
  termo: string,
  source: string,
): CandidatoFabricante[] {
  const candidatos: CandidatoFabricante[] = [];

  for (const match of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const bruto = match[1]?.trim();
    if (!bruto) continue;

    try {
      const dados = JSON.parse(bruto) as unknown;
      const fila: unknown[] = [dados];

      while (fila.length) {
        const atual = fila.shift();
        if (Array.isArray(atual)) {
          fila.push(...atual);
          continue;
        }
        if (!atual || typeof atual !== "object") continue;

        const objeto = atual as Record<string, unknown>;
        const tipo = String(objeto["@type"] ?? "").toLowerCase();
        const nome = String(objeto.name ?? "");

        if (tipo.includes("product") && nome && cobertura(termo, nome) >= 0.5) {
          const imagens = Array.isArray(objeto.image) ? objeto.image : [objeto.image];
          for (const imagem of imagens) {
            const url = resolverUrl(String(imagem ?? ""), paginaUrl);
            if (url) candidatos.push({ url, titulo: nome, source });
          }
        }

        for (const valor of Object.values(objeto)) {
          if (valor && typeof valor === "object") fila.push(valor);
        }
      }
    } catch {
      // Alguns sites publicam JSON-LD inválido; a extração por HTML ainda roda.
    }
  }

  return candidatos;
}

async function buscarNoFabricante(
  fabricante: FonteFabricante,
  termo: string,
): Promise<CandidatoFabricante[]> {
  const termoSemMarca = removerMarca(termo, fabricante) || termo;
  const paginas = [
    `${fabricante.baseUrl}/?s=${encodeURIComponent(termoSemMarca)}`,
    ...fabricante.paginas.map((pagina) => new URL(pagina, fabricante.baseUrl).toString()),
  ];

  const source = `oficial_${normalizarTexto(fabricante.marca).replace(/\s+/g, "_")}`;
  const unicos = new Map<string, CandidatoFabricante>();

  for (const paginaUrl of [...new Set(paginas)].slice(0, 3)) {
    const resposta = await fetchComTimeout(paginaUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; NodusCatalogBot/1.0)",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!resposta?.ok) continue;

    const html = await resposta.text();
    const encontrados = [
      ...extrairJsonLd(html, paginaUrl, termoSemMarca, source),
      ...extrairImagensHtml(html, paginaUrl, termoSemMarca, source),
    ];

    for (const candidato of encontrados) {
      if (!unicos.has(candidato.url)) unicos.set(candidato.url, candidato);
      if (unicos.size >= MAX_BRUTOS) break;
    }
    if (unicos.size >= MAX_BRUTOS) break;
  }

  return [...unicos.values()];
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
  candidatos: CandidatoFabricante[],
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

export const buscarCandidatosFabricante = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const fabricante = detectarFabricante(data.descricao);
    if (!fabricante) {
      return {
        fabricante: null as string | null,
        candidatos: [] as CandidatoImagemServidor[],
      };
    }

    const termo = limparDescricao(data.descricao);
    const brutos = await buscarNoFabricante(fabricante, termo);
    const candidatos = await analisarComConcorrencia(brutos);

    console.info("[Nodus manufacturer image search]", {
      descricao: data.descricao,
      categoria: data.categoria,
      fabricante: fabricante.marca,
      brutos: brutos.length,
      candidatosValidos: candidatos.length,
    });

    return { fabricante: fabricante.marca, candidatos };
  });
