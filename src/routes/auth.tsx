import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Nódus" },
      { name: "description", content: "Acesse o Nódus e continue sua operação." },
      { property: "og:title", content: "Entrar no Nódus" },
      { property: "og:description", content: "Acesse sua conta no Nódus." },
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
  const value = error as { message?: string; code?: string; status?: number };
  const message = value.message || String(error);
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar";
  if (/email rate limit|rate limit/i.test(message)) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
  if (/failed to fetch|network|fetch/i.test(message)) return "Não foi possível conectar ao serviço. Verifique sua conexão.";
  if (/apikey|api key|invalid jwt|jwt/i.test(message)) return "A chave de acesso foi rejeitada. Verifique a configuração do projeto.";
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
          if (hasOAuthTokens) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
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
        const { data, error } = await supabase.auth.signUp({ ...parsed.data, options: { emailRedirectTo: `${window.location.origin}/auth` } });
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
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth` } });
      if (error) throw error;
      if (!data.url) throw new Error("O serviço de autenticação não retornou a URL do Google.");
      window.location.assign(data.url);
    } catch (error) {
      console.error("[Auth] Erro no Google OAuth:", error);
      toast.error(getAuthErrorMessage(error));
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground md:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-border/70 bg-card shadow-sm md:grid-cols-[1.05fr_.95fr]">
        <section className="hidden flex-col justify-between bg-foreground p-10 text-background md:flex lg:p-14">
          <Link to="/" className="font-serif text-3xl tracking-tight">Nódus<span className="text-primary">.</span></Link>
          <div className="max-w-lg">
            <p className="mb-4 text-xs font-medium uppercase tracking-[0.22em] text-background/50">Organização · Automação · Clareza</p>
            <h1 className="font-serif text-5xl leading-[1.02] tracking-tight lg:text-6xl">Tudo conectado. Menos trabalho manual.</h1>
            <p className="mt-6 max-w-md text-sm leading-7 text-background/65">Entre para continuar organizando seus produtos, ofertas e processos em um único lugar.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-background/50"><ShieldCheck className="size-4" /> Acesso protegido</div>
        </section>

        <section className="flex items-center justify-center p-6 md:p-10 lg:p-14">
          <div className="w-full max-w-md">
            <div className="mb-8 md:hidden"><Link to="/" className="font-serif text-3xl tracking-tight">Nódus<span className="text-primary">.</span></Link></div>
            <div className="mb-8">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">Acesso</p>
              <h2 className="font-serif text-4xl tracking-tight">Bem-vindo ao Nódus.</h2>
              <p className="mt-2 text-sm text-muted-foreground">Entre na sua conta ou crie uma nova.</p>
            </div>

            <Tabs defaultValue="login">
              <TabsList className="h-11 w-full rounded-none border-b border-border bg-transparent p-0">
                <TabsTrigger value="login" className="h-11 flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Entrar</TabsTrigger>
                <TabsTrigger value="signup" className="h-11 flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent">Criar conta</TabsTrigger>
              </TabsList>
              {(["login", "signup"] as const).map((mode) => (
                <TabsContent key={mode} value={mode} className="mt-7 space-y-5">
                  <div className="space-y-2"><Label htmlFor={`${mode}-email`}>E-mail</Label><Input id={`${mode}-email`} className="h-11 rounded-xl" type="email" autoComplete="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /></div>
                  <div className="space-y-2"><Label htmlFor={`${mode}-password`}>Senha</Label><Input id={`${mode}-password`} className="h-11 rounded-xl" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" /></div>
                  <Button className="h-11 w-full rounded-xl" disabled={loading} onClick={() => submit(mode)}>{mode === "login" ? "Entrar" : "Criar conta"}<ArrowRight className="ml-1 size-4" /></Button>
                </TabsContent>
              ))}
            </Tabs>
            <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
            <Button variant="outline" className="h-11 w-full rounded-xl" disabled={loading} onClick={signInWithGoogle}>Continuar com Google</Button>
            <p className="mt-6 text-center text-xs leading-5 text-muted-foreground">Ao continuar, você concorda com os termos de uso do Nódus.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
