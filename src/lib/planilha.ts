/**
 * Leitura e escrita de planilhas (CSV / Excel).
 * Tudo que envolve "abrir arquivo" ou "gerar arquivo" mora aqui.
 */
import * as XLSX from "xlsx";
import { normalizarTexto } from "./comparar-textos";

export type LinhaPlanilha = Record<string, unknown>;

/** CSVs de sistemas de supermercado costumam vir em Windows-1252 e não em UTF-8. */
function decodificarCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, "");
  }
}

/** Descobre se o CSV usa ponto e vírgula, tabulação ou vírgula. */
function descobrirSeparador(texto: string): string {
  const linhas = texto.split(/\r?\n/).filter((linha) => linha.trim()).slice(0, 10);
  const contar = (separador: string) =>
    linhas.reduce((total, linha) => total + linha.split(separador).length - 1, 0);
  return [";", "\t", ","]
    .map((separador) => ({ separador, total: contar(separador) }))
    .sort((a, b) => b.total - a.total)[0]?.separador || ";";
}

function temTexto(valor: unknown): boolean {
  return String(valor ?? "").trim() !== "";
}

/**
 * Muitos arquivos começam com linhas de título/logo antes do cabeçalho real.
 * Procuramos a primeira linha que pareça um cabeçalho (2+ células com texto).
 */
function acharLinhaDoCabecalho(matriz: unknown[][]): number {
  const limite = Math.min(matriz.length, 25);
  for (let i = 0; i < limite; i++) {
    const linha = matriz[i] ?? [];
    const preenchidas = linha.filter(temTexto);
    if (preenchidas.length >= 2 && preenchidas.some((celula) => /[a-zA-ZÀ-ÿ]/.test(String(celula)))) return i;
  }
  return 0;
}

/** Lê a primeira aba do arquivo e devolve as linhas já com nomes de coluna. */
export async function lerPlanilha(arquivo: File): Promise<LinhaPlanilha[]> {
  const buffer = await arquivo.arrayBuffer();
  const ehCsv = /\.csv$/i.test(arquivo.name);

  let planilha: XLSX.WorkBook;
  if (ehCsv) {
    const texto = decodificarCsv(buffer);
    planilha = XLSX.read(texto, { type: "string", raw: true, FS: descobrirSeparador(texto) });
  } else {
    planilha = XLSX.read(buffer, { type: "array" });
  }

  const nomeAba = planilha.SheetNames[0];
  if (!nomeAba) return [];
  const aba = planilha.Sheets[nomeAba];
  if (!aba) return [];

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, defval: "", raw: true, blankrows: false });
  if (!matriz.length) return [];

  const indiceCabecalho = acharLinhaDoCabecalho(matriz);
  const usados = new Set<string>();
  const colunas = (matriz[indiceCabecalho] ?? []).map((celula, indice) => {
    let nome = String(celula ?? "").trim() || `Coluna ${indice + 1}`;
    while (usados.has(nome)) nome = `${nome} (${indice + 1})`;
    usados.add(nome);
    return nome;
  });

  return matriz
    .slice(indiceCabecalho + 1)
    .filter((linha) => linha.some(temTexto))
    .map((linha) => {
      const registro: LinhaPlanilha = {};
      colunas.forEach((coluna, indice) => {
        registro[coluna] = linha[indice] ?? "";
      });
      return registro;
    });
}

/** Valor pela posição da coluna (0 = A, 1 = B...). */
export function valorDaColuna(linha: LinhaPlanilha, indice: number): unknown {
  return Object.values(linha)[indice] ?? "";
}

/** Procura uma coluna pelos nomes possíveis, ignorando acentos e maiúsculas. */
export function valorDoCampo(linha: LinhaPlanilha, nomesPossiveis: string[]): unknown {
  const campos = Object.entries(linha).map(([chave, valor]) => [normalizarTexto(chave), valor] as const);
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTexto(nome);
    const exato = campos.find(([chave]) => chave === alvo);
    if (exato && temTexto(exato[1])) return exato[1];
  }
  for (const nome of nomesPossiveis) {
    const alvo = normalizarTexto(nome);
    const parcial = campos.find(([chave]) => chave.includes(alvo) || alvo.includes(chave));
    if (parcial && temTexto(parcial[1])) return parcial[1];
  }
  return "";
}

function baixarArquivo(planilha: XLSX.WorkBook, nomeArquivo: string) {
  const conteudo = XLSX.write(planilha, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const blob = new Blob([conteudo], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export interface OfertaParaExportar {
  name: string;
  price: number | null;
  promotionalPrice: number | null;
  limit: number | null;
  imageUrl: string;
  code: string;
  codeType: "Interno" | "EAN";
}

/** Cria uma versão quadrada (1:1) da imagem sem alterar a URL original. */
export function imagemQuadrada(url: string): string {
  const valor = String(url ?? "").trim();
  if (!valor) return "";
  return `https://wsrv.nl/?url=${encodeURIComponent(valor)}&w=500&h=500&fit=cover&output=webp`;
}

const COLUNAS_DO_CLUBE = [
  "Nome", "Carrossel", "Check-In", "Preço", "Preço promocional", "Limite por cliente",
  "Dias para Resgate após ativação", "Unidade", "Não exigir ativação no App", "Ativar em",
  "Inativar em", "URL da imagem", "Tipo do código", "Códigos dos produtos", "Tipo Promocional",
  "Sobrescrever lojas", "Lojas",
];

export function exportarModeloDoClube(ofertas: OfertaParaExportar[], nomeArquivo = "modelo para o clube.xlsx") {
  const dados = ofertas.map((oferta) => ({
    Nome: oferta.name,
    Carrossel: "",
    "Check-In": "Não",
    Preço: oferta.price ?? 0,
    "Preço promocional": oferta.promotionalPrice ?? 0,
    "Limite por cliente": oferta.limit ?? 0,
    "Dias para Resgate após ativação": 0,
    Unidade: "Unidade",
    "Não exigir ativação no App": "Exigir ativação no App",
    "Ativar em": "01/01/2000 00:00:00",
    "Inativar em": "01/01/2000 00:00:00",
    "URL da imagem": imagemQuadrada(oferta.imageUrl),
    "Tipo do código": oferta.codeType,
    "Códigos dos produtos": oferta.code || "",
    "Tipo Promocional": "De / por",
    "Sobrescrever lojas": "Não",
    Lojas: "",
  }));

  const aba = XLSX.utils.json_to_sheet(dados, { header: COLUNAS_DO_CLUBE });
  aba["!freeze"] = { xSplit: 0, ySplit: 1 };
  aba["!autofilter"] = { ref: `A1:Q${Math.max(1, dados.length + 1)}` };
  aba["!cols"] = COLUNAS_DO_CLUBE.map((coluna) => ({ wch: Math.min(38, Math.max(14, coluna.length + 2)) }));
  for (let linha = 2; linha <= dados.length + 1; linha++) {
    if (aba[`D${linha}`]) aba[`D${linha}`].z = "0.00";
    if (aba[`E${linha}`]) aba[`E${linha}`].z = "0.00";
  }

  const arquivo = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(arquivo, aba, "Descontos");
  baixarArquivo(arquivo, nomeArquivo);
}

/** A categoria do produto é o nome do arquivo importado. */
export function categoriaPeloNomeDoArquivo(nomeArquivo: string): string {
  return nomeArquivo.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Sem categoria";
}
