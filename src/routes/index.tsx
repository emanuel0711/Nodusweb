import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Package, Sparkles, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VarejoFlow — Operação mais simples, todos os dias" },
      {
        name: "description",
        content: "Uma plataforma para organizar produtos, informações e processos do varejo em um só lugar.",
      },
      { property: "og:title", content: "VarejoFlow — Operação mais simples, todos os dias" },
      {
        property: "og:description",
        content: "Uma plataforma para organizar produtos, informações e processos do varejo em um só lugar.",
      },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  {
    icon: Package,
    title: "Tudo organizado",
    text: "Centralize produtos, informações e dados importantes em uma base fácil de manter.",
  },
  {
    icon: Sparkles,
    title: "Mais inteligência",
    text: "Automatize tarefas repetitivas e encontre informações com menos esforço.",
  },
  {
    icon: Layers3,
    title: "Uma operação conectada",
    text: "Tenha uma visão mais clara dos processos e trabalhe com dados consistentes.",
  },
];

function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    let ativo = true;
    supabase.auth.getSession().then(({ data }) => {
      if (ativo && data.session) navigate({ to: "/painel", replace: true });
    });
    const { data: assinatura } = supabase.auth.onAuthStateChange((_evento, sessao) => {
      if (sessao) navigate({ to: "/painel", replace: true });
    });
    return () => {
      ativo = false;
      assinatura.subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Package className="size-5" />
          </span>
          VarejoFlow
        </div>
        <Button asChild size="sm">
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:pt-24">
        <div className="max-w-4xl">
          <p className="mb-5 text-sm font-medium text-primary">Tecnologia para simplificar a rotina</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">
            Menos trabalho manual. Mais clareza para sua operação.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            O VarejoFlow reúne informações e processos em um ambiente simples, organizado e inteligente —
            feito para acompanhar a rotina do seu negócio.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Começar agora</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">Entrar</Link>
            </Button>
          </div>
        </div>

        <div className="mt-20 grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div key={title} className="surface p-6">
              <span className="mb-5 flex size-10 items-center justify-center rounded-lg bg-secondary text-primary">
                <Icon className="size-5" />
              </span>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
