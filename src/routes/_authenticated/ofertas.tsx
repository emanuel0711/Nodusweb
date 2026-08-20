import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, AlertTriangle, ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerPlanilha, valorDaColuna, valorDoCampo, exportarModeloDoClube, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { melhorCorrespondencia, lerPreco } from "@/lib/comparar-textos";
import { buscarImagens, buscarImagensPorProduto } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";
import { aplicarRegras, type RegraOferta } from "@/lib/regras-oferta";
import { codigosDaFamiliaOferta, extrairExcecoes, normalizarCodigos } from "@/lib/codigos-oferta";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({ meta: [{ title: "Automação de ofertas — OfertaFlow" }, { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube." }] }),
  component: PaginaOfertas,
});

interface Oferta extends RegraOferta {
  nome: string;
  preco: number | null;
  precoClube: number | null;
  limiteBruto: string;
  ean: string;
  codigo: string;
  codigoInterno: string;
  codigos: string[];
  codigosEditados?: boolean;
  excecoes: string[][];
  imagem: string;
  encontrado: string | null;
  nota: number;
}

const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];
const OFERTAS_STORAGE_KEY = "ofertaflow:rascunho-ofertas";

const CARROSSEIS = [
  "6431 - Promoções",
  "6432 - Pra Você",
  "13533 - Hortifruti",
  "14036 - TERÇA DAS BEBIDAS",
  "13715 - SUPER SABADO",
  "6433 - Especial",
  "6434 - Cashback",
] as const;

function separarCodigos(valor: unknown, ean = false): string[] {
  return normalizarCodigos([
    String(valor ?? "")
      .split(/[;,|\n]+/)
      .map((codigo) => ean ? limparEan(codigo) : limparCodigo(codigo))
      .filter(Boolean)
      .join(";"),
  ]);
}

function valorDeLimite(linha: LinhaPlanilha): string {
  return String(valorDoCampo(linha, [
    "Limite por cliente",
    "Limite por cliente (CPF)",
    "Limite por CPF",
    "Limite cliente",
    "Limite por pessoa",
    "Qtd. limite",
    "Quantidade limite",
    "LIMITE",
    "Limite",
  ]) ?? "").trim();
}

function pareceCodigoNumerico(valor: unknown): boolean {
  const texto = String(valor ?? "").trim();
  if (!texto) return false;
  return texto.split(/[;,|\n]+/).every((parte) => /^\d{1,14}$/.test(parte.trim()));
}

function valorDeCodigo(linha: LinhaPlanilha): string {
  const prioridades = [
    "Código da promoção", "Cód. Promoção", "Código do produto",
    "Cód. Interno", "Codigo Interno", "Código Interno", "Código", "Codigo", "Cod.", "Cod",
  ];

  for (const prioridade of prioridades) {
    const alvo = prioridade.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const encontrado = Object.entries(linha).find(([cabecalho, valor]) => {
      const h = cabecalho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (/ean|gtin|codigo de barras/.test(h)) return false;
      return h === alvo && String(valor ?? "").trim() !== "";
    });
    if (encontrado) return limparCodigo(encontrado[1]);
  }

  // Nos CSVs do mercado, a coluna A é removida em lerPlanilha; portanto,
  // o primeiro valor ativo é a antiga coluna B, onde fica o código útil.
  const primeiraColunaAtiva = valorDaColuna(linha, 0);
  return pareceCodigoNumerico(primeiraColunaAtiva) ? limparCodigo(primeiraColunaAtiva) : "";
}

function acharPorCodigo(nome: string, codigo: string, catalogo: Produto[], notaMinima: number): { item: Produto; score: number } | null {
  if (!codigo) return null;
  const codigos = separarCodigos(codigo);
  for (const alvo of codigos) {
    const candidatos = catalogo.filter((p) => limparCodigo(p.promotion_code) === alvo || limparCodigo(p.internal_code) === alvo);
    if (candidatos.length === 1) return { item: candidatos[0], score: 1 };
    if (candidatos.length > 1) {
      const achado = melhorCorrespondencia(nome, candidatos, Math.max(0.55, notaMinima));
      if (achado) return achado;
    }
  }
  return null;
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;

  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigo(linha) || (valorEAN.length > 0 && valorEAN.length < 8 ? valorEAN : "");
  const limiteBruto = valorDeLimite(linha);
  const excecoes = extrairExcecoes(linha, nome);

  const exatoPorEan = eanOrigem ? catalogo.find((p) => limparEan(p.ean) === eanOrigem) : undefined;
  const exatoPorCodigo = !exatoPorEan ? acharPorCodigo(nome, codigoOrigem, catalogo, notaMinima) : null;
  const achado = exatoPorEan ? { item: exatoPorEan, score: 1 } : exatoPorCodigo || melhorCorrespondencia(nome, catalogo, notaMinima);
  const produto = achado?.item;

  const codigoInterno = limparCodigo(produto?.internal_code) || (produto ? "" : codigoOrigem);
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");
  const codigos = normalizarCodigos(codigosDaFamiliaOferta(nome, produto, catalogo, regras.porQuilo, excecoes));

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)),
    precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limiteBruto,
    ...regras,
    ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigos.join(";"),
    codigoInterno,
    codigos,
    codigosEditados: false,
    excecoes,
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

interface RascunhoOfertas {
  ofertas: Oferta[];
  nomeArquivo: string;
  carrossel: string;
  ativarEm: string;
  inativarEm: string;
  notaMinima: number;
}

function lerRascunho(): RascunhoOfertas | null {
  try {
    const salvo = sessionStorage.getItem(OFERTAS_STORAGE_KEY);
    return salvo ? JSON.parse(salvo) as RascunhoOfertas : null;
  } catch {
    return null;
  }
}

function PaginaOfertas() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const rascunho = lerRascunho();
  const [processando, setProcessando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState(rascunho?.nomeArquivo ?? "");
  const [ofertas, setOfertas] = useState<Oferta[]>(rascunho?.ofertas ?? []);
  const [notaMinima, setNotaMinima] = useState(rascunho?.notaMinima ?? 0.55);
  const [modalAberto, setModalAberto] = useState(false);
  const [modalVisualizacao, setModalVisualizacao] = useState<Oferta | null>(null);
  const [carrossel, setCarrossel] = useState(rascunho?.carrossel ?? "");
  const [ativarEm, setAtivarEm] = useState(rascunho?.ativarEm ?? "");
  const [inativarEm, setInativarEm] = useState(rascunho?.inativarEm ?? "");

  useEffect(() => {
    if (!ofertas.length && !nomeArquivo) {
      sessionStorage.removeItem(OFERTAS_STORAGE_KEY);
      return;
    }
    sessionStorage.setItem(OFERTAS_STORAGE_KEY, JSON.stringify({ ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima }));
  }, [ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima]);

  useEffect(() => {
    if (!ofertas.length) return;
    let ativo = true;
    carregarTodosProdutos().then((catalogo) => {
      if (!ativo) return;
      setOfertas((atuais) => atuais.map((oferta) => {
        const achado = melhorCorrespondencia(oferta.nome, catalogo, 0.72);
        if (!achado) return oferta;
        const produto = achado.item;
        const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, limparCodigo(produto.internal_code), limparEan(produto.ean), produto.unit || "");
        const descobertos = codigosDaFamiliaOferta(oferta.nome, produto, catalogo, regras.porQuilo, oferta.excecoes || []);
        const codigos = oferta.codigosEditados
          ? normalizarCodigos(oferta.codigos || [])
          : normalizarCodigos(descobertos);
        return {
          ...oferta,
          encontrado: oferta.encontrado || produto.description,
          imagem: oferta.imagem || produto.image_url || "",
          codigos,
          codigo: codigos.join(";"),
          ean: oferta.ean || limparEan(produto.ean),
          codigoInterno: oferta.codigoInterno || limparCodigo(produto.internal_code),
          nota: Math.max(oferta.nota, achado.score),
          porQuilo: regras.porQuilo,
          unidade: regras.unidade,
          limite: regras.limite,
          limiteBruto: oferta.limiteBruto,
        };
      }));
    }).catch(() => {});
    return () => { ativo = false; };
  }, []);

  function alterar(indice: number, mudanca: Partial<Oferta>) {
    setOfertas((atual) => atual.map((o, i) => (i === indice
      ? { ...o, ...mudanca, ...(Object.prototype.hasOwnProperty.call(mudanca, "codigos") ? { codigosEditados: true } : {}) }
      : o)));
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]);
      if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");

      const cruzadas = linhas.map((linha) => cruzar(linha, catalogo, notaMinima)).filter((item): item is Oferta => item !== null);
      if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");

      const eansParaImagem = cruzadas.filter((i) => !i.imagem && !i.porQuilo).flatMap((i) => i.codigos.filter((codigo) => codigo.length >= 8));
      const imagens = await buscarImagens(eansParaImagem);
      const imagensPorNome = await buscarImagensPorProduto(cruzadas.filter((i) => !i.imagem && i.porQuilo).map((i) => ({ ean: "", nome: i.nome })));

      const finais = cruzadas.map((item) => ({
        ...item,
        imagem: item.imagem || item.codigos.map((codigo) => imagens.get(codigo)).find(Boolean) || imagensPorNome.get(item.nome) || "",
      }));

      setOfertas(finais);
      setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter((i) => i.nota >= notaMinima && i.codigos.length > 0).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({ user_id: data.user.id, file_name: arquivo.name, total_items: finais.length, matched_items: correspondidas });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha");
    } finally {
      setProcessando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function exportar() {
    if (!ofertas.length || !carrossel.trim() || !ativarEm || !inativarEm) {
      toast.error("Preencha Carrossel, Ativação automática e Inativar em.");
      return;
    }

    const linhas: OfertaParaExportar[] = ofertas.map((o) => ({
      name: o.nome,
      price: o.preco,
      promotionalPrice: o.precoClube,
      limit: o.limite,
      imageUrl: o.imagem,
      code: normalizarCodigos(o.codigos.length ? o.codigos : [o.codigo]).join(";"),
      codeType: o.porQuilo ? "Interno" : "EAN",
      unidade: o.unidade,
    }));

    try {
      exportarModeloDoClube(linhas, { carrossel: carrossel.trim(), ativarEm: dataParaClube(ativarEm), inativarEm: dataParaClube(inativarEm) });
      setModalAberto(false);
      toast.success("Arquivo do Clube gerado e enviado para download.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível gerar o arquivo.");
    }
  }

  const precisamRevisao = ofertas.filter((o) => !o.codigos.length || !o.imagem || o.nota < notaMinima).length;

  return (
    <AppShell title="Automação de ofertas" subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube.">
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input ref={campoArquivo} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) processar(arquivo); }} />
        <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>{processando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha da semana</Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Sensibilidade</span><Input type="number" min={0.3} max={1} step={0.05} className="w-24" value={notaMinima} onChange={(e) => setNotaMinima(Number(e.target.value) || 0.55)} /></div>
        <Button variant="destructive" disabled={!ofertas.length} className="ml-auto" onClick={() => { if (confirm("Excluir a planilha carregada?")) { setOfertas([]); setNomeArquivo(""); toast.success("Planilha removida"); } }}><Trash2 className="size-4" /> Excluir planilha</Button>
        <Button variant="outline" disabled={!ofertas.length || processando} onClick={() => setModalAberto(true)}><Download className="size-4" /> Baixar arquivo do Clube</Button>
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
            <TableHeader><TableRow><TableHead>Img</TableHead><TableHead>Nome</TableHead><TableHead>Produto encontrado</TableHead><TableHead>Confiança</TableHead><TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Tipo de produto</TableHead><TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{ofertas.map((o, i) => <TableRow key={`${o.nome}-${i}`} className={`${(!o.codigos.length || !o.imagem || o.nota < notaMinima) ? "bg-warn/40" : ""} cursor-pointer hover:bg-muted/60`} onClick={(e) => { const target = e.target as HTMLElement; if (target.closest("input,button")) return; setModalVisualizacao(o); }}>
              <TableCell>{o.imagem ? <img src={o.imagem} alt={o.nome} loading="lazy" className="size-10 rounded-md object-contain bg-white" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell className="max-w-64 font-medium">{o.nome}</TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">{o.encontrado || "Não encontrado"}</TableCell>
              <TableCell>{Math.round(o.nota * 100)}%</TableCell>
              <TableCell>{o.preco ?? "—"}</TableCell>
              <TableCell>{o.precoClube ?? "—"}</TableCell>
              <TableCell>{o.limite ?? "—"}</TableCell>
              <TableCell>{o.unidade}</TableCell>
              <TableCell>{!o.porQuilo ? <Input className="w-64" value={o.codigos.join(";")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onChange={(e) => { const codigos = separarCodigos(e.target.value, true); alterar(i, { codigos, ean: codigos[0] || "", codigo: codigos.join(";") }); }} /> : "—"}</TableCell>
              <TableCell>{o.porQuilo ? <Input className="w-64" value={o.codigos.join(";")} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onChange={(e) => { const codigos = separarCodigos(e.target.value); alterar(i, { codigos, codigo: codigos.join(";") }); }} /> : "—"}</TableCell>
              <TableCell><Input className="w-64" value={o.imagem} maxLength={1000} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onChange={(e) => alterar(i, { imagem: e.target.value })} /></TableCell>
              <TableCell><Button variant="ghost" size="icon" aria-label="Remover item" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setOfertas((atual) => atual.filter((_, x) => x !== i)); }}><Trash2 className="size-4" /></Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </> : <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.</div>}

      <Dialog open={modalAberto} onOpenChange={setModalAberto}>
        <DialogContent>
          <DialogHeader><DialogTitle>Configurar arquivo do Clube</DialogTitle><DialogDescription>Escolha o carrossel e defina o período da oferta. A ativação usa data e hora.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Carrossel</label>
              <select
                value={carrossel}
                onChange={(e) => setCarrossel(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Selecione um carrossel</option>
                {CARROSSEIS.map((opcao) => <option key={opcao} value={opcao}>{opcao}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Ativação automática</label>
              <Input type="datetime-local" step="60" value={ativarEm} onChange={(e) => setAtivarEm(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">A oferta será ativada automaticamente na data e hora escolhidas.</p>
            </div>
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
            <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted p-3">{modalVisualizacao.imagem ? <img src={modalVisualizacao.imagem} alt={modalVisualizacao.nome} className="max-h-52 w-full rounded-lg object-contain bg-white" /> : <ImageIcon className="size-10 text-muted-foreground" />}</div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Produto encontrado</span><p className="font-medium">{modalVisualizacao.encontrado || "Não encontrado"}</p></div>
              <div><span className="text-muted-foreground">Confiança</span><p className="font-medium">{Math.round(modalVisualizacao.nota * 100)}%</p></div>
              <div><span className="text-muted-foreground">Preço</span><p className="font-medium">{modalVisualizacao.preco ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Preço clube</span><p className="font-medium">{modalVisualizacao.precoClube ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Limite lido da planilha</span><p className="font-medium">{modalVisualizacao.limiteBruto || "—"}</p></div>
              <div><span className="text-muted-foreground">Limite para o Clube</span><p className="font-medium">{modalVisualizacao.limite ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Tipo de produto</span><p className="font-medium">{modalVisualizacao.unidade}</p></div>
              <div><span className="text-muted-foreground">Tipo do código</span><p className="font-medium">{modalVisualizacao.porQuilo ? "Interno" : "EAN"}</p></div>
              <div className="sm:col-span-2"><span className="text-muted-foreground">Códigos gerados</span><p className="font-medium break-words">{modalVisualizacao.codigos.join(";") || "—"}</p></div>
              {modalVisualizacao.excecoes.length > 0 && <div className="sm:col-span-2"><span className="text-muted-foreground">Exceções detectadas</span><p className="font-medium break-words">{modalVisualizacao.excecoes.map((e) => e.join(" ")).join(" | ")}</p></div>}
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
