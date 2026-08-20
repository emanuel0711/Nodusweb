# OfertaFlow

Aplicativo para montar as ofertas do supermercado: você guarda o catálogo de produtos,
envia a planilha da semana e baixa o arquivo pronto para o Clube de descontos.

## Como usar

1. **Entrar** — crie a conta com e-mail/senha ou use o Google.
2. **Catálogo** — importe seus CSV/Excel de produtos. A categoria de cada produto vira o
   nome do arquivo importado, então dá para excluir tudo de um arquivo depois, de uma vez.
3. **Ofertas** — envie a planilha da semana (ex.: SABADOU.xlsx). O sistema encontra o
   produto equivalente no catálogo, preenche código e imagem, e você confere na tabela
   (linhas em amarelo precisam de revisão). Depois clique em "Baixar arquivo do Clube".

## Onde fica cada coisa (para quem não é programador)

```
src/
  routes/                 cada arquivo é uma tela do site
    index.tsx             página inicial (quem já está logado vai para o painel)
    auth.tsx              login e cadastro
    _authenticated/       telas que só aparecem depois de entrar
      painel.tsx          números rápidos (produtos e ofertas processadas)
      catalogo.tsx        cadastro/importação/exclusão de produtos
      ofertas.tsx         envio da planilha da semana e download do arquivo do Clube
  lib/                    as "regras" do sistema, separadas por assunto
    planilha.ts           abrir CSV/Excel e gerar o arquivo do Clube
    catalogo.ts           o que é um produto e como ler um produto da planilha
    comparar-textos.ts    achar o produto certo mesmo com nome diferente; ler preço/limite
    imagens.ts            buscar a foto do produto pelo código de barras
  components/             peças visuais reutilizadas (menu, botões, tabelas)
  integrations/supabase/  conexão com o banco de dados e login (gerado automaticamente)
```
