import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ShoppingBasket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — OfertaFlow | Gestão de ofertas de supermercado" },
      { name: "description", content: "Acesse o OfertaFlow para gerenciar seu catálogo de produtos e automatizar as planilhas de ofertas da semana." },
      { property: "og:title", content: "Entrar no OfertaFlow" },
      { property: "og:description", content: "Acesse o OfertaFlow para gerenciar seu catálogo de produtos e automatizar as planilhas de ofertas." },
    ],
  }),
  component: AuthPage,
});

const credentialsSchema = z.object({
  email: z.string().trim().email({ message: "Informe um e-mail válido" }).max(255),
  password: z.string().min(6, { message: "A senha deve ter ao menos 6 caracteres" }).max(72),
});

function getAuthErrorMessage(error: unknown) {
  if (!error) return "Não foi possível continuar";
  const value = error as { message?: string; code?: string; status?: number; name?: string };
  const message = value.message || String(error);
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar";
  if (/email rate limit|rate limit/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (/failed to fetch|network|fetch/i.test(message)) return "Não foi possível conectar ao Supabase. Verifique a configuração do projeto.";
  if (/apikey|api key|invalid jwt|jwt/i.test(message)) return "A chave pública do Supabase foi rejeitada. Confira a Publishable Key do projeto.";
  const suffix = [value.code, value.status ? `HTTP ${value.status}` : ""].filter(Boolean).join(" — ");
  return suffix ? `${message} (${suffix})` : message;
}

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    let active = true;

    const finishOAuthRedirect = async () => {
      try {
        const hash = window.location.hash;
        const hasOAuthTokens = hash.includes("access_token=") || hash.includes("refresh_token=");
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        let session = data.session;
        if (hasOAuthTokens && !session) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          const retry = await supabase.auth.getSession();
          if (retry.error) throw retry.error;
          session = retry.data.session;
        }

        if (active && session) {
          if (hasOAuthTokens) {
            window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
          }
          await navigate({ to: "/painel", replace: true });
        }
      } catch (error) {
        console.error("[Auth] Falha ao finalizar sessão OAuth:", error);
        if (active) toast.error(getAuthErrorMessage(error));
      }
    };

    void finishOAuthRedirect();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && active) {
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
        void navigate({ to: "/painel", replace: true });
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [navigate]);

  async function submit(mode: "login" | "signup") {
    const parsed = credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword(parsed.data);
        if (error) throw error;
        toast.success("Bem-vindo de volta!");
        await navigate({ to: "/painel", replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: { emailRedirectTo: `${window.location.origin}/auth` },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Conta criada com sucesso!");
          await navigate({ to: "/painel", replace: true });
        } else {
          toast.success("Conta criada! Confirme seu e-mail para entrar.");
        }
      }
    } catch (error) {
      console.error("[Auth] Erro de autenticação:", error);
      toast.error(getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      if (!data.url) throw new Error("O Supabase não retornou a URL de autenticação do Google.");
      window.location.assign(data.url);
    } catch (error) {
      console.error("[Auth] Erro no Google OAuth:", error);
      toast.error(getAuthErrorMessage(error));
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary px-4 py-12">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 font-display text-xl font-semibold">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"><ShoppingBasket className="size-5" /></span>
          OfertaFlow
        </Link>
        <div className="surface p-6">
          <Tabs defaultValue="login">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            {(["login", "signup"] as const).map((mode) => (
              <TabsContent key={mode} value={mode} className="mt-6 space-y-4">
                <div className="space-y-2"><Label htmlFor={`${mode}-email`}>E-mail</Label><Input id={`${mode}-email`} type="email" autoComplete="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@mercado.com.br" /></div>
                <div className="space-y-2"><Label htmlFor={`${mode}-password`}>Senha</Label><Input id={`${mode}-password`} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></div>
                <Button className="w-full" disabled={loading} onClick={() => submit(mode)}>{mode === "login" ? "Entrar" : "Criar conta"}</Button>
              </TabsContent>
            ))}
          </Tabs>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
          <Button variant="outline" className="w-full" disabled={loading} onClick={signInWithGoogle}>Continuar com Google</Button>
        </div>
      </div>
    </div>
  );
}
