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
import { lerPlanilha, valorDoCampo, exportarModeloDoClube, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { melhorCorrespondencia, lerPreco, normalizarTexto, semelhanca } from "@/lib/comparar-textos";
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
  codigos: string[];
  imagem: string;
  encontrado: string | null;
  nota: number;
}

const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];
const OFERTAS_STORAGE_KEY = "ofertaflow:rascunho-ofertas";

const TOKENS_GENERICOS = new Set([
  "kg", "un", "und", "unidade", "pct", "pcte", "cx", "caixa", "fardo", "fd",
  "bov", "bovina", "bovino", "produto", "mercadoria",
]);

function tokensFamilia(valor: string): string[] {
  const texto = normalizarTexto(valor)
    .replace(/(\d+)\s+(ml|l|g|kg)\b/g, "$1$2")
    .replace(/\btrad\b/g, "tradicional");
  return [...new Set(texto.split(" ").filter((t) => t.length >= 2 && !TOKENS_GENERICOS.has(t)))];
}

function produtoContemTokens(descricao: string, tokens: string[]): boolean {
  const desc = tokensFamilia(descricao);
  return tokens.every((token) => desc.includes(token));
}

function separarCodigos(valor: unknown, ean = false): string[] {
  return [...new Set(String(valor ?? "")
    .split(/[,;|\n]+/)
    .map((item) => ean ? limparEan(item) : limparCodigo(item))
    .filter(Boolean))];
}

function valorDeLimite(linha: LinhaPlanilha): string {
  const porNome = valorDoCampo(linha, ["Limite por cliente", "Limite por cliente (CPF)", "Limite por CPF", "LIMITE", "Limite"]);
  if (String(porNome ?? "").trim()) return String(porNome).trim();

  const encontrado = Object.entries(linha).find(([cabecalho, valor]) =>
    normalizarTexto(cabecalho).includes("limite") && String(valor ?? "").trim() !== "",
  );
  return encontrado ? String(encontrado[1]).trim() : "";
}

function valorDeCodigo(linha: LinhaPlanilha): string {
  const campos = Object.entries(linha);
  const prioridades = ["Código da promoção", "Cód. Promoção", "Código do produto", "Cód. Interno", "Codigo Interno", "Código Interno", "Código", "Codigo"];

  for (const prioridade of prioridades) {
    const alvo = normalizarTexto(prioridade);
    const encontrado = campos.find(([cabecalho]) => {
      const h = normalizarTexto(cabecalho);
      if (["ean", "gtin", "codigo de barras", "código de barras"].some((bloqueado) => h.includes(normalizarTexto(bloqueado)))) return false;
      return h === alvo;
    });
    if (encontrado && String(encontrado[1] ?? "").trim()) return limparCodigo(encontrado[1]);
  }
  return "";
}

function acharPorCodigo(nome: string, codigo: string, catalogo: Produto[], notaMinima: number): { item: Produto; score: number } | null {
  if (!codigo) return null;
  const alvo = limparCodigo(codigo);
  const candidatos = catalogo.filter((p) => limparCodigo(p.promotion_code) === alvo || limparCodigo(p.internal_code) === alvo);
  if (!candidatos.length) return null;
  if (candidatos.length === 1) return { item: candidatos[0], score: 1 };
  return melhorCorrespondencia(nome, candidatos, Math.max(0.55, notaMinima));
}

function codigosDaFamilia(nome: string, produto: Produto | undefined, catalogo: Produto[], porQuilo: boolean): string[] {
  if (!produto) return [];
  const tokensOferta = tokensFamilia(nome);
  const codigoPrincipal = porQuilo ? limparCodigo(produto.internal_code) : limparEan(produto.ean);

  if (tokensOferta.length < 3) return codigoPrincipal ? [codigoPrincipal] : [];

  const candidatos = catalogo.filter((item) => {
    if (!produtoContemTokens(item.description, tokensOferta)) return false;
    return porQuilo ? Boolean(limparCodigo(item.internal_code)) : Boolean(limparEan(item.ean));
  });

  const codigos = candidatos
    .map((item) => ({ item, score: semelhanca(nome, item.description) }))
    .filter(({ score }) => score >= 0.55)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => porQuilo ? limparCodigo(item.internal_code) : limparEan(item.ean))
    .filter(Boolean);

  return [...new Set([codigoPrincipal, ...codigos].filter(Boolean))];
}

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;

  const valorEAN = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN", "EAN13"]));
  const eanOrigem = valorEAN.length >= 8 ? valorEAN : "";
  const codigoOrigem = valorDeCodigo(linha) || (valorEAN.length > 0 && valorEAN.length < 8 ? valorEAN : "");
  const limiteBruto = valorDeLimite(linha);

  const exatoPorEan = eanOrigem ? catalogo.find((p) => limparEan(p.ean) === eanOrigem) : undefined;
  const exatoPorCodigo = !exatoPorEan ? acharPorCodigo(nome, codigoOrigem, catalogo, notaMinima) : null;
  const achado = exatoPorEan ? { item: exatoPorEan, score: 1 } : exatoPorCodigo || melhorCorrespondencia(nome, catalogo, notaMinima);
  const produto = achado?.item;

  const codigoInterno = limparCodigo(produto?.internal_code) || (produto ? "" : codigoOrigem);
  const eanProduto = limparEan(produto?.ean) || eanOrigem;
  const regras = aplicarRegras(nome, limiteBruto, codigoInterno, eanProduto, produto?.unit || "");
  const codigos = codigosDaFamilia(nome, produto, catalogo, regras.porQuilo);
  const codigoOperacional = regras.porQuilo
    ? (codigos[0] || limparCodigo(produto?.internal_code) || codigoOrigem)
    : (codigos[0] || limparEan(produto?.ean) || eanOrigem);

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)),
    precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limiteBruto,
    ...regras,
    ean: eanProduto.length >= 8 ? eanProduto : "",
    codigo: codigoOperacional,
    codigoInterno,
    codigos,
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
    const dados: RascunhoOfertas = { ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima };
    sessionStorage.setItem(OFERTAS_STORAGE_KEY, JSON.stringify(dados));
  }, [ofertas, nomeArquivo, carrossel, ativarEm, inativarEm, notaMinima]);

  // Ao voltar do Catálogo, tenta completar somente os dados que estavam faltando.
  // Alterações manuais feitas na Oferta não são sobrescritas.
  useEffect(() => {
    if (!ofertas.length) return;
    let ativo = true;
    carregarTodosProdutos().then((catalogo) => {
      if (!ativo) return;
      setOfertas((atuais) => atuais.map((oferta) => {
        if (oferta.encontrado && oferta.imagem && oferta.codigos.length) return oferta;
        const achado = melhorCorrespondencia(oferta.nome, catalogo, 0.72);
        if (!achado) return oferta;

        const produto = achado.item;
        const codigoInterno = limparCodigo(produto.internal_code);
        const ean = limparEan(produto.ean);
        const regras = aplicarRegras(oferta.nome, oferta.limiteBruto, codigoInterno, ean, produto.unit || "");
        const codigos = oferta.codigos.length ? oferta.codigos : codigosDaFamilia(oferta.nome, produto, catalogo, regras.porQuilo);

        return {
          ...oferta,
          encontrado: oferta.encontrado || produto.description,
          imagem: oferta.imagem || produto.image_url || "",
          codigos,
          ean: oferta.ean || ean,
          codigoInterno: oferta.codigoInterno || codigoInterno,
          codigo: oferta.codigo || codigos[0] || "",
          nota: Math.max(oferta.nota, achado.score),
          porQuilo: oferta.porQuilo,
          unidade: oferta.unidade,
          limite: oferta.limite,
        };
      }));
    }).catch(() => {
      // O rascunho local continua disponível mesmo se o catálogo estiver temporariamente indisponível.
    });
    return () => { ativo = false; };
  }, []);

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

      const eansParaImagem = cruzadas
        .filter((i) => !i.imagem && !i.porQuilo)
        .flatMap((i) => i.codigos.filter((codigo) => codigo.length >= 8));
      const imagens = await buscarImagens(eansParaImagem);
      const imagensPorNome = await buscarImagensPorProduto(
        cruzadas.filter((i) => !i.imagem && i.porQuilo).map((i) => ({ ean: "", nome: i.nome })),
      );

      const finais = cruzadas.map((item) => ({
        ...item,
        imagem: item.imagem
          || item.codigos.map((codigo) => imagens.get(codigo)).find(Boolean)
          || imagensPorNome.get(item.nome)
          || "",
      }));

      setOfertas(finais);
      setNomeArquivo(arquivo.name);
      const correspondidas = finais.filter((i) => i.nota >= notaMinima && (i.codigoInterno || i.ean || i.codigo || i.codigos.length)).length;
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
      code: o.codigos.length
        ? o.codigos.join(", ")
        : (o.porQuilo ? limparCodigo(o.codigoInterno || o.codigo) : limparEan(o.ean)),
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

  const precisamRevisao = ofertas.filter((o) => (!o.codigoInterno && !o.ean && !o.codigo && !o.codigos.length) || !o.imagem || o.nota < notaMinima).length;

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
            <TableHeader><TableRow><TableHead>Img</TableHead><TableHead>Nome</TableHead><TableHead>Produto encontrado</TableHead><TableHead>Confiança</TableHead><TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Tipo de produto</TableHead><TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>{ofertas.map((o, i) => <TableRow
              key={`${o.nome}-${i}`}
              className={`${((!o.codigoInterno && !o.ean && !o.codigo && !o.codigos.length) || !o.imagem || o.nota < notaMinima) ? "bg-warn/40" : ""} cursor-pointer hover:bg-muted/60`}
              onClick={() => setModalVisualizacao(o)}
            >
              <TableCell>{o.imagem ? <img src={o.imagem} alt={o.nome} loading="lazy" className="size-10 rounded-md object-contain bg-white" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell className="max-w-64 font-medium">{o.nome}</TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">{o.encontrado || "Não encontrado"}</TableCell>
              <TableCell>{Math.round(o.nota * 100)}%</TableCell>
              <TableCell>{o.preco ?? "—"}</TableCell>
              <TableCell>{o.precoClube ?? "—"}</TableCell>
              <TableCell>{o.limite ?? "—"}</TableCell>
              <TableCell>{o.unidade}</TableCell>
              <TableCell>
                {!o.porQuilo ? (
                  <Input className="w-56" value={o.codigos.join(", ")} onClick={(e) => e.stopPropagation()} onChange={(e) => { const codigos = separarCodigos(e.target.value, true); alterar(i, { codigos, ean: codigos[0] || "" }); }} />
                ) : "—"}
              </TableCell>
              <TableCell>
                {o.porQuilo ? (
                  <Input className="w-48" value={o.codigos.join(", ")} onClick={(e) => e.stopPropagation()} onChange={(e) => { const codigos = separarCodigos(e.target.value); alterar(i, { codigos, codigo: codigos[0] || "" }); }} />
                ) : "—"}
              </TableCell>
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
              {modalVisualizacao.imagem ? <img src={modalVisualizacao.imagem} alt={modalVisualizacao.nome} className="max-h-52 w-full rounded-lg object-contain bg-white" /> : <ImageIcon className="size-10 text-muted-foreground" />}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Produto encontrado</span><p className="font-medium">{modalVisualizacao.encontrado || "Não encontrado"}</p></div>
              <div><span className="text-muted-foreground">Confiança</span><p className="font-medium">{Math.round(modalVisualizacao.nota * 100)}%</p></div>
              <div><span className="text-muted-foreground">Preço</span><p className="font-medium">{modalVisualizacao.preco ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Preço clube</span><p className="font-medium">{modalVisualizacao.precoClube ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Limite lido da planilha</span><p className="font-medium">{modalVisualizacao.limiteBruto || "—"}</p></div>
              <div><span className="text-muted-foreground">Limite para o Clube</span><p className="font-medium">{modalVisualizacao.limite ?? "—"}</p></div>
              <div><span className="text-muted-foreground">Tipo de produto</span><p className="font-medium">{modalVisualizacao.unidade}</p></div>
              <div><span className="text-muted-foreground">Tipo do código</span><p className="font-medium">{modalVisualizacao.porQuilo ? "Interno" : "EAN"}</p></div>
              <div><span className="text-muted-foreground">{modalVisualizacao.porQuilo ? "Códigos internos" : "EANs"}</span><p className="font-medium break-words">{modalVisualizacao.codigos.join(", ") || "—"}</p></div>
            </div>
          </div>}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
