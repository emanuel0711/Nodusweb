/**
 * Leitura e escrita de planilhas (CSV / Excel).
 */
import * as XLSX from "xlsx";
import { normalizarTexto } from "./comparar-textos";

export type LinhaPlanilha = Record<string, unknown>;

function decodificarCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { return new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, ""); }
}

function descobrirSeparador(texto: string): string {
  const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim()).slice(0, 10);
  const contar = (s: string) => linhas.reduce((n, linha) => n + linha.split(s).length - 1, 0);
  return [";", "\t", ","].map((separador) => ({ separador, total: contar(separador) })).sort((a,b) => b.total-a.total)[0]?.separador || ";";
}

function temTexto(valor: unknown): boolean { return String(valor ?? "").trim() !== ""; }

function acharLinhaDoCabecalho(matriz: unknown[][]): number {
  for (let i = 0; i < Math.min(matriz.length, 25); i++) {
    const linha = matriz[i] ?? [];
    const preenchidas = linha.filter(temTexto);
    if (preenchidas.length >= 2 && preenchidas.some((c) => /[a-zA-ZÀ-ÿ]/.test(String(c)))) return i;
  }
  return 0;
}

export async function lerPlanilha(arquivo: File): Promise<LinhaPlanilha[]> {
  const buffer = await arquivo.arrayBuffer();
  const ehCsv = /\.csv$/i.test(arquivo.name);
  const planilha = ehCsv
    ? XLSX.read(decodificarCsv(buffer), { type: "string", raw: true, FS: descobrirSeparador(decodificarCsv(buffer)) })
    : XLSX.read(buffer, { type: "array" });
  const nomeAba = planilha.SheetNames[0];
  if (!nomeAba || !planilha.Sheets[nomeAba]) return [];
  const matriz = XLSX.utils.sheet_to_json<unknown[]>(planilha.Sheets[nomeAba], { header: 1, defval: "", raw: true, blankrows: false });
  if (!matriz.length) return [];
  const cabecalho = acharLinhaDoCabecalho(matriz);
  const usados = new Set<string>();
  const colunas = (matriz[cabecalho] ?? []).map((celula, indice) => {
    let nome = String(celula ?? "").trim() || `Coluna ${indice + 1}`;
    while (usados.has(nome)) nome = `${nome} (${indice + 1})`;
    usados.add(nome); return nome;
  });
  return matriz.slice(cabecalho + 1).filter((linha) => linha.some(temTexto)).map((linha) => {
    const registro: LinhaPlanilha = {};
    colunas.forEach((coluna, indice) => { registro[coluna] = linha[indice] ?? ""; });
    return registro;
  });
}

export function valorDaColuna(linha: LinhaPlanilha, indice: number): unknown { return Object.values(linha)[indice] ?? ""; }

export function valorDoCampo(linha: LinhaPlanilha, nomesPossiveis: string[]): unknown {
  const campos = Object.entries(linha).map(([chave, valor]) => [normalizarTexto(chave), valor] as const);
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTexto(nome); const exato = campos.find(([chave]) => chave === alvo);
    if (exato && temTexto(exato[1])) return exato[1];
  }
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTexto(nome); const parcial = campos.find(([chave]) => chave.includes(alvo) || alvo.includes(chave));
    if (parcial && temTexto(parcial[1])) return parcial[1];
  }
  return "";
}

function baixarArquivo(planilha: XLSX.WorkBook, nomeArquivo: string) {
  const conteudo = XLSX.write(planilha, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([conteudo], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const link = document.createElement("a"); link.href = url; link.download = nomeArquivo; link.rel = "noopener noreferrer";
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface OfertaParaExportar {
  name: string;
  price: number | null;
  promotionalPrice: number | null;
  limit: number | null;
  imageUrl: string;
  code: string;
  codeType: "Interno" | "EAN";
  unidade: "Kg" | "Unidade";
}

export interface OpcoesExportacaoClube {
  carrossel: string;
  ativarEm: string;
  inativarEm: string;
}

/**
 * Cria uma URL quadrada sem cortar o produto. O "contain" preserva a embalagem
 * inteira dentro do quadrado que o app do Clube utiliza para o reconhecimento.
 */
export function imagemQuadrada(url: string): string {
  const valor = String(url ?? "").trim();
  return valor
    ? `https://wsrv.nl/?url=${encodeURIComponent(valor)}&w=500&h=500&fit=contain&bg=white&output=webp`
    : "";
}

const COLUNAS_DO_CLUBE = ["Nome", "Carrossel", "Check-In", "Preço", "Preço promocional", "Limite por cliente", "Dias para Resgate após ativação", "Unidade", "Não exigir ativação no App", "Ativar em", "Inativar em", "URL da imagem", "Tipo do código", "Códigos dos produtos", "Tipo Promocional", "Sobrescrever lojas", "Lojas"];

/** Garante que múltiplos códigos sejam exportados como "codigo1;codigo2;codigo3", sem espaços. */
function normalizarCodigosParaExportacao(codigos: string): string {
  return String(codigos ?? "")
    .split(/[;,|\n]+/)
    .map((codigo) => codigo.trim())
    .filter(Boolean)
    .join(";");
}

export function exportarModeloDoClube(ofertas: OfertaParaExportar[], opcoes: OpcoesExportacaoClube, nomeArquivo = "modelo para o clube.xlsx") {
  const dados = ofertas.map((oferta) => ({
    Nome: oferta.name,
    Carrossel: opcoes.carrossel,
    "Check-In": "Não",
    Preço: oferta.price ?? 0,
    "Preço promocional": oferta.promotionalPrice ?? 0,
    "Limite por cliente": oferta.limit ?? 0,
    "Dias para Resgate após ativação": 1,
    Unidade: oferta.unidade,
    "Não exigir ativação no App": "Não exigir ativação no App",
    "Ativar em": opcoes.ativarEm,
    "Inativar em": opcoes.inativarEm,
    "URL da imagem": imagemQuadrada(oferta.imageUrl),
    "Tipo do código": oferta.codeType,
    "Códigos dos produtos": normalizarCodigosParaExportacao(oferta.code),
    "Tipo Promocional": "De / por",
    "Sobrescrever lojas": "Não",
    Lojas: "",
  }));
  const aba = XLSX.utils.json_to_sheet(dados, { header: COLUNAS_DO_CLUBE });
  aba["!freeze"] = { xSplit: 0, ySplit: 1 };
  aba["!autofilter"] = { ref: `A1:Q${Math.max(1, dados.length + 1)}` };
  aba["!cols"] = COLUNAS_DO_CLUBE.map((c) => ({ wch: Math.min(38, Math.max(14, c.length + 2)) }));
  for (let linha = 2; linha <= dados.length + 1; linha++) { if (aba[`D${linha}`]) aba[`D${linha}`].z = "0.00"; if (aba[`E${linha}`]) aba[`E${linha}`].z = "0.00"; }
  const arquivo = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(arquivo, aba, "Descontos"); baixarArquivo(arquivo, nomeArquivo);
}

export function categoriaPeloNomeDoArquivo(nomeArquivo: string): string { return nomeArquivo.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Sem categoria"; }
