# Super Oferta Manager

Crie uma aplicação web moderna, responsiva e intuitiva em React, Tailwind CSS e Supabase para automação e gestão de ofertas de supermercado.

### 1. Autenticação e Usuários

- Tela de Login/Cadastro protegida por e-mail e senha.

- Controle de acesso às rotas internas (somente usuários autenticados podem acessar o painel de controle).

### 2. Módulo de Gestão do Catálogo de Produtos (Base de Dados / CRUD)

- Interface de Gerenciamento do Catálogo com listagem paginada, filtro por busca de texto e por categoria.

- Funcionalidade para importar múltiplos arquivos CSV/Excel de produtos contendo as colunas: `Cód. Interno`, `Código` (EAN), `Descrição`, `Un.`, `Preço Un.` e Categoria.

- Tabela com CRUD completo:

  - Criar novo produto manualmente.

  - Ler/Visualizar detalhes do produto (incluindo URL da imagem).

  - Editar código, descrição, unidade e link da imagem.

  - Excluir produto do catálogo.

- Permite vincular/salvar uma URL de imagem para cada produto baseado no código de barras (EAN) ou código interno.

### 3. Módulo de Automação de Ofertas ("Sabadou" -> "Modelo do Clube")

- Tela para upload da planilha de ofertas da semana (ex: SABADOU.xlsx).

- Processamento automático do arquivo de entrada:

  - Mapear colunas de oferta: Nome do Produto, Preço Normal, Preço Clube e Limite por CPF.

  - Realizar busca/cruzamento automático do nome do produto contra a base de dados do catálogo (via correspondência exata e busca por similaridade de texto / fuzzy match).

  - Preencher automaticamente o Código do Produto (EAN) e a URL da Imagem cadastrada.

  - Formatar o campo de "Limite por cliente" extraindo apenas o valor numérico.

- Tabela de pré-visualização e conferência do resultado antes do download, destacando em amarelo os itens que não tiveram correspondência de código/imagem encontrada.

- Botão "Exportar Planilha Preenchida" para baixar o arquivo no formato "modelo para o clube.xlsx" com todas as colunas necessárias (`Nome`, `Preço`, `Preço promocional`, `Limite por cliente`, `URL da imagem`, `Códigos dos produtos`, etc.).

### 4. Design e Experiência do Usuário (UI/UX)

- Dashboard limpo com estatísticas rápidas (Total de Produtos no Catálogo, Ofertas Processadas na Semana).

- Notificações de sucesso e erro ao realizar importações ou edições.

- Design moderno usando cores neutras e elementos visuais de e-commerce/supermercado.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://pdftoclub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/04db955e-4b69-4e9c-b84e-3ea213ad3a15).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
