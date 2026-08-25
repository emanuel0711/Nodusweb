import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { ArrowRight, Layers3, Package, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Nódus — Processos mais simples, dados mais claros" },
      { name: "description", content: "Nódus organiza informações e automatiza processos para tornar operações mais simples, consistentes e inteligentes." },
      { property: "og:title", content: "Nódus — Processos mais simples, dados mais claros" },
      { property: "og:description", content: "Uma plataforma para organizar informações e automatizar processos em um só lugar." },
    ],
  }),
  component: Landing,
});

const FEATURES = [
  { icon: Layers3, eyebrow: "Organização", title: "Uma base mais confiável", text: "Centralize informações e mantenha seus dados consistentes, acessíveis e fáceis de revisar." },
  { icon: Sparkles, eyebrow: "Automação", title: "Menos tarefas repetitivas", text: "Transforme processos manuais em fluxos previsíveis, reduzindo retrabalho e erros operacionais." },
  { icon: Package, eyebrow: "Clareza", title: "Decisões com contexto", text: "Tenha uma visão mais clara do que está acontecendo e encontre rapidamente o que precisa de atenção." },
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
    return () => { ativo = false; assinatura.subscription.unsubscribe(); };
  }, [navigate]);

  return (
    <div className="nodus-public min-h-screen bg-background text-foreground">
      <header className="nodus-public__header">
        <div className="nodus-public__header-inner">
          <Link to="/" className="nodus-brand" aria-label="Nódus — início"><span className="nodus-brand__mark">N</span><span>Nódus</span></Link>
          <nav className="nodus-public__nav" aria-label="Navegação principal">
            <a href="#como-funciona">Como funciona</a><a href="#beneficios">Benefícios</a><a href="#sobre">Sobre</a>
          </nav>
          <Button asChild className="nodus-public__login"><Link to="/auth">Entrar</Link></Button>
        </div>
      </header>

      <main>
        <section className="nodus-hero">
          <div className="nodus-hero__rule" />
          <p className="nodus-kicker">Organização · Automação · Clareza</p>
          <h1>Processos mais simples.<br /><em>Dados mais claros.</em></h1>
          <p className="nodus-hero__lead">O Nódus conecta informações e processos em um ambiente feito para reduzir trabalho manual, organizar operações e tornar cada etapa mais previsível.</p>
          <div className="nodus-hero__actions">
            <Button asChild size="lg"><Link to="/auth">Entrar no Nódus <ArrowRight className="size-4" /></Link></Button>
            <a href="#como-funciona" className="nodus-text-link">Conhecer a plataforma</a>
          </div>
          <div className="nodus-hero__caption"><span>Feito para operações que precisam funcionar melhor.</span><span className="nodus-hero__caption-line" /></div>
        </section>

        <section id="como-funciona" className="nodus-section">
          <div className="nodus-section__heading"><p className="nodus-kicker">Como funciona</p><h2>Do dado ao processo,<br /><em>sem complicação.</em></h2></div>
          <div className="nodus-steps">
            {[["01", "Centralize", "Reúna informações importantes em uma única base."], ["02", "Automatize", "Deixe o sistema cuidar das tarefas repetitivas."], ["03", "Revise", "Enxergue inconsistências e tome decisões com mais segurança."]].map(([number, title, text]) => (
              <article key={number} className="nodus-step"><span>{number}</span><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </section>

        <section id="beneficios" className="nodus-section nodus-section--bordered">
          <div className="nodus-section__heading nodus-section__heading--wide"><p className="nodus-kicker">Por que Nódus</p><h2>Menos ruído.<br /><em>Mais controle.</em></h2></div>
          <div className="nodus-feature-grid">
            {FEATURES.map(({ icon: Icon, eyebrow, title, text }) => (
              <article key={title} className="nodus-feature"><Icon className="size-5 text-primary" strokeWidth={1.4} /><p className="nodus-feature__eyebrow">{eyebrow}</p><h3>{title}</h3><p>{text}</p></article>
            ))}
          </div>
        </section>

        <section id="sobre" className="nodus-final">
          <p className="nodus-kicker">Nódus</p><h2>Uma forma mais inteligente<br /><em>de fazer as coisas.</em></h2>
          <p>Uma plataforma construída para evoluir junto com a sua operação.</p>
          <Button asChild size="lg"><Link to="/auth">Acessar plataforma <ArrowRight className="size-4" /></Link></Button>
        </section>
      </main>

      <footer className="nodus-footer">
        <div><Link to="/" className="nodus-brand"><span className="nodus-brand__mark">N</span><span>Nódus</span></Link><p>Organização e automação para processos mais claros.</p></div>
        <div className="nodus-footer__links"><a href="#como-funciona">Como funciona</a><a href="#beneficios">Benefícios</a><Link to="/auth">Entrar</Link></div>
        <small>© 2026 Emanuel Chaves</small>
      </footer>
    </div>
  );
}
