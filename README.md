# NODUS

Plataforma para organizar dados, produtos e processos do varejo em um só lugar.

O projeto começou focado em automação de ofertas, mas a estrutura foi mantida aberta para crescer para outras rotinas operacionais.

## O que existe hoje

- **Painel:** visão geral da operação.
- **Catálogo:** base de produtos, códigos, custos e imagens.
- **Ofertas:** cruzamento de produtos e preparação de arquivos promocionais.
- **Planilhas:** leitura e geração de CSV/XLSX.
- **Imagens:** busca, validação e preparação das imagens dos produtos.

## Estrutura

```text
src/
├── components/              # Componentes visuais reutilizáveis
├── integrations/            # Supabase e integrações externas
├── modules/
│   ├── catalogo/            # Cadastro e dados dos produtos
│   ├── ofertas/             # Regras e seleção de produtos
│   ├── planilhas/           # Importação e exportação
│   └── imagens/             # Busca e validação de imagens
├── routes/
│   ├── _authenticated/      # Telas internas
│   └── auth.tsx             # Login/cadastro
└── shared/                  # Funções compartilhadas
```

## Princípios

- Regras de negócio ficam em módulos, não espalhadas pelas telas.
- EAN e código interno são tratados como identificadores diferentes.
- Dados importados devem ser preservados antes de qualquer transformação.
- Exceções explícitas não devem ser ignoradas pelo matching.
- A IA será uma camada de sugestão para casos ambíguos, sem substituir regras fixas automaticamente.

## Desenvolvimento

```bash
bun install
bun run dev
bun run lint
bun run build
```

## Evolução

O sistema deve continuar simples, previsível e modular. Novos recursos devem ser adicionados como módulos independentes sempre que possível, evitando aumentar a complexidade das telas existentes.
