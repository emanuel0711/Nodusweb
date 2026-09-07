# Ofertas

Regras determinísticas para transformar uma oferta em dados do Clube.

- `codigos-oferta.ts`: normalização de medidas, variantes, exclusões, famílias equivalentes e seleção somente no catálogo.
- `processar-ofertas.ts`: fluxo puro de cruzamento, separação de variantes e agrupamento, compartilhado com os testes.
- `regras-oferta.ts`: unidade de venda, limite e fardos.
- `use-ofertas.ts`: estado de revisão, rascunho, carregamento do catálogo e exportação.

“Sabores” só expande uma família compatível e exige gramatura. Ambiguidades não escolhem o primeiro candidato. Produtos equivalentes retornam todos os códigos únicos. As variantes tradicional/zero e branco/parboilizado permanecem distintas.

Execute `pnpm test` com Node.js 24 para os testes de seleção, importação CSV/XLSX e exportação. Veja `VALIDACAO-EANS.md` na raiz para evidências e limitações.
