/** Seleção determinística de códigos de oferta por identidade, variante, tamanho e custo. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const TOKENS_GENERICOS = new Set([
  "kg","un","und","unidade","pct","pcte","cx","caixa","fardo","fd",
  "produto","produtos","mercadoria","bov","bovina","bovino",
  "refrigerante","refrig","cerveja","cerv","beer","suco","sucos","agua","bebida","bebidas"
]);
const TOKENS_IGNORADOS = new Set(["a","as","o","os","e","de","da","do","das","dos","em","no","na","nos","nas","por","para","pra","ao","aos","um","uma","uns","umas"]);
export type Variante = "tradicional" | "zero" | "com_gas" | "sem_gas" | "com_alcool" | "sem_alcool";
type FamiliaVariante = "trad_zero" | "gas" | "alcool";
const FAMILIAS_VARIANTE: Array<{ familia: FamiliaVariante; variantes: readonly Variante[] }> = [
  { familia:"trad_zero", variantes:["tradicional","zero"] },
  { familia:"gas", variantes:["com_gas","sem_gas"] },
  { familia:"alcool", variantes:["com_alcool","sem_alcool"] },
];
const TOKENS_VARIANTE = new Set(["com","sem","tradicional","zero","gas","alcool"]);

function compactarTexto(valor:string):string {
  return normalizarTexto(valor)
    .replace(/(\d+(?:[.,]\d+)?)\s+(ml|l|g|kg)\b/g,"$1$2")
    .replace(/\btrad\b/g,"tradicional")
    .replace(/\bc\s*\/?\s*gas\b/g,"com gas").replace(/\bs\s*\/?\s*gas\b/g,"sem gas")
    .replace(/\bc\s*\/?\s*alcool\b/g,"com alcool").replace(/\bs\s*\/?\s*alcool\b/g,"sem alcool")
    .replace(/\bcom\s+e\s+sem\s+gas\b/g,"com sem gas")
    .replace(/\bcom\s+e\s+sem\s+alcool\b/g,"com sem alcool")
    .replace(/\bexceto\b.*$/i,"").trim();
}

export function tokensFamilia(valor:string):string[] {
  return [...new Set(compactarTexto(valor).split(/\s+/).filter(t=>t.length>=2&&!TOKENS_GENERICOS.has(t)&&!TOKENS_IGNORADOS.has(t)&&!TOKENS_VARIANTE.has(t)))];
}
function tamanhosDoProduto(valor:string):string[]{return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map(m=>`${m[1]!.replace(",",".")}${m[2]!}`))];}
function tamanhosCompativeis(oferta:string,descricao:string):boolean{const t=tamanhosDoProduto(oferta);return !t.length||t.every(x=>tamanhosDoProduto(descricao).includes(x));}
function tokensExcecao(valor:string):string[][]{const texto=normalizarTexto(valor);if(!texto.includes("exceto"))return [];return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map(p=>tokensFamilia(p.trim())).filter(t=>t.length);}
export function extrairExcecoes(linha:Record<string,unknown>,nome:string):string[][]{return [nome,...Object.values(linha).map(v=>String(v??""))].flatMap(tokensExcecao).filter(t=>t.length);}

export function variantesDoTexto(valor:string):Set<Variante>{
  const texto=compactarTexto(valor),v=new Set<Variante>();
  if(/\bzero\b/.test(texto))v.add("zero");
  if(/\btradicional\b/.test(texto))v.add("tradicional");
  if(/\bcom\s+gas\b/.test(texto))v.add("com_gas");
  if(/\bsem\s+gas\b/.test(texto))v.add("sem_gas");
  if(/\bcom\s+alcool\b/.test(texto))v.add("com_alcool");
  if(/\bsem\s+alcool\b/.test(texto))v.add("sem_alcool");
  return v;
}
function variantesDaOferta(nome:string){return variantesDoTexto(nome);}
function variantesDaFamilia(v:Set<Variante>,f:FamiliaVariante):Variante[]{const c=FAMILIAS_VARIANTE.find(x=>x.familia===f);return c?c.variantes.filter(x=>v.has(x)):[];}

function varianteExplicitamenteConflitante(oferta:string,descricao:string):boolean{
  const desejadas=variantesDaOferta(oferta),encontradas=variantesDoTexto(descricao);if(!desejadas.size||!encontradas.size)return false;
  return FAMILIAS_VARIANTE.some(({familia})=>{const a=variantesDaFamilia(desejadas,familia),b=variantesDaFamilia(encontradas,familia);return a.length>0&&b.length>0&&!b.some(x=>a.includes(x));});
}

function tokensEquivalentes(a:string,b:string):boolean{
  if(a===b)return true;
  const pares:[string,string][]=[
    ["refrigerante","refrig"],["cerveja","cerv"],["energetico","energet"],["suco","sucos"]
  ];
  if(pares.some(([x,y])=>(a===x&&b===y)||(a===y&&b===x)))return true;
  return a.length>=4&&b.length>=4&&semelhanca(a,b)>=0.78;
}
function baseCompativel(oferta:string,descricao:string):boolean{
  const a=tokensFamilia(oferta),b=tokensFamilia(descricao);
  if(!a.length)return true;
  const comuns=a.filter(x=>b.some(y=>tokensEquivalentes(x,y))).length;
  if(!comuns)return false;
  const cobertura=comuns/a.length;
  const identidade=semelhanca(a.join(" "),b.join(" "));
  return cobertura>=0.5||identidade>=0.58;
}
function candidatoExcluido(item:Produto,excecoes:string[][]):boolean{if(!excecoes.length)return false;const d=normalizarTexto(item.description),c=[limparEan(item.ean),limparCodigo(item.internal_code),limparCodigo(item.promotion_code)];return excecoes.some(t=>{if(!t.length)return false;const texto=t.join(" ");if(/^\d{8,14}$/.test(texto))return c.includes(texto);return t.every(x=>d.includes(x));});}
function codigoDoProduto(item:Produto,porQuilo:boolean):string{if(porQuilo){const i=limparCodigo(item.internal_code);return i&&!/^\d{8,14}$/.test(limparEan(i))?i:"";}return limparEan(item.ean);}
function custoCompativel(item:Produto,preco:number|null):boolean{if(preco==null||!Number.isFinite(preco)||preco<=0||item.cost==null||!Number.isFinite(item.cost))return true;return item.cost<=preco*1.15;}
function pontuacaoBase(nome:string,item:Produto):number{const a=tokensFamilia(nome),b=tokensFamilia(item.description);const comuns=a.filter(x=>b.some(y=>tokensEquivalentes(x,y))).length;const cobertura=a.length?comuns/a.length:1;return Math.min(1,cobertura*0.7+semelhanca(a.join(" "),b.join(" "))*0.3);}

type Candidato={item:Produto;score:number};
function candidatosBase(nome:string,catalogo:Produto[],excecoes:string[][],preco:number|null,porQuilo:boolean):Candidato[]{
  const tokensOferta=tokensFamilia(nome);
  return catalogo
    .filter(i=>!candidatoExcluido(i,excecoes))
    .filter(i=>custoCompativel(i,preco))
    .filter(i=>Boolean(codigoDoProduto(i,porQuilo)))
    .filter(i=>tamanhosCompativeis(nome,i.description))
    .filter(i=>baseCompativel(nome,i.description))
    .filter(i=>!varianteExplicitamenteConflitante(nome,i.description))
    .map(i=>({item:i,score:pontuacaoBase(nome,i)}))
    .filter(x=>{
      if(x.score<0.45)return false;
      const tokensCatalogo=tokensFamilia(x.item.description);
      const fortes=tokensOferta.filter(t=>tokensCatalogo.some(c=>tokensEquivalentes(t,c))).length;
      return !tokensOferta.length || fortes>0;
    })
    .sort((a,b)=>b.score-a.score);
}

/**
 * Seleciona somente o melhor produto para uma linha da Oferta.
 * Variantes da mesma família NÃO são expandidas automaticamente.
 * Ex.: "amaciante 5l" deve apontar para um único item, e não para todos
 * os amaciantes de 5L do catálogo.
 */
function selecionarProdutoUnico(nome:string,candidatos:Candidato[],produto:Produto|undefined):Produto|undefined{
  if(produto){
    const correspondente=candidatos.find(x=>x.item.id===produto.id);
    if(correspondente)return correspondente.item;
  }
  return candidatos[0]?.item;
}

export function codigosDaFamiliaOferta(nome:string,produto:Produto|undefined,catalogo:Produto[],porQuilo:boolean,excecoes:string[][]=[],precoOferta:number|null=null):string[]{
  const candidatos=candidatosBase(nome,catalogo,excecoes,precoOferta,porQuilo);
  const selecionado=selecionarProdutoUnico(nome,candidatos,produto);
  if(!selecionado)return [];
  const codigo=codigoDoProduto(selecionado,porQuilo);
  return codigo ? [codigo] : [];
}

export function normalizarCodigos(codigos:string[]):string[]{return [...new Set(codigos.flatMap(v=>String(v??"").split(/[;,|\n]+/)).map(v=>v.trim()).filter(Boolean))];}
export function chaveBaseOferta(nome:string):string{return tokensFamilia(nome).join(" ");}