/**
 * Busca automática de fotos de produto pelo código de barras (EAN),
 * usando a base pública Open Food Facts.
 */
const API = "https://world.openfoodfacts.org/api/v2/product";
const MAX_PARALELO = 24;
const cache = new Map<string, string>();

function somenteNumeros(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}

async function buscarUma(ean: string): Promise<string> {
  const guardada = cache.get(ean);
  if (guardada !== undefined) return guardada;

  const tentativas = ean.length === 12 ? [ean, `0${ean}`] : [ean];
  for (const codigo of tentativas) {
    try {
      const resposta = await fetch(`${API}/${encodeURIComponent(codigo)}.json?fields=image_front_url,image_url,image_front_small_url`, {
        headers: { Accept: "application/json" },
      });
      if (!resposta.ok) continue;
      const dados = (await resposta.json()) as {
        status?: number;
        product?: { image_front_url?: string; image_url?: string; image_front_small_url?: string };
      };
      const imagem = dados.status === 1
        ? dados.product?.image_front_url || dados.product?.image_url || dados.product?.image_front_small_url
        : undefined;
      if (imagem) {
        cache.set(ean, imagem);
        return imagem;
      }
    } catch {
      // Uma falha de rede não deve interromper a importação.
    }
  }

  cache.set(ean, "");
  return "";
}

/** Busca várias imagens em paralelo. Devolve um mapa EAN -> URL. */
export async function buscarImagens(eans: string[]): Promise<Map<string, string>> {
  const lista = [...new Set(eans.map(somenteNumeros).filter((ean) => ean.length >= 8))];
  const resultado = new Map<string, string>();
  let indice = 0;

  async function trabalhador() {
    while (indice < lista.length) {
      const ean = lista[indice++];
      if (!ean) continue;
      const url = await buscarUma(ean);
      if (url) resultado.set(ean, url);
    }
  }

  await Promise.all(Array.from({ length: Math.min(MAX_PARALELO, lista.length) }, trabalhador));
  return resultado;
}
