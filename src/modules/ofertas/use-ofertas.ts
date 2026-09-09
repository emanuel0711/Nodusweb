import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportarModeloDoClube, lerPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { chaveBaseOferta, codigoProduto, normalizarCodigos } from "@/lib/codigos-oferta";

import {
  processarLinhasOfertas,
  cruzarOferta,
  itemComEstoqueZerado,
  validarCodigosNoCatalogo,
  type Oferta,
} from "./processar-ofertas";
export type { Oferta } from "./processar-ofertas";
export { agruparOfertasIrmas, itemComEstoqueZerado } from "./processar-ofertas";

export const CARROSSEIS = [
  "6431 - Promoções",
  "6432 - Pra Você",
  "13533 - Hortifruti",
  "14036 - TERÇA DAS BEBIDAS",
  "13715 - SUPER SABADO",
  "6433 - Especial",
  "6434 - Cashback",
] as const;

const STORAGE_KEY = "ofertaflow:rascunho-ofertas";
const MEMORY_KEY = "ofertaflow:memoria-eans";

export interface ItemMemoriaEans {
  codigos: string[];
  candidatos: string[];
  /** Última versão confirmada pelo relógio do servidor. */
  atualizadoEm: string;
  pendente: boolean;
  conflito: boolean;
}

type MemoriaEans = Record<string, ItemMemoriaEans>;

function normalizarItemMemoria(valor: unknown): ItemMemoriaEans | null {
  if (Array.isArray(valor)) {
    const codigos = valor.map(String).filter(Boolean);
    return { codigos, candidatos: [], atualizadoEm: "", pendente: true, conflito: false };
  }
  if (!valor || typeof valor !== "object") return null;
  const item = valor as Partial<ItemMemoriaEans>;
  if (!Array.isArray(item.codigos)) return null;
  return {
    codigos: item.codigos.map(String).filter(Boolean),
    candidatos: Array.isArray(item.candidatos) ? item.candidatos.map(String).filter(Boolean) : [],
    atualizadoEm: typeof item.atualizadoEm === "string" ? item.atualizadoEm : "",
    // Registros anteriores não informavam se a última tentativa chegou ao servidor.
    // Reenviá-los uma vez evita perder escolhas que ficaram somente neste navegador.
    pendente: typeof item.pendente === "boolean" ? item.pendente : true,
    conflito: typeof item.conflito === "boolean" ? item.conflito : false,
  };
}

function lerMemoria(): MemoriaEans {
  try {
    const salva = JSON.parse(localStorage.getItem(MEMORY_KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(salva)
        .map(([chave, valor]) => [chave, normalizarItemMemoria(valor)] as const)
        .filter((item): item is [string, ItemMemoriaEans] => Boolean(item[1])),
    );
  } catch {
    return {};
  }
}

function mesmosCodigos(a: string[], b: string[]): boolean {
  const esquerda = [...new Set(a)].sort();
  const direita = [...new Set(b)].sort();
  return esquerda.length === direita.length && esquerda.every((codigo, i) => codigo === direita[i]);
}

function aplicarMemoria(ofertas: Oferta[], catalogo: Produto[]): Oferta[] {
  const memoria = lerMemoria();
  return ofertas.map((oferta) => {
    const lembranca = memoria[chaveBaseOferta(oferta.nome)];
    if (!lembranca) return oferta;
    const permitidos = new Set(
      catalogo.map((p) => codigoProduto(p, oferta.porQuilo)).filter(Boolean),
    );
    const codigos = lembranca.codigos.filter((codigo) => permitidos.has(codigo));
    const candidatosAtuais = Object.keys(
      oferta.decisoesPorCodigo ?? oferta.nomesPorCodigo ?? {},
    ).filter((codigo) => permitidos.has(codigo));
    const catalogoMudou = lembranca.candidatos.length
      ? !mesmosCodigos(lembranca.candidatos, candidatosAtuais)
      : candidatosAtuais.some((codigo) => !lembranca.codigos.includes(codigo));
    if (!codigos.length) {
      return {
        ...oferta,
        motivoRevisao:
          "Os códigos lembrados não existem mais no catálogo. Revise os itens compatíveis.",
      };
    }
    const imagem = codigos
      .map((codigo) => oferta.imagemPorCodigo?.[codigo])
      .find((url): url is string => Boolean(url?.trim()));
    return {
      ...oferta,
      codigos,
      codigo: codigos.join(";"),
      ean: oferta.porQuilo ? "" : codigos[0]!,
      codigoInterno: oferta.porQuilo ? codigos[0]! : "",
      codigosEditados: true,
      imagem: imagem ?? oferta.imagem,
      nota: catalogoMudou || lembranca.conflito ? Math.min(oferta.nota, 0.99) : 1,
      motivoRevisao: lembranca.conflito
        ? "Existe uma correção mais recente em outro computador. Confira e escolha novamente."
        : catalogoMudou
          ? "O catálogo mudou desde a última escolha. Confira os itens compatíveis."
          : null,
    };
  });
}

async function sincronizarMemoriaDoServidor() {
  const { data: sessao } = await supabase.auth.getUser();
  if (!sessao.user) return;
  const { data, error } = await supabase
    .from("offer_match_memory")
    .select("offer_key, codes, candidate_codes, updated_at");
  if (error) return;
  const remotos = new Map((data ?? []).map((item) => [item.offer_key, item]));
  const memoria = lerMemoria();
  let encontrouConflito = false;

  // Primeiro compara a versão conhecida por este navegador com o servidor.
  // Assim uma aba antiga nunca publica sua cópia por cima de uma correção nova.
  for (const [chave, item] of Object.entries(memoria)) {
    if (!item.pendente) continue;
    const remoto = remotos.get(chave);
    if (remoto && item.atualizadoEm !== remoto.updated_at) {
      memoria[chave] = {
        ...item,
        atualizadoEm: remoto.updated_at,
        pendente: false,
        conflito: true,
      };
      encontrouConflito = true;
      continue;
    }
    try {
      const atualizadoEm = await salvarMemoriaNoServidor(
        chave,
        item.codigos,
        item.candidatos,
        item.atualizadoEm || null,
      );
      if (!atualizadoEm) continue;
      memoria[chave] = {
        ...item,
        atualizadoEm,
        pendente: false,
        conflito: false,
      };
      remotos.set(chave, {
        offer_key: chave,
        codes: item.codigos,
        candidate_codes: item.candidatos,
        updated_at: atualizadoEm,
      });
    } catch {
      // A escolha continua marcada como pendente para a próxima sincronização.
    }
  }

  for (const item of remotos.values()) {
    const local = memoria[item.offer_key];
    if (local?.pendente || local?.conflito) continue;
    memoria[item.offer_key] = {
      codigos: item.codes,
      candidatos: item.candidate_codes ?? [],
      atualizadoEm: item.updated_at,
      pendente: false,
      conflito: false,
    };
  }
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memoria));
  if (encontrouConflito)
    toast.warning(
      "Há uma correção mais recente em outro computador. O item foi marcado para revisão.",
    );
}

function confirmarMemoriaSincronizada(
  chave: string,
  codigosEnviados: string[],
  candidatosEnviados: string[],
  atualizadoEm: string,
) {
  const memoria = lerMemoria();
  const atual = memoria[chave];
  if (!atual) return;

  if (!mesmosCodigos(atual.codigos, codigosEnviados)) {
    memoria[chave] = { ...atual, pendente: true };
  } else {
    const candidatosAindaSaoOsMesmos = mesmosCodigos(atual.candidatos, candidatosEnviados);
    memoria[chave] = {
      ...atual,
      atualizadoEm,
      pendente: !candidatosAindaSaoOsMesmos,
      conflito: false,
    };
  }
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memoria));
}

async function salvarMemoriaNoServidor(
  chave: string,
  codigos: string[],
  candidatos: string[],
  atualizadoEm: string | null,
): Promise<string | null> {
  const { data: sessao } = await supabase.auth.getUser();
  if (!sessao.user) throw new Error("Sessão expirada");
  const { data, error } = await supabase.rpc("save_offer_match_memory", {
    p_offer_key: chave,
    p_codes: codigos,
    p_candidate_codes: candidatos,
    p_updated_at: atualizadoEm,
  });
  if (error) throw error;
  return typeof data === "string" && data ? data : null;
}

interface Rascunho {
  ofertas: Oferta[];
  nomeArquivo: string;
  carrossel: string;
  ativarEm: string;
  inativarEm: string;
  notaMinima: number;
}

function lerRascunho(): Rascunho | null {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
    return salvo ? (JSON.parse(salvo) as Rascunho) : null;
  } catch {
    return null;
  }
}

export function separarCodigos(valor: unknown, ean = false): string[] {
  return normalizarCodigos([
    String(valor ?? "")
      .split(/[;,|\n]+/)
      .map((codigo) => (ean ? limparEan(codigo) : limparCodigo(codigo)))
      .filter(Boolean)
      .join(";"),
  ]);
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function atualizarComCatalogo(oferta: Oferta, catalogo: Produto[]): Oferta {
  const atualizada = cruzarOferta(
    {
      ...oferta.linhaOrigem,
      PRODUTO: oferta.nome,
      OFERTA: oferta.preco,
      CLUBE: oferta.precoClube,
      LIMITE: oferta.limiteBruto,
    },
    catalogo,
    oferta.nome,
    oferta.excecoes,
  );
  if (!atualizada) return oferta;
  const conferida = { ...atualizada, imagem: oferta.imagem || atualizada.imagem };
  return oferta.codigosEditados ? aplicarMemoria([conferida], catalogo)[0]! : conferida;
}

export function useOfertas() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const rascunho = lerRascunho();
  const tinhaRascunho = useRef(Boolean(rascunho?.ofertas.length));
  const [processando, setProcessando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState(rascunho?.nomeArquivo ?? "");
  const [ofertas, setOfertas] = useState<Oferta[]>(rascunho?.ofertas ?? []);
  const [notaMinima, setNotaMinima] = useState(rascunho?.notaMinima ?? 0.55);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalVisualizacao, setModalVisualizacao] = useState<Oferta | null>(null);
  const [selecaoExpandida, setSelecaoExpandida] = useState(false);
  const [carrossel, setCarrossel] = useState(rascunho?.carrossel ?? "");
  const [ativarEm, setAtivarEm] = useState(rascunho?.ativarEm ?? "");
  const [inativarEm, setInativarEm] = useState(rascunho?.inativarEm ?? "");

  useEffect(() => {
    void sincronizarMemoriaDoServidor().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ofertas.length && !nomeArquivo) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima }),
    );
  }, [ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima]);

  useEffect(() => {
    if (!tinhaRascunho.current) return;
    let ativo = true;
    carregarTodosProdutos()
      .then((catalogo) => {
        if (ativo)
          setOfertas((atuais) => atuais.map((oferta) => atualizarComCatalogo(oferta, catalogo)));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  function alterar(indice: number, mudanca: Partial<Oferta>) {
    const atual = ofertas[indice];
    if (atual && Object.hasOwn(mudanca, "codigos")) {
      const memoria = lerMemoria();
      const codigos = mudanca.codigos ?? [];
      const candidatos = Object.keys(atual.decisoesPorCodigo ?? atual.nomesPorCodigo ?? {});
      const chave = chaveBaseOferta(atual.nome);
      const atualizadoEm = memoria[chave]?.atualizadoEm ?? "";
      memoria[chave] = {
        codigos,
        candidatos,
        atualizadoEm,
        pendente: true,
        conflito: false,
      };
      localStorage.setItem(MEMORY_KEY, JSON.stringify(memoria));
      void salvarMemoriaNoServidor(chave, codigos, candidatos, atualizadoEm || null)
        .then((confirmadoEm) => {
          if (confirmadoEm) confirmarMemoriaSincronizada(chave, codigos, candidatos, confirmadoEm);
          else void sincronizarMemoriaDoServidor();
        })
        .catch(() =>
          toast.warning(
            "A escolha ficou salva neste navegador, mas não foi sincronizada. Tente novamente depois.",
          ),
        );
    }
    setOfertas((atual) =>
      atual.map((oferta, i) => {
        if (i !== indice) return oferta;
        const alterada = {
          ...oferta,
          ...mudanca,
          ...(Object.hasOwn(mudanca, "codigos") ? { codigosEditados: true } : {}),
        };
        return alterada;
      }),
    );
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([
        lerPlanilha(arquivo, { preservarColunaA: true }),
        carregarTodosProdutos(),
        sincronizarMemoriaDoServidor(),
      ]);
      if (!linhas.length)
        throw new Error("A planilha não possui linhas de produtos reconhecíveis.");
      const cruzadas = processarLinhasOfertas(linhas, catalogo);
      if (!cruzadas.length)
        throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");
      const finais = aplicarMemoria(cruzadas, catalogo);

      setOfertas(finais);
      setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter(
        (item) => item.nota >= notaMinima && item.codigos.length > 0,
      ).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({
          user_id: data.user.id,
          file_name: arquivo.name,
          total_items: finais.length,
          matched_items: correspondidas,
        });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(
        `${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado.`,
      );
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha");
    } finally {
      setProcessando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function remover(indice: number) {
    setOfertas((atuais) => atuais.filter((_, i) => i !== indice));
  }

  function limparOfertas() {
    setOfertas([]);
    setNomeArquivo("");
    toast.success("Planilha removida");
  }

  async function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) {
      toast.error("Preencha Carrossel, Ativação automática e Inativar em.");
      return;
    }
    let catalogo: Produto[];
    try {
      catalogo = await carregarTodosProdutos();
    } catch {
      toast.error("Não foi possível conferir os códigos no catálogo. Tente novamente.");
      return;
    }
    const invalidas = ofertas.filter((o) => !validarCodigosNoCatalogo(o, catalogo));
    if (invalidas.length) {
      toast.error(
        invalidas.length + " oferta(s) sem código válido no catálogo. Revise antes de exportar.",
      );
      return;
    }
    const linhas: OfertaParaExportar[] = ofertas.map((oferta) => ({
      name: oferta.nome,
      price: oferta.preco,
      promotionalPrice: oferta.precoClube,
      limit: oferta.limite,
      imageUrl: oferta.imagem,
      code: normalizarCodigos(oferta.codigos.length ? oferta.codigos : [oferta.codigo]).join(";"),
      codeType: oferta.porQuilo ? "Interno" : "EAN",
      unidade: oferta.unidade,
    }));
    exportarModeloDoClube(linhas, {
      carrossel,
      ativarEm: dataParaClube(ativarEm),
      inativarEm: dataParaClube(inativarEm),
    });
    setModalAberto(false);
    toast.success("Planilha do Clube gerada.");
  }

  return {
    campoArquivo,
    processando,
    ofertas,
    notaMinima,
    setNotaMinima,
    nomeArquivo,
    precisamRevisao: ofertas.filter(
      (item) =>
        !item.imagem?.trim() ||
        item.nota < notaMinima ||
        !item.codigos.length ||
        itemComEstoqueZerado(item) ||
        Boolean(item.motivoRevisao),
    ).length,
    alterar,
    remover,
    limparOfertas,
    setModalAberto,
    processar,
    modalAberto,
    carrossel,
    setCarrossel,
    ativarEm,
    setAtivarEm,
    inativarEm,
    setInativarEm,
    exportar,
    modalVisualizacao,
    setModalVisualizacao,
    selecaoExpandida,
    setSelecaoExpandida,
  };
}
