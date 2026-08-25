/** Busca de imagens por EAN. Ordem: catálogo/Cosmos -> EAN Pictures -> UPCitemdb -> Open Food Facts. */
const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const COSMOS_CDN = "https://cdn-cosmos.bluesoft.com.br/products";
const EAN_PICTURES = "https://www.eanpictures.com.br:9000/api/gtin";
const UPC_SEARCH_API = "https://api.upcitemdb.com/prod/trial/search";
const MAX_PARALELO = 16;
const cache = new Map<string, string>();
const cacheNome = new Map<string, string>();

const somenteNumeros = (valor: unknown) => String(valor ?? "").replace(/\D/g, "");

function imagemCarrega(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const imagem = new Image();
    const timer = window.setTimeout(() => { imagem.src = ""; resolve(false); }, 7000);
    imagem.onload = () => { window.clearTimeout(timer); resolve(imagem.naturalWidth > 0 && imagem.naturalHeight > 0); };
    imagem.onerror = () => { window.clearTimeout(timer); resolve(false); };
    imagem.src = url;
  });
}

async function buscarCosmos(ean: string) { const url = `${COSMOS_CDN}/${encodeURIComponent(ean)}`; return await imagemCarrega(url) ? url : ""; }
async function buscarEanPictures(ean: string) { const url = `${EAN_PICTURES}/${encodeURIComponent(ean)}`; return await imagemCarrega(url) ? url : ""; }

async function buscarUpc(ean: string): Promise<string> {
  try {
    const resposta = await fetch(`${UPC_SEARCH_API}?s=${encodeURIComponent(ean)}&match_mode=1`);
    if (!resposta.ok) return "";
    const dados = await resposta.json() as { items?: Array<{ images?: string[] }> };
    for (const item of dados.items ?? []) for (const url of item.images ?? []) if (url && await imagemCarrega(url)) return url;
  } catch { /* tenta a próxima fonte */ }
  return "";
}

async function buscarOpenFoodFacts(ean: string): Promise<string> {
  for (const codigo of ean.length === 12 ? [ean, `0${ean}`] : [ean]) {
    try {
      const resposta = await fetch(`${OFF_API}/${encodeURIComponent(codigo)}.json?fields=image_front_url,image_front_small_url,image_url`, { headers: { Accept: "application/json" } });
      if (!resposta.ok) continue;
      const dados = await resposta.json() as { status?: number; product?: { image_front_url?: string; image_front_small_url?: string; image_url?: string } };
      if (dados.status !== 1) continue;
      for (const url of [dados.product?.image_front_url, dados.product?.image_front_small_url, dados.product?.image_url].filter(Boolean) as string[]) if (await imagemCarrega(url)) return url;
    } catch { /* tenta o próximo código */ }
  }
  return "";
}

/** Itens sem EAN usam busca textual apenas quando há correspondência suficiente. */
async function buscarPorNome(nome: string): Promise<string> {
  const chave = nome.trim().toLowerCase();
  if (!chave) return "";
  const guardada = cacheNome.get(chave);
  if (guardada !== undefined) return guardada;
  try {
    const resposta = await fetch(`${UPC_SEARCH_API}?s=${encodeURIComponent(`${nome} produto`)}&match_mode=0`);
    if (resposta.ok) {
      const dados = await resposta.json() as { items?: Array<{ title?: string; images?: string[] }> };
      const termos = chave.split(/\s+/).filter((t) => t.length >= 4 && !["produto", "bov", "bovina", "kg"].includes(t));
      const candidatos = (dados.items ?? []).filter((item) => item.images?.length).map((item) => {
        const titulo = String(item.title ?? "").toLowerCase();
        return { item, acertos: termos.filter((termo) => titulo.includes(termo)).length };
      }).filter((item) => !termos.length || item.acertos >= Math.min(2, termos.length)).sort((a, b) => b.acertos - a.acertos);
      for (const { item } of candidatos) for (const url of item.images ?? []) if (url && await imagemCarrega(url)) { cacheNome.set(chave, url); return url; }
    }
  } catch { /* sem imagem textual confiável */ }
  cacheNome.set(chave, "");
  return "";
}

async function buscarUma(ean: string): Promise<string> {
  const guardada = cache.get(ean);
  if (guardada !== undefined) return guardada;
  for (const buscar of [buscarCosmos, buscarEanPictures, buscarUpc, buscarOpenFoodFacts]) {
    const url = await buscar(ean);
    if (url) { cache.set(ean, url); return url; }
  }
  cache.set(ean, "");
  return "";
}

export async function buscarImagens(eans: string[]): Promise<Map<string, string>> {
  const lista = [...new Set(eans.map(somenteNumeros).filter((ean) => ean.length >= 8))];
  const resultado = new Map<string, string>(); let indice = 0;
  async function trabalhador() { while (indice < lista.length) { const ean = lista[indice++]!; const url = await buscarUma(ean); if (url) resultado.set(ean, url); } }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALELO, lista.length) }, trabalhador));
  return resultado;
}

export async function buscarImagensPorProduto(itens: Array<{ ean: string; nome: string }>): Promise<Map<string, string>> {
  const lista = itens.filter((item) => !item.ean && item.nome.trim());
  const resultado = new Map<string, string>(); let indice = 0;
  async function trabalhador() { while (indice < lista.length) { const item = lista[indice++]!; const url = await buscarPorNome(item.nome); if (url) resultado.set(item.nome, url); } }
  await Promise.all(Array.from({ length: Math.min(4, lista.length) }, trabalhador));
  return resultado;
}

/** Busca a imagem de um único EAN nas fontes confiáveis (Cosmos primeiro). */
export async function buscarImagemPorEan(ean: string): Promise<string> {
  const codigo = somenteNumeros(ean);
  return codigo.length >= 8 ? buscarUma(codigo) : "";
}

/** Busca a imagem de um produto sem EAN pelo nome (fonte confiável, com corte de similaridade). */
export async function buscarImagemPorNome(nome: string): Promise<string> {
  return buscarPorNome(nome);
}

/** Valida se uma URL de imagem realmente carrega (usado para candidatos do Google). */
export async function urlDeImagemValida(url: string): Promise<boolean> {
  return imagemCarrega(url);
}
