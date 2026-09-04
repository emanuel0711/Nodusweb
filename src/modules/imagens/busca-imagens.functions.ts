import { createServerFn } from "@tanstack/react-start";
import sharp from "sharp";
import { z } from "zod";
import { normalizarTexto } from "@/shared/texto";

const entrada = z.object({
  ean: z.string().max(32).optional().default(""),
  descricao: z.string().min(2).max(220),
  categoria: z.string().max(120).nullable().optional(),
});

const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const EAN_PICTURES = "https://www.eanpictures.com.br:9000/api/gtin";
const UPC_SEARCH_API = "https://api.upcitemdb.com/prod/trial/search";

const TIMEOUT_MS = 6_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CANDIDATOS_ANALISADOS = 12;
const CONCORRENCIA_ANALISE = 8;
const CONCORRENCIA_GOOGLE = 3;
const SCORE_SUFICIENTE_POR_EAN = 50;

const FONTES_PRIORITARIAS = [
  "zaffari.com.br",
  "carrefour.com.br",
  "paodeacucar.com",
  "mercadolivre.com.br",
  "amazon.com.br",
  "magazineluiza.com.br",
];

const CATEGORIAS_VARIAVEIS = [
  "acougue",
  "fruteira",
  "hortifruti",
  "fruta",
  "frutas",
  "verdura",
  "verduras",
  "legume",
  "legumes",
];

const IGNORAR_GOOGLE =
  /gstatic|googleusercontent|google\.com|googleapis|\.svg(\?|$)|sprite|favicon|logo/i;
const EXTENSAO_IMAGEM = /\.(?:jpe?g|png|webp)(?:[?#&]|$)/i;
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
  "pct",
  "cx",
  "produto",
]);
const PESO = /(\d+[.,]?\d*)\s?(kg|g|gr|ml|l|lt|litro|litros)\b/gi;
const VENDIDO_POR_PESO = /\b(kg|quilo|quilos)\b/i;
const EAN13_USO_INTERNO = /^2\d{12}$/;

export type TipoProdutoImagem = "industrializado" | "variavel";

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

export interface DiagnosticoBuscaImagem {
  totalBrutos: number;
  totalValidos: number;
  porFonte: Record<
    string,
    {
      brutos: number;
      validos: number;
      rejeicoes: Record<string, number>;
    }
  >;
}

type CandidatoBruto = {
  url: string;
  titulo: string;
  source: string;
  eanExato: boolean;
};

type AnaliseImagem = {
  width: number;
  height: number;
  backgroundScore: number;
};

type ResultadoAnalise =
  | { analise: AnaliseImagem; motivo: null }
  | { analise: null; motivo: string };

function somenteNumeros(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

function gtinValido(codigo: string): boolean {
  if (![8, 12, 13, 14].includes(codigo.length) || !/^\d+$/.test(codigo)) {
    return false;
  }

  const digitos = codigo.split("").map(Number);
  const verificador = digitos.pop();
  if (verificador == null) return false;

  let soma = 0;
  let peso = 3;

  for (let indice = digitos.length - 1; indice >= 0; indice -= 1) {
    soma += digitos[indice]! * peso;
    peso = peso === 3 ? 1 : 3;
  }

  return (10 - (soma % 10)) % 10 === verificador;
}

function eanPublicoValido(ean: string): boolean {
  if (!gtinValido(ean)) return false;

  // Prefixos 20–29 em EAN-13 são reservados com frequência para circulação
  // restrita, peso/preço variável e códigos internos de varejo.
  if (EAN13_USO_INTERNO.test(ean)) return false;

  return true;
}

export function classificarProdutoImagem(produto: {
  ean: string;
  descricao: string;
  categoria?: string | null;
}): TipoProdutoImagem {
  const categoria = normalizarTexto(produto.categoria ?? "");
  const descricao = normalizarTexto(produto.descricao);
  const temEanPublico = eanPublicoValido(produto.ean);

  // Um GTIN público válido é o sinal mais forte. Isso evita classificar como
  // variável itens embalados de Fruteira que realmente possuem código público.
  if (temEanPublico) return "industrializado";

  const categoriaVariavel = CATEGORIAS_VARIAVEIS.some((termo) =>
    categoria.includes(termo),
  );
  const codigoInternoDePeso = EAN13_USO_INTERNO.test(produto.ean);
  const vendidoPorPeso = VENDIDO_POR_PESO.test(descricao);

  if (categoriaVariavel || codigoInternoDePeso || vendidoPorPeso) {
    return "variavel";
  }

  return "industrializado";
}

async function fetchComTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
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

async function executarComConcorrencia<T, R>(
  itens: T[],
  concorrencia: number,
  executar: (item: T) => Promise<R>,
): Promise<R[]> {
  if (!itens.length) return [];

  const resultados = new Array<R>(itens.length);
  let indice = 0;

  async function trabalhador() {
    while (indice < itens.length) {
      const atual = indice++;
      resultados[atual] = await executar(itens[atual]!);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concorrencia, itens.length) },
      trabalhador,
    ),
  );

  return resultados;
}

function limparUrlGoogle(valor: string): string {
  return valor
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/&amp;/gi, "&");
}

function extrairGoogle(
  html: string,
): Array<{ url: string; titulo: string }> {
  const encontrados = new Map<string, string>();
  const urls = html.match(/https?:\\?\/\\?\/[^"'<>\\s\\]+/gi) ?? [];

  for (const bruto of urls) {
    const url = limparUrlGoogle(bruto).replace(/[\\]$/, "");
    if (IGNORAR_GOOGLE.test(url) || encontrados.has(url)) continue;

    if (
      EXTENSAO_IMAGEM.test(url) ||
      /\/image|\/images|\/produto|cdn|media/i.test(url)
    ) {
      encontrados.set(url, "");
    }
  }

  for (const [, bruto] of html.matchAll(
    /\["(https?:\\?\/\\?\/[^"\\]+?\.(?:jpe?g|png|webp)(?:[?#&][^"\\]*)?)",\d+,\d+\]/gi,
  )) {
    const url = limparUrlGoogle(bruto);
    if (url && !IGNORAR_GOOGLE.test(url) && !encontrados.has(url)) {
      encontrados.set(url, "");
    }
  }

  const titulos = [...html.matchAll(/"(?:pt|2003)":"([^"]{6,200})"/g)].map(
    ([, texto]) =>
      (texto ?? "").replace(/\\u[\dA-Fa-f]{4}/g, " ").trim(),
  );

  return [...encontrados.keys()].slice(0, 18).map((url, indice) => ({
    url,
    titulo: titulos[indice] ?? "",
  }));
}

async function buscarGoogle(
  termo: string,
): Promise<Array<{ url: string; titulo: string }>> {
  const resposta = await fetchComTimeout(
    `https://www.google.com/search?tbm=isch&hl=pt-BR&q=${encodeURIComponent(termo)}`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    },
  );

  if (!resposta?.ok) return [];
  return extrairGoogle(await resposta.text());
}

async function candidatosPorEan(ean: string): Promise<CandidatoBruto[]> {
  if (ean.length < 8) return [];

  const cosmosEanPictures: CandidatoBruto[] = [
    {
      url: `${COSMOS_CDN}/${encodeURIComponent(ean)}`,
      titulo: ean,
      source: "cosmos",
      eanExato: true,
    },
    {
      url: `${EAN_PICTURES}/${encodeURIComponent(ean)}`,
      titulo: ean,
      source: "ean_pictures",
      eanExato: true,
    },
  ];

  const upc = (async (): Promise<CandidatoBruto[]> => {
    const resposta = await fetchComTimeout(
      `${UPC_SEARCH_API}?s=${encodeURIComponent(ean)}&match_mode=1`,
    );
    if (!resposta?.ok) return [];

    const dados = (await resposta.json()) as {
      items?: Array<{
        title?: string;
        ean?: string;
        upc?: string;
        images?: string[];
      }>;
    };

    return (dados.items ?? []).flatMap((item) =>
      (item.images ?? []).map((url) => ({
        url,
        titulo: item.title ?? "",
        source: "upcitemdb",
        eanExato: [item.ean, item.upc].map(somenteNumeros).includes(ean),
      })),
    );
  })();

  return [...cosmosEanPictures, ...(await upc)];
}

async function candidatosPorDescricao(
  descricao: string,
): Promise<CandidatoBruto[]> {
  const buscaUpc = (async (): Promise<CandidatoBruto[]> => {
    const resposta = await fetchComTimeout(
      `${UPC_SEARCH_API}?s=${encodeURIComponent(`${descricao} produto`)}&match_mode=0`,
    );
    if (!resposta?.ok) return [];

    const dados = (await resposta.json()) as {
      items?: Array<{ title?: string; images?: string[] }>;
    };

    return (dados.items ?? []).flatMap((item) =>
      (item.images ?? []).map((url) => ({
        url,
        titulo: item.title ?? "",
        source: "upcitemdb_text",
        eanExato: false,
      })),
    );
  })();

  const buscaGoogle = (async (): Promise<CandidatoBruto[]> => {
    const consultas = [
      `${descricao} produto embalagem fundo branco`,
      ...FONTES_PRIORITARIAS.map(
        (dominio) => `${descricao} site:${dominio}`,
      ),
    ];

    const resultados = await executarComConcorrencia(
      consultas,
      CONCORRENCIA_GOOGLE,
      buscarGoogle,
    );

    const encontrados = new Map<string, CandidatoBruto>();

    for (const lista of resultados) {
      for (const resultado of lista) {
        if (encontrados.size >= 18) break;
        if (encontrados.has(resultado.url)) continue;

        encontrados.set(resultado.url, {
          ...resultado,
          source: "google_images",
          eanExato: false,
        });
      }
      if (encontrados.size >= 18) break;
    }

    return [...encontrados.values()];
  })();

  const [upc, google] = await Promise.all([buscaUpc, buscaGoogle]);
  return [...upc, ...google];
}

async function analisarImagem(url: string): Promise<ResultadoAnalise> {
  const resposta = await fetchComTimeout(url, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; NodusImageBot/1.0)",
    },
  });

  if (!resposta) return { analise: null, motivo: "rede_ou_timeout" };
  if (!resposta.ok) {
    return { analise: null, motivo: `http_${resposta.status}` };
  }

  const tamanho = Number(resposta.headers.get("content-length") ?? 0);
  if (tamanho > MAX_BYTES) {
    return { analise: null, motivo: "arquivo_muito_grande" };
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (!buffer.length) return { analise: null, motivo: "arquivo_vazio" };
  if (buffer.length > MAX_BYTES) {
    return { analise: null, motivo: "arquivo_muito_grande" };
  }

  try {
    const imagem = sharp(buffer, { failOn: "none" });
    const metadata = await imagem.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (!width || !height) {
      return { analise: null, motivo: "formato_nao_reconhecido" };
    }
    if (width < 160 || height < 160) {
      return { analise: null, motivo: "resolucao_baixa" };
    }

    const { data, info } = await imagem
      .resize(48, 48, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let borda = 0;
    let brancos = 0;
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

        if (
          r >= 238 &&
          g >= 238 &&
          b >= 238 &&
          Math.max(r, g, b) - Math.min(r, g, b) <= 12
        ) {
          brancos += 1;
        }
      }
    }

    return {
      analise: {
        width,
        height,
        backgroundScore: borda
          ? Number((brancos / borda).toFixed(4))
          : 0,
      },
      motivo: null,
    };
  } catch {
    return { analise: null, motivo: "sharp_ou_formato_invalido" };
  }
}

function palavras(texto: string): string[] {
  return normalizarTexto(texto)
    .split(/\s+/)
    .filter(
      (palavra) =>
        palavra.length >= 3 && !PALAVRAS_IGNORADAS.has(palavra),
    );
}

function pontuar(
  candidato: CandidatoBruto,
  produto: { descricao: string; categoria?: string | null; ean: string },
  analise: AnaliseImagem,
): { total: number; detalhes: Array<{ rotulo: string; pontos: number }> } {
  const alvo = normalizarTexto(
    `${candidato.titulo} ${decodeURIComponent(candidato.url)}`,
  );
  const termos = palavras(produto.descricao);
  const detalhes: Array<{ rotulo: string; pontos: number }> = [];

  const pesoFonte: Record<string, number> = {
    cosmos: 22,
    ean_pictures: 20,
    upcitemdb: 15,
    upcitemdb_text: 8,
    google_images: 5,
  };

  detalhes.push({
    rotulo: `Fonte: ${candidato.source}`,
    pontos: pesoFonte[candidato.source] ?? 0,
  });

  if (candidato.eanExato) {
    detalhes.push({ rotulo: "EAN exato", pontos: 28 });
  }

  const acertos = termos.filter((termo) => alvo.includes(termo)).length;
  const cobertura = termos.length ? acertos / termos.length : 0;
  detalhes.push({
    rotulo: `Descrição (${acertos}/${termos.length} termos)`,
    pontos: Math.round(cobertura * 24),
  });

  const pesos = [...produto.descricao.matchAll(PESO)].map(
    ([, numero, medida]) =>
      normalizarTexto(`${numero}${medida}`).replace(",", "."),
  );

  if (
    pesos.some((peso) =>
      alvo.replace(/\s/g, "").includes(peso.replace(/\s/g, "")),
    )
  ) {
    detalhes.push({ rotulo: "Peso/volume compatível", pontos: 8 });
  }

  const resolucao = Math.min(
    8,
    Math.round((Math.min(analise.width, analise.height) / 800) * 8),
  );
  detalhes.push({
    rotulo: `Resolução ${analise.width}×${analise.height}`,
    pontos: resolucao,
  });

  detalhes.push({
    rotulo: `Fundo branco ${Math.round(analise.backgroundScore * 100)}%`,
    pontos: Math.round(analise.backgroundScore * 10),
  });

  const total = Math.max(
    0,
    Math.min(100, detalhes.reduce((soma, item) => soma + item.pontos, 0)),
  );

  return {
    total,
    detalhes: detalhes.filter((item) => item.pontos !== 0),
  };
}

function criarDiagnostico(lista: CandidatoBruto[]): DiagnosticoBuscaImagem {
  const diagnostico: DiagnosticoBuscaImagem = {
    totalBrutos: lista.length,
    totalValidos: 0,
    porFonte: {},
  };

  for (const candidato of lista) {
    diagnostico.porFonte[candidato.source] ??= {
      brutos: 0,
      validos: 0,
      rejeicoes: {},
    };
    diagnostico.porFonte[candidato.source]!.brutos += 1;
  }

  return diagnostico;
}

async function analisarCandidatos(
  lista: CandidatoBruto[],
  produto: { descricao: string; categoria?: string | null; ean: string },
): Promise<{
  candidatos: CandidatoImagemServidor[];
  diagnostico: DiagnosticoBuscaImagem;
}> {
  const diagnostico = criarDiagnostico(lista);

  const analisados = await executarComConcorrencia(
    lista,
    CONCORRENCIA_ANALISE,
    async (candidato) => {
      const resultado = await analisarImagem(candidato.url);
      const fonte = diagnostico.porFonte[candidato.source]!;

      if (!resultado.analise) {
        const motivo = resultado.motivo ?? "desconhecido";
        fonte.rejeicoes[motivo] = (fonte.rejeicoes[motivo] ?? 0) + 1;
        return null;
      }

      fonte.validos += 1;
      diagnostico.totalValidos += 1;

      const score = pontuar(candidato, produto, resultado.analise);
      return {
        url: candidato.url,
        titulo: candidato.titulo,
        source: candidato.source,
        score: score.total,
        scoreDetails: score.detalhes,
        width: resultado.analise.width,
        height: resultado.analise.height,
        backgroundScore: resultado.analise.backgroundScore,
        eanExato: candidato.eanExato,
      } satisfies CandidatoImagemServidor;
    },
  );

  const candidatos = analisados
    .filter((item): item is CandidatoImagemServidor => Boolean(item))
    .sort((a, b) => b.score - a.score);

  return { candidatos, diagnostico };
}

function unicos(lista: CandidatoBruto[]): CandidatoBruto[] {
  const mapa = new Map<string, CandidatoBruto>();

  for (const candidato of lista) {
    if (candidato.url && !mapa.has(candidato.url)) {
      mapa.set(candidato.url, candidato);
    }
  }

  return [...mapa.values()];
}

export const buscarCandidatosImagem = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const ean = somenteNumeros(data.ean);
    const produto = {
      descricao: data.descricao,
      categoria: data.categoria,
      ean,
    };

    const tipoProduto = classificarProdutoImagem(produto);
    const usarBuscaPorEan =
      tipoProduto === "industrializado" && eanPublicoValido(ean);

    const candidatosEan = usarBuscaPorEan
      ? unicos(await candidatosPorEan(ean)).slice(
          0,
          MAX_CANDIDATOS_ANALISADOS,
        )
      : [];

    if (candidatosEan.length) {
      const resultadoEan = await analisarCandidatos(candidatosEan, produto);

      if (
        (resultadoEan.candidatos[0]?.score ?? 0) >=
        SCORE_SUFICIENTE_POR_EAN
      ) {
        console.info("[Nodus image search]", {
          ean,
          descricao: data.descricao,
          tipoProduto,
          estrategia: "ean",
          diagnostico: resultadoEan.diagnostico,
        });

        return {
          candidatos: resultadoEan.candidatos.slice(0, 5),
          diagnostico: resultadoEan.diagnostico,
          tipoProduto,
          estrategia: "ean" as const,
        };
      }
    }

    const candidatosTexto = await candidatosPorDescricao(data.descricao);
    const lista = unicos([...candidatosEan, ...candidatosTexto]).slice(
      0,
      MAX_CANDIDATOS_ANALISADOS,
    );
    const resultado = await analisarCandidatos(lista, produto);
    const estrategia = usarBuscaPorEan ? "ean+texto" : "texto";

    console.info("[Nodus image search]", {
      ean,
      descricao: data.descricao,
      tipoProduto,
      estrategia,
      diagnostico: resultado.diagnostico,
    });

    return {
      candidatos: resultado.candidatos.slice(0, 5),
      diagnostico: resultado.diagnostico,
      tipoProduto,
      estrategia,
    };
  });
