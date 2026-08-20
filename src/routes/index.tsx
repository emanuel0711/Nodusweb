import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ShoppingBasket, Package, Sparkles, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OfertaFlow — Automação de ofertas de supermercado" },
      {
        name: "description",
        content:
          "Gerencie o catálogo de produtos e gere a planilha do clube de ofertas automaticamente, com cruzamento inteligente de descrições, EAN e imagens.",
      },
      { property: "og:title", content: "OfertaFlow — Automação de ofertas de supermercado" },
      {
        property: "og:description",
        content:
          "Gerencie o catálogo de produtos e gere a planilha do clube de ofertas automaticamente, com cruzamento inteligente de descrições, EAN e imagens.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Package,
    title: "Catálogo centralizado",
    text: "Importe CSV/Excel, edite códigos, unidades e vincule a imagem de cada EAN.",
  },
  {
    icon: Sparkles,
    title: "Cruzamento automático",
    text: "Correspondência exata e por similaridade entre a oferta da semana e sua base.",
  },
  {
    icon: FileSpreadsheet,
    title: "Modelo do clube pronto",
    text: "Exporte a planilha preenchida com preço, limite por CPF, imagem e códigos.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBasket className="size-5" />
          </span>
          OfertaFlow
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-10 sm:pt-20">
        <p className="mb-4 inline-flex rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
          Do SABADOU ao modelo do clube em segundos
        </p>
        <h1 className="max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">
          Automatize a planilha de ofertas do seu supermercado
        </h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          Suba a planilha da semana, deixe o sistema encontrar o código de barras e a imagem de cada
          produto no seu catálogo e baixe o arquivo final pronto para o clube de descontos.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Começar agora</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/auth">Já tenho conta</Link>
          </Button>
        </div>

        <div className="mt-16 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="surface p-6">
              <span className="mb-4 flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
                <Icon className="size-5" />
              </span>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
