import { AlertTriangle, History, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useHistoricoImportacoes } from "@/modules/catalogo/use-historico-importacoes";

export function HistoricoImportacoes() {
  const { historico, carregando, erro, desfazerImportacao } = useHistoricoImportacoes();
  const ativaPorCategoria = new Map<string, (typeof historico)[number]>();
  for (const item of historico) {
    if (!item.undone_at && !ativaPorCategoria.has(item.category))
      ativaPorCategoria.set(item.category, item);
  }
  const ultimasPorCategoria = [...ativaPorCategoria.values()];
  const agora = Date.now();

  const desfazer = (item: (typeof historico)[number]) => {
    if (!confirm(`Desfazer a carga ${item.file_name} e restaurar a categoria ${item.category}?`))
      return;
    void desfazerImportacao(item.id).catch((falha) =>
      toast.error(falha instanceof Error ? falha.message : "Não foi possível desfazer"),
    );
  };

  if (carregando)
    return (
      <div className="surface flex min-h-40 items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando histórico…
      </div>
    );

  if (erro)
    return (
      <div className="surface p-5 text-sm text-destructive">
        Não foi possível carregar o histórico de importações.
      </div>
    );

  return (
    <div className="space-y-4">
      <section className="surface space-y-3 p-4">
        <div className="flex items-center gap-2 font-medium">
          <History className="size-4" /> Última importação de cada categoria
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {ultimasPorCategoria.map((item) => {
            const estoqueAtualizadoEm = item.stock_updated_at;
            const antigo =
              !estoqueAtualizadoEm ||
              agora - new Date(estoqueAtualizadoEm).getTime() > 24 * 60 * 60 * 1000;
            return (
              <article key={item.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.category}</p>
                    <p className="text-xs text-muted-foreground">{item.file_name}</p>
                    <p className="mt-1 text-xs">
                      {new Date(item.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  {antigo && (
                    <span
                      className="flex items-center gap-1 text-xs text-warn-foreground"
                      title="O estoque não foi informado ou foi atualizado há mais de 24 horas"
                    >
                      <AlertTriangle className="size-3.5" />
                      {estoqueAtualizadoEm ? "Estoque antigo" : "Sem data de estoque"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Estoque:{" "}
                  {estoqueAtualizadoEm
                    ? new Date(estoqueAtualizadoEm).toLocaleString("pt-BR")
                    : "não informado"}
                  {item.product_count > 0
                    ? ` · cobertura ${item.stock_covered_count}/${item.product_count}`
                    : ""}
                </p>
                <p className="mt-2 text-xs">
                  {item.inserted_count} inseridos · {item.updated_count} atualizados ·{" "}
                  {item.ignored_count} ignorados · {item.error_count} erros
                </p>
                <Button className="mt-2" size="sm" variant="outline" onClick={() => desfazer(item)}>
                  <RotateCcw className="size-3.5" /> Desfazer carga
                </Button>
              </article>
            );
          })}
          {!ultimasPorCategoria.length && (
            <p className="text-sm text-muted-foreground">
              O histórico aparecerá após a próxima importação.
            </p>
          )}
        </div>
      </section>

      {historico.length > 0 && (
        <section className="surface p-4">
          <h2 className="font-medium">Todas as cargas recentes</h2>
          <div className="mt-3 space-y-2 text-sm">
            {historico.map((item) => {
              const podeDesfazer = ativaPorCategoria.get(item.category)?.id === item.id;
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-0 first:pt-0"
                >
                  <div>
                    <strong>{item.file_name}</strong> ·{" "}
                    {new Date(item.created_at).toLocaleString("pt-BR")}
                    <p className="text-xs text-muted-foreground">
                      {item.inserted_count} inseridos · {item.updated_count} atualizados ·{" "}
                      {item.ignored_count} ignorados · {item.error_count} erros
                      {item.product_count > 0
                        ? ` · estoque ${item.stock_covered_count}/${item.product_count}`
                        : ""}
                      {item.undone_at
                        ? ` · desfeita em ${new Date(item.undone_at).toLocaleString("pt-BR")}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!podeDesfazer}
                    onClick={() => desfazer(item)}
                  >
                    <RotateCcw className="size-3.5" />
                    {item.undone_at
                      ? "Carga desfeita"
                      : podeDesfazer
                        ? "Desfazer carga"
                        : "Desfaça a mais recente primeiro"}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
