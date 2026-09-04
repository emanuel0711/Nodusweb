import { Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, Package, Sparkles, LogOut, PackageOpen, Moon, Sun, Settings2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import "@/app-overrides.css";
import "@/catalogo-overrides.css";
import "@/ui-polish.css";

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
  const [showProfile, setShowProfile] = useState(false);
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
    navigate({ to: "/", replace: true });
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
          <button className="app-account-card" onClick={() => setShowProfile(true)} aria-label="Abrir perfil">
            <span className="app-account-card__avatar">{initials(userName)}</span>
            <span className="app-account-card__identity">
              <strong>{userName}</strong>
              <small>{userEmail || "Conta Nódus"}</small>
            </span>
            <Settings2 className="app-account-card__chevron" />
          </button>
          <div className="app-account-actions">
            <Button variant="ghost" size="sm" onClick={alternarTema} title={darkMode ? "Usar tema claro" : "Usar tema escuro"}>
              {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
              <span>{darkMode ? "Tema claro" : "Tema escuro"}</span>
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
        <Button variant="ghost" size="sm" onClick={() => setShowProfile(true)} className="shrink-0" title="Perfil">
          <Settings2 className="size-4" />
        </Button>
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
          <span>Workspace privado</span>
        </footer>
      </div>

      {showProfile ? (
        <div className="app-profile-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowProfile(false); }}>
          <section className="app-profile-panel" role="dialog" aria-modal="true" aria-labelledby="perfil-titulo">
            <div className="app-profile-panel__header">
              <div>
                <div className="app-main__eyebrow">Conta</div>
                <h2 id="perfil-titulo">Perfil e preferências</h2>
              </div>
              <button className="app-profile-close" onClick={() => setShowProfile(false)} aria-label="Fechar perfil"><X className="size-5" /></button>
            </div>

            <div className="app-profile-identity">
              <span className="app-profile-avatar">{initials(userName)}</span>
              <div>
                <strong>{userName}</strong>
                <span>{userEmail || "E-mail não informado"}</span>
              </div>
            </div>

            <div className="app-profile-section">
              <span className="app-profile-section__label">Conta</span>
              <div className="app-profile-row"><span>Nome</span><strong>{userName}</strong></div>
              <div className="app-profile-row"><span>E-mail</span><strong>{userEmail || "—"}</strong></div>
            </div>

            <div className="app-profile-section">
              <span className="app-profile-section__label">Empresa / organização</span>
              <div className="app-profile-placeholder">A área de empresa está preparada para receber os dados da organização quando essa informação fizer parte do cadastro.</div>
            </div>

            <div className="app-profile-section">
              <span className="app-profile-section__label">Preferências</span>
              <Button variant="outline" size="sm" onClick={alternarTema}>
                {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
                {darkMode ? "Usar tema claro" : "Usar tema escuro"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
