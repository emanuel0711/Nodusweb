/** Matching determinístico: só devolve códigos presentes no catálogo recebido. */
import { normalizarTexto } from "@/shared/texto";
import { ehPorQuilo } from "./regras-oferta";
import { limparCodigo, limparEan } from "@/shared/codigos";
import type { Produto } from "@/modules/catalogo/catalogo";

const IGNORADOS = new Set([
  "a",
  "as",
  "o",
  "os",
  "e",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "ao",
  "com",
  "sem",
  "un",
  "und",
  "unds",
  "unidade",
  "unidades",
  "kg",
  "pct",
  "pcte",
  "c",
  "carne",
  "bovino",
  "peca",
  "int",
  "congelado",
  "cong",
  "resfriado",
  "resfriada",
  "capa",
  "lt",
  "lata",
  "pet",
  "grf",
  "garrafa",
  "liq",
  "liquido",
  "somente",
  "uht",
  "bandeja",
  "pacote",
  "osso",
  "nov",
  "jovem",
  "hibrido",
]);
const SABORES = new Set([
  "alfazema",
  "brisa",
  "primavera",
  "verao",
  "lirios",
  "calabresa",
  "mussarela",
  "lombo",
  "frango",
  "requeijao",
  "iogurte",
  "jones",
  "baunilha",
  "laranja",
  "uva",
  "limao",
  "morango",
  "abacaxi",
  "maracuja",
  "manga",
  "goiaba",
  "acerola",
  "caju",
  "pessego",
  "tangerina",
  "jabuticaba",
  "guarana",
  "frutas",
  "vermelhas",
  "citrico",
  "citricas",
  "coco",
  "melancia",
  "melao",
  "kiwi",
  "banana",
  "maca",
  "pera",
  "salada",
  "tropical",
  "tropicais",
  "acai",
  "mangarito",
  "verde",
  "silvestres",
  "cereja",
  "groselha",
  "framboesa",
  "amora",
  "blueberry",
  "cranberry",
  "big",
  "apple",
  "energy",
  "drink",
  // Variedades de vinho que podem compartilhar uma oferta por marca e volume.
  "tinto",
  "rose",
  "rosado",
  "seco",
  "suave",
  "meio",
  "demi",
  "bordo",
  "cabernet",
  "sauvignon",
  "merlot",
  "moscatel",
  "chardonnay",
  "malbec",
  "niagara",
  "prosecco",
  "capim",
  "neutro",
  "clear",
  "care",
  "antibac",
  "isis",
  "italia",
  "lavanda",
  "erva",
  "doce",
  "chocolate",
  "fresh",
  "active",
  "flor",
  "floral",
  "talco",
]);
const VARIEDADES_HORTIFRUTI = new Set(["isis", "italia"]);
const ALIASES: Record<string, string> = {
  abs: "absorvente",
  cr: "creme",
  higien: "higienico",
  conc: "concentrado",
  sh: "shampoo",
  alm: "almofada",
  refrig: "refrigerante",
  refri: "refrigerante",
  cerv: "cerveja",
  heinekn: "heineken",
  heineknen: "heineken",
  bov: "bovino",
  bovina: "bovino",
  congel: "congelado",
  congelada: "congelado",
  congelados: "congelado",
  congeladas: "congelado",
  cong: "congelado",
  resf: "resfriado",
  resfriada: "resfriado",
  resfriados: "resfriado",
  resfriadas: "resfriado",
  inte: "integral",
  desn: "desnatado",
  bdj: "bandeja",
  qj: "queijo",
  prim: "primeira",
  seg: "segunda",
  parbolizado: "parboilizado",
  fat: "fatiado",
  energet: "energetico",
  trad: "tradicional",
  parbo: "parboilizado",
  parb: "parboilizado",
  parboil: "parboilizado",
  bco: "branco",
  acuc: "acucar",
  sab: "sabao",
  amac: "amaciante",
  ref: "refresco",
  beb: "bebida",
  hamb: "hamburguer",
  achoc: "achocolatado",
  bisc: "biscoito",
  rosado: "rose",
  hamburger: "hamburguer",
  ovos: "ovo",
  temp: "temperado",
  temperada: "temperado",
  temperados: "temperado",
  temperadas: "temperado",
};
const DESCRITORES_OPCIONAIS_NA_APROXIMACAO = new Set(["mini", "molho", "maco"]);
const FORMATOS_DE_PRODUTO = new Set([
  "file",
  "filezinho",
  "bife",
  "desfiado",
  "fatiado",
  "moido",
  "sassami",
  "parafuso",
  "penne",
  "talharim",
  "tubo",
  "espaguete",
  "2em1",
  "ceramidas",
  "detox",
]);
const PREPAROS_DE_PRODUTO = new Set([
  "empanado",
  "temperado",
  "condimentado",
  "marinado",
  "recheado",
  "defumado",
]);
export type Variante =
  | "tradicional"
  | "zero"
  | "com_gas"
  | "sem_gas"
  | "com_alcool"
  | "sem_alcool"
  | "branco"
  | "parboilizado"
  | "refinado"
  | "demerara"
  | "integral"
  | "semidesnatado"
  | "desnatado";
const FAMILIAS: Variante[][] = [
  ["tradicional", "zero"],
  ["com_gas", "sem_gas"],
  ["com_alcool", "sem_alcool"],
  ["branco", "parboilizado"],
  ["refinado", "demerara"],
  ["integral", "semidesnatado", "desnatado"],
];
const PADROES: Record<Variante, RegExp> = {
  tradicional: /\btradicional\b/g,
  zero: /\bzero\b|\bsem\s+acucar\b/g,
  com_gas: /\bcom gas\b/g,
  sem_gas: /\bsem gas\b/g,
  com_alcool: /\bcom alcool\b/g,
  sem_alcool: /\bsem alcool\b|\b0\s+0\b/g,
  branco: /\bbranco\b/g,
  parboilizado: /\bparboilizado\b/g,
  refinado: /\brefinado\b/g,
  demerara: /\bdemerara\b/g,
  integral: /\bintegral\b/g,
  semidesnatado: /\bsemi(?:desnatado)?\b/g,
  desnatado: /(?<!\bsemi )\bdesnatado\b/g,
};

/** Converte antes de remover pontuação, preservando 1,5 L e 0.8 kg. */
const cacheTexto = new Map<string, string>();
function textoCanonico(valor: string): string {
  const salvo = cacheTexto.get(valor);
  if (salvo !== undefined) return salvo;
  let unidadesCompletas = valor
    .toLowerCase()
    // O ERP alterna M e MT para medidas lineares. Mantém dimensões como
    // 45X4M e rolos como 60M equivalentes a 45X4MT e 60MT.
    .replace(/(\d+(?:[.,]\d+)?)\s*mt\b/g, "$1m");
  // Em listas como "15L, 30L, 50 e 100L", reaproveita a unidade anterior.
  // O laço cobre várias medidas consecutivas sem confundir a vírgula decimal.
  const unidadeOmitida =
    /(\d+(?:[.,]\d+)?)\s*(kg|ml|g|l)(\s*(?:[,;/]|\be\b)\s*)(\d+(?:[.,]\d+)?)(?!\d|\s*(?:kg|ml|g|l)\b)(?=\s*(?:[,;/]|\be\b|$))/gi;
  let anterior = "";
  while (unidadesCompletas !== anterior) {
    anterior = unidadesCompletas;
    unidadesCompletas = unidadesCompletas.replace(
      unidadeOmitida,
      (_trecho, numero: string, unidade: string, separador: string, proximo: string) =>
        `${numero}${unidade}${separador}${proximo}${unidade}`,
    );
  }
  const medidas = unidadesCompletas.replace(
    /(\d+(?:[.,]\d+)?)\s*(kg|ml|g|l)\b/g,
    (_, numero: string, unidade: string) => {
      const n = Number(numero.replace(",", ".")) * (unidade === "kg" || unidade === "l" ? 1000 : 1);
      return (
        " " +
        Number(n.toFixed(6)).toString().replace(".", "d") +
        (unidade === "kg" || unidade === "g" ? "g" : "ml") +
        " "
      );
    },
  );
  const quantidades = medidas.replace(
    /(\d+)\s*(?:un|und|unid|unidade|unidades)\b/gi,
    (_, numero: string) => ` ${Number(numero)}un `,
  );
  const resultado = normalizarTexto(quantidades)
    .replace(/\bcouve\s+verde\b/g, "couve manteiga")
    .split(" ")
    .map((t) => ALIASES[t] ?? t)
    .join(" ")
    .replace(/\bc gas\b/g, "com gas")
    .replace(/\bs gas\b/g, "sem gas")
    .replace(/\bc alcool\b/g, "com alcool")
    .replace(/\bs alcool\b/g, "sem alcool")
    .replace(/\bcom e sem gas\b/g, "com gas e sem gas")
    .replace(/\bcom e sem alcool\b/g, "com alcool e sem alcool");
  if (cacheTexto.size >= 60000) cacheTexto.clear();
  cacheTexto.set(valor, resultado);
  return resultado;
}

function semExcecoes(valor: string): string {
  return textoCanonico(valor)
    .split(/\bexceto\b/)[0]!
    .trim();
}
const cacheMedidas = new Map<string, string[]>();
function medidas(valor: string): string[] {
  const texto = semExcecoes(valor);
  const salva = cacheMedidas.get(texto);
  if (salva) return salva;
  const resultado = [...new Set(texto.match(/\b\d+(?:d\d+)?(?:g|ml|un)\b/g) ?? [])].sort();
  if (cacheMedidas.size >= 60000) cacheMedidas.clear();
  cacheMedidas.set(texto, resultado);
  return resultado;
}

/**
 * Compara a medida como critério próprio. Uma lista de medidas na oferta
 * representa alternativas (15 L, 30 L, 50 L e 100 L), enquanto cada produto
 * do catálogo precisa conter apenas uma delas.
 */
function medidasCompativeis(tamanhos: string[], descricao: string): boolean {
  if (!tamanhos.length) return true;
  const encontradas = medidas(descricao);
  return tamanhos.length > 1
    ? tamanhos.some((tamanho) => encontradas.includes(tamanho))
    : tamanhos.every((tamanho) => encontradas.includes(tamanho));
}
const CORES_VINHO = new Set(["tinto", "branco", "rose"]);
const CASTAS_VINHO = new Set([
  "bordo",
  "cabernet",
  "sauvignon",
  "merlot",
  "moscatel",
  "chardonnay",
  "malbec",
  "niagara",
  "prosecco",
]);
const GENERICOS_VINHO = new Set([
  "vinho",
  "vinhos",
  "mesa",
  "fino",
  "nacional",
  "bebida",
  "tinto",
  "branco",
  "rose",
  "seco",
  "suave",
  "meio",
  "demi",
  ...CASTAS_VINHO,
]);

function ehVinho(valor: string): boolean {
  return /\bvinhos?\b/.test(semExcecoes(valor));
}

/** A expansão de vinho só é segura quando a oferta identifica uma marca ou linha. */
function vinhoTemMarcaOuLinha(nome: string): boolean {
  if (!ehVinho(nome)) return false;
  return semExcecoes(nome)
    .split(/\s+/)
    .some(
      (token) =>
        token.length > 1 &&
        !IGNORADOS.has(token) &&
        !GENERICOS_VINHO.has(token) &&
        !/^\d+(?:d\d+)?(?:g|ml|un)$/.test(token),
    );
}

function tipoVinho(valor: string): "seco" | "suave" | "meio_seco" | null {
  const texto = semExcecoes(valor);
  if (/\b(?:meio|demi) seco\b/.test(texto)) return "meio_seco";
  if (/\bsuave\b/.test(texto)) return "suave";
  if (/\bseco\b/.test(texto)) return "seco";
  return null;
}

function vinhoCompativel(nome: string, descricao: string): boolean {
  if (!ehVinho(nome)) return true;
  const oferta = semExcecoes(nome);
  const produto = semExcecoes(descricao);
  const corDesejada = [...CORES_VINHO].find((cor) => oferta.split(" ").includes(cor));
  const corEncontrada = [...CORES_VINHO].find((cor) => produto.split(" ").includes(cor));
  if (corDesejada && corDesejada !== corEncontrada) return false;
  const tipoDesejado = tipoVinho(nome);
  if (tipoDesejado && tipoDesejado !== tipoVinho(descricao)) return false;
  const castasDesejadas = [...CASTAS_VINHO].filter((casta) => oferta.split(" ").includes(casta));
  return castasDesejadas.every((casta) => produto.split(" ").includes(casta));
}

function saboresSolicitados(nome: string): boolean {
  const texto = semExcecoes(nome);
  if (/\bsabores\b/.test(texto)) return true;
  const variedadesMencionadas = texto
    .split(" ")
    .filter((token) => VARIEDADES_HORTIFRUTI.has(token));
  if (new Set(variedadesMencionadas).size > 1) return true;
  // Uma marca/linha explícita pode reunir as variações de vinho, respeitando
  // cor, tipo e casta quando esses dados aparecem na oferta.
  if (ehVinho(nome)) return vinhoTemMarcaOuLinha(nome);
  // Regra confirmada nos exemplos: Frisco sem sabor especificado reúne a família.
  const familiaComSabores =
    /\bfrisco\b|\bred horse\b|\bdetergente ype\b|\blava roupas\b.*\bbrilhante\b|\bamaciante\b.*\baquafast\b|\bmassa isabela\b.*\bsemola\b|\bsopao apti\b|\binseticida mat inset\b|\bfralda\b.*\bpom pom\b.*\bjumbo\b|\bkit\b.*\bshampoo\b.*\bcond\b/.test(
      texto,
    );
  const tipoComVariedades =
    /^(?:amaciante|pizza)\b/.test(texto) &&
    texto
      .split(" ")
      .some(
        (t) =>
          !IGNORADOS.has(t) &&
          !["amaciante", "pizza", "concentrado", "sabores"].includes(t) &&
          !/^\d+(?:d\d+)?(?:g|ml|un)$/.test(t),
      );
  const bebidaSemSabor =
    /\b(?:refrigerante|energetico|suco|refresco)\b/.test(texto) &&
    !texto.split(" ").some((token) => SABORES.has(token));
  return (
    bebidaSemSabor ||
    ((familiaComSabores || tipoComVariedades) && !texto.split(" ").some((t) => SABORES.has(t)))
  );
}

function expansaoSemMedidaPermitida(nome: string): boolean {
  return /\bfralda\b.*\bpom pom\b.*\bjumbo\b/.test(semExcecoes(nome));
}

function alternativasExplicitas(nome: string): string[] {
  const semExcecao = nome.split(/\bexceto\b/i)[0]!.trim();
  const aoLeite = semExcecao.match(
    /^(.*\b(?:chocolate|bombom|wafer|biscoito)\b.*\s)(\S+)\s+e\s+ao\s+leite(.*)$/i,
  );
  if (aoLeite) {
    const prefixo = aoLeite[1] ?? "";
    const sufixo = aoLeite[3] ?? "";
    const excecao = nome.match(/\bexceto\b.*$/i)?.[0] ?? "";
    return [aoLeite[2]!, "leite"].map((alternativa) =>
      `${prefixo}${alternativa}${sufixo} ${excecao}`.replace(/\s+/g, " ").trim(),
    );
  }
  const partes = semExcecao.match(/^(.*\s)?(\S+)\s+ou\s+(\S+)(.*)$/i);
  if (!partes) return [nome];
  const prefixo = partes[1] ?? "";
  const sufixo = partes[4] ?? "";
  const excecao = nome.match(/\bexceto\b.*$/i)?.[0] ?? "";
  return [partes[2]!, partes[3]!].map((alternativa) =>
    `${prefixo}${alternativa}${sufixo} ${excecao}`.replace(/\s+/g, " ").trim(),
  );
}

const cacheVariantes = new Map<string, Variante[]>();
export function variantesDoTexto(valor: string): Set<Variante> {
  const texto = semExcecoes(valor);
  let resultado = cacheVariantes.get(texto);
  if (!resultado) {
    resultado = (Object.keys(PADROES) as Variante[]).filter((v) =>
      new RegExp(PADROES[v].source).test(texto),
    );
    if (cacheVariantes.size >= 60000) cacheVariantes.clear();
    cacheVariantes.set(texto, resultado);
  }
  return new Set(resultado);
}
function semVariantes(texto: string): string {
  for (const padrao of Object.values(PADROES)) texto = texto.replace(padrao, " ");
  return texto;
}
export function tokensFamilia(valor: string): string[] {
  return [
    ...new Set(
      semVariantes(semExcecoes(valor))
        .split(/\s+/)
        .filter(
          (t) =>
            t &&
            !IGNORADOS.has(t) &&
            !["sabores", "todos", "sortidos"].includes(t) &&
            !/^\d+(?:d\d+)?(?:g|ml|un)$/.test(t),
        ),
    ),
  ];
}
const cacheTokensIdentidade = new Map<string, string[]>();
function tokensIdentidade(valor: string, sabores: boolean): string[] {
  const chave = `${sabores ? "1" : "0"}\u0000${semExcecoes(valor)}`;
  const salvos = cacheTokensIdentidade.get(chave);
  if (salvos) return salvos;
  let tokens = tokensFamilia(valor);
  if (sabores) {
    const variedadesHorti = tokens.filter((token) => VARIEDADES_HORTIFRUTI.has(token));
    if (tokens.includes("uva") && variedadesHorti.length)
      tokens = tokens.filter((token) => !VARIEDADES_HORTIFRUTI.has(token));
    // A família de bebidas em pó pode omitir "refresco/suco em pó" na oferta.
    else
      tokens = tokens.filter(
        (t) =>
          !SABORES.has(t) && !["sabor", "suco", "sucos", "refresco", "refrescos", "po"].includes(t),
      );
  }
  if (cacheTokensIdentidade.size >= 120000) cacheTokensIdentidade.clear();
  cacheTokensIdentidade.set(chave, tokens);
  return tokens;
}

interface IndiceCatalogo {
  exatos: Map<string, Produto[]>;
  porToken: Map<string, Produto[]>;
  tokensPorProduto: WeakMap<Produto, Set<string>>;
}

const indicesCatalogo = new WeakMap<Produto[], IndiceCatalogo>();

/**
 * Monta uma vez o índice de pesquisa do catálogo. A seleção final continua
 * aplicando todas as regras; o índice apenas evita varrer e renormalizar mais
 * de vinte mil descrições para cada linha da planilha.
 */
function indiceDoCatalogo(catalogo: Produto[]): IndiceCatalogo {
  const salvo = indicesCatalogo.get(catalogo);
  if (salvo) return salvo;
  const indice: IndiceCatalogo = {
    exatos: new Map(),
    porToken: new Map(),
    tokensPorProduto: new WeakMap(),
  };
  for (const produto of catalogo) {
    const descricaoExata = normalizarTexto(produto.description);
    const exatos = indice.exatos.get(descricaoExata) ?? [];
    exatos.push(produto);
    indice.exatos.set(descricaoExata, exatos);
    // O índice usa os tokens completos. A busca por família/sabores remove
    // tokens apenas da consulta, portanto continua sendo um subconjunto seguro.
    const tokens = new Set(tokensIdentidade(produto.description, false));
    indice.tokensPorProduto.set(produto, tokens);
    for (const token of tokens) {
      const produtos = indice.porToken.get(token) ?? [];
      produtos.push(produto);
      indice.porToken.set(token, produtos);
    }
  }
  indicesCatalogo.set(catalogo, indice);
  return indice;
}

function candidatosComTodosTokens(
  catalogo: Produto[],
  tokens: string[],
  _sabores: boolean,
): Produto[] {
  if (catalogo.length < 300 || !tokens.length) return catalogo;
  const indice = indiceDoCatalogo(catalogo);
  const listas = tokens.map((token) => indice.porToken.get(token) ?? []);
  if (listas.some((lista) => !lista.length)) return [];
  const menor = [...listas].sort((a, b) => a.length - b.length)[0]!;
  return menor.filter((produto) => {
    const encontrados = indice.tokensPorProduto.get(produto);
    return encontrados && tokens.every((token) => encontrados.has(token));
  });
}
function variantesCompativeis(nome: string, descricao: string): boolean {
  const pedido = semExcecoes(nome);
  const cadastro = semExcecoes(descricao)
    .replace(/\bdesossad[oa]s?\b/g, "sem osso")
    .replace(/\bc osso\b/g, "com osso")
    .replace(/\bs osso\b/g, "sem osso");
  const congelado = /\bcongelad[oa]s?\b/;
  const resfriado = /\bresfriad[oa]s?\b/;
  if (
    (congelado.test(pedido) && resfriado.test(cadastro)) ||
    (resfriado.test(pedido) && congelado.test(cadastro))
  )
    return false;
  const atributos = [...pedido.matchAll(/\b(?:com|c|sem|s) ([a-z]+)\b/g)].map((m) => m[1]);
  for (const atributo of atributos) {
    const positivo = new RegExp(`\\b(?:com|c) ${atributo}\\b`);
    const negativo = new RegExp(`\\b(?:sem|s) ${atributo}\\b`);
    if (
      (positivo.test(pedido) && negativo.test(cadastro)) ||
      (negativo.test(pedido) && positivo.test(cadastro))
    )
      return false;
  }
  if (/\barroz\b/.test(pedido) && /\bintegral\b/.test(pedido) !== /\bintegral\b/.test(cadastro))
    return false;
  const a = variantesDoTexto(nome),
    b = variantesDoTexto(descricao),
    contexto = `${semExcecoes(nome)} ${semExcecoes(descricao)}`;
  return FAMILIAS.every((f) => {
    if (f.includes("branco") && !/\barroz\b/.test(contexto)) return true;
    if (f.includes("refinado") && !/\bacucar\b/.test(contexto)) return true;
    if (f.includes("integral") && !/\bleite\b/.test(contexto)) return true;
    const desejadas = f.filter((v) => a.has(v)),
      encontradas = f.filter((v) => b.has(v));
    // A ausência de variante significa a versão comum. Nunca inclua zero,
    // sem gás, sem álcool ou parboilizado por suposição.
    if (!desejadas.length) {
      // Açúcar sem tipo é refinado por regra comercial confirmada.
      if (f.includes("refinado"))
        return !encontradas.length || encontradas.every((variante) => variante === "refinado");
      return !encontradas.some((variante) => variante !== "tradicional");
    }
    if (!encontradas.length)
      return desejadas.includes("tradicional") || desejadas.includes("com_alcool");
    return encontradas.every((v) => desejadas.includes(v));
  });
}
function chaveFamilia(produto: Produto, sabores: boolean): string {
  const variantes = [...variantesDoTexto(produto.description)]
    .filter((v) => v !== "tradicional")
    .sort();
  return JSON.stringify([
    tokensIdentidade(produto.description, sabores).sort(),
    medidas(produto.description),
    variantes,
    ehPorQuilo(
      produto.description,
      "",
      produto.internal_code ?? "",
      produto.ean ?? "",
      produto.unit ?? "",
    )
      ? "kg"
      : "un",
  ]);
}

/** Agrupa a mesma família quando a própria oferta pede vários tamanhos. */
function chaveFamiliaSemMedidas(produto: Produto, sabores: boolean): string {
  const variantes = [...variantesDoTexto(produto.description)]
    .filter((v) => v !== "tradicional")
    .sort();
  return JSON.stringify([
    tokensIdentidade(produto.description, sabores).sort(),
    variantes,
    ehPorQuilo(
      produto.description,
      "",
      produto.internal_code ?? "",
      produto.ean ?? "",
      produto.unit ?? "",
    )
      ? "kg"
      : "un",
  ]);
}
export function chaveBaseOferta(nome: string): string {
  return JSON.stringify([
    tokensFamilia(nome).sort(),
    medidas(nome),
    [...variantesDoTexto(nome)].sort(),
    saboresSolicitados(nome),
  ]);
}
export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] {
  const partes = [nome, ...Object.values(linha).map((v) => String(v ?? ""))];
  const todas = partes
    .flatMap((valor) => {
      const texto = valor
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const indice = texto.search(/\bexceto\b/);
      if (indice < 0) return [];
      return texto
        .slice(indice + 6)
        .split(/[,;|/]|\s+e\s+/)
        .map((p) => textoCanonico(p).split(" ").filter(Boolean));
    })
    .filter((t) => t.length);
  return [...new Map(todas.map((t) => [t.join(" "), t])).values()];
}
function excluido(item: Produto, excecoes: string[][]): boolean {
  const descricao = textoCanonico(item.description).split(" ");
  const codigos = [
    limparEan(item.ean),
    limparCodigo(item.internal_code),
    limparCodigo(item.promotion_code),
  ];
  return excecoes.some(
    (tokens) =>
      tokens.length &&
      (codigos.includes(tokens.join("")) || tokens.every((t) => descricao.includes(t))),
  );
}
export function codigoProduto(item: Produto, porQuilo: boolean): string {
  if (
    ehPorQuilo(item.description, "", item.internal_code ?? "", item.ean ?? "", item.unit ?? "") !==
    porQuilo
  )
    return "";
  if (porQuilo) {
    const codigo = limparCodigo(item.internal_code);
    return codigo && !/^\d{8,14}$/.test(codigo) ? codigo : "";
  }
  // PLU confirmado para produto vendido por unidade, sem EAN no catálogo.
  const codigoInterno = limparCodigo(item.internal_code) || limparCodigo(item.ean);
  const pluPorUnidade: Record<string, RegExp> = {
    "1663": /\babacaxi\s+perola\b/,
    "10399": /\brepolho\s+verde\b/,
  };
  if (pluPorUnidade[codigoInterno]?.test(textoCanonico(item.description))) return codigoInterno;
  const ean = String(item.ean ?? "").trim();
  // O catálogo do ERP também armazena PLUs e UPCs sem zeros iniciais.
  // Preserva o identificador cadastrado, sem inventar ou completar dígitos.
  return /^\d{1,14}$/.test(ean) ? ean : "";
}
export interface SelecaoCodigos {
  codigos: string[];
  produtos: Produto[];
  /** Todos os itens considerados, inclusive os descartados pelo desempate. */
  candidatos?: Produto[];
  nota: number;
  motivo: string | null;
  decisoesPorCodigo?: Record<
    string,
    { nome: string; status: "incluido" | "descartado"; motivos: string[] }
  >;
}

function motivoEstoque(produto: Produto): string {
  if (produto.stock_quantity == null) return "estoque não informado";
  if (produto.stock_quantity <= 0) return "estoque zerado";
  return `estoque disponível: ${produto.stock_quantity}`;
}

function tokensQuaseIguais(a: string, b: string): boolean {
  if (a === b) return true;
  const [menorPrefixo, maiorPrefixo] = a.length < b.length ? [a, b] : [b, a];
  if (
    menorPrefixo.length >= 3 &&
    maiorPrefixo.startsWith(menorPrefixo) &&
    maiorPrefixo.length - menorPrefixo.length <= 5
  )
    return true;
  if (Math.min(a.length, b.length) < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let diferencas = 0;
    for (let indice = 0; indice < a.length; indice += 1) {
      if (a[indice] !== b[indice] && ++diferencas > 1) return false;
    }
    return true;
  }
  const [menor, maior] = a.length < b.length ? [a, b] : [b, a];
  let i = 0,
    j = 0,
    diferencas = 0;
  while (i < menor.length && j < maior.length) {
    if (menor[i] === maior[j]) {
      i += 1;
      j += 1;
    } else {
      diferencas += 1;
      j += 1;
      if (diferencas > 1) return false;
    }
  }
  return true;
}

function candidatosComTokensAproximados(
  catalogo: Produto[],
  procurados: string[],
  _sabores: boolean,
): Produto[] {
  if (catalogo.length < 300) return catalogo;
  const obrigatorios = procurados.filter(
    (token) => !DESCRITORES_OPCIONAIS_NA_APROXIMACAO.has(token),
  );
  if (!obrigatorios.length) return catalogo;
  const indice = indiceDoCatalogo(catalogo);
  const conjuntos = obrigatorios.map((procurado) => {
    const produtos = new Set<Produto>();
    for (const [encontrado, itens] of indice.porToken)
      if (tokensQuaseIguais(procurado, encontrado)) for (const item of itens) produtos.add(item);
    return produtos;
  });
  if (conjuntos.some((conjunto) => !conjunto.size)) return [];
  const menor = [...conjuntos].sort((a, b) => a.size - b.size)[0]!;
  return [...menor].filter((produto) => conjuntos.every((conjunto) => conjunto.has(produto)));
}

/** Sugere itens para revisão sem promover uma aproximação a resultado automático. */
function candidatosAproximados(
  nome: string,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][],
): Produto[] {
  const sabores = saboresSolicitados(nome);
  const procurados = tokensIdentidade(nome, sabores);
  const tamanhos = medidas(nome);
  if (!procurados.length) return [];
  const pontuados = candidatosComTokensAproximados(catalogo, procurados, sabores)
    .filter(
      (produto) =>
        codigoProduto(produto, porQuilo) &&
        !excluido(produto, excecoes) &&
        variantesCompativeis(nome, produto.description) &&
        vinhoCompativel(nome, produto.description) &&
        medidasCompativeis(tamanhos, produto.description),
    )
    .map((produto) => {
      const encontrados = tokensIdentidade(produto.description, sabores);
      const correspondencias = procurados.filter((token) =>
        encontrados.some((encontrado) => tokensQuaseIguais(token, encontrado)),
      ).length;
      const naoCorrespondidos = procurados.filter(
        (token) =>
          !encontrados.some((encontrado) => tokensQuaseIguais(token, encontrado)) &&
          !DESCRITORES_OPCIONAIS_NA_APROXIMACAO.has(token),
      );
      const exatas = procurados.filter((token) => encontrados.includes(token)).length;
      return {
        produto,
        correspondencias,
        naoCorrespondidos,
        exatas,
        extras: encontrados.filter(
          (token) => !procurados.some((procurado) => tokensQuaseIguais(procurado, token)),
        ).length,
      };
    })
    .filter(
      ({ correspondencias, naoCorrespondidos }) =>
        !naoCorrespondidos.length &&
        correspondencias >= Math.max(1, Math.ceil(procurados.length * 0.6)),
    )
    .sort(
      (a, b) =>
        b.correspondencias - a.correspondencias ||
        b.exatas - a.exatas ||
        a.extras - b.extras ||
        codigoProduto(a.produto, porQuilo).localeCompare(codigoProduto(b.produto, porQuilo)),
    );
  const melhor = pontuados[0];
  if (!melhor) return [];
  return pontuados
    .filter(
      (item) => item.correspondencias === melhor.correspondencias && item.exatas === melhor.exatas,
    )
    .slice(0, 25)
    .map((item) => item.produto);
}

function pendente(motivo: string, candidatos: Produto[] = [], porQuilo = false): SelecaoCodigos {
  return {
    codigos: [],
    produtos: [],
    ...(candidatos.length ? { candidatos } : {}),
    nota: 0,
    motivo,
    ...(candidatos.length
      ? {
          decisoesPorCodigo: Object.fromEntries(
            candidatos.map((produto) => [
              codigoProduto(produto, porQuilo),
              {
                nome: produto.description,
                status: "descartado" as const,
                motivos: [
                  "correspondência aproximada; aguardando escolha manual",
                  motivoEstoque(produto),
                ],
              },
            ]),
          ),
        }
      : {}),
  };
}

/** Seleção exata por palavras normalizadas. Ambiguidades ficam visíveis para revisão. */
export function selecionarCodigosOferta(
  nome: string,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][] = [],
  preco: number | null = null,
): SelecaoCodigos {
  const canonico = semExcecoes(nome);
  if (/\brepolho\b/.test(canonico) && !/\b(?:verde|roxo)\b/.test(canonico)) nome += " verde";
  if (/\bbrocolis\b/.test(canonico) && !/\bhibrido\b/.test(canonico)) nome += " hibrido";
  const alternativas = alternativasExplicitas(nome);
  if (alternativas.length > 1) {
    const resultados = alternativas.map((alternativa) =>
      selecionarCodigosOferta(alternativa, catalogo, porQuilo, excecoes, preco),
    );
    const pendentes = resultados.filter((resultado) => !resultado.codigos.length);
    if (pendentes.length)
      return pendente(
        `Não encontrei todos os produtos separados por "ou": ${alternativas.join(" / ")}.`,
        resultados.flatMap((resultado) => resultado.candidatos ?? resultado.produtos),
        porQuilo,
      );
    const produtos = resultados.flatMap((resultado) => resultado.produtos);
    return {
      produtos,
      candidatos: resultados.flatMap((resultado) => resultado.candidatos ?? resultado.produtos),
      codigos: normalizarCodigos(resultados.flatMap((resultado) => resultado.codigos)),
      nota: Math.min(...resultados.map((resultado) => resultado.nota)),
      motivo: resultados.find((resultado) => resultado.motivo)?.motivo ?? null,
      decisoesPorCodigo: Object.assign(
        {},
        ...resultados.map((resultado) => resultado.decisoesPorCodigo ?? {}),
      ),
    };
  }
  const sabores = saboresSolicitados(nome),
    tamanhos = medidas(nome),
    tokens = tokensIdentidade(nome, sabores);
  if (!tokens.length) return pendente("Informe a identidade do produto.");
  if (sabores && !tamanhos.length && !expansaoSemMedidaPermitida(nome))
    return pendente("Informe a gramatura para reunir os sabores.");
  if (FAMILIAS.some((f) => f.filter((v) => variantesDoTexto(nome).has(v)).length > 1))
    return pendente("Separe as variantes da oferta.");
  const indice = catalogo.length >= 300 ? indiceDoCatalogo(catalogo) : null;
  const exatos = (indice?.exatos.get(normalizarTexto(nome)) ?? catalogo).filter(
    (item) =>
      normalizarTexto(item.description) === normalizarTexto(nome) &&
      codigoProduto(item, porQuilo) &&
      !excluido(item, excecoes),
  );
  const candidatosCatalogo = candidatosComTodosTokens(catalogo, tokens, sabores).filter((item) => {
    if (exatos.includes(item)) return true;
    if (
      !codigoProduto(item, porQuilo) ||
      excluido(item, excecoes) ||
      !variantesCompativeis(nome, item.description) ||
      !vinhoCompativel(nome, item.description)
    )
      return false;
    const ts = medidas(item.description);
    if (!medidasCompativeis(tamanhos, item.description)) return false;
    if (tamanhos.length === 1 && !sabores && tamanhos.length !== ts.length) return false;
    const identidade = tokensIdentidade(item.description, sabores);
    return tokens.every((t) => identidade.includes(t));
  });
  if (!candidatosCatalogo.length) {
    const aproximados = candidatosAproximados(nome, catalogo, porQuilo, excecoes);
    return pendente(
      aproximados.length
        ? "Não encontrei uma correspondência exata. Selecione abaixo um dos itens aproximados."
        : "Nenhum código compatível encontrado no catálogo.",
      aproximados,
      porQuilo,
    );
  }
  if (ehVinho(nome) && !vinhoTemMarcaOuLinha(nome))
    return pendente(
      "Informe a marca ou a linha do vinho antes de selecionar os códigos.",
      candidatosCatalogo,
      porQuilo,
    );

  // Primeiro resolve identidade, quantidade, tipo e variedade. O estoque só
  // participa depois, caso ainda existam famílias semanticamente empatadas.
  const conservacao = semExcecoes(nome).match(/\b(?:congelado|resfriado)\b/)?.[0];
  const conservacaoConfirmada = conservacao
    ? candidatosCatalogo.filter((p) => semExcecoes(p.description).split(" ").includes(conservacao))
    : [];
  const semPreparoNaoSolicitado = candidatosCatalogo.filter((produto) =>
    tokensIdentidade(produto.description, sabores)
      .filter((token) => !tokens.includes(token))
      .every((token) => !PREPAROS_DE_PRODUTO.has(token)),
  );
  const candidatosPreferidos = conservacaoConfirmada.length
    ? conservacaoConfirmada
    : semPreparoNaoSolicitado.length
      ? semPreparoNaoSolicitado
      : candidatosCatalogo;
  const extras = candidatosPreferidos.map((produto) => ({
    produto,
    tokens: tokensIdentidade(produto.description, sabores).filter(
      (token) => !tokens.includes(token),
    ),
  }));
  const extrasComuns = extras.length
    ? extras[0]!.tokens.filter((token) => extras.every((item) => item.tokens.includes(token)))
    : [];
  const variantesTecnicas = extras.map((item) =>
    item.tokens.filter((token) => !extrasComuns.includes(token)),
  );
  const agruparVariantesTecnicas =
    !sabores &&
    candidatosPreferidos.length > 1 &&
    variantesTecnicas.every(
      (variantes) => variantes.length === 1 && /^[a-z0-9]{1,3}$/.test(variantes[0]!),
    ) &&
    new Set(variantesTecnicas.map((variantes) => variantes[0])).size ===
      candidatosPreferidos.length;
  const agruparVariantesAdicionais =
    !sabores &&
    !exatos.length &&
    candidatosPreferidos.length > 1 &&
    extras.every(
      (item) =>
        item.tokens.length > 0 &&
        semExcecoes(item.produto.description).startsWith(`${semExcecoes(nome)} `) &&
        item.tokens.every(
          (token) => !FORMATOS_DE_PRODUTO.has(token) && !PREPAROS_DE_PRODUTO.has(token),
        ),
    );
  const agruparVariantesCatalogo = agruparVariantesTecnicas || agruparVariantesAdicionais;
  const menorQuantidade = Math.min(...extras.map((item) => item.tokens.length));
  const chaveDaFamilia = tamanhos.length > 1 ? chaveFamiliaSemMedidas : chaveFamilia;
  let maisEspecificos =
    exatos.length && !sabores
      ? candidatosPreferidos.filter((item) =>
          exatos.some((exato) => chaveFamilia(exato, false) === chaveFamilia(item, false)),
        )
      : sabores
        ? candidatosPreferidos
        : agruparVariantesCatalogo
          ? candidatosPreferidos
          : extras
              .filter((item) => item.tokens.length === menorQuantidade)
              .map((item) => item.produto);
  if (
    !exatos.length &&
    !sabores &&
    !agruparVariantesCatalogo &&
    !maisEspecificos.some((produto) => Number(produto.stock_quantity) > 0)
  ) {
    const familiasComSaldo = new Set(
      candidatosPreferidos
        .filter(
          (produto) =>
            Number(produto.stock_quantity) > 0 &&
            !tokensIdentidade(produto.description, false)
              .filter((token) => !tokens.includes(token))
              .some((token) => FORMATOS_DE_PRODUTO.has(token)),
        )
        .map((produto) => chaveDaFamilia(produto, false)),
    );
    if (familiasComSaldo.size === 1) {
      const familiaComSaldo = [...familiasComSaldo][0]!;
      maisEspecificos = candidatosPreferidos.filter(
        (produto) => chaveDaFamilia(produto, false) === familiaComSaldo,
      );
    }
  }
  let familias = new Set(maisEspecificos.map((p) => chaveDaFamilia(p, sabores)));
  let familiaEscolhidaPorEstoque: string | null = null;
  let estoqueUsadoNoDesempate = false;
  if (!sabores && !agruparVariantesCatalogo && familias.size > 1) {
    const familiasComEstoque = new Set(
      maisEspecificos
        .filter((produto) => produto.stock_quantity != null && produto.stock_quantity > 0)
        .map((produto) => chaveDaFamilia(produto, sabores)),
    );
    if (familiasComEstoque.size === 1) {
      familiaEscolhidaPorEstoque = [...familiasComEstoque][0]!;
      maisEspecificos = maisEspecificos.filter(
        (produto) => chaveDaFamilia(produto, sabores) === familiaEscolhidaPorEstoque,
      );
      familias = new Set([familiaEscolhidaPorEstoque]);
      estoqueUsadoNoDesempate = true;
    }
  }
  if (!sabores && !agruparVariantesCatalogo && familias.size !== 1)
    return {
      codigos: [],
      produtos: [],
      candidatos: candidatosCatalogo,
      nota: 0,
      decisoesPorCodigo: Object.fromEntries(
        candidatosCatalogo.map((produto) => [
          codigoProduto(produto, porQuilo),
          {
            nome: produto.description,
            status: "descartado" as const,
            motivos: [
              "marca e identidade compatíveis",
              tamanhos.length
                ? `quantidade compatível: ${tamanhos.join(", ")}`
                : "quantidade não exigida",
              "aguardando escolha manual entre famílias diferentes",
              motivoEstoque(produto),
            ],
          },
        ]),
      ),
      motivo:
        "Mais de uma família de produtos corresponde à descrição. Selecione abaixo quais itens entram na oferta.",
    };
  const produtos = [...maisEspecificos].sort((a, b) =>
    codigoProduto(a, porQuilo).localeCompare(codigoProduto(b, porQuilo)),
  );
  const custoAlto =
    preco != null &&
    Number.isFinite(preco) &&
    preco > 0 &&
    produtos.some((p) => p.cost != null && p.cost > preco * 1.15);
  const codigosIncluidos = new Set(produtos.map((p) => codigoProduto(p, porQuilo)));
  const decisoesPorCodigo: NonNullable<SelecaoCodigos["decisoesPorCodigo"]> = Object.fromEntries(
    candidatosCatalogo.map((produto) => {
      const codigo = codigoProduto(produto, porQuilo);
      const incluido = codigosIncluidos.has(codigo);
      const motivos = [
        "marca e identidade compatíveis",
        tamanhos.length
          ? `quantidade compatível: ${tamanhos.join(", ")}`
          : "quantidade não exigida",
        `unidade compatível: ${porQuilo ? "peso" : "unidade"}`,
        sabores ? "variedade aceita pela regra da família" : "variedade compatível",
        "tipo de produto compatível",
        motivoEstoque(produto),
      ];
      if (
        !incluido &&
        estoqueUsadoNoDesempate &&
        produto.stock_quantity != null &&
        produto.stock_quantity <= 0
      )
        motivos.push("descartado no último desempate: estoque zerado");
      else if (!incluido && estoqueUsadoNoDesempate && produto.stock_quantity == null)
        motivos.push("descartado no último desempate: estoque não informado");
      else if (!incluido) motivos.push("descartado por pertencer a uma família menos específica");
      const status: "incluido" | "descartado" = incluido ? "incluido" : "descartado";
      return [codigo, { nome: produto.description, status, motivos }];
    }),
  );
  return {
    produtos,
    candidatos: candidatosCatalogo,
    codigos: normalizarCodigos(produtos.map((p) => codigoProduto(p, porQuilo))),
    nota: 1,
    motivo: custoAlto ? "O custo cadastrado supera o preço da oferta. Confira o preço." : null,
    decisoesPorCodigo,
  };
}
/** Compatibilidade com os consumidores antigos; sugestão anterior não resolve ambiguidades. */
export function codigosDaFamiliaOferta(
  nome: string,
  _produto: Produto | undefined,
  catalogo: Produto[],
  porQuilo: boolean,
  excecoes: string[][] = [],
  precoOferta: number | null = null,
): string[] {
  return selecionarCodigosOferta(nome, catalogo, porQuilo, excecoes, precoOferta).codigos;
}
export function normalizarCodigos(codigos: string[]): string[] {
  return [
    ...new Set(
      codigos
        .flatMap((v) => String(v ?? "").split(/[;,|\n]+/))
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

/** Expande pares explícitos; nunca divide sabores. Mantém as exclusões no nome. */
export function separarVariantesOferta(nome: string): string[] {
  nome = nome.replace(
    /\b(?:c\/|com)\s+e\s+(?:s\/|sem)\s*(g[aá]s|[aá]lcool)\b/gi,
    "com $1 e sem $1",
  );
  if (/\btrad(?:icional)?\s+e\s+extra\s+forte\b/i.test(nome))
    return [
      nome.replace(/\btrad(?:icional)?\s+e\s+extra\s+forte\b/i, "tradicional"),
      nome.replace(/\btrad(?:icional)?\s+e\s+extra\s+forte\b/i, "extra forte"),
    ];
  const variantes = variantesDoTexto(nome);
  const familias = FAMILIAS.filter((f) => f.filter((v) => variantes.has(v)).length > 1);
  if (!familias.length) return [nome];
  let base = nome
    .split(/\bexceto\b/i)[0]!
    .replace(/\bcom\s+e\s+sem\s+g[aá]s\b/gi, "com gás e sem gás")
    .replace(/\bcom\s+e\s+sem\s+[aá]lcool\b/gi, "com álcool e sem álcool");
  const formas: Record<Variante, RegExp> = {
    tradicional: /\btrad(?:icional)?\b/gi,
    zero: /\bzero\b/gi,
    branco: /\b(?:branco|bco)\b/gi,
    parboilizado: /\bparb(?:o(?:il(?:izado)?)?)?\b/gi,
    refinado: /\brefinado\b/gi,
    demerara: /\bdemerara\b/gi,
    integral: /\binte(?:gral)?\b/gi,
    semidesnatado: /\bsemi(?:desnatado)?\b/gi,
    desnatado: /\bdesn(?:atado)?\b/gi,
    com_gas: /\b(?:com|c\s*\/?)\s*g[aá]s\b/gi,
    sem_gas: /\b(?:sem|s\s*\/?)\s*g[aá]s\b/gi,
    com_alcool: /\b(?:com|c\s*\/?)\s*[aá]lcool\b/gi,
    sem_alcool: /\b(?:sem|s\s*\/?)\s*[aá]lcool\b/gi,
  };
  for (const familia of familias) for (const v of familia) base = base.replace(formas[v], "§");
  base = base
    .replace(/§(?:\s*(?:e|ou|[/,+])?\s*§)*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const excecao = nome.match(/\bexceto\b.*$/i)?.[0] ?? "";
  let nomes = [base];
  for (const familia of familias)
    nomes = nomes.flatMap((n) =>
      familia.filter((v) => variantes.has(v)).map((v) => n + " " + v.replaceAll("_", " ")),
    );
  return nomes.map((n) => (n + " " + excecao).trim());
}
