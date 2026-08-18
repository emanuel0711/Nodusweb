const OFF_API = "https://world.openfoodfacts.org/api/v2/product";
const MAX_CONCURRENCY = 24;
const memoryCache = new Map<string, string>();

function barcodeCandidates(value: string | null | undefined): string[] {
  const code = String(value ?? "").replace(/\D/g, "");
  if (code.length < 8) return [];
  const candidates = [code];
  if (code.length === 12) candidates.push(`0${code}`);
  return [...new Set(candidates)];
}

async function fetchOne(code: string): Promise<string> {
  const cached = memoryCache.get(code);
  if (cached !== undefined) return cached;

  for (const candidate of barcodeCandidates(code)) {
    try {
      const response = await fetch(`${OFF_API}/${encodeURIComponent(candidate)}.json?fields=image_front_url,image_url,image_front_small_url,image_front_thumb_url`, {
        headers: {
          Accept: "application/json",
          "User-Agent": "OfertaFlow/1.0 (product catalog image lookup)",
        },
      });
      if (!response.ok) continue;
      const data = (await response.json()) as {
        status?: number;
        product?: {
          image_front_url?: string;
          image_url?: string;
          image_front_small_url?: string;
          image_front_thumb_url?: string;
        };
      };
      if (data.status !== 1) continue;
      const image = data.product?.image_front_url || data.product?.image_url || data.product?.image_front_small_url || data.product?.image_front_thumb_url;
      if (image) {
        memoryCache.set(code, image);
        return image;
      }
    } catch {
      // Ignore one failed lookup and continue with the next candidate.
    }
  }

  // Cache misses too, so repeated imports do not query the same missing EAN again.
  memoryCache.set(code, "");
  return "";
}

export async function findProductImage(ean: string | null | undefined): Promise<string> {
  const code = String(ean ?? "").replace(/\D/g, "");
  if (code.length < 8) return "";
  return fetchOne(code);
}

/**
 * Looks up images with bounded concurrency instead of processing five EANs at a time.
 * The importer can therefore finish quickly while the image enrichment is handled
 * in parallel. Results are cached in memory for the current session.
 */
export async function findProductImages(eans: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(eans.map((value) => String(value ?? "").replace(/\D/g, "")).filter((value) => value.length >= 8))];
  const result = new Map<string, string>();
  let cursor = 0;

  async function worker() {
    while (cursor < unique.length) {
      const index = cursor++;
      const ean = unique[index];
      const url = await fetchOne(ean);
      if (url) result.set(ean, url);
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, unique.length) }, () => worker());
  await Promise.all(workers);
  return result;
}
