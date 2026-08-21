# Rotas

As telas ficam aqui; regras de negócio devem ficar em `src/modules` ou `src/shared`.

- `index.tsx` — página inicial pública.
- `auth.tsx` — login, cadastro e Google OAuth.
- `_authenticated/painel.tsx` — dashboard.
- `_authenticated/catalogo.tsx` — importação e manutenção do catálogo.
- `_authenticated/ofertas.tsx` — importação, conferência e exportação das ofertas.
- `_authenticated/route.tsx` — proteção das rotas autenticadas.
- `__root.tsx` — shell raiz, estilos globais e notificações.

**Regra:** componentes de tela podem chamar funções dos módulos, mas não devem duplicar as regras de código, limite, unidade ou imagem.
