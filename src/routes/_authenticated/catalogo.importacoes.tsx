import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HistoricoImportacoes } from "@/components/HistoricoImportacoes";

export const Route = createFileRoute("/_authenticated/catalogo/importacoes")({
  head: () => ({
    meta: [
      { title: "Histórico de importações — Nódus" },
      {
        name: "description",
        content: "Consulte as cargas do catálogo, a cobertura de estoque e restaure importações.",
      },
    ],
  }),
  component: PaginaHistoricoImportacoes,
});

function PaginaHistoricoImportacoes() {
  return (
    <AppShell
      title="Histórico de importações"
      subtitle="Acompanhe as cargas do catálogo e restaure uma importação problemática."
    >
      <HistoricoImportacoes />
    </AppShell>
  );
}
