import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Package, Sparkles, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/painel")({
  head: () => ({
    meta: [
      { title: "Painel — OfertaFlow" },
      {
        name: "description",
        content: "Estatísticas do catálogo e das ofertas processadas na semana.",
      },
      { property: "og:title", content: "Painel — OfertaFlow" },
      { property: "og:description", content: "Visão geral do catálogo e das ofertas processadas." },
    ],
  }),
  component: DashboardPage,
});

function weekStart() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  return start.toISOString();
}

function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [products, withImage, runs, recent] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }),
        supabase
          .from("products")
          .select("id", { count: "exact", head: true })
          .not("image_url", "is", null),
        supabase
          .from("offer_runs")
          .select("id", { count: "exact", head: true })
          .gte("created_at", weekStart()),
        supabase
          .from("offer_runs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
      return {
        totalProducts: products.count ?? 0,
        withImage: withImage.count ?? 0,
        runsThisWeek: runs.count ?? 0,
        recent: recent.data ?? [],
      };
    },
  });

  const cards = [
    { label: "Produtos no catálogo", value: data?.totalProducts ?? 0, icon: Package },
    { label: "Produtos com imagem", value: data?.withImage ?? 0, icon: CheckCircle2 },
    { label: "Ofertas processadas na semana", value: data?.runsThisWeek ?? 0, icon: Sparkles },
  ];

  return (
    <AppShell title="Painel" subtitle="Visão rápida do catálogo e das automações de oferta.">
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label} className="surface p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{label}</span>
              <Icon className="size-4 text-primary" />
            </div>
            {isLoading ? (
              <Skeleton className="mt-3 h-9 w-20" />
            ) : (
              <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="surface p-5 lg:col-span-2">
          <h2 className="text-lg font-semibold">Últimos processamentos</h2>
          {isLoading ? (
            <Skeleton className="mt-4 h-24 w-full" />
          ) : data && data.recent.length > 0 ? (
            <ul className="mt-4 divide-y divide-border">
              {data.recent.map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{run.file_name}</p>
                    <p className="text-xs text-muted-foreground">
                      <Clock className="mr-1 inline size-3" />
                      {new Date(run.created_at).toLocaleString("pt-BR")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs font-medium">
                    {run.matched_items}/{run.total_items} com código
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              Nenhuma planilha processada ainda. Comece pelo módulo de ofertas.
            </p>
          )}
        </div>

        <div className="surface flex flex-col gap-3 p-5">
          <h2 className="text-lg font-semibold">Atalhos</h2>
          <Button asChild>
            <Link to="/ofertas">Processar planilha da semana</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/catalogo">Gerenciar catálogo</Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
