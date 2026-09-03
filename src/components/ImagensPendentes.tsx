import { Check, CheckCheck, ImageIcon, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImagensPendentes } from "@/modules/imagens/use-imagens-pendentes";

interface ImagensPendentesProps {
  categoria?: string;
}

function formatarOrigem(origem: string): string {
  const nomes: Record<string, string> = {
    cosmos: "Cosmos",
    ean_pictures: "EAN Pictures",
    open_food_facts: "Open Food Facts",
    upcitemdb: "UPC Item DB",
    upcitemdb_text: "UPC Item DB · texto",
    google_images: "Google Imagens",
  };
  return nomes[origem] ?? origem;
}

function detalhesPontuacao(valor: unknown): Array<{ rotulo: string; pontos: number }> {
  if (!Array.isArray(valor)) return [];
  return valor.filter(
    (item): item is { rotulo: string; pontos: number } =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { rotulo?: unknown }).rotulo === "string" &&
      typeof (item as { pontos?: unknown }).pontos === "number",
  );
}

export function ImagensPendentes({ categoria = "__all__" }: ImagensPendentesProps) {
  const fila = useImagensPendentes(categoria);
  const categoriaLabel =
    categoria === "__all__"
      ? "Todas as categorias"
      : categoria === "__uncategorized__"
        ? "Sem categoria"
        : categoria;

  const contadores = [
    ["Sem imagem", fila.totalSemImagem],
    ["Na fila", fila.totalNaFila],
    ["Processando", fila.totalProcessando],
    ["Já processados", fila.jaProcessados],
    ["Aguardando aprovação", fila.aguardandoAprovacao],
    ["Sem resultado", fila.totalSemResultado],
  ] as const;

  return (
    <section className="surface mt-4 space-y-5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Imagens de produtos</h2>
          <p className="text-sm text-muted-foreground">
            Estado da busca salvo no Supabase. Categoria ativa: <strong>{categoriaLabel}</strong>.
          </p>
          <p className="text-xs text-muted-foreground">
            Cada execução processa até {fila.limitePorExecucao} produtos, com concorrência controlada. Aprovação automática exige score mínimo de <strong>{fila.pontuacaoMinimaAprovacao}/100</strong>, fundo branco e resolução mínima.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={fila.rodando || fila.aprovandoTodos}
            onClick={() => void fila.pesquisarNovamente()}
            title="Devolve para a fila produtos sem resultado ou aguardando revisão"
          >
            <RotateCcw className="size-4" /> Reenfileirar pendentes
          </Button>
          <Button disabled={fila.rodando || fila.aprovandoTodos || !fila.totalNaFila} onClick={() => void fila.completar()}>
            {fila.rodando ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Buscar próximo lote
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {contadores.map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-md border p-3">
            <div className="text-xs text-muted-foreground">{rotulo}</div>
            <div className="text-xl font-semibold">{valor}</div>
          </div>
        ))}
      </div>

      {fila.rodando ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>
            Processando <strong>{fila.processados}</strong> produto(s) neste lote.
          </p>
          <p className="text-xs">A fila permanece registrada mesmo se a página for recarregada.</p>
        </div>
      ) : null}

      {fila.encontrados || fila.semResultadoExecucao ? (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span>
            Aprovados automaticamente nesta execução: <strong>{fila.encontrados}</strong>
          </span>
          <span>
            Sem candidato nesta execução: <strong>{fila.semResultadoExecucao}</strong>
          </span>
        </div>
      ) : null}

      {fila.gruposRevisao.length ? (
        <div className="space-y-4 border-t pt-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold">Aguardando revisão</h3>
              <p className="text-xs text-muted-foreground">
                Compare os candidatos do mesmo produto. A aprovação em massa usa somente o melhor candidato de cada produto que também atende aos mesmos critérios técnicos da aprovação automática.
              </p>
            </div>

            <Button
              disabled={fila.aprovandoTodos || fila.rodando || fila.totalAprovaveisEmMassa === 0}
              onClick={() => void fila.aprovarTodos()}
              title={`Aprova o melhor candidato de cada produto com score mínimo ${fila.pontuacaoMinimaAprovacao} e critérios técnicos válidos`}
            >
              {fila.aprovandoTodos ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
              Aprovar todos ({fila.totalAprovaveisEmMassa})
            </Button>
          </div>

          {fila.gruposRevisao.map((grupo) => (
            <article key={grupo.produto.id} className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-medium">{grupo.produto.description}</h4>
                  <p className="text-xs text-muted-foreground">
                    EAN: {grupo.produto.ean || "não informado"} · {grupo.candidatos.length} candidato(s)
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void fila.pesquisarNovamente(grupo.produto.id)}>
                  <RotateCcw className="size-4" /> Pesquisar novamente
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {grupo.candidatos.map((candidato) => {
                  const detalhes = detalhesPontuacao(candidato.score_details);
                  return (
                    <div key={candidato.id} className="flex h-full flex-col gap-3 rounded-md border p-3">
                      <div className="flex min-h-52 items-center justify-center rounded-md bg-white p-3">
                        <img
                          src={candidato.url}
                          alt={grupo.produto.description}
                          loading="lazy"
                          className="max-h-48 max-w-full object-contain"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <span className="font-medium">{formatarOrigem(candidato.source)}</span>
                          <strong>{candidato.score}/100</strong>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {candidato.width && candidato.height ? `${candidato.width}×${candidato.height}` : "resolução não informada"}
                          {candidato.background_score != null
                            ? ` · fundo branco ${Math.round(candidato.background_score * 100)}%`
                            : ""}
                        </p>
                        <details className="text-xs text-muted-foreground">
                          <summary className="cursor-pointer">Ver composição da confiança</summary>
                          <ul className="mt-1 space-y-0.5">
                            {detalhes.map((item) => (
                              <li key={`${candidato.id}-${item.rotulo}`}>
                                {item.rotulo}: {item.pontos > 0 ? `+${item.pontos}` : item.pontos}
                              </li>
                            ))}
                          </ul>
                        </details>
                      </div>

                      <div className="mt-auto flex gap-2">
                        <Button className="flex-1" size="sm" onClick={() => void fila.aprovar(candidato)}>
                          <Check className="size-4" /> Aprovar
                        </Button>
                        <Button className="flex-1" size="sm" variant="outline" onClick={() => void fila.rejeitar(candidato)}>
                          <X className="size-4" /> Rejeitar
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {!fila.carregando && !fila.totalSemImagem ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-4" /> Nenhum produto sem imagem nesta categoria.
        </p>
      ) : null}
    </section>
  );
}
