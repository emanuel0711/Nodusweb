import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Package, Sparkles, LogOut, PackageOpen, Moon, Sun, UserRound, Settings2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import "@/app-overrides.css";
import "@/catalogo-overrides.css";

const NAV = [
  { to: "/painel", label: "Visão geral", icon: LayoutDashboard },
  { to: "/catalogo", label: "Catálogo", icon: Package },
  { to: "/ofertas", label: "Ofertas", icon: Sparkles },
] as const;

const THEME_STORAGE_KEY = "nodus:tema";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "N";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

export function AppShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [darkMode, setDarkMode] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("Usuário");

  useEffect(() => {
    const salvo = localStorage.getItem(THEME_STORAGE_KEY);
    const preferencia = salvo === "dark" || (salvo === null && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDarkMode(preferencia);
    document.documentElement.classList.toggle("dark", preferencia);

    let mounted = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!mounted || !data.user) return;
      const nome = data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email?.split("@")[0] || "Usuário";
      setUserName(String(nome));
      setUserEmail(data.user.email ?? "");
    });
    return () => { mounted = false; };
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
              <PackageOpen className="size-5" />
            </span>
            Nódus
          </Link>
        </div>

        <nav className="app-sidebar__nav">
          <div className="app-sidebar__section-label">Workspace</div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <Link key={to} to={to} className="app-sidebar__link" activeProps={{ "data-active": "true" }}>
              <Icon className="size-5 shrink-0" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="app-sidebar__account">
          <div className="app-account-card" title={userEmail || undefined}>
            <span className="app-account-card__avatar">{initials(userName)}</span>
            <span className="app-account-card__identity">
              <strong>{userName}</strong>
              <small>{userEmail || "Conta Nódus"}</small>
            </span>
          </div>
          <div className="app-account-actions">
            <Button variant="ghost" size="sm" onClick={alternarTema} title={darkMode ? "Usar tema claro" : "Usar tema escuro"}>
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
              <span>{darkMode ? "Tema claro" : "Tema escuro"}</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/painel" })} title="Perfil e preferências">
              <Settings2 className="size-4" />
              <span>Perfil e preferências</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="size-4" />
              <span>Sair</span>
            </Button>
          </div>
        </div>
      </aside>

      <nav className="app-mobile-nav" aria-label="Navegação móvel">
        {NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="app-sidebar__link" activeProps={{ "data-active": "true" }}>
            <Icon className="size-4" />
            <span>{label}</span>
          </Link>
        ))}
        <Button variant="ghost" size="sm" onClick={alternarTema} className="shrink-0" title={darkMode ? "Usar tema claro" : "Usar tema escuro"}>
          {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </nav>

      <div className="app-main">
        <main className="app-main__content">
          <div className="mb-6">
            <div className="app-main__eyebrow">Nódus · Workspace</div>
            <h1 className="text-2xl font-semibold sm:text-3xl">{title === "Painel" ? "Visão geral" : title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
        </main>
        <footer className="app-footer">
          <span>© 2026 Nódus · Emanuel Chaves</span>
          <span className="app-footer__links">
            <a href="/" target="_blank" rel="noreferrer">Nódus</a>
            <a href="/" target="_blank" rel="noreferrer">Privacidade</a>
            <a href="/" target="_blank" rel="noreferrer">Termos</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
