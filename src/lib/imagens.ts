/**
 * Busca automática de imagens por EAN.
 * Prioridade: Cosmos (catálogo brasileiro, imagem vinculada ao GTIN) -> Open Food Facts.
 * O Cosmos é priorizado porque tende a entregar foto de cadastro do produto, em vez
 * de fotos de consumo/ângulos aleatórios comuns em bases colaborativas.
 */
const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const MAX_PARALELO = 16;
const cache = new Map<string, string>();

function somenteNumeros(valor: unknown): string { return String(valor ?? "").replace(/\D/g, ""); }

/** Verifica se uma URL realmente entrega uma imagem sem exigir CORS. */
function imagemCarrega(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const imagem = new Image();
    const timer = window.setTimeout(() => { imagem.src = ""; resolve(false); }, 7000);
    imagem.onload = () => { window.clearTimeout(timer); resolve(imagem.naturalWidth > 0 && imagem.naturalHeight > 0); };
    imagem.onerror = () => { window.clearTimeout(timer); resolve(false); };
    imagem.src = url;
  });
}

async function buscarCosmos(ean: string): Promise<string> {
  const url = `${COSMOS_CDN}/${encodeURIComponent(ean)}`;
  return await imagemCarrega(url) ? url : "";
}

async function buscarOpenFoodFacts(ean: string): Promise<string> {
  const tentativas = ean.length === 12 ? [ean, `0${ean}`] : [ean];
  for (const codigo of tentativas) {
    try {
      const resposta = await fetch(`${OFF_API}/${encodeURIComponent(codigo)}.json?fields=image_front_url,image_front_small_url,image_url`, { headers: { Accept: "application/json" } });
      if (!resposta.ok) continue;
      const dados = await resposta.json() as { status?: number; product?: { image_front_url?: string; image_front_small_url?: string; image_url?: string } };
      if (dados.status !== 1) continue;
      const candidatos = [dados.product?.image_front_url, dados.product?.image_front_small_url, dados.product?.image_url].filter(Boolean) as string[];
      for (const url of candidatos) if (await imagemCarrega(url)) return url;
    } catch { /* tenta o próximo código/fonte */ }
  }
  return "";
}

async function buscarUma(ean: string): Promise<string> {
  const guardada = cache.get(ean);
  if (guardada !== undefined) return guardada;

  // 1. Cosmos: fonte principal para produtos de supermercado por GTIN.
  const cosmos = await buscarCosmos(ean);
  if (cosmos) { cache.set(ean, cosmos); return cosmos; }

  // 2. Open Food Facts: somente se o Cosmos não possuir imagem válida.
  const off = await buscarOpenFoodFacts(ean);
  if (off) { cache.set(ean, off); return off; }

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
