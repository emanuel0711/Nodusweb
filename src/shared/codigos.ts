/** Identificadores permanecem texto para preservar zeros à esquerda. */
export function limparEan(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "");
}
export function limparCodigo(valor: unknown): string {
  return String(valor ?? "")
    .trim()
    .replace(/\.0+$/, "");
}
