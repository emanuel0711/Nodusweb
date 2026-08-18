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

/** Returns a cell by zero-based column position. Useful for legacy CSVs where column B is the product code. */
export function columnValue(row: SheetRow, index: number): unknown {
  return Object.entries(row)[index]?.[1] ?? "";
}

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

function downloadWorkbook(workbook: XLSX.WorkBook, fileName: string) {
  const output = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([output], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function exportRows(rows: Record<string, unknown>[], fileName: string, sheetName = "Planilha1") {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  downloadWorkbook(workbook, fileName);
}

export interface ClubOfferExportRow {
  name: string;
  price: number | null;
  promotionalPrice: number | null;
  limit: number | null;
  imageUrl: string;
  code: string;
  codeType: "Interno" | "EAN";
}

/** Creates a square 1:1 delivery URL without changing the original catalog URL. */
export function squareImageUrl(url: string): string {
  const value = String(url ?? "").trim();
  if (!value) return "";
  return `https://wsrv.nl/?url=${encodeURIComponent(value)}&w=500&h=500&fit=cover&output=webp`;
}

export function exportClubTemplate(rows: ClubOfferExportRow[], fileName = "modelo para o clube.xlsx") {
  const headers = [
    "Nome", "Carrossel", "Check-In", "Preço", "Preço promocional", "Limite por cliente",
    "Dias para Resgate após ativação", "Unidade", "Não exigir ativação no App", "Ativar em",
    "Inativar em", "URL da imagem", "Tipo do código", "Códigos dos produtos", "Tipo Promocional",
    "Sobrescrever lojas", "Lojas",
  ];
  const data = rows.map((row) => ({
    Nome: row.name,
    Carrossel: "",
    "Check-In": "Não",
    Preço: row.price ?? 0,
    "Preço promocional": row.promotionalPrice ?? 0,
    "Limite por cliente": row.limit ?? 0,
    "Dias para Resgate após ativação": 0,
    Unidade: "Unidade",
    "Não exigir ativação no App": "Exigir ativação no App",
    "Ativar em": "01/01/2000 00:00:00",
    "Inativar em": "01/01/2000 00:00:00",
    "URL da imagem": squareImageUrl(row.imageUrl),
    "Tipo do código": row.codeType,
    "Códigos dos produtos": row.code || "",
    "Tipo Promocional": "De / por",
    "Sobrescrever lojas": "Não",
    Lojas: "",
  }));
  const worksheet = XLSX.utils.json_to_sheet(data, { header: headers });
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  worksheet["!autofilter"] = { ref: `A1:Q${Math.max(1, data.length + 1)}` };
  worksheet["!cols"] = headers.map((header) => ({ wch: Math.min(38, Math.max(14, header.length + 2)) }));
  for (let row = 2; row <= data.length + 1; row++) {
    worksheet[`D${row}`].z = "0.00";
    worksheet[`E${row}`].z = "0.00";
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Descontos");
  downloadWorkbook(workbook, fileName);
}

export function categoryFromFileName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Sem categoria";
}
