import { useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useImagensPendentes } from "@/modules/imagens/use-imagens-pendentes";

interface ImagensPendentesProps {
  categoria?: string;
}

function formatarOrigem(origem: string): string {
  const nomes: Record<string, string> = {
    cosmos: "Cosmos",
    ean_pictures: "EAN Pictures",
    upcitemdb: "UPC Item DB",
    upcitemdb_text: "UPC Item DB · texto",
    google_images: "Google Imagens",
  };

  return nomes[origem] ?? origem;
}

export function ImagensPendentes({
  categoria = "__all__",
}: ImagensPendentesProps) {
  const fila = useImagensPendentes(categoria);
  const [mostrarRevisao, setMostrarRevisao] = useState(false);

  const categoriaLabel =
    categoria === "__all__"
      ? "Todas as categorias"
      : categoria === "__uncategorized__"
        ? "Sem categoria"
        : categoria;

  const resumo = [
    ["Com imagem", fila.totalConcluidos],
    ["Para revisar", fila.aguardandoAprovacao],
    ["Sem imagem", fila.totalSemImagem],
  ] as const;

  const podeBuscar = fila.totalNaFila > 0;
  const podeRevisar = fila.aguardandoAprovacao > 0;
  const podeTentarNovamente = fila.totalSemResultado > 0;

  return (
    <section className="surface mt-4 space-y-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Imagens do catálogo</h2>
          <p className="text-sm text-muted-foreground">
            {categoriaLabel}. O Nódus encontra imagens e envia apenas os casos
            duvidosos para revisão.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={fila.rodando || !podeRevisar}
            onClick={() => setMostrarRevisao((atual) => !atual)}
            title={
              podeRevisar
                ? "Abrir itens que precisam de revisão"
                : "Nenhuma imagem aguardando revisão"
            }
          >
            {mostrarRevisao ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            Revisar ({fila.aguardandoAprovacao})
          </Button>

          <Button
            variant="outline"
            disabled={fila.rodando || !podeTentarNovamente}
            onClick={() => void fila.pesquisarNovamente()}
            title={
              podeTentarNovamente
                ? "Devolver produtos sem resultado para a fila"
                : "Nenhum produto sem resultado para pesquisar novamente"
            }
          >
            <RotateCcw className="size-4" /> Tentar novamente
          </Button>

          <Button
            disabled={fila.rodando || !podeBuscar}
            onClick={() => void fila.completar()}
          >
            {fila.rodando ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            {fila.rodando ? "Buscando..." : "Buscar imagens"}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {resumo.map(([rotulo, valor]) => (
          <div key={rotulo} className="rounded-lg border px-4 py-3">
            <div className="text-xs text-muted-foreground">{rotulo}</div>
            <div className="mt-1 text-2xl font-semibold">{valor}</div>
          </div>
        ))}
      </div>

      {fila.rodando ? (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
          Buscando imagens: <strong>{fila.processados}</strong> de até{" "}
          <strong>{fila.limitePorExecucao}</strong> produtos neste lote.
        </div>
      ) : null}

      {mostrarRevisao && fila.gruposRevisao.length ? (
        <div className="space-y-4 border-t pt-5">
          <div>
            <h3 className="font-semibold">Revisão de imagens</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Veja o melhor resultado primeiro. Se ele não servir, escolha uma
              alternativa ou pesquise novamente.
            </p>
          </div>

          {fila.gruposRevisao.map((grupo) => {
            const principal = grupo.candidatos[0];
            if (!principal) return null;

            return (
              <article key={grupo.produto.id} className="rounded-lg border p-4">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="font-medium">{grupo.produto.description}</h4>
                    <p className="text-xs text-muted-foreground">
                      {grupo.produto.ean
                        ? `EAN ${grupo.produto.ean}`
                        : "Sem EAN público informado"}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void fila.pesquisarNovamente(grupo.produto.id)
                    }
                  >
                    <RotateCcw className="size-4" /> Pesquisar novamente
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                  <div className="flex min-h-56 items-center justify-center rounded-lg border bg-white p-3">
                    <img
                      src={principal.url}
                      alt={grupo.produto.description}
                      loading="lazy"
                      className="max-h-52 max-w-full object-contain"
                    />
                  </div>

                  <div className="flex min-w-0 flex-col gap-4">
                    <div>
                      <div className="text-sm font-medium">
                        {formatarOrigem(principal.source)}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Confiança:{" "}
                        <strong className="text-foreground">
                          {principal.score}/100
                        </strong>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => void fila.aprovar(principal)}
                      >
                        <Check className="size-4" /> Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void fila.rejeitar(principal)}
                      >
                        <X className="size-4" /> Não serve
                      </Button>
                    </div>

                    {grupo.candidatos.length > 1 ? (
                      <div className="mt-auto">
                        <div className="mb-2 text-xs font-medium text-muted-foreground">
                          Outras opções
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {grupo.candidatos.slice(1, 5).map((candidato) => (
                            <button
                              key={candidato.id}
                              type="button"
                              className="group relative flex size-20 items-center justify-center overflow-hidden rounded-md border bg-white p-1"
                              title={`${formatarOrigem(candidato.source)} · ${candidato.score}/100`}
                              onClick={() => void fila.aprovar(candidato)}
                            >
                              <img
                                src={candidato.url}
                                alt={grupo.produto.description}
                                loading="lazy"
                                className="max-h-full max-w-full object-contain"
                              />
                              <span className="absolute bottom-0 right-0 bg-background/90 px-1 text-[10px] font-semibold">
                                {candidato.score}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {!fila.carregando && fila.totalSemImagem === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ImageIcon className="size-4" /> Todos os produtos desta seleção já
          possuem imagem.
        </p>
      ) : null}
    </section>
  );
}
