import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, AlertTriangle, ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerPlanilha, valorDoCampo, exportarModeloDoClube, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { melhorCorrespondencia, lerPreco, normalizarTexto } from "@/lib/comparar-textos";
import { buscarImagens, buscarImagensPorProduto } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";

export const Route = createFileRoute("/_authenticated/ofertas")({ head: () => ({ meta: [{ title: "Automação de ofertas — OfertaFlow" }, { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube." }] }), component: PaginaOfertas });

interface Oferta extends RegraOferta {
  nome: string;
  preco: number | null;
  precoClube: number | null;
  limiteBruto: string;
  ean: string;
  codigo: string;
  codigoInterno: string;
  imagem: string;
  encontrado: string | null;
  nota: number;
}

const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];

/** Procura a coluna de limite mesmo quando o arquivo usa outro texto, como "Limite por cliente". */
function valorDeLimite(linha: LinhaPlanilha): string {
  const encontrado = Object.entries(linha).find(([cabecalho, valor]) => {
    const h = normalizarTexto(cabecalho);
    return h.includes("limite") && String(valor ?? "").trim() !== "";
  });
  if (encontrado) return String(encontrado[1]).trim();
  const porNome = valorDoCampo(linha, ["LIMITE", "Limite por CPF", "Limite", "Limite por cliente", "Limite por cliente (CPF)"]);
  return String(porNome || "").trim();
}

/** Evita confundir "Código de barras" com o código operacional da oferta. */
function valorDeCodigo(linha: LinhaPlanilha): string {
  const prioridades = ["Código da promoção", "Cód. Promoção", "Código do produto", "Cód. Interno", "Codigo Interno", "Código Interno", "Código"];
  const valor = valorDoCampo(linha, prioridades);
  return limparCodigo(valor);
}

/**
 * Código curto pode ser compartilhado por vários itens de balança. Nesse caso
 * o código sozinho NÃO escolhe o primeiro produto: o nome desempata entre os
 * candidatos. Isso evita que todos os cortes de carne recebam o mesmo item.
 */
function acharPorCodigo(nome: string, codigo: string, catalogo: Produto[], notaMinima: number): { item: Produto; score: number } | null {
  if (!codigo) return null;
  const alvo = limparCodigo(codigo);
  const candidatos = catalogo.filter((p) => limparCodigo(p.promotion_code) === alvo || limparCodigo(p.internal_code) === alvo);
  if (!candidatos.length) return null;
  if (candidatos.length === 1) return { item: candidatos[0], score: 1 };
  return melhorCorrespondencia(nome, candidatos, Math.min(0.48, notaMinima));
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;

  // Em planilhas de carnes/balança, o campo chamado EAN às vezes contém um
  // código interno curto (ex.: 1718). Só 8+ dígitos podem ser tratados como EAN.
  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigo(linha) || (valorEAN.length > 0 && valorEAN.length < 8 ? valorEAN : "");
  const limiteBruto = valorDeLimite(linha);

  const exatoPorEan = eanOrigem
    ? catalogo.find((p) => limparEan(p.ean) === eanOrigem)
    : undefined;
  const exatoPorCodigo = !exatoPorEan ? acharPorCodigo(nome, codigoOrigem, catalogo, notaMinima) : null;
  const achado = exatoPorEan
    ? { item: exatoPorEan, score: 1 }
    : exatoPorCodigo || melhorCorrespondencia(nome, catalogo, notaMinima);
  const produto = achado?.item;

  const codigoInterno = limparCodigo(produto?.internal_code) || (produto ? "" : codigoOrigem);
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");

  // Para KG o código que interessa é o interno do produto encontrado.
  // Para unidade, o código que interessa na exportação é o EAN.
  const codigoOperacional = limparCodigo(produto?.promotion_code) || limparCodigo(produto?.internal_code) || codigoOrigem;

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)),
    precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limiteBruto,
    ...regras,
    ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigoOperacional,
    codigoInterno,
    imagem: produto?.image_url ?? "",
    encontrado: produto?.description ?? null,
    nota: achado?.score ?? 0,
  };
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function PaginaOfertas() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [processando, setProcessando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [notaMinima, setNotaMinima] = useState(0.55);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalVisualizacao, setModalVisualizacao] = useState<Oferta | null>(null);
  const [carrossel, setCarrossel] = useState("");
  const [ativarEm, setAtivarEm] = useState("");
  const [inativarEm, setInativarEm] = useState("");

  function alterar(indice: number, mudanca: Partial<Oferta>) {
    setOfertas((atual) => atual.map((o, i) => (i === indice ? { ...o, ...mudanca } : o)));
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]);
      if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");

      const cruzadas = linhas.map((l) => cruzar(l, catalogo, notaMinima)).filter((x): x is Oferta => x !== null);
      if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");

      // Cosmos continua sendo a primeira fonte para EAN. Fontes secundárias só
      // entram quando o catálogo não tem imagem.
      const imagens = await buscarImagens(cruzadas.filter((i) => i.ean && !i.imagem).map((i) => i.ean));

      // Para carnes/produtos de balança sem EAN, tenta busca textual separada.
      // O código interno nunca é enviado como se fosse GTIN.
      const imagensPorNome = await buscarImagensPorProduto(
        cruzadas.filter((i) => !i.imagem && !i.ean).map((i) => ({ ean: "", nome: i.nome })),
      );

      const finais = cruzadas.map((item) => ({
        ...item,
        imagem: item.imagem || imagens.get(item.ean) || imagensPorNome.get(item.nome) || "",
      }));

      setOfertas(finais);
      setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter((i) => i.nota >= notaMinima && (i.codigoInterno || i.ean || i.codigo)).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({ user_id: data.user.id, file_name: arquivo.name, total_items: finais.length, matched_items: correspondidas });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com produto/código encontrado.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha");
    } finally {
      setProcessando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) {
      toast.error("Preencha Carrossel, Ativar em e Inativar em.");
      return;
    }

    const linhas: OfertaParaExportar[] = ofertas.map((o) => ({
      name: o.nome,
      price: o.preco,
      promotionalPrice: o.precoClube,
      limit: o.limite,
      imageUrl: o.imagem,
      code: o.porQuilo ? limparCodigo(o.codigoInterno || o.codigo) : limparEan(o.ean),
      codeType: o.porQuilo ? "Interno" : "EAN",
      unidade: o.unidade,
    }));

    try {
      exportarModeloDoClube(linhas, {
        carrossel: carrossel.trim(),
        ativarEm: dataParaClube(ativarEm),
        inativarEm: dataParaClube(inativarEm),
      });
      setModalAberto(false);
      toast.success("Arquivo do Clube gerado e enviado para download.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível gerar o arquivo.");
    }
  }

  const precisamRevisao = ofertas.filter((o) => (!o.codigoInterno && !o.ean && !o.codigo) || !o.imagem || o.nota < notaMinima).length;

  return (
    <AppShell title="Automação de ofertas" subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube.">
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input ref={campoArquivo} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const a = e.target.files?.[0]; if (a) processar(a); }} />
        <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>
          {processando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha da semana
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Sensibilidade</span>
          <Input type="number" min={0.3} max={1} step={0.05} className="w-24" value={notaMinima} onChange={(e) => setNotaMinima(Number(e.target.value) || 0.55)} />
        </div>
        <Button variant="destructive" disabled={!ofertas.length} className="ml-auto" onClick={() => { if (confirm("Excluir a planilha carregada?")) { setOfertas([]); setNomeArquivo(""); toast.success("Planilha removida"); } }}>
          <Trash2 className="size-4" /> Excluir planilha
        </Button>
        <Button variant="outline" disabled={!ofertas.length || processando} onClick={() => setModalAberto(true)}>
          <Download className="size-4" /> Baixar arquivo do Clube
        </Button>
      </div>

      {ofertas.length ? <>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1 font-medium">{nomeArquivo}</span>
          <span className="rounded-full bg-secondary px-3 py-1">{ofertas.length} itens</span>
          {precisamRevisao ? <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground"><AlertTriangle className="size-3.5" /> {precisamRevisao} precisam de revisão</span> : <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Tudo pronto para exportar</span>}
          <span className="text-xs text-muted-foreground">Clique em qualquer item para visualizar.</span>
        </div>

        <div className="surface mt-4 overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Img</TableHead><TableHead>Nome</TableHead><TableHead>Produto encontrado</TableHead><TableHead>Confiança</TableHead><TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Unidade</TableHead><TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{ofertas.map((o, i) => <TableRow
              key={`${o.nome}-${i}`}
              className={`${((!o.codigoInterno && !o.ean && !o.codigo) || !o.imagem || o.nota < notaMinima) ? "bg-warn/40" : ""} cursor-pointer hover:bg-muted/60`}
              onClick={() => setModalVisualizacao(o)}
            >
              <TableCell>{o.imagem ? <img src={o.imagem} alt={o.nome} loading="lazy" className="size-10 rounded-md object-cover" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell className="max-w-64 font-medium">{o.nome}</TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">{o.encontrado || "Não encontrado"}</TableCell>
              <TableCell>{Math.round(o.nota * 100)}%</TableCell>
              <TableCell>{o.preco ?? "—"}</TableCell>
              <TableCell>{o.precoClube ?? "—"}</TableCell>
              <TableCell>{o.limite ?? "—"}</TableCell>
              <TableCell>{o.unidade}</TableCell>
              <TableCell><Input className="w-40" value={o.ean} maxLength={20} onClick={(e) => e.stopPropagation()} onChange={(e) => alterar(i, { ean: limparEan(e.target.value) })} /></TableCell>
              <TableCell><Input className="w-36" value={o.codigo} maxLength={60} onClick={(e) => e.stopPropagation()} onChange={(e) => alterar(i, { codigo: limparCodigo(e.target.value) })} /></TableCell>
              <TableCell><Input className="w-56" value={o.imagem} maxLength={1000} onClick={(e) => e.stopPropagation()} onChange={(e) => alterar(i, { imagem: e.target.value })} /></TableCell>
              <TableCell><Button variant="ghost" size="icon" aria-label="Remover item" onClick={(e) => { e.stopPropagation(); setOfertas((atual) => atual.filter((_, x) => x !== i)); }}><Trash2 className="size-4" /></Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </> : <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.</div>}

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configurar arquivo do Clube</DialogTitle><DialogDescription>Esses dados serão aplicados a todas as ofertas desta planilha.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div><label className="mb-1.5 block text-sm font-medium">Carrossel</label><Input value={carrossel} onChange={(e) => setCarrossel(e.target.value)} placeholder="Ex.: Ofertas da semana" /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Ativar em</label><Input type="datetime-local" step="60" value={ativarEm} onChange={(e) => setAtivarEm(e.target.value)} /></div>
            <div><label className="mb-1.5 block text-sm font-medium">Inativar em</label><Input type="datetime-local" step="60" value={inativarEm} onChange={(e) => setInativarEm(e.target.value)} /></div>
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Check-In: <strong>Não</strong> · Dias para resgate: <strong>1</strong> · App: <strong>Não exigir ativação</strong></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setModalAberto(false)}>Cancelar</Button><Button onClick={exportar}><Download className="size-4" /> Gerar planilha</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!modalVisualizacao} onOpenChange={(aberto) => { if (!aberto) setModalVisualizacao(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{modalVisualizacao?.nome}</DialogTitle><DialogDescription>Conferência completa do item importado.</DialogDescription></DialogHeader>
          {modalVisualizacao && <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted p-3">
              {modalVisualizacao.imagem ? <img src={modalVisualizacao.imagem} alt={modalVisualizacao.nome} className="max-h-52 w-full rounded-lg object-contain" /> : <ImageIcon className="size-10 text-muted-foreground" />}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Produto encontrado</span><p className="font-medium">{modalVisualizacao.encontrado || "Não encontrado"}</p></div>
              <div><span className="text-muted-foreground">Confiança</span><p className="font-medium">{Math.round(modalVisualizacao.nota * 100)}%</p></div>
              <div><span className="text-muted-foreground">Preço</span><p className="font-medium">{modalVisualizacao.preco ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Preço clube</span><p className="font-medium">{modalVisualizacao.precoClube ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Limite lido da planilha</span><p className="font-medium">{modalVisualizacao.limiteBruto || "—"}</p></div>
              <div><span className="text-muted-foreground">Limite para o Clube</span><p className="font-medium">{modalVisualizacao.limite ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Unidade</span><p className="font-medium">{modalVisualizacao.unidade}</p></div>
              <div><span className="text-muted-foreground">Tipo do código</span><p className="font-medium">{modalVisualizacao.porQuilo ? "Interno" : "EAN"}</p></div>
              <div><span className="text-muted-foreground">EAN</span><p className="font-medium">{modalVisualizacao.ean || "—"}</p></div>
              <div><span className="text-muted-foreground">Código interno</span><p className="font-medium">{modalVisualizacao.codigoInterno || "—"}</p></div>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
