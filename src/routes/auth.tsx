import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
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

const TERMS_VERSION = "2026-09-04";
const LEGAL_ACCEPTANCE_KEY = `nodus:legal-accepted:${TERMS_VERSION}`;

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
  const [newPassword, setNewPassword] = useState("");
  const [forgotMode, setForgotMode] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [acceptedLegal, setAcceptedLegal] = useState(false);

  useEffect(() => {
    let active = true;

    const registrarAceitePendente = async () => {
      if (localStorage.getItem(LEGAL_ACCEPTANCE_KEY) !== "pending") return;
      const acceptedAt = new Date().toISOString();
      const { error } = await supabase.auth.updateUser({
        data: {
          terms_accepted_at: acceptedAt,
          terms_version: TERMS_VERSION,
          privacy_accepted_at: acceptedAt,
          privacy_version: TERMS_VERSION,
        },
      });
      if (!error) localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "accepted");
    };

    const finishOAuthRedirect = async () => {
      try {
        const hash = window.location.hash;
        const search = window.location.search;
        const hasOAuthTokens = hash.includes("access_token=") || hash.includes("refresh_token=");
        const isRecovery = search.includes("reset=1") || hash.includes("type=recovery");
        if (isRecovery) setRecoveryMode(true);

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
          if (isRecovery) return;
          await registrarAceitePendente();
          if (hasOAuthTokens) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
          await navigate({ to: "/painel", replace: true });
        }
      } catch (error) {
        console.error("[Auth] Falha ao finalizar sessão OAuth:", error);
        if (active) toast.error(getAuthErrorMessage(error));
      }
    };

    void finishOAuthRedirect();

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecoveryMode(true);
        setForgotMode(false);
        return;
      }
      if (session && active && event === "SIGNED_IN") {
        const isRecovery = window.location.search.includes("reset=1") || window.location.hash.includes("type=recovery");
        if (isRecovery) return;
        void registrarAceitePendente().finally(() => {
          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
          void navigate({ to: "/painel", replace: true });
        });
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
    if (mode === "signup" && !acceptedLegal) {
      toast.error("Aceite os Termos de Uso e a Política de Privacidade para criar a conta.");
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
        const acceptedAt = new Date().toISOString();
        const { data, error } = await supabase.auth.signUp({
          ...parsed.data,
          options: {
            emailRedirectTo: `${window.location.origin}/auth`,
            data: {
              terms_accepted_at: acceptedAt,
              terms_version: TERMS_VERSION,
              privacy_accepted_at: acceptedAt,
              privacy_version: TERMS_VERSION,
            },
          },
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
    if (!acceptedLegal) {
      toast.error("Aceite os Termos de Uso e a Política de Privacidade antes de continuar com Google.");
      return;
    }

    setLoading(true);
    try {
      localStorage.setItem(LEGAL_ACCEPTANCE_KEY, "pending");
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) throw error;
      if (!data.url) throw new Error("O serviço de autenticação não retornou a URL do Google.");
      window.location.assign(data.url);
    } catch (error) {
      localStorage.removeItem(LEGAL_ACCEPTANCE_KEY);
      console.error("[Auth] Erro no Google OAuth:", error);
      toast.error(getAuthErrorMessage(error));
      setLoading(false);
    }
  }

  async function enviarRecuperacao() {
    const parsed = z.string().trim().email("Informe um e-mail válido").safeParse(email);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Informe seu e-mail.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
        redirectTo: `${window.location.origin}/auth?reset=1`,
      });
      if (error) throw error;
      toast.success("Se o e-mail estiver cadastrado, enviaremos um link para redefinir sua senha.");
      setForgotMode(false);
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function atualizarSenha() {
    if (newPassword.length < 6 || newPassword.length > 72) {
      toast.error("A nova senha deve ter entre 6 e 72 caracteres.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Senha atualizada com sucesso.");
      setRecoveryMode(false);
      setNewPassword("");
      window.history.replaceState({}, document.title, "/auth");
      await navigate({ to: "/painel", replace: true });
    } catch (error) {
      toast.error(getAuthErrorMessage(error));
    } finally {
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

            {recoveryMode ? (
              <div className="space-y-6">
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">Segurança</p>
                  <h2 className="font-serif text-4xl tracking-tight">Defina uma nova senha.</h2>
                  <p className="mt-2 text-sm text-muted-foreground">Escolha uma senha nova para concluir a recuperação da sua conta.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <Input id="new-password" className="h-11 rounded-xl" type="password" autoComplete="new-password" maxLength={72} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="••••••••" />
                </div>
                <Button className="h-11 w-full rounded-xl" disabled={loading} onClick={atualizarSenha}>Atualizar senha <ArrowRight className="ml-1 size-4" /></Button>
              </div>
            ) : forgotMode ? (
              <div className="space-y-6">
                <button type="button" onClick={() => setForgotMode(false)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Voltar para o login</button>
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-primary">Recuperação</p>
                  <h2 className="font-serif text-4xl tracking-tight">Esqueceu sua senha?</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">Informe o e-mail da sua conta. Você receberá um link seguro para criar uma nova senha.</p>
                </div>
                <div className="space-y-2"><Label htmlFor="recovery-email">E-mail</Label><Input id="recovery-email" className="h-11 rounded-xl" type="email" autoComplete="email" maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@empresa.com.br" /></div>
                <Button className="h-11 w-full rounded-xl" disabled={loading} onClick={enviarRecuperacao}>Enviar link de recuperação</Button>
              </div>
            ) : (
              <>
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
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3"><Label htmlFor={`${mode}-password`}>Senha</Label>{mode === "login" ? <button type="button" onClick={() => setForgotMode(true)} className="text-xs text-primary hover:underline">Esqueci minha senha</button> : null}</div>
                        <Input id={`${mode}-password`} className="h-11 rounded-xl" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" />
                      </div>
                      {mode === "signup" ? <LegalConsent checked={acceptedLegal} onChange={setAcceptedLegal} /> : null}
                      <Button className="h-11 w-full rounded-xl" disabled={loading} onClick={() => submit(mode)}>{mode === "login" ? "Entrar" : "Criar conta"}<ArrowRight className="ml-1 size-4" /></Button>
                    </TabsContent>
                  ))}
                </Tabs>

                <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />ou<span className="h-px flex-1 bg-border" /></div>
                <div className="space-y-4">
                  <LegalConsent checked={acceptedLegal} onChange={setAcceptedLegal} compact />
                  <Button variant="outline" className="h-11 w-full rounded-xl" disabled={loading} onClick={signInWithGoogle}>Continuar com Google</Button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function LegalConsent({ checked, onChange, compact = false }: { checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-muted/20 ${compact ? "p-3" : "p-4"}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-1 size-4 shrink-0" />
      <span className="text-xs leading-5 text-muted-foreground">
        Li e aceito os <Link to="/termos" target="_blank" className="font-medium text-foreground underline underline-offset-2">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank" className="font-medium text-foreground underline underline-offset-2">Política de Privacidade</Link> do Nódus.
      </span>
    </label>
  );
}
