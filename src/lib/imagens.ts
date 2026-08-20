/**
 * Busca automática de imagens.
 * Prioridade por EAN: Cosmos -> EAN Pictures -> UPCitemdb -> Open Food Facts.
 * Produtos sem EAN ficam separados para busca textual.
 */
const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const EAN_PICTURES = "https://www.eanpictures.com.br:9000/api/gtin";
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

async function buscarEanPictures(ean: string): Promise<string> {
  const url = `${EAN_PICTURES}/${encodeURIComponent(ean)}`;
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

/** Busca textual para itens sem EAN. É deliberadamente mais conservadora para não salvar imagem aleatória. */
async function buscarPorNome(nome: string): Promise<string> {
  const chave = nome.trim().toLowerCase();
  if (!chave) return "";
  const guardada = cacheNome.get(chave);
  if (guardada !== undefined) return guardada;
  try {
    const consulta = `${nome} produto`;
    const resposta = await fetch(`${UPC_SEARCH_API}?s=${encodeURIComponent(consulta)}&match_mode=0`);
    if (resposta.ok) {
      const dados = await resposta.json() as { items?: Array<{ title?: string; images?: string[] }> };
      const termos = chave.split(/\s+/).filter((t) => t.length >= 4 && !["produto", "bov", "bovina", "kg"].includes(t));
      const candidatos = (dados.items ?? [])
        .filter((item) => item.images?.length)
        .map((item) => {
          const titulo = String(item.title ?? "").toLowerCase();
          const acertos = termos.filter((termo) => titulo.includes(termo)).length;
          return { item, acertos };
        })
        .filter((item) => termos.length === 0 || item.acertos >= Math.min(2, termos.length))
        .sort((a, b) => b.acertos - a.acertos);

      for (const { item } of candidatos) {
        for (const url of item.images ?? []) if (url && await imagemCarrega(url)) {
          cacheNome.set(chave, url);
          return url;
        }
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
  const eanPictures = await buscarEanPictures(ean);
  if (eanPictures) { cache.set(ean, eanPictures); return eanPictures; }
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
