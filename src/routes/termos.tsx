import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import "../nodus-public.css";

export const Route = createFileRoute("/termos")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Nódus" },
      { name: "description", content: "Termos de Uso da plataforma Nódus." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <main className="nodus-public min-h-screen bg-background px-5 py-10 text-foreground md:px-8">
      <article className="mx-auto max-w-3xl">
        <Link to="/" className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Voltar ao Nódus
        </Link>

        <p className="nodus-kicker">Legal · versão 04/09/2026</p>
        <h1 className="mt-3 font-serif text-4xl tracking-tight md:text-5xl">Termos de Uso</h1>
        <p className="mt-5 text-sm leading-7 text-muted-foreground">
          Estes termos regulam o acesso e o uso do Nódus. Ao criar uma conta ou utilizar a plataforma, o usuário declara ter lido e aceitado estas condições.
        </p>

        <div className="mt-10 space-y-8 text-sm leading-7">
          <section><h2 className="font-serif text-2xl">1. Uso da plataforma</h2><p className="mt-2 text-muted-foreground">O Nódus fornece ferramentas para organização de catálogo, automação de ofertas, tratamento de dados e funcionalidades relacionadas. O usuário deve utilizar a plataforma de forma lícita, responsável e compatível com a finalidade do serviço.</p></section>
          <section><h2 className="font-serif text-2xl">2. Conta e segurança</h2><p className="mt-2 text-muted-foreground">O usuário é responsável por manter suas credenciais seguras e por informar dados corretos no cadastro. Atividades realizadas com uma conta autenticada poderão ser atribuídas ao respectivo usuário.</p></section>
          <section><h2 className="font-serif text-2xl">3. Dados e conteúdo</h2><p className="mt-2 text-muted-foreground">Os dados enviados pelo usuário permanecem vinculados à sua operação. O usuário declara possuir autorização para inserir, processar e utilizar as informações, arquivos, imagens e demais conteúdos fornecidos à plataforma.</p></section>
          <section><h2 className="font-serif text-2xl">4. Licença de uso</h2><p className="mt-2 text-muted-foreground">O acesso ao Nódus concede ao usuário uma licença limitada, revogável, não exclusiva e intransferível para utilizar a plataforma enquanto sua conta estiver ativa e de acordo com estes termos. Nenhum direito sobre o código-fonte, marca, identidade visual ou demais ativos da plataforma é transferido ao usuário.</p></section>
          <section><h2 className="font-serif text-2xl">5. Serviços de terceiros</h2><p className="mt-2 text-muted-foreground">Algumas funcionalidades podem depender de serviços externos, como autenticação, hospedagem, bancos de dados, APIs e fontes públicas de informação. A disponibilidade desses serviços pode afetar temporariamente determinadas funções.</p></section>
          <section><h2 className="font-serif text-2xl">6. Uso de imagens e informações externas</h2><p className="mt-2 text-muted-foreground">O Nódus pode auxiliar na localização e organização de imagens e informações disponíveis em fontes externas. O usuário é responsável por verificar se possui autorização adequada para utilizar comercialmente qualquer conteúdo de terceiros.</p></section>
          <section><h2 className="font-serif text-2xl">7. Disponibilidade e alterações</h2><p className="mt-2 text-muted-foreground">A plataforma pode receber melhorias, correções, alterações de funcionalidades ou interrupções de manutenção. Sempre que mudanças relevantes afetarem estes termos, uma nova versão poderá ser apresentada para aceite.</p></section>
          <section><h2 className="font-serif text-2xl">8. Responsabilidades</h2><p className="mt-2 text-muted-foreground">Resultados automáticos, correspondências de produtos, códigos, imagens e demais sugestões devem ser revisados quando houver impacto operacional relevante. O usuário permanece responsável pelas decisões tomadas com base nas informações processadas pela plataforma.</p></section>
          <section><h2 className="font-serif text-2xl">9. Encerramento</h2><p className="mt-2 text-muted-foreground">O acesso poderá ser encerrado pelo usuário ou suspenso em caso de violação destes termos, uso abusivo, fraude ou risco à segurança da plataforma e de outros usuários.</p></section>
          <section><h2 className="font-serif text-2xl">10. Contato</h2><p className="mt-2 text-muted-foreground">Dúvidas sobre estes termos poderão ser tratadas pelos canais oficiais disponibilizados pelo Nódus.</p></section>
        </div>

        <p className="mt-12 border-t border-border pt-6 text-xs leading-5 text-muted-foreground">Este documento é uma base operacional inicial e deve passar por revisão jurídica antes de uma operação comercial em escala.</p>
      </article>
    </main>
  );
}
