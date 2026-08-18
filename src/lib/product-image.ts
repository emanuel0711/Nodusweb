const OFF_API = "https://world.openfoodfacts.org/api/v2/product";

export async function findProductImage(ean: string | null | undefined): Promise<string> {
  const code = String(ean ?? "").replace(/\D/g, "");
  if (code.length < 8) return "";

  try {
    const response = await fetch(`${OFF_API}/${encodeURIComponent(code)}.json`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return "";
    const data = (await response.json()) as {
      status?: number;
      product?: { image_front_url?: string; image_url?: string };
    };
    if (data.status !== 1) return "";
    return data.product?.image_front_url || data.product?.image_url || "";
  } catch {
    return "";
  }
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
