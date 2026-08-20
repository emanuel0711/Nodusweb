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
import { melhorCorrespondencia, lerPreco } from "@/lib/comparar-textos";
import { buscarImagens } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";

export const Route = createFileRoute("/_authenticated/ofertas")({ head: () => ({ meta: [{ title: "Automação de ofertas — OfertaFlow" }, { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube." }] }), component: PaginaOfertas });

interface Oferta extends RegraOferta { nome: string; preco: number | null; precoClube: number | null; limiteBruto: string; ean: string; codigo: string; imagem: string; encontrado: string | null; nota: number; }
const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];
const LIMITES = ["LIMITE", "Limite por CPF", "Limite", "Limite por cliente"];

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim(); if (!nome) return null;
  const ean = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN"]));
  const codigo = limparCodigo(valorDoCampo(linha, ["Código da promoção", "Cód. Promoção", "Cód. Interno", "Codigo Interno", "Código"]));
  const limiteBruto = String(valorDoCampo(linha, LIMITES) || "").trim();
  const exato = (ean && catalogo.find((p) => limparEan(p.ean) === ean)) || (codigo && catalogo.find((p) => limparCodigo(p.promotion_code) === codigo || limparCodigo(p.internal_code) === codigo)) || undefined;
  const achado = exato ? { item: exato, score: 1 } : melhorCorrespondencia(nome, catalogo, notaMinima); const produto = achado?.item;
  const regras = aplicarRegras(nome, limiteBruto, limparCodigo(produto?.internal_code) || codigo, limparEan(produto?.ean) || ean);
  return { nome, preco: lerPreco(valorDoCampo(linha, PRECOS)), precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)), limiteBruto, ...regras, ean: limparEan(produto?.ean) || ean, codigo: limparCodigo(produto?.promotion_code) || limparCodigo(produto?.internal_code) || codigo, imagem: produto?.image_url ?? "", encontrado: produto?.description ?? null, nota: achado?.score ?? 0 };
}

function dataParaClube(valor: string): string {
  if (!valor) return "";
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(data.getDate())}/${p(data.getMonth() + 1)}/${data.getFullYear()} ${p(data.getHours())}:${p(data.getMinutes())}:00`;
}

function PaginaOfertas() {
  const queryClient = useQueryClient(); const campoArquivo = useRef<HTMLInputElement>(null);
  const [processando, setProcessando] = useState(false); const [nomeArquivo, setNomeArquivo] = useState(""); const [ofertas, setOfertas] = useState<Oferta[]>([]); const [notaMinima, setNotaMinima] = useState(0.62);
  const [modalAberto, setModalAberto] = useState(false); const [carrossel, setCarrossel] = useState(""); const [ativarEm, setAtivarEm] = useState(""); const [inativarEm, setInativarEm] = useState("");
  function alterar(indice: number, mudanca: Partial<Oferta>) { setOfertas((atual) => atual.map((o, i) => i === indice ? { ...o, ...mudanca } : o)); }
  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]); if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");
      const cruzadas = linhas.map((l) => cruzar(l, catalogo, notaMinima)).filter((x): x is Oferta => x !== null); if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");
      const imagens = await buscarImagens(cruzadas.filter((i) => i.ean && !i.imagem).map((i) => i.ean)); const finais = cruzadas.map((item) => ({ ...item, imagem: item.imagem || imagens.get(item.ean) || "" }));
      setOfertas(finais); setNomeArquivo(arquivo.name); const correspondidas = finais.filter((i) => i.nota >= notaMinima && (i.codigo || i.ean)).length; const { data } = await supabase.auth.getUser();
      if (data.user) { await supabase.from("offer_runs").insert({ user_id: data.user.id, file_name: arquivo.name, total_items: finais.length, matched_items: correspondidas }); queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }); }
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado.`);
    } catch (erro) { toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha"); } finally { setProcessando(false); if (campoArquivo.current) campoArquivo.current.value = ""; }
  }
  function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) { toast.error("Preencha Carrossel, Ativar em e Inativar em."); return; }
    const linhas: OfertaParaExportar[] = ofertas.map((o) => ({ name: o.nome, price: o.preco, promotionalPrice: o.precoClube, limit: o.limite, imageUrl: o.imagem, code: o.porQuilo ? limparCodigo(o.codigo) : limparEan(o.ean), codeType: o.porQuilo ? "Interno" : "EAN", unidade: o.unidade }));
    try { exportarModeloDoClube(linhas, { carrossel: carrossel.trim(), ativarEm: dataParaClube(ativarEm), inativarEm: dataParaClube(inativarEm) }); setModalAberto(false); toast.success("Arquivo do Clube gerado e enviado para download."); } catch (erro) { toast.error(erro instanceof Error ? erro.message : "Não foi possível gerar o arquivo."); }
  }
  const precisamRevisao = ofertas.filter((o) => (!o.codigo && !o.ean) || !o.imagem || o.nota < notaMinima).length;
  return <AppShell title="Automação de ofertas" subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube.">
    <div className="surface flex flex-wrap items-center gap-3 p-5">
      <input ref={campoArquivo} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const a = e.target.files?.[0]; if (a) processar(a); }} />
      <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>{processando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha da semana</Button>
      <div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Sensibilidade</span><Input type="number" min={0.3} max={1} step={0.05} className="w-24" value={notaMinima} onChange={(e) => setNotaMinima(Number(e.target.value) || 0.62)} /></div>
      <Button variant="destructive" disabled={!ofertas.length} className="ml-auto" onClick={() => { if (confirm("Excluir a planilha carregada?")) { setOfertas([]); setNomeArquivo(""); toast.success("Planilha removida"); } }}><Trash2 className="size-4" /> Excluir planilha</Button>
      <Button variant="outline" disabled={!ofertas.length || processando} onClick={() => setModalAberto(true)}><Download className="size-4" /> Baixar arquivo do Clube</Button>
    </div>
    {ofertas.length ? <>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm"><span className="rounded-full bg-secondary px-3 py-1 font-medium">{nomeArquivo}</span><span className="rounded-full bg-secondary px-3 py-1">{ofertas.length} itens</span>{precisamRevisao ? <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground"><AlertTriangle className="size-3.5" /> {precisamRevisao} precisam de revisão</span> : <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Tudo pronto para exportar</span>}</div>
      <div className="surface mt-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Img</TableHead><TableHead>Nome</TableHead><TableHead>Produto encontrado</TableHead><TableHead>Confiança</TableHead><TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Unidade</TableHead><TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead><TableHead /></TableRow></TableHeader><TableBody>{ofertas.map((o, i) => <TableRow key={`${o.nome}-${i}`} className={(!o.codigo && !o.ean) || !o.imagem || o.nota < notaMinima ? "bg-warn/40" : ""}>
        <TableCell>{o.imagem ? <img src={o.imagem} alt={o.nome} loading="lazy" className="size-10 rounded-md object-cover" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell><TableCell className="max-w-64 font-medium">{o.nome}</TableCell><TableCell className="max-w-72 text-xs text-muted-foreground">{o.encontrado || "Não encontrado"}</TableCell><TableCell>{Math.round(o.nota * 100)}%</TableCell><TableCell>{o.preco ?? "—"}</TableCell><TableCell>{o.precoClube ?? "—"}</TableCell><TableCell>{o.limite ?? "—"}</TableCell><TableCell>{o.unidade}</TableCell><TableCell><Input className="w-40" value={o.ean} maxLength={20} onChange={(e) => alterar(i, { ean: limparEan(e.target.value) })} /></TableCell><TableCell><Input className="w-36" value={o.codigo} maxLength={60} onChange={(e) => alterar(i, { codigo: limparCodigo(e.target.value) })} /></TableCell><TableCell><Input className="w-56" value={o.imagem} maxLength={1000} onChange={(e) => alterar(i, { imagem: e.target.value })} /></TableCell><TableCell><Button variant="ghost" size="icon" aria-label="Remover item" onClick={() => setOfertas((atual) => atual.filter((_, x) => x !== i))}><Trash2 className="size-4" /></Button></TableCell>
      </TableRow>)}</TableBody></Table></div>
    </> : <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.</div>}
    <Dialog open={modalAberto} onOpenChange={setModalAberto}><DialogContent><DialogHeader><DialogTitle>Configurar arquivo do Clube</DialogTitle><DialogDescription>Esses dados serão aplicados a todas as ofertas desta planilha.</DialogDescription></DialogHeader><div className="space-y-4 py-2">
      <div><label className="mb-1.5 block text-sm font-medium">Carrossel</label><Input value={carrossel} onChange={(e) => setCarrossel(e.target.value)} placeholder="Ex.: Ofertas da semana" /></div>
      <div><label className="mb-1.5 block text-sm font-medium">Ativar em</label><Input type="datetime-local" step="60" value={ativarEm} onChange={(e) => setAtivarEm(e.target.value)} /></div>
      <div><label className="mb-1.5 block text-sm font-medium">Inativar em</label><Input type="datetime-local" step="60" value={inativarEm} onChange={(e) => setInativarEm(e.target.value)} /></div>
      <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Check-In: <strong>Não</strong> · Dias para resgate: <strong>1</strong> · App: <strong>Não exigir ativação</strong></div>
    </div><DialogFooter><Button variant="outline" onClick={() => setModalAberto(false)}>Cancelar</Button><Button onClick={exportar}><Download className="size-4" /> Gerar planilha</Button></DialogFooter></DialogContent></Dialog>
  </AppShell>;
}
