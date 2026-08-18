export function normalize(value: string): string {
  return (value ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(value: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < value.length - 1; i++) {
    const gram = value.slice(i, i + 2);
    map.set(gram, (map.get(gram) ?? 0) + 1);
  }
  return map;
}

/** Dice coefficient over character bigrams — 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;

  const ga = bigrams(x);
  const gb = bigrams(y);
  let matches = 0;
  let totalA = 0;
  let totalB = 0;
  ga.forEach((count) => (totalA += count));
  gb.forEach((count) => (totalB += count));
  ga.forEach((count, gram) => {
    const other = gb.get(gram);
    if (other) matches += Math.min(count, other);
  });

  const dice = (2 * matches) / (totalA + totalB);
  const ta = new Set(x.split(" "));
  const tb = new Set(y.split(" "));
  let shared = 0;
  ta.forEach((token) => {
    if (tb.has(token)) shared += 1;
  });
  const jaccard = shared / new Set([...ta, ...tb]).size;

  return dice * 0.7 + jaccard * 0.3;
}

export interface MatchCandidate {
  id: string;
  description: string;
}

export function bestMatch<T extends MatchCandidate>(
  query: string,
  candidates: T[],
  threshold = 0.55,
): { item: T; score: number } | null {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return null;

  let best: { item: T; score: number } | null = null;
  for (const candidate of candidates) {
    const score = normalize(candidate.description) === normalizedQuery ? 1 : similarity(normalizedQuery, candidate.description);
    if (!best || score > best.score) best = { item: candidate, score };
    if (score === 1) break;
  }
  return best && best.score >= threshold ? best : null;
}

/** Extracts a numeric customer limit, but not the number in phrases such as "segunda unidade". */
export function extractLimit(value: unknown): number | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = normalize(text);
  if (/segunda unidade|segunda un|na segunda/.test(normalized)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  const match = text.replace(",", ".").match(/\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

/** "R$ 12,90" -> 12.9 */
export function parsePrice(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value)
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}\b)/g, "")
    .replace(",", ".");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
