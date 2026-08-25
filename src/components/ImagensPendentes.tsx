import { Check, ImageIcon, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImagensPendentes } from "@/modules/imagens/use-imagens-pendentes";

interface ImagensPendentesProps {
  categoria?: string;
}

export function ImagensPendentes({ categoria = "__all__" }: ImagensPendentesProps) {
  const fila = useImagensPendentes(categoria);
  const categoriaLabel = categoria === "__all__" ? "Todas as categorias" : categoria === "__uncategorized__" ? "Sem categoria" : categoria;

  return <section className="surface mt-4 space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold">Imagens pendentes</h2>
        <p className="text-sm text-muted-foreground">A busca usa o mesmo filtro de categoria do Catálogo. Categoria ativa: <strong>{categoriaLabel}</strong>.</p>
        <p className="text-xs text-muted-foreground">Um produto só é pesquisado automaticamente uma vez. Produtos já processados não voltam para a fila em novas importações.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={fila.rodando} onClick={fila.pesquisarNovamente} title="Permite pesquisar novamente os produtos que já tiveram uma tentativa">
          <RotateCcw className="size-4" /> Pesquisar novamente
        </Button>
        <Button disabled={fila.rodando || !fila.totalNaFila} onClick={() => void fila.completar()}>
          {fila.rodando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Completar imagens faltantes
        </Button>
      </div>
    </div>

    <div className="grid gap-3 sm:grid-cols-4">
      {[
        ["Sem imagem", fila.totalSemImagem],
        ["Na fila", fila.totalNaFila],
        ["Já processados", fila.jaProcessados],
        ["Aguardando aprovação", fila.aguardandoAprovacao],
      ].map(([rotulo, valor]) =>
        <div key={String(rotulo)} className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{rotulo}</div>
          <div className="text-xl font-semibold">{valor}</div>
        </div>,
      )}
    </div>

    {fila.rodando ? <p className="text-sm text-muted-foreground">Processando {fila.processados} de {fila.totalNaFila} produto(s)…</p> : null}

    {fila.encontrados || fila.semResultado ? <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span>Encontrados nesta execução: <strong>{fila.encontrados}</strong></span>
      <span>Sem resultado nesta execução: <strong>{fila.semResultado}</strong></span>
    </div> : null}

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
          <Button size="sm" variant="outline" onClick={() => void fila.rejeitar(candidato)}><X className="size-4" /> Rejeitar</Button>
        </div>
      </div>)}
    </div> : null}

    {!fila.carregando && !fila.totalSemImagem ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><ImageIcon className="size-4" /> Nenhum produto sem imagem nesta categoria.</p> : null}
  </section>;
}
