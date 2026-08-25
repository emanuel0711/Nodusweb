/** Pontuação explicável de candidatos do Google. Serve para ordenar/revisar, nunca para aprovar sozinha. */
import { normalizarTexto } from "@/shared/texto";

export interface ItemPontuacao { rotulo: string; pontos: number }
export interface Pontuacao { total: number; itens: ItemPontuacao[] }

const PALAVRAS_IGNORADAS = new Set(["de", "do", "da", "com", "sem", "kg", "un", "und", "unidade", "pct", "cx", "produto"]);
const PESO = /(\d+[.,]?\d*)\s?(kg|g|gr|ml|l|lt|litro|litros)\b/gi;
const AMBIENTE = /(prateleira|gondola|gôndola|supermercado|mercado|corredor|loja|estoque|carrinho)/i;
const PESSOA = /(pessoa|homem|mulher|crianca|criança|chef|mao|mão|modelo|cliente)/i;
const RECEITA = /(receita|recipe|prato|servido|acompanhamento|como fazer|preparo)/i;
const NEUTRO = /(fundo branco|white background|isolated|isolado|png|transparente|packshot)/i;
const ISOLADO = /(packshot|isolated|isolado|embalagem|unidade|garrafa|lata|pacote)/i;

function palavras(texto: string): string[] {
  return normalizarTexto(texto).split(/\s+/).filter((palavra) => palavra.length >= 3 && !PALAVRAS_IGNORADAS.has(palavra));
}

/** Compara o candidato (título + URL) com a descrição, marca, peso/volume e categoria do produto. */
export function pontuarCandidato(
  candidato: { url: string; titulo: string },
  produto: { description: string; category?: string | null },
): Pontuacao {
  const alvo = normalizarTexto(`${candidato.titulo} ${decodeURIComponent(candidato.url)}`);
  const termos = palavras(produto.description);
  const itens: ItemPontuacao[] = [];

  const acertos = termos.filter((termo) => alvo.includes(termo)).length;
  const proporcao = termos.length ? acertos / termos.length : 0;
  itens.push({ rotulo: `Nome (${acertos}/${termos.length} termos)`, pontos: Math.round(proporcao * 40) });

  const marca = termos[0] ?? "";
  itens.push({ rotulo: "Marca", pontos: marca && alvo.includes(marca) ? 20 : 0 });

  const pesos = [...produto.description.matchAll(PESO)].map(([, numero, medida]) => normalizarTexto(`${numero}${medida}`).replace(",", "."));
  const pesoOk = pesos.some((peso) => alvo.replace(/\s/g, "").includes(peso.replace(/\s/g, "")));
  itens.push({ rotulo: "Peso/volume", pontos: pesoOk ? 15 : 0 });

  const categoria = produto.category ? palavras(produto.category) : [];
  itens.push({ rotulo: "Categoria", pontos: categoria.some((termo) => alvo.includes(termo)) ? 10 : 0 });

  itens.push({ rotulo: "Produto isolado", pontos: ISOLADO.test(alvo) ? 10 : 0 });
  itens.push({ rotulo: "Fundo neutro", pontos: NEUTRO.test(alvo) ? 5 : 0 });

  if (AMBIENTE.test(alvo)) itens.push({ rotulo: "Penalidade: foto de prateleira/ambiente", pontos: -25 });
  if (PESSOA.test(alvo)) itens.push({ rotulo: "Penalidade: pessoas na foto", pontos: -20 });
  if (RECEITA.test(alvo)) itens.push({ rotulo: "Penalidade: receita/prato pronto", pontos: -20 });

  const total = Math.max(0, Math.min(100, itens.reduce((soma, item) => soma + item.pontos, 0)));
  return { total, itens: itens.filter((item) => item.pontos !== 0) };
}
