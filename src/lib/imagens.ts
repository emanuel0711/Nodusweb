/**
 * Busca automática de imagens por EAN.
 * Prioridade: Cosmos -> UPCitemdb -> Open Food Facts.
 * Produtos sem EAN ficam separados para busca textual, sem fingir que um
 * código interno é um EAN válido.
 */
const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const UPC_SEARCH_API = "https://api.upcitemdb.com/prod/trial/search";
const MAX_PARALELO = 16;
const cache = new Map<string, string>();
const cacheNome = new Map<string, string>();

function somenteNumeros(valor: unknown): string { return String(valor ?? "").replace(/\D/g, ""); }

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

async function buscarUpc(ean: string): Promise<string> {
  try {
    const resposta = await fetch(`${UPC_SEARCH_API}?s=${encodeURIComponent(ean)}&match_mode=1`);
    if (!resposta.ok) return "";
    const dados = await resposta.json() as { items?: Array<{ images?: string[] }> };
    for (const item of dados.items ?? []) {
      for (const url of item.images ?? []) if (url && await imagemCarrega(url)) return url;
    }
  } catch { /* segue para Open Food Facts */ }
  return "";
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

/** Busca textual de fallback para itens sem EAN, sem usar o código interno como se fosse GTIN. */
async function buscarPorNome(nome: string): Promise<string> {
  const chave = nome.trim().toLowerCase();
  if (!chave) return "";
  const guardada = cacheNome.get(chave);
  if (guardada !== undefined) return guardada;
  try {
    const resposta = await fetch(`${UPC_SEARCH_API}?s=${encodeURIComponent(nome)}&match_mode=0`);
    if (resposta.ok) {
      const dados = await resposta.json() as { items?: Array<{ title?: string; images?: string[] }> };
      const termos = chave.split(/\s+/).filter((t) => t.length >= 3);
      const candidatos = (dados.items ?? []).filter((item) => item.images?.length).sort((a, b) => {
        const score = (item: { title?: string }) => termos.reduce((n, termo) => n + (String(item.title ?? "").toLowerCase().includes(termo) ? 1 : 0), 0);
        return score(b) - score(a);
      });
      for (const item of candidatos) for (const url of item.images ?? []) if (url && await imagemCarrega(url)) {
        cacheNome.set(chave, url);
        return url;
      }
    }
  } catch { /* nenhuma imagem textual disponível */ }
  cacheNome.set(chave, "");
  return "";
}

async function buscarUma(ean: string): Promise<string> {
  const guardada = cache.get(ean);
  if (guardada !== undefined) return guardada;

  const cosmos = await buscarCosmos(ean);
  if (cosmos) { cache.set(ean, cosmos); return cosmos; }
  const upc = await buscarUpc(ean);
  if (upc) { cache.set(ean, upc); return upc; }
  const off = await buscarOpenFoodFacts(ean);
  cache.set(ean, off);
  return off;
}

export async function buscarImagens(eans: string[]): Promise<Map<string, string>> {
  const lista = [...new Set(eans.map(somenteNumeros).filter((ean) => ean.length >= 8))];
  const resultado = new Map<string, string>(); let indice = 0;
  async function trabalhador() {
    while (indice < lista.length) {
      const ean = lista[indice++];
      const url = await buscarUma(ean);
      if (url) resultado.set(ean, url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALELO, lista.length) }, trabalhador));
  return resultado;
}

export async function buscarImagensPorProduto(itens: Array<{ ean: string; nome: string }>): Promise<Map<string, string>> {
  const lista = itens.filter((item) => !item.ean && item.nome.trim());
  const resultado = new Map<string, string>(); let indice = 0;
  async function trabalhador() {
    while (indice < lista.length) {
      const item = lista[indice++];
      const url = await buscarPorNome(item.nome);
      if (url) resultado.set(item.nome, url);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, lista.length) }, trabalhador));
  return resultado;
}
