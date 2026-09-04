import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ImagensPendentes } from "@/components/ImagensPendentes";

export const Route = createFileRoute("/_authenticated/imagens")({
  head: () => ({
    meta: [
      { title: "Imagens do catálogo — Nódus" },
      {
        name: "description",
        content: "Busque, revise e aprove imagens dos produtos do catálogo.",
      },
      { property: "og:title", content: "Imagens do catálogo — Nódus" },
      {
        property: "og:description",
        content: "Área dedicada à busca e revisão de imagens dos produtos.",
      },
    ],
  }),
  component: PaginaImagens,
});

function PaginaImagens() {
  return (
    <AppShell
      title="Imagens do catálogo"
      subtitle="Busque imagens e revise somente os resultados que precisam de confirmação."
    >
      <ImagensPendentes />
    </AppShell>
  );
}
