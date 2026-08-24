import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, Link, createRootRouteWithContext, useRouter, HeadContent, Scripts } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import appCss from "../styles.css?url";
import "../app-overrides.css";
import { Toaster } from "../components/ui/sonner";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { supabase } from "../integrations/supabase/client";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">A página que você procura não existe ou foi movida.</p>
        <div className="mt-6">
          <Link to="/" className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
            Voltar ao início
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">Esta página não carregou</h1>
        <p className="mt-2 text-sm text-muted-foreground">Ocorreu um erro. Tente atualizar a página ou voltar ao início.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button onClick={() => { router.invalidate(); reset(); }} className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">Tentar novamente</button>
          <a href="/" className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">Ir para o início</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#f47b20" },
      { title: "VarejoFlow — Operação mais simples, todos os dias" },
      { name: "description", content: "Uma plataforma para organizar produtos, informações e processos do varejo em um só lugar." },
      { name: "author", content: "VarejoFlow" },
      { property: "og:title", content: "VarejoFlow — Operação mais simples, todos os dias" },
      { property: "og:description", content: "Uma plataforma para organizar produtos, informações e processos do varejo em um só lugar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "VarejoFlow — Operação mais simples, todos os dias" },
      { name: "twitter:description", content: "Uma plataforma para organizar produtos, informações e processos do varejo em um só lugar." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9085e57a5951fd7e488142afc344440d/id-preview-01b73533--04db955e-4b69-4e9c-b84e-3ea213ad3a15.lovable.app-1787060207661.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/9085e57a5951fd7e488142afc344440d/id-preview-01b73533--04db955e-4b69-4e9c-b84e-3ea213ad3a15.lovable.app-1787060207661.png" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap" },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return <html lang="pt-BR"><head><HeadContent /></head><body>{children}<Scripts /></body></html>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    const handleOAuthCallback = async () => {
      const hash = window.location.hash;
      const hasOAuthTokens = /(?:^|#|&)access_token=/.test(hash) || /(?:^|#|&)refresh_token=/.test(hash);
      if (!hasOAuthTokens) return;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const retry = await supabase.auth.getSession();
          if (retry.error) throw retry.error;
          if (!retry.data.session) throw new Error("O login do Google retornou os tokens, mas a sessão não foi criada.");
        }
        if (cancelled) return;
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
        await router.navigate({ to: "/painel", replace: true });
      } catch (error) {
        console.error("[Auth] Falha ao processar callback OAuth:", error);
        if (!cancelled) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
      }
    };
    void handleOAuthCallback();
    return () => { cancelled = true; };
  }, [router]);
  return <QueryClientProvider client={queryClient}><Outlet /><Toaster richColors position="top-right" /></QueryClientProvider>;
}
