import { Check, ImageIcon, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImagensPendentes } from "@/modules/imagens/use-imagens-pendentes";

export function ImagensPendentes() {
  const fila = useImagensPendentes();

  return <section className="surface mt-4 space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Imagens pendentes</h2>
        <p className="text-sm text-muted-foreground">Todos os produtos sem imagem são carregados. A busca roda em lotes e não fica limitada a 1.000 itens.</p>
      </div>
      <Button disabled={fila.rodando || !fila.totalSemImagem} onClick={() => void fila.completar()}>
        {fila.rodando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Completar imagens faltantes
      </Button>
    </div>

    <div className="grid gap-3 sm:grid-cols-4">
      {[["Sem imagem", fila.totalSemImagem], ["Encontrados", fila.encontrados], ["Aguardando aprovação", fila.aguardandoAprovacao], ["Sem resultado", fila.semResultado]].map(([rotulo, valor]) =>
        <div key={String(rotulo)} className="rounded-md border p-3"><div className="text-xs text-muted-foreground">{rotulo}</div><div className="text-xl font-semibold">{valor}</div></div>)}
    </div>

    {fila.rodando ? <p className="text-sm text-muted-foreground">Processando {fila.processados} de {fila.totalSemImagem} produto(s)…</p> : null}

    {fila.candidatos.length ? <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium">Candidatos de busca externa</h3>
        <p className="text-xs text-muted-foreground">O Google é o último recurso. As buscas priorizam sites de grandes varejistas e fontes de produto; nada é salvo automaticamente.</p>
      </div>
      {fila.candidatos.map((candidato) => <div key={candidato.id} className="flex flex-wrap items-start gap-4 rounded-md border p-3">
        <img src={candidato.url} alt={candidato.produto.description} loading="lazy" className="size-20 rounded-md object-contain" />
        <div className="min-w-56 flex-1 space-y-1">
          <div className="font-medium">{candidato.produto.description}</div>
          <div className="text-xs text-muted-foreground">Google Imagens · Confiança {candidato.pontuacao.total}/100</div>
          <div className="break-all text-xs text-muted-foreground">{candidato.url}</div>
          <ul className="text-xs text-muted-foreground">{candidato.pontuacao.itens.map((item) => <li key={item.rotulo}>{item.rotulo}: {item.pontos > 0 ? `+${item.pontos}` : item.pontos}</li>)}</ul>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void fila.aprovar(candidato)}><Check className="size-4" /> Aprovar</Button>
          <Button size="sm" variant="outline" onClick={() => fila.rejeitar(candidato)}><X className="size-4" /> Rejeitar</Button>
        </div>
      </div>)}
    </div> : null}

    {!fila.carregando && !fila.totalSemImagem ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" /> Todos os produtos já têm imagem.</p> : null}
  </section>;
}
