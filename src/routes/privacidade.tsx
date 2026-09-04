import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import "../nodus-public.css";

export const Route = createFileRoute("/privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Nódus" },
      { name: "description", content: "Política de Privacidade da plataforma Nódus." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <main className="nodus-public min-h-screen bg-background px-5 py-10 text-foreground md:px-8">
      <article className="mx-auto max-w-3xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Voltar ao Nódus
        </Link>

        <p className="nodus-kicker">Legal · versão 04/09/2026</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight md:text-5xl">Política de Privacidade</h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          Esta política explica, em linguagem objetiva, como o Nódus trata informações relacionadas ao uso da plataforma.
        </p>

        <div className="mt-10 space-y-8 text-sm leading-7">
          <section><h2 className="font-serif text-2xl">1. Dados tratados</h2><p className="mt-2 text-muted-foreground">Podemos tratar dados de cadastro, como nome e e-mail, dados de autenticação fornecidos pelo provedor utilizado e informações inseridas pelo usuário no catálogo, nas ofertas e em outros recursos da plataforma.</p></section>
          <section><h2 className="font-serif text-2xl">2. Finalidades</h2><p className="mt-2 text-muted-foreground">Os dados são utilizados para autenticar usuários, manter a conta, executar funcionalidades contratadas ou solicitadas, processar arquivos, preservar segurança, diagnosticar falhas e melhorar a experiência do produto.</p></section>
          <section><h2 className="font-serif text-2xl">3. Serviços de infraestrutura</h2><p className="mt-2 text-muted-foreground">O Nódus utiliza provedores de infraestrutura e autenticação para operar o serviço. Esses provedores tratam dados conforme suas próprias políticas e os contratos aplicáveis à prestação do serviço.</p></section>
          <section><h2 className="font-serif text-2xl">4. Compartilhamento</h2><p className="mt-2 text-muted-foreground">O Nódus não compartilha dados pessoais para fins de venda. Informações podem ser processadas por fornecedores técnicos necessários à operação da plataforma ou quando houver obrigação legal.</p></section>
          <section><h2 className="font-serif text-2xl">5. Retenção</h2><p className="mt-2 text-muted-foreground">Os dados são mantidos enquanto forem necessários para a operação da conta, cumprimento das finalidades informadas, segurança e obrigações aplicáveis. Dados podem ser removidos ou anonimizados quando deixarem de ser necessários.</p></section>
          <section><h2 className="font-serif text-2xl">6. Segurança</h2><p className="mt-2 text-muted-foreground">São adotadas medidas técnicas e organizacionais compatíveis com o estágio atual da plataforma, incluindo autenticação, controle de acesso e separação de dados por usuário. Nenhum sistema, porém, é totalmente imune a incidentes.</p></section>
          <section><h2 className="font-serif text-2xl">7. Direitos do usuário</h2><p className="mt-2 text-muted-foreground">O usuário pode solicitar informações, correções ou exclusão de dados quando aplicável, observadas as obrigações legais e os requisitos técnicos necessários para manter a integridade do serviço.</p></section>
          <section><h2 className="font-serif text-2xl">8. Cookies e armazenamento local</h2><p className="mt-2 text-muted-foreground">A aplicação pode utilizar cookies e armazenamento local estritamente necessários para autenticação, sessão, preferências de interface e funcionamento técnico.</p></section>
          <section><h2 className="font-serif text-2xl">9. Atualizações desta política</h2><p className="mt-2 text-muted-foreground">Esta política poderá ser atualizada conforme o Nódus evoluir. Mudanças relevantes poderão exigir novo aceite do usuário.</p></section>
          <section><h2 className="font-serif text-2xl">10. Contato</h2><p className="mt-2 text-muted-foreground">Solicitações relacionadas à privacidade poderão ser encaminhadas pelos canais oficiais disponibilizados pelo Nódus.</p></section>
        </div>

        <p className="mt-12 border-t border-border pt-6 text-xs leading-5 text-muted-foreground">Este documento é uma base operacional inicial e deve passar por revisão jurídica antes de uma operação comercial em escala.</p>
      </article>
    </main>
  );
}
