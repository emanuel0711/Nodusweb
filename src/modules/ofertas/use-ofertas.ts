import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportarModeloDoClube, lerPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { normalizarCodigos } from "@/lib/codigos-oferta";

import {
  processarLinhasOfertas,
  cruzarOferta,
  validarCodigosNoCatalogo,
  type Oferta,
} from "./processar-ofertas";
export type { Oferta } from "./processar-ofertas";
export { agruparOfertasIrmas } from "./processar-ofertas";

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
    const salvo = sessionStorage.getItem(STORAGE_KEY);
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
  if (oferta.codigosEditados) return oferta;
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
  return atualizada ? { ...atualizada, imagem: oferta.imagem || atualizada.imagem } : oferta;
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
    if (!ofertas.length && !nomeArquivo) {
      sessionStorage.removeItem(STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(
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
    setOfertas((atual) =>
      atual.map((oferta, i) =>
        i === indice
          ? {
              ...oferta,
              ...mudanca,
              ...(Object.hasOwn(mudanca, "codigos") ? { codigosEditados: true } : {}),
            }
          : oferta,
      ),
    );
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([
        lerPlanilha(arquivo, { preservarColunaA: true }),
        carregarTodosProdutos(),
      ]);
      if (!linhas.length)
        throw new Error("A planilha não possui linhas de produtos reconhecíveis.");
      const cruzadas = processarLinhasOfertas(linhas, catalogo);
      if (!cruzadas.length)
        throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");
      const finais = cruzadas;

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
      (item) => item.nota < notaMinima || !item.codigos.length || Boolean(item.motivoRevisao),
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
