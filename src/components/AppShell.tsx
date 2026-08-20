import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Package, Sparkles, LogOut, ShoppingBasket, Moon, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import "@/app-overrides.css";
import "@/catalogo-overrides.css";

const NAV = [
  { to: "/painel", label: "Painel", icon: LayoutDashboard },
  { to: "/catalogo", label: "Catálogo", icon: Package },
  { to: "/ofertas", label: "Ofertas", icon: Sparkles },
] as const;

const THEME_STORAGE_KEY = "ofertaflow:tema";

export function AppShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const salvo = localStorage.getItem(THEME_STORAGE_KEY);
    const preferencia = salvo === "dark" || (salvo === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(preferencia);
    document.documentElement.classList.toggle("dark", preferencia);
  }, []);

  function alternarTema() {
    setDarkMode((atual) => {
      const novo = !atual;
      document.documentElement.classList.toggle("dark", novo);
      localStorage.setItem(THEME_STORAGE_KEY, novo ? "dark" : "light");
      return novo;
    });
  }

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await router.invalidate();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="app-sidebar" aria-label="Navegação principal">
        <div className="app-sidebar__brand">
          <Link to="/painel" className="flex items-center gap-2 font-display text-lg font-semibold">
            <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ShoppingBasket className="size-5" />
            </span>
            OfertaFlow
          </Link>
        </div>

        <nav className="app-sidebar__nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="app-sidebar__link"
              activeProps={{ "data-active": "true" }}
            >
              <Icon className="size-5 shrink-0" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="app-sidebar__footer">
          <Button variant="ghost" size="sm" onClick={alternarTema} title={darkMode ? "Usar tema claro" : "Usar tema escuro"}>
            {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
            {darkMode ? "Tema claro" : "Tema escuro"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut className="size-4" />
            Sair
          </Button>
        </div>
      </aside>

      <nav className="app-mobile-nav" aria-label="Navegação móvel">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className="app-sidebar__link"
            activeProps={{ "data-active": "true" }}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        ))}
        <Button variant="ghost" size="sm" onClick={alternarTema} className="shrink-0" title={darkMode ? "Usar tema claro" : "Usar tema escuro"}>
          {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </nav>

      <div className="app-main">
        <main className="app-main__content">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
