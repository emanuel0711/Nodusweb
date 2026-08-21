# PDF to Club

Aplicação web para importar catálogos de supermercado, cruzar ofertas e gerar a planilha no formato aceito pelo Clube.

## Objetivo

O sistema recebe arquivos CSV/XLSX do supermercado, identifica os produtos no catálogo, reúne códigos compatíveis, encontra imagens e aplica as regras de limite/unidade antes da exportação.

## Estrutura do código

```text
src/
├── components/              # Componentes visuais reutilizáveis
├── integrations/            # Supabase e integrações externas
├── modules/
│   ├── catalogo/            # Cadastro, leitura e códigos do catálogo
│   ├── ofertas/             # Regras de ofertas e seleção de códigos
│   ├── planilhas/           # Importação e exportação CSV/XLSX
│   └── imagens/             # Busca e validação de imagens
├── routes/
│   ├── _authenticated/      # Painel, catálogo e ofertas
│   └── auth.tsx             # Login/cadastro
└── shared/
    └── texto.ts             # Normalização e comparação de textos
```

### Onde mexer

- **Importação do catálogo:** `src/modules/catalogo/`
- **Códigos das ofertas:** `src/modules/ofertas/codigos-oferta.ts`
- **Kg, Unidade e Fardo:** `src/modules/ofertas/regras-oferta.ts`
- **Planilha do Clube:** `src/modules/planilhas/planilha.ts`
- **Imagens:** `src/modules/imagens/busca-imagens.ts`
- **Comparação de nomes:** `src/shared/texto.ts`
- **Tela de ofertas:** `src/routes/_authenticated/ofertas.tsx`
- **Tela do catálogo:** `src/routes/_authenticated/catalogo.tsx`

## Regras importantes

### Códigos

O projeto mantém três campos separados:

- **EAN:** código de barras do produto.
- **Cód. interno:** código usado principalmente para produtos vendidos por Kg/balança.
- **Cód. promoção:** identificador promocional; não substitui EAN ou código interno.

Na exportação:

- produto por **Kg** → código interno;
- produto por **Unidade** → EAN;
- vários códigos → `codigo1;codigo2;codigo3`, sem espaços;
- produtos marcados como **exceto** não entram na lista de códigos.

### Planilhas

- A coluna **A do CSV** é ignorada.
- A categoria do catálogo vem do nome do arquivo importado.
- Limites escritos como **fardo** são convertidos para a quantidade total de unidades do fardo.
- A exportação usa `Quilograma` ou `Unidade` na coluna de unidade.
- Check-In fica como `Não`.
- Dias para resgate fica como `1`.
- A coluna de ativação usa `Ativação automática`.
- Imagens são exportadas em formato quadrado com `contain`, para evitar cortar o produto no app.

### Fardos conhecidos

- energético 473 ml → 6 unidades;
- cerveja 473 ml → 12 unidades;
- cerveja 330/350/355 ml → 24 unidades;
- refrigerante 2 L → 8 unidades;
- refrigerante 1,5 L → 6 unidades;
- demais fardos → 12 unidades, quando não houver regra específica.

## Imagens

A busca por EAN prioriza:

1. Cosmos;
2. EAN Pictures;
3. UPCitemdb;
4. Open Food Facts.

A imagem só é aceita depois de ser carregada e validada pelo navegador. Produtos sem EAN usam busca textual conservadora.

## Fluxo da aplicação

```text
Arquivo da semana
      ↓
Leitura da planilha
      ↓
Normalização dos nomes
      ↓
Busca no catálogo
      ↓
Identificação de Kg / Unidade
      ↓
Leitura e conversão do limite
      ↓
Seleção de códigos compatíveis
      ↓
Busca da imagem
      ↓
Conferência na tela
      ↓
Modal de configuração da oferta
      ↓
Modelo para o Clube.xlsx
```

## Compatibilidade

Os arquivos antigos em `src/lib/` continuam como pequenos pontos de compatibilidade e apenas reexportam os módulos novos. Isso permite reorganizar o projeto sem quebrar imports existentes.

Novos códigos devem usar os módulos em `src/modules/` ou `src/shared/` diretamente.

## Desenvolvimento

Instalar dependências:

```bash
bun install
```

Rodar localmente:

```bash
bun run dev
```

Verificar qualidade do código:

```bash
bun run lint
```

Gerar build de produção:

```bash
bun run build
```

## Princípio do projeto

**Regra de negócio deve existir em um único lugar.**

Antes de criar uma nova exceção, procure primeiro o módulo correspondente. Evite duplicar regras dentro das telas React.

A IA será adicionada posteriormente como uma camada de sugestão para casos que as regras determinísticas não resolverem. Ela não deve sobrescrever regras fixas do sistema sem confirmação.
