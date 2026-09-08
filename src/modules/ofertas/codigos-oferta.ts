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
  "com",
  "sem",
  "un",
  "und",
  "unidade",
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
  "hibrido",
]);
const SABORES = new Set([
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
  "seco",
  "suave",
  "bordo",
  "cabernet",
  "sauvignon",
  "merlot",
  "moscatel",
  "chardonnay",
  "capim",
  "neutro",
  "clear",
  "care",
  "antibac",
]);
const ALIASES: Record<string, string> = {
  refrig: "refrigerante",
  refri: "refrigerante",
  cerv: "cerveja",
  heinekn: "heineken",
  heineknen: "heineken",
  bov: "bovino",
  bovina: "bovino",
  congel: "congelado",
  cong: "congelado",
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
  achoc: "achocolatado",
  bisc: "biscoito",
};
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
  | "demerara";
const FAMILIAS: Variante[][] = [
  ["tradicional", "zero"],
  ["com_gas", "sem_gas"],
  ["com_alcool", "sem_alcool"],
  ["branco", "parboilizado"],
  ["refinado", "demerara"],
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
};

/** Converte antes de remover pontuação, preservando 1,5 L e 0.8 kg. */
function textoCanonico(valor: string): string {
  const medidas = valor
    .toLowerCase()
    .replace(/(\d+(?:[.,]\d+)?)\s*(kg|ml|g|l)\b/g, (_, numero: string, unidade: string) => {
      const n = Number(numero.replace(",", ".")) * (unidade === "kg" || unidade === "l" ? 1000 : 1);
      return (
        " " +
        Number(n.toFixed(6)).toString().replace(".", "d") +
        (unidade === "kg" || unidade === "g" ? "g" : "ml") +
        " "
      );
    });
  const quantidades = medidas.replace(
    /(\d+)\s*(?:un|und|unid|unidade|unidades)\b/gi,
    (_, numero: string) => ` ${Number(numero)}un `,
  );
  return normalizarTexto(quantidades)
    .split(" ")
    .map((t) => ALIASES[t] ?? t)
    .join(" ")
    .replace(/\bc gas\b/g, "com gas")
    .replace(/\bs gas\b/g, "sem gas")
    .replace(/\bc alcool\b/g, "com alcool")
    .replace(/\bs alcool\b/g, "sem alcool")
    .replace(/\bcom e sem gas\b/g, "com gas e sem gas")
    .replace(/\bcom e sem alcool\b/g, "com alcool e sem alcool");
}
function semExcecoes(valor: string): string {
  return textoCanonico(valor)
    .split(/\bexceto\b/)[0]!
    .trim();
}
function medidas(valor: string): string[] {
  return [...new Set(semExcecoes(valor).match(/\b\d+(?:d\d+)?(?:g|ml|un)\b/g) ?? [])].sort();
}
function saboresSolicitados(nome: string): boolean {
  const texto = semExcecoes(nome);
  if (/\bsabores\b/.test(texto)) return true;
  // Regra confirmada nos exemplos: Frisco sem sabor especificado reúne a família.
  const familiaComSabores =
    /\bfrisco\b|\bred horse\b|\bvinho\b|\bdetergente ype\b|\blava roupas\b.*\bbrilhante\b|\bamaciante\b.*\baquafast\b|\bmassa isabela\b.*\bsemola\b|\bsopao apti\b|\binseticida mat inset\b|\bfralda\b.*\bpom pom\b.*\bjumbo\b/.test(
      texto,
    );
  return familiaComSabores && !texto.split(" ").some((t) => SABORES.has(t));
}

function expansaoSemMedidaPermitida(nome: string): boolean {
  return /\bfralda\b.*\bpom pom\b.*\bjumbo\b/.test(semExcecoes(nome));
}

function alternativasExplicitas(nome: string): string[] {
  const semExcecao = nome.split(/\bexceto\b/i)[0]!.trim();
  const partes = semExcecao.match(/^(.*\s)?(\S+)\s+ou\s+(\S+)(.*)$/i);
  if (!partes) return [nome];
  const prefixo = partes[1] ?? "";
  const sufixo = partes[4] ?? "";
  const excecao = nome.match(/\bexceto\b.*$/i)?.[0] ?? "";
  return [partes[2]!, partes[3]!].map((alternativa) =>
    `${prefixo}${alternativa}${sufixo} ${excecao}`.replace(/\s+/g, " ").trim(),
  );
}

export function variantesDoTexto(valor: string): Set<Variante> {
  const texto = semExcecoes(valor);
  return new Set(
    (Object.keys(PADROES) as Variante[]).filter((v) => new RegExp(PADROES[v].source).test(texto)),
  );
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
function tokensIdentidade(valor: string, sabores: boolean): string[] {
  let tokens = tokensFamilia(valor);
  if (sabores) {
    // A família de bebidas em pó pode omitir "refresco/suco em pó" na oferta.
    tokens = tokens.filter(
      (t) =>
        !SABORES.has(t) && !["sabor", "suco", "sucos", "refresco", "refrescos", "po"].includes(t),
    );
  }
  return tokens;
}
function variantesCompativeis(nome: string, descricao: string): boolean {
  const a = variantesDoTexto(nome),
    b = variantesDoTexto(descricao),
    contexto = semExcecoes(`${nome} ${descricao}`);
  return FAMILIAS.every((f) => {
    if (f.includes("branco") && !/\barroz\b/.test(contexto)) return true;
    if (f.includes("refinado") && !/\bacucar\b/.test(contexto)) return true;
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
  return /^(?:\d{8}|\d{12,14})$/.test(ean) ? ean : "";
}
export interface SelecaoCodigos {
  codigos: string[];
  produtos: Produto[];
  nota: number;
  motivo: string | null;
  decisoesPorCodigo?: Record<
    string,
    { nome: string; status: "incluido" | "descartado"; motivos: string[] }
  >;
}
function pendente(motivo: string): SelecaoCodigos {
  return { codigos: [], produtos: [], nota: 0, motivo };
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
      );
    const produtos = resultados.flatMap((resultado) => resultado.produtos);
    return {
      produtos,
      codigos: normalizarCodigos(resultados.flatMap((resultado) => resultado.codigos)),
      nota: Math.min(...resultados.map((resultado) => resultado.nota)),
      motivo: resultados.find((resultado) => resultado.motivo)?.motivo ?? null,
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
  const candidatosCatalogo = catalogo.filter((item) => {
    if (
      !codigoProduto(item, porQuilo) ||
      excluido(item, excecoes) ||
      !variantesCompativeis(nome, item.description)
    )
      return false;
    const ts = medidas(item.description);
    if (tamanhos.length) {
      const contemTamanhos = tamanhos.every((t) => ts.includes(t));
      if (!contemTamanhos || (!sabores && tamanhos.length !== ts.length)) return false;
    }
    const identidade = tokensIdentidade(item.description, sabores);
    return tokens.every((t) => identidade.includes(t));
  });
  // O estoque é consultado por último. Enquanto não houver carga de estoque,
  // os valores ficam nulos e a seleção baseada no catálogo é preservada.
  const candidatosEmEstoque = candidatosCatalogo.filter(
    (item) => item.stock_quantity != null && item.stock_quantity > 0,
  );
  const candidatos = candidatosEmEstoque.length ? candidatosEmEstoque : candidatosCatalogo;
  if (!candidatos.length) return pendente("Nenhum código compatível encontrado no catálogo.");
  const extras = candidatos.map((produto) => ({
    produto,
    quantidade: tokensIdentidade(produto.description, sabores).filter(
      (token) => !tokens.includes(token),
    ).length,
  }));
  const menorQuantidade = Math.min(...extras.map((item) => item.quantidade));
  const maisEspecificos = sabores
    ? candidatos
    : extras.filter((item) => item.quantidade === menorQuantidade).map((item) => item.produto);
  const familias = new Set(maisEspecificos.map((p) => chaveFamilia(p, sabores)));
  if (!sabores && familias.size !== 1)
    return {
      codigos: [],
      produtos: maisEspecificos,
      nota: 0,
      decisoesPorCodigo: Object.fromEntries(
        maisEspecificos.map((produto) => [
          codigoProduto(produto, porQuilo),
          {
            nome: produto.description,
            status: "descartado" as const,
            motivos: [
              "marca e identidade compatíveis",
              tamanhos.length ? `quantidade compatível: ${tamanhos.join(", ")}` : "quantidade não exigida",
              "aguardando escolha manual entre famílias diferentes",
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
  const decisoesPorCodigo = Object.fromEntries(
    candidatosCatalogo.map((produto) => {
      const codigo = codigoProduto(produto, porQuilo);
      const incluido = codigosIncluidos.has(codigo);
      const motivos = [
        "marca e identidade compatíveis",
        tamanhos.length ? `quantidade compatível: ${tamanhos.join(", ")}` : "quantidade não exigida",
        `unidade compatível: ${porQuilo ? "peso" : "unidade"}`,
        sabores ? "variedade aceita pela regra da família" : "variedade compatível",
        "tipo de produto compatível",
      ];
      if (!incluido && candidatosEmEstoque.length && (produto.stock_quantity ?? 0) <= 0)
        motivos.push("descartado no último desempate: estoque zerado");
      else if (!incluido) motivos.push("descartado por pertencer a uma família menos específica");
      return [codigo, { nome: produto.description, status: incluido ? "incluido" : "descartado", motivos }];
    }),
  );
  return {
    produtos,
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
