import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Download, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CARROSSEIS, separarCodigos, useOfertas } from "@/modules/ofertas/use-ofertas";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({ meta: [
    { title: "Automação de ofertas — OfertaFlow" },
    { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube." },
  ] }),
  component: PaginaOfertas,
});

function PaginaOfertas() {
  const oferta = useOfertas();
  return (
    <AppShell title="Automação de ofertas" subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube.">
      <BarraAcao {...oferta} />
      {oferta.ofertas.length ? <TabelaOfertas {...oferta} /> : <EmptyState />}
      <DialogExportacao {...oferta} />
      <DialogVisualizacao {...oferta} />
    </AppShell>
  );
}

function BarraAcao({ campoArquivo, processando, ofertas, notaMinima, setNotaMinima, nomeArquivo, precisamRevisao, limparOfertas, setModalAberto, processar }: ReturnType<typeof useOfertas>) {
  return (
    <>
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input ref={campoArquivo} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(e) => { const arquivo = e.target.files?.[0]; if (arquivo) void processar(arquivo); }} />
        <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>
          {processando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha da semana
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Sensibilidade</span>
          <Input type="number" min={0.3} max={1} step={0.05} className="w-24" value={notaMinima} onChange={(e) => setNotaMinima(Number(e.target.value) || 0.55)} />
        </div>
        <Button variant="destructive" disabled={!ofertas.length} className="ml-auto" onClick={() => { if (confirm("Excluir a planilha carregada?")) limparOfertas(); }}>
          <Trash2 className="size-4" /> Excluir planilha
        </Button>
        <Button variant="outline" disabled={!ofertas.length || processando} onClick={() => setModalAberto(true)}>
          <Download className="size-4" /> Baixar arquivo do Clube
        </Button>
      </div>
      {ofertas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1 font-medium">{nomeArquivo}</span>
          <span className="rounded-full bg-secondary px-3 py-1">{ofertas.length} itens</span>
          {precisamRevisao ? <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground"><AlertTriangle className="size-3.5" /> {precisamRevisao} precisam de revisão</span> : <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Tudo pronto para exportar</span>}
          <span className="text-xs text-muted-foreground">Clique em qualquer item para visualizar.</span>
        </div>
      )}
    </>
  );
}

function TabelaOfertas({ ofertas, notaMinima, alterar, setModalVisualizacao }: ReturnType<typeof useOfertas>) {
  return (
    <div className="surface mt-4 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Img</TableHead><TableHead>Nome</TableHead><TableHead>Produto encontrado</TableHead><TableHead>Confiança</TableHead>
          <TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Tipo de produto</TableHead>
          <TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead><TableHead />
        </TableRow></TableHeader>
        <TableBody>
          {ofertas.map((item, index) => (
            <TableRow key={`${item.nome}-${index}`} className={`${(!item.codigos.length || !item.imagem || item.nota < notaMinima) ? "bg-warn/40" : ""} cursor-pointer hover:bg-muted/60`} onClick={(e) => {
              if ((e.target as HTMLElement).closest("input,button")) return;
              setModalVisualizacao(item);
            }}>
              <TableCell>{item.imagem ? <img src={item.imagem} alt={item.nome} loading="lazy" className="size-10 rounded-md object-contain bg-white" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell className="max-w-64 font-medium">{item.nome}</TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">{item.encontrado || "Não encontrado"}</TableCell>
              <TableCell>{Math.round(item.nota * 100)}%</TableCell>
              <TableCell>{item.preco ?? "—"}</TableCell>
              <TableCell>{item.precoClube ?? "—"}</TableCell>
              <TableCell>{item.limite ?? "—"}</TableCell>
              <TableCell>{item.unidade}</TableCell>
              <TableCell>{!item.porQuilo && <CodigoInput value={item.codigos.join(";")} onChange={(value) => { const codigos = separarCodigos(value, true); alterar(index, { codigos, ean: codigos[0] || "", codigo: codigos.join(";") }); }} />}</TableCell>
              <TableCell>{item.porQuilo && <CodigoInput value={item.codigos.join(";")} onChange={(value) => { const codigos = separarCodigos(value); alterar(index, { codigos, codigo: codigos.join(";") }); }} />}</TableCell>
              <TableCell><CodigoInput value={item.imagem} maxLength={1000} onChange={(imagem) => alterar(index, { imagem })} /></TableCell>
              <TableCell><Button variant="ghost" size="icon" aria-label="Remover item" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}><Trash2 className="size-4" /></Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CodigoInput({ value, onChange, maxLength }: { value: string; onChange: (value: string) => void; maxLength?: number }) {
  return <Input className="w-64" value={value} maxLength={maxLength} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onChange={(e) => onChange(e.target.value)} />;
}

function EmptyState() {
  return <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.</div>;
}

function DialogExportacao({ modalAberto, setModalAberto, carrossel, setCarrossel, ativarEm, setAtivarEm, inativarEm, setInativarEm, exportar }: ReturnType<typeof useOfertas>) {
  return (
    <Dialog open={modalAberto} onOpenChange={setModalAberto}>
      <DialogContent>
        <DialogHeader><DialogTitle>Configurar arquivo do Clube</DialogTitle><DialogDescription>Escolha o carrossel e defina o período da oferta. A ativação usa data e hora.</DialogDescription></DialogHeader>
        <div className="space-y-4 py-2">
          <label className="block text-sm font-medium">Carrossel
            <select value={carrossel} onChange={(e) => setCarrossel(e.target.value)} className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none">
              <option value="">Selecione um carrossel</option>
              {CARROSSEIS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Ativação automática<Input className="mt-1.5" type="datetime-local" step="60" value={ativarEm} onChange={(e) => setAtivarEm(e.target.value)} /></label>
          <label className="block text-sm font-medium">Inativar em<Input className="mt-1.5" type="datetime-local" step="60" value={inativarEm} onChange={(e) => setInativarEm(e.target.value)} /></label>
          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Check-In: <strong>Não</strong> · Dias para resgate: <strong>1</strong> · App: <strong>Não exigir ativação</strong></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setModalAberto(false)}>Cancelar</Button><Button onClick={exportar}><Download className="size-4" /> Gerar planilha</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogVisualizacao({ modalVisualizacao, setModalVisualizacao }: ReturnType<typeof useOfertas>) {
  return (
    <Dialog open={!!modalVisualizacao} onOpenChange={(aberto) => { if (!aberto) setModalVisualizacao(null); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{modalVisualizacao?.nome}</DialogTitle><DialogDescription>Conferência completa do item importado.</DialogDescription></DialogHeader>
        {modalVisualizacao && <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
          <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted p-3">{modalVisualizacao.imagem ? <img src={modalVisualizacao.imagem} alt={modalVisualizacao.nome} className="max-h-52 w-full rounded-lg object-contain bg-white" /> : <ImageIcon className="size-10 text-muted-foreground" />}</div>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Info label="Produto encontrado" value={modalVisualizacao.encontrado || "Não encontrado"} />
            <Info label="Confiança" value={`${Math.round(modalVisualizacao.nota * 100)}%`} />
            <Info label="Preço" value={modalVisualizacao.preco ?? "—"} />
            <Info label="Preço clube" value={modalVisualizacao.precoClube ?? "—"} />
            <Info label="Limite lido da planilha" value={modalVisualizacao.limiteBruto || "—"} />
            <Info label="Limite para o Clube" value={modalVisualizacao.limite ?? "—"} />
            <Info label="Tipo de produto" value={modalVisualizacao.unidade} />
            <Info label="Tipo do código" value={modalVisualizacao.porQuilo ? "Interno" : "EAN"} />
            <div className="sm:col-span-2"><span className="text-muted-foreground">Códigos gerados</span><p className="font-medium break-words">{modalVisualizacao.codigos.join(";") || "—"}</p></div>
            {modalVisualizacao.excecoes.length > 0 && <div className="sm:col-span-2"><span className="text-muted-foreground">Exceções detectadas</span><p className="font-medium break-words">{modalVisualizacao.excecoes.map((e) => e.join(" ")).join(" | ")}</p></div>}
          </div>
        </div>}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><span className="text-muted-foreground">{label}</span><p className="font-medium">{value}</p></div>;
}
