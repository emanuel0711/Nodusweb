const OFF_API = "https://world.openfoodfacts.org/api/v2/product";

function barcodeCandidates(value: string | null | undefined): string[] {
  const code = String(value ?? "").replace(/\D/g, "");
  if (code.length < 8) return [];
  const candidates = [code];
  // Excel often removes a leading zero from EAN-13 values when it stores them as numbers.
  if (code.length === 12) candidates.push(`0${code}`);
  return [...new Set(candidates)];
}

export async function findProductImage(ean: string | null | undefined): Promise<string> {
  const candidates = barcodeCandidates(ean);
  for (const code of candidates) {
    try {
      const response = await fetch(`${OFF_API}/${encodeURIComponent(code)}.json`, {
        headers: { Accept: "application/json" },
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
      if (image) return image;
    } catch {
      // Try the next barcode representation.
    }
  }
  return "";
}

export async function findProductImages(eans: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(eans.map((value) => String(value ?? "").replace(/\D/g, "")).filter((value) => value.length >= 8))];
  const result = new Map<string, string>();

  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5);
    const images = await Promise.all(batch.map(async (ean) => [ean, await findProductImage(ean)] as const));
    for (const [ean, url] of images) if (url) result.set(ean, url);
  }
  return result;
}
