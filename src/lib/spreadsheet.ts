import * as XLSX from "xlsx";
import { normalize } from "./text-match";

export type SheetRow = Record<string, unknown>;

export async function readSpreadsheet(file: File): Promise<SheetRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<SheetRow>(sheet, { defval: "", raw: true });
}

/** Finds a value in a row by trying several possible header names (accent/case insensitive). */
export function pick(row: SheetRow, candidates: string[]): unknown {
  const entries = Object.entries(row).map(([key, value]) => [normalize(key), value] as const);
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const exact = entries.find(([key]) => key === target);
    if (exact && exact[1] !== "") return exact[1];
  }
  for (const candidate of candidates) {
    const target = normalize(candidate);
    const partial = entries.find(([key]) => key.includes(target) || target.includes(key));
    if (partial && partial[1] !== "") return partial[1];
  }
  return "";
}

export function exportRows(rows: Record<string, unknown>[], fileName: string, sheetName = "Planilha1") {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  // Browser-safe download (works inside preview iframes where writeFile can be blocked)
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** "SABADOU 12-08.xlsx" -> "SABADOU 12-08" */
export function categoryFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Sem categoria";
}
