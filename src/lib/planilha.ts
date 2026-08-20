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
  return [";", "\t", ","].map((separador) => ({ separador, total: contar(separador) })).sort((a, b) => b.total - a.total)[0]?.separador || ";";
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
  const textoCsv = ehCsv ? decodificarCsv(buffer) : "";
  const planilha = ehCsv
    ? XLSX.read(textoCsv, { type: "string", raw: true, FS: descobrirSeparador(textoCsv) })
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
    usados.add(nome);
    return nome;
  });

  // A coluna A dos CSVs de origem é um identificador auxiliar e não participa do cruzamento.
  const indicesAtivos = colunas.map((_, indice) => indice).filter((indice) => !(ehCsv && indice === 0));

  return matriz.slice(cabecalho + 1).filter((linha) => linha.some(temTexto)).map((linha) => {
    const registro: LinhaPlanilha = {};
    indicesAtivos.forEach((indice) => { registro[colunas[indice]] = linha[indice] ?? ""; });
    return registro;
  });
}

export function valorDaColuna(linha: LinhaPlanilha, indice: number): unknown { return Object.values(linha)[indice] ?? ""; }

function normalizarCabecalho(valor: string): string {
  return normalizarTexto(valor).replace(/[._\-\/]+/g, " ").replace(/\s+/g, " ").trim();
}

function valorPareceLimite(valor: unknown): boolean {
  const texto = normalizarTexto(String(valor ?? ""));
  if (!texto) return false;
  if (/^[-–—]+$/.test(texto)) return false;
  return /\d/.test(texto) && (
    /\b(limite|qtd|quantidade|maximo|max|cliente|cpf|und|unidade|fardo|fd|kg)\b/.test(texto) ||
    /^\d+(?:[,.]\d+)?$/.test(texto)
  );
}

/**
 * Procura primeiro pelo cabeçalho informado. Para limites, também procura
 * cabeçalhos equivalentes e textos de limite espalhados na linha.
 */
export function valorDoCampo(linha: LinhaPlanilha, nomesPossiveis: string[]): unknown {
  const campos = Object.entries(linha).map(([chave, valor]) => [normalizarCabecalho(chave), valor] as const);

  for (const nome of nomesPossiveis) {
    const alvo = normalizarCabecalho(nome);
    const exato = campos.find(([chave, valor]) => chave === alvo && temTexto(valor));
    if (exato) return exato[1];
  }

  for (const nome of nomesPossiveis) {
    const alvo = normalizarCabecalho(nome);
    const parcial = campos.find(([chave, valor]) => temTexto(valor) && (chave.includes(alvo) || alvo.includes(chave)));
    if (parcial) return parcial[1];
  }

  const procurandoLimite = nomesPossiveis.some((nome) => normalizarCabecalho(nome).includes("limite"));
  if (procurandoLimite) {
    const porCabecalho = campos.find(([chave, valor]) => {
      if (!temTexto(valor)) return false;
      return /\b(limite|qtd limite|quantidade limite|qtd max|quantidade max|maximo por cliente|max por cliente|cliente|cpf)\b/.test(chave);
    });
    if (porCabecalho && valorPareceLimite(porCabecalho[1])) return porCabecalho[1];

    const porTexto = campos.find(([, valor]) => {
      const texto = normalizarTexto(String(valor ?? ""));
      return /\b(limite|limite de|por cpf|por cliente|fardo|fardos|kg|und|unidade)\b/.test(texto) && /\d/.test(texto);
    });
    if (porTexto) return porTexto[1];

    const numerico = campos.find(([chave, valor]) => {
      if (!valorPareceLimite(valor)) return false;
      if (/preco|preço|valor|oferta|clube|promocional|ean|codigo|cod|produto|nome|descricao|descrição/.test(chave)) return false;
      return /^\d+(?:[,.]\d+)?$/.test(normalizarTexto(String(valor)));
    });
    if (numerico) return numerico[1];
  }

  return "";
}

function baixarArquivo(planilha: XLSX.WorkBook, nomeArquivo: string) {
  const conteudo = XLSX.write(planilha, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const url = URL.createObjectURL(new Blob([conteudo], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
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
  unidade: "Kg" | "Unidade";
}

export interface OpcoesExportacaoClube {
  carrossel: string;
  ativarEm: string;
  inativarEm: string;
}

/** Cria uma URL quadrada sem cortar o produto. */
export function imagemQuadrada(url: string): string {
  const valor = String(url ?? "").trim();
  return valor
    ? `https://wsrv.nl/?url=${encodeURIComponent(valor)}&w=500&h=500&fit=contain&bg=white&output=webp`
    : "";
}

const COLUNAS_DO_CLUBE = ["Nome", "Carrossel", "Check-In", "Preço", "Preço promocional", "Limite por cliente", "Dias para Resgate após ativação", "Unidade", "Não exigir ativação no App", "Ativar em", "Inativar em", "URL da imagem", "Tipo do código", "Códigos dos produtos", "Tipo Promocional", "Sobrescrever lojas", "Lojas"];

function normalizarCodigosParaExportacao(codigos: string): string {
  return String(codigos ?? "")
    .split(/[;,|\n]+/)
    .map((codigo) => codigo.trim())
    .filter(Boolean)
    .join(";");
}

function carrosselParaExportacao(valor: string): string {
  // O modal mantém os nomes reais dos carrosséis; o arquivo do Clube exige a versão sem acentos.
  return String(valor ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatarMoedaPlanilha(celula: XLSX.CellObject | undefined) {
  if (celula) celula.z = '"R$"\\ #,##0.00';
}

export function exportarModeloDoClube(ofertas: OfertaParaExportar[], opcoes: OpcoesExportacaoClube, nomeArquivo = "modelo para o clube.xlsx") {
  const dados = ofertas.map((oferta) => ({
    Nome: oferta.name,
    Carrossel: carrosselParaExportacao(opcoes.carrossel),
    "Check-In": "Não",
    Preço: oferta.price ?? 0,
    "Preço promocional": oferta.promotionalPrice ?? 0,
    "Limite por cliente": oferta.limit ?? 0,
    "Dias para Resgate após ativação": 1,
    Unidade: oferta.unidade === "Kg" ? "Quilograma" : "Unidade",
    "Não exigir ativação no App": "Ativação automática",
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
  for (let linha = 2; linha <= dados.length + 1; linha++) {
    formatarMoedaPlanilha(aba[`D${linha}`]);
    formatarMoedaPlanilha(aba[`E${linha}`]);
  }
  const arquivo = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(arquivo, aba, "Descontos");
  baixarArquivo(arquivo, nomeArquivo);
}

export function categoriaPeloNomeDoArquivo(nomeArquivo: string): string {
  return nomeArquivo.replace(/\.[^.]+$/, "").trim().slice(0, 120) || "Sem categoria";
}
