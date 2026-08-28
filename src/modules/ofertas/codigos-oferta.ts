/** Seleção determinística de códigos de oferta por identidade, variantes, tamanho e custo. */
import { normalizarTexto, semelhanca } from "@/shared/texto";
import { limparCodigo, limparEan, type Produto } from "@/modules/catalogo/catalogo";

const GENERICOS = new Set(["kg","un","und","unidade","pct","pcte","cx","caixa","fardo","fd","produto","produtos","mercadoria","bov","bovina","bovino","refrigerante","refrig","cerveja","cerv","beer","suco","sucos","agua","bebida","bebidas"]);
const IGNORADOS = new Set(["a","as","o","os","e","de","da","do","das","dos","em","no","na","nos","nas","por","para","pra","ao","aos","um","uma","uns","umas"]);
const VARIANTES = new Set(["com","sem","tradicional","zero","light","diet","integral","desnatado","semidesnatado","original","morango","chocolate","baunilha","cookies","coco","uva","limao","limão","maracuja","maracujá","banana","frutas","vermelhas","menta","laranja","manga","abacaxi","pesego","pessego","pêssego"]);

export type Variante = "tradicional" | "zero" | "com_gas" | "sem_gas" | "com_alcool" | "sem_alcool";
type FamiliaVariante = "trad_zero" | "gas" | "alcool";
const FAMILIAS_VARIANTE: Array<{ familia: FamiliaVariante; variantes: readonly Variante[] }> = [
  { familia:"trad_zero", variantes:["tradicional","zero"] },
  { familia:"gas", variantes:["com_gas","sem_gas"] },
  { familia:"alcool", variantes:["com_alcool","sem_alcool"] },
];

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
  return [...new Set(compactarTexto(valor).split(/\s+/).filter(t=>t.length>=2&&!GENERiCOS.has(t)&&!IGNORADOS.has(t)))];
}

function tamanhosDoProduto(valor:string):string[]{
  return [...new Set([...compactarTexto(valor).matchAll(/\b(\d+(?:[.,]\d+)?)(ml|l|g|kg)\b/g)].map(m=>`${m[1]!.replace(",",".")}${m[2]!}`))];
}
function tamanhosCompativeis(oferta:string,descricao:string):boolean{
  const t=tamanhosDoProduto(oferta);
  return !t.length||t.every(x=>tamanhosDoProduto(descricao).includes(x));
}
function tokensExcecao(valor:string):string[][]{
  const texto=normalizarTexto(valor);
  if(!texto.includes("exceto"))return [];
  return texto.split(/\bexceto\b/).slice(1).join(" exceto ").split(/[,;|]|\s+e\s+|\s+\/\s+/).map(p=>tokensFamilia(p.trim())).filter(t=>t.length);
}
export function extrairExcecoes(linha:Record<string,unknown>,nome:string):string[][]{
  return [nome,...Object.values(linha).map(v=>String(v??""))].flatMap(tokensExcecao).filter(t=>t.length);
}

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
function varianteConflitante(oferta:string,descricao:string):boolean{
  const a=variantesDoTexto(oferta),b=variantesDoTexto(descricao);
  if(!a.size||!b.size)return false;
  return FAMILIAS_VARIANTE.some(({familia,variantes})=>{
    const da=variantes.filter(x=>a.has(x)),db=variantes.filter(x=>b.has(x));
    return da.length>0&&db.length>0&&!db.some(x=>da.includes(x));
  });
}

function tokensEquivalentes(a:string,b:string):boolean{
  if(a===b)return true;
  const pares:[[string,string],[string,string],[string,string],[string,string]]=[
    ["refrigerante","refrig"],["cerveja","cerv"],["energetico","energet"],["suco","sucos"]
  ];
  if(pares.some(([x,y])=>(a===x&&b===y)||(a===y&&b===x)))return true;
  return a.length>=4&&b.length>=4&&semelhanca(a,b)>=0.78;
}
function baseCompativel(oferta:string,descricao:string):boolean{
  const a=tokensFamilia(oferta),b=tokensFamilia(descricao);
  if(!a.length)return true;
  const comuns=a.filter(x=>b.some(y=>tokensEquivalentes(x,y))).length;
  const cobertura=comuns/a.length;
  return comuns>0&&(cobertura>=0.75||semelhanca(a.join(" "),b.join(" "))>=0.65);
}
function candidatoExcluido(item:Produto,excecoes:string[][]):boolean{
  if(!excecoes.length)return false;
  const d=normalizarTexto(item.description),c=[limparEan(item.ean),limparCodigo(item.internal_code),limparCodigo(item.promotion_code)];
  return excecoes.some(t=>{
    if(!t.length)return false;
    const texto=t.join(" ");
    if(/^\d{8,14}$/.test(texto))return c.includes(texto);
    return t.every(x=>d.includes(x));
  });
}
function codigoDoProduto(item:Produto,porQuilo:boolean):string{
  if(porQuilo){
    const i=limparCodigo(item.internal_code);
    return i&&!/^\d{8,14}$/.test(limparEan(i))?i:"";
  }
  return limparEan(item.ean);
}
function custoCompativel(item:Produto,preco:number|null):boolean{
  if(preco==null||!Number.isFinite(preco)||preco<=0||item.cost==null||!Number.isFinite(item.cost))return true;
  // Custo acima do preço de venda nunca é aceito automaticamente.
  return item.cost<=preco;
}
function pontuacao(nome:string,item:Produto):number{
  const a=tokensFamilia(nome),b=tokensFamilia(item.description);
  const comuns=a.filter(x=>b.some(y=>tokensEquivalentes(x,y))).length;
  const cobertura=a.length?comuns/a.length:1;
  const similaridade=semelhanca(compactarTexto(nome),compactarTexto(item.description));
  const tamanho=tamanhosCompativeis(nome,item.description)?1:0;
  return Math.min(1,cobertura*0.55+similaridade*0.3+tamanho*0.15);
}

type Candidato={item:Produto;score:number};
function candidatosBase(nome:string,catalogo:Produto[],excecoes:string[][],preco:number|null,porQuilo:boolean):Candidato[]{
  return catalogo
    .filter(i=>!candidatoExcluido(i,excecoes))
    .filter(i=>custoCompativel(i,preco))
    .filter(i=>Boolean(codigoDoProduto(i,porQuilo)))
    .filter(i=>tamanhosCompativeis(nome,i.description))
    .filter(i=>baseCompativel(nome,i.description))
    .filter(i=>!varianteConflitante(nome,i.description))
    .map(i=>({item:i,score:pontuacao(nome,i)}))
    .filter(x=>x.score>=0.55)
    .sort((a,b)=>b.score-a.score);
}

function atributosNaoInformados(nome:string,candidato:Produto):string[]{
  const oferta=new Set(tokensFamilia(nome));
  return tokensFamilia(candidato.description).filter(t=>!oferta.has(t));
}

/**
 * Decide se vários candidatos são realmente variantes da mesma descrição.
 * Só permite expansão quando:
 * - a oferta já identifica uma base forte (ex.: WHEY PARMALAT 250ML);
 * - todos os candidatos compartilham os tokens informados;
 * - as diferenças ficam concentradas em atributos não informados;
 * - existem no máximo 8 candidatos;
 * - o custo de cada candidato não ultrapassa o preço da oferta.
 *
 * Isso impede "AMACIANTE 5L" de virar todos os amaciantes 5L,
 * mas permite "WHEY PARMALAT 250ML" retornar seus sabores cadastrados.
 */
function candidatosDaMesmaVariacao(nome:string,candidatos:Candidato[],preco:number|null):Candidato[]{
  if(candidatos.length<2||candidatos.length>8)return [];
  const tokensOferta=tokensFamilia(nome);
  if(tokensOferta.length<2)return [];

  const melhor=candidatos[0]!;
  const baseScore=melhor.score;
  const elegiveis=candidatos.filter(c=>c.score>=Math.max(0.68,baseScore-0.12));
  if(elegiveis.length<2||elegiveis.length>8)return [];

  // Os candidatos precisam compartilhar todos os atributos informados.
  const compartilhamBase=elegiveis.every(c=>tokensOferta.every(t=>tokensFamilia(c.item.description).some(x=>tokensEquivalentes(t,x))));
  if(!compartilhamBase)return [];

  // Se os nomes completos são praticamente iguais, não há motivo para expandir.
  // Se são muito diferentes, provavelmente são produtos diferentes.
  const diferencas=elegiveis.map(c=>atributosNaoInformados(nome,c.item));
  const quantidadeVariavel=new Set(diferencas.flat()).size;
  if(quantidadeVariavel===0)return [];

  // A descrição precisa deixar claro um núcleo comum. Evita agrupar
  // marcas/produtos diferentes apenas porque compartilham "5L" ou "250ML".
  const intersecao=tokensFamilia(elegiveis[0]!.item.description).filter(t=>elegiveis.every(c=>tokensFamilia(c.item.description).some(x=>tokensEquivalentes(t,x))));
  const coberturaBase=tokensOferta.filter(t=>intersecao.some(x=>tokensEquivalentes(t,x))).length/Math.max(1,tokensOferta.length);
  if(coberturaBase<1)return [];

  // Exige uma base textual suficientemente forte; custo já foi aplicado na lista.
  if(baseScore<0.72)return [];
  if(preco!=null&&elegiveis.some(c=>!custoCompativel(c.item,preco)))return [];

  return elegiveis;
}

export function codigosDaFamiliaOferta(nome:string,produto:Produto|undefined,catalogo:Produto[],porQuilo:boolean,excecoes:string[][]=[],precoOferta:number|null=null):string[]{
  const candidatos=candidatosBase(nome,catalogo,excecoes,precoOferta,porQuilo);
  if(!candidatos.length)return [];

  // Se o produto já foi identificado pela etapa de cruzamento, ele é a âncora.
  // A expansão só acontece se a descrição da oferta for uma família explícita.
  const anchor=produto?candidatos.find(x=>x.item.id===produto.id):undefined;
  const selecionado=anchor?.item||candidatos[0]!.item;
  const mult= candidatosDaMesmaVariacao(nome,candidatos,precoOferta);

  if(mult.length){
    const codigos=mult.map(x=>codigoDoProduto(x.item,porQuilo)).filter(Boolean);
    return [...new Set(codigos)];
  }

  const codigo=codigoDoProduto(selecionado,porQuilo);
  return codigo?[codigo]:[];
}

export function normalizarCodigos(codigos:string[]):string[]{
  return [...new Set(codigos.flatMap(v=>String(v??"").split(/[;,|\n]+/)).map(v=>v.trim()).filter(Boolean))];
}
export function chaveBaseOferta(nome:string):string{return tokensFamilia(nome).join(" ");}
