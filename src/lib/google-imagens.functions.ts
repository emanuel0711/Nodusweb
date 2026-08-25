/** Último recurso: busca candidatos no Google Imagens. Nunca salva nada automaticamente. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const entrada = z.object({ termo: z.string().min(2).max(200) });
const FONTES_PRIORITARIAS = [
  "zaffari.com.br",
  "carrefour.com.br",
  "paodeacucar.com",
  "mercadolivre.com.br",
  "amazon.com.br",
  "magazineluiza.com.br",
];
const IGNORAR = /gstatic|googleusercontent|google\.com|googleapis|\.svg(\?|$)|sprite|favicon|logo/i;
const EXTENSAO_IMAGEM = /\.(?:jpe?g|png|webp)(?:[?#&]|$)/i;

function limparUrl(valor: string): string {
  return valor.replace(/\\\//g, "/").replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/&amp;/gi, "&");
}

function extrairCandidatos(html: string): Array<{ url: string; titulo: string }> {
  const encontrados = new Map<string, string>();
  const urls = html.match(/https?:\\?\/\\?\/[^"'<>\\s\\]+/gi) ?? [];

  for (const bruto of urls) {
    const url = limparUrl(bruto).replace(/[\\]$/, "");
    if (!EXTENSAO_IMAGEM.test(url) || IGNORAR.test(url) || encontrados.has(url)) continue;
    encontrados.set(url, "");
  }

  // Também cobre o formato estruturado usado pelo Google Imagens em algumas respostas.
  for (const [, bruto] of html.matchAll(/\["(https?:\\?\/\\?\/[^"\\]+?\.(?:jpe?g|png|webp)(?:[?#&][^"\\]*)?)",\d+,\d+\]/gi)) {
    const url = limparUrl(bruto);
    if (url && !IGNORAR.test(url) && !encontrados.has(url)) encontrados.set(url, "");
  }

  const titulos = [...html.matchAll(/"(?:pt|2003)":"([^"]{6,200})"/g)].map(([, texto]) => (texto ?? "").replace(/\\u[\dA-Fa-f]{4}/g, " ").trim());
  return [...encontrados.keys()].slice(0, 24).map((url, indice) => ({ url, titulo: titulos[indice] ?? "" }));
}

async function buscarGoogle(termo: string): Promise<Array<{ url: string; titulo: string }>> {
  const url = `https://www.google.com/search?tbm=isch&hl=pt-BR&q=${encodeURIComponent(termo)}`;
  try {
    const resposta = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      },
    });
    if (!resposta.ok) return [];
    return extrairCandidatos(await resposta.text());
  } catch {
    return [];
  }
}

export const buscarCandidatosGoogle = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const consultas = [
      `${data.termo} produto embalagem`,
      ...FONTES_PRIORITARIAS.map((dominio) => `${data.termo} site:${dominio}`),
    ];
    const encontrados = new Map<string, string>();

    for (const consulta of consultas) {
      const candidatos = await buscarGoogle(consulta);
      for (const candidato of candidatos) {
        if (!encontrados.has(candidato.url)) encontrados.set(candidato.url, candidato.titulo || consulta);
      }
      if (encontrados.size >= 18) break;
    }

    const resultado = [...encontrados.entries()].slice(0, 18).map(([url, titulo]) => ({ url, titulo }));
    return { candidatos: resultado };
  });
