/** Último recurso: busca candidatos no Google Imagens. Nunca salva nada automaticamente. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const entrada = z.object({ termo: z.string().min(2).max(200) });

const IGNORAR = /gstatic|googleusercontent|\.svg(\?|$)|sprite|logo/i;

function extrairCandidatos(html: string): Array<{ url: string; titulo: string }> {
  const encontrados = new Map<string, string>();

  // Padrão do bloco de metadados: ["https://...jpg",largura,altura]
  for (const [, url] of html.matchAll(/\["(https?:\/\/[^"]+?\.(?:jpe?g|png|webp))",\d+,\d+\]/gi)) {
    if (url && !IGNORAR.test(url) && !encontrados.has(url)) encontrados.set(url, "");
  }

  // Títulos das imagens, usados para pontuar a confiança.
  const titulos = [...html.matchAll(/"(?:pt|2003)":"([^"]{6,160})"/g)].map(([, texto]) => texto ?? "");

  return [...encontrados.keys()].slice(0, 12).map((url, indice) => ({
    url,
    titulo: (titulos[indice] ?? "").replace(/\\u[\dA-Fa-f]{4}/g, " ").trim(),
  }));
}

export const buscarCandidatosGoogle = createServerFn({ method: "POST" })
  .inputValidator((dados: unknown) => entrada.parse(dados))
  .handler(async ({ data }) => {
    const url = `https://www.google.com/search?tbm=isch&hl=pt-BR&q=${encodeURIComponent(data.termo)}`;
    try {
      const resposta = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
      });
      if (!resposta.ok) return { candidatos: [] as Array<{ url: string; titulo: string }> };
      return { candidatos: extrairCandidatos(await resposta.text()) };
    } catch {
      return { candidatos: [] as Array<{ url: string; titulo: string }> };
    }
  });
