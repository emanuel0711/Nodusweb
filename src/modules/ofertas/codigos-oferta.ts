/** Seleção determinística de códigos de oferta por identidade, variante, tamanho e custo. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const TOKENS_GENERICOS = new Set(["kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd", "produto", "produtos", "mercadoria", "bov", "bovina", "bovino"]);
const TOKENS_IGNORADOS = new Set(["a", "as", "o", "os", "e", "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas", "por", "para", "pra", "ao", "aos", "um", "uma", "uns", "umas"]);

export type Variante = "tradicional" | "zero" | "com_gas" | "sem_gas" | "com_alcool" | "sem_alcool";
type FamiliaVariante = "trad_zero" | "gas" | "alcool";
const FAMILIAS_VARIANTE: Array<{ familia: FamiliaVariante; variantes: readonly Variante[] }> = [
  { familia: "trad_zero", variantes: ["tradicional", "zero"] },
  { familia: "gas", variantes: ["com_gas", "sem_gas"] },
  { familia: "alcool", variantes: ["com_alcool", "sem_alcool"] },
];
const TOKENS_VARIANTE = new Set(["com", "sem", "tradicional", "zero", "gas", "alcool"]);

function compactarTexto(valor: string): string {
  return normalizarTexto(valor)
    .replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional")
    .replace(/\bc\s+gas\b/g, "com gas").replace(/\bs\s+gas\b/g, "sem gas")
    .replace(/\bc\s+alcool\b/g, "com alcool").replace(/\bs\s+alcool\b/g, "sem alcool")
    .replace(/\bcom\s+e\s+sem\s+gas\b/g, "com sem gas")
    .replace(/\bcom\s+e\s+sem\s+alcool\b/g, "com sem alcool")
    .replace(/\bexceto\b.*$/i, "")
    .trim();
}

export function tokensFamilia(valor: string): string[] {
  return [...new Set(compactarTexto(valor).split(/\s+/).filter((token) => token.length >= 2 && !TOKENS_GENERICOS.has(token) && !TOKENS_IGNORADOS.has(token) && !TOKENS_VARIANTE.has(token)))];
}
function tamanhosDoProduto(valor: string): string[] { return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map((m) => `${m[1]!.replace(",", ".")}${m[2]!}`))]; }
function tamanhosCompativeis(oferta: string, descricao: string): boolean { const t=tamanhosDoProduto(oferta); return !t.length || t.every((x)=>tamanhosDoProduto(descricao).includes(x)); }
function tokensExcecao(valor: string): string[][] { const texto=normalizarTexto(valor); if(!texto.includes("exceto")) return []; return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map((p)=>tokensFamilia(p.trim())).filter((t)=>t.length); }
export function extrairExcecoes(linha: Record<string, unknown>, nome: string): string[][] { return [nome,...Object.values(linha).map((v)=>String(v??""))].flatMap(tokensExcecao).filter((t)=>t.length); }

export function variantesDoTexto(valor: string): Set<Variante> {
  const texto=compactarTexto(valor); const v=new Set<Variante>();
  if(/\bzero\b/.test(texto)) v.add("zero");
  if(/\btradicional\b/.test(texto)) v.add("tradicional");
  if(/\bcom\s+gas\b/.test(texto)) v.add("com_gas");
  if(/\bsem\s+gas\b/.test(texto)) v.add("sem_gas");
  if(/\bcom\s+alcool\b/.test(texto)) v.add("com_alcool");
  if(/\bsem\s+alcool\b/.test(texto)) v.add("sem_alcool");
  return v;
}
function variantesDaOferta(nome:string){return variantesDoTexto(nome);}
function variantesDaFamilia(v:Set<Variante>,f:FamiliaVariante):Variante[]{const c=FAMILIAS_VARIANTE.find(x=>x.familia===f);return c?c.variantes.filter(x=>v.has(x)):[];}

function varianteExplicitamenteConflitante(oferta:string,descricao:string):boolean{
  const desejadas=variantesDaOferta(oferta); if(!desejadas.size)return false;
  const encontradas=variantesDoTexto(descricao); if(!encontradas.size)return false;
  return FAMILIAS_VARIANTE.some(({familia})=>{const a=variantesDaFamilia(desejadas,familia);const b=variantesDaFamilia(encontradas,familia);return a.length>0&&b.length>0&&!b.some(x=>a.includes(x));});
}
function contemToken(descricao:string,token:string):boolean{const c=tokensFamilia(descricao);return c.includes(token)||c.some(x=>x.length>=4&&token.length>=4&&semelhanca(token,x)>=0.82);}
function contemTodosTokens(descricao:string,tokens:string[]):boolean{return tokens.every(t=>contemToken(descricao,t));}
function candidatoExcluido(item:Produto,excecoes:string[][]):boolean{if(!excecoes.length)return false;const d=normalizarTexto(item.description);const c=[limparEan(item.ean),limparCodigo(item.internal_code),limparCodigo(item.promotion_code)];return excecoes.some(t=>{if(!t.length)return false;const texto=t.join(" ");if(/^\d{8,14}$/.test(texto))return c.includes(texto);return t.every(x=>d.includes(x));});}
function codigoDoProduto(item:Produto,porQuilo:boolean):string{if(porQuilo){const i=limparCodigo(item.internal_code);return i&&!/^\d{8,14}$/.test(limparEan(i))?i:"";}return limparEan(item.ean);}
function custoCompativel(item:Produto,preco:number|null):boolean{if(preco==null||!Number.isFinite(preco)||preco<=0||item.cost==null||!Number.isFinite(item.cost))return true;return item.cost<=preco*1.15;}
function pontuacaoCandidato(nome:string,item:Produto,desejadas:Set<Variante>):number{const base=semelhanca(nome,item.description);const e=variantesDoTexto(item.description);if(!desejadas.size||!e.size)return base;return [...desejadas].some(v=>e.has(v))?Math.min(1,base+0.18):base;}

type Candidato={item:Produto;score:number};
function candidatosDaFamilia(nome:string,produto:Produto|undefined,catalogo:Produto[],excecoes:string[][],preco:number|null,porQuilo:boolean):Candidato[]{
  const tokens=tokensFamilia(nome);const tamanhos=tamanhosDoProduto(nome);const desejadas=variantesDaOferta(nome);
  return catalogo.filter(i=>!candidatoExcluido(i,excecoes)).filter(i=>custoCompativel(i,preco)).filter(i=>Boolean(codigoDoProduto(i,porQuilo))).filter(i=>tamanhosCompativeis(nome,i.description)).filter(i=>!tamanhos.length||tamanhosDoProduto(i.description).some(t=>tamanhos.includes(t))).filter(i=>!varianteExplicitamenteConflitante(nome,i.description)).filter(i=>!tokens.length||contemTodosTokens(i.description,tokens)).map(i=>({item:i,score:pontuacaoCandidato(nome,i,desejadas)})).filter(({item,score})=>produto?.id===item.id||score>=0.38).sort((a,b)=>b.score-a.score);
}

/** Seleciona por variante de forma independente. Nunca usa uma variante como substituta de outra. */
function selecionarPorVariante(nome:string,candidatos:Candidato[]):Produto[]{
  const desejadas=variantesDaOferta(nome); if(!desejadas.size)return candidatos.map(x=>x.item);
  const selecionados=new Map<string,Produto>();
  const neutros=candidatos.filter(x=>variantesDoTexto(x.item.description).size===0);
  for(const {familia} of FAMILIAS_VARIANTE){
    for(const variante of variantesDaFamilia(desejadas,familia)){
      const explicitos=candidatos.filter(x=>variantesDoTexto(x.item.description).has(variante));
      if(explicitos.length){selecionados.set(explicitos[0]!.item.id,explicitos[0]!.item);continue;}
      if(variante==="tradicional"){
        const neutro=neutros.find(x=>!selecionados.has(x.item.id));
        if(neutro)selecionados.set(neutro.item.id,neutro.item);
      }
    }
  }
  return [...selecionados.values()];
}

function varianteDoItemCompativelComOferta(nome:string,item:Produto):boolean{
  const desejadas=variantesDaOferta(nome);if(!desejadas.size)return true;
  const encontradas=variantesDoTexto(item.description);if(!encontradas.size)return desejadas.has("tradicional");
  return [...encontradas].some(v=>desejadas.has(v));
}

export function codigosDaFamiliaOferta(nome:string,produto:Produto|undefined,catalogo:Produto[],porQuilo:boolean,excecoes:string[][]=[],precoOferta:number|null=null):string[]{
  const principalValido=Boolean(produto&&tamanhosCompativeis(nome,produto.description)&&!candidatoExcluido(produto,excecoes)&&custoCompativel(produto,precoOferta)&&!varianteExplicitamenteConflitante(nome,produto.description)&&varianteDoItemCompativelComOferta(nome,produto)&&codigoDoProduto(produto,porQuilo));
  const candidatos=candidatosDaFamilia(nome,principalValido?produto:undefined,catalogo,excecoes,precoOferta,porQuilo);
  const selecionados=normalizarCodigos(selecionarPorVariante(nome,candidatos).map(i=>codigoDoProduto(i,porQuilo)).filter(Boolean));
  // Quando há variante explícita, somente os candidatos selecionados por variante entram.
  // O principal não pode "vazar" para o resultado e engolir a outra variante.
  if(variantesDaOferta(nome).size)return selecionados;
  const principal=principalValido?codigoDoProduto(produto!,porQuilo):"";
  return normalizarCodigos([...selecionados,...(principal?[principal]:[])]);
}

export function normalizarCodigos(codigos:string[]):string[]{return [...new Set(codigos.flatMap(v=>String(v??"").split(/[;,|\n]+/)).map(v=>v.trim()).filter(Boolean))];}
export function chaveBaseOferta(nome:string):string{return tokensFamilia(nome).join(" ");}
