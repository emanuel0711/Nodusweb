# Imagens

O módulo de imagens mantém quatro responsabilidades separadas:

- `busca-imagens.functions.ts`: descoberta e validação técnica dos candidatos.
- `score-imagem.ts`: cálculo de confiança, sem acesso à rede ou ao banco.
- `buscar-imagem.functions.ts`: fachada usada pela interface para combinar busca e pontuação.
- `use-imagens-pendentes.ts`: fila, persistência e estado da interface.

## Estratégia

Produtos industrializados usam GTIN público quando disponível e consultam Cosmos, EAN Pictures, UPC Item DB e, como fallback, busca textual na web.

Produtos variáveis, como hortifrúti e itens vendidos por peso, ignoram códigos internos e usam descrição normalizada na busca textual.

A Open Food Facts não faz parte do pipeline.

## Aprovação

O score é dividido em correspondência do produto, qualidade da imagem e confiabilidade da fonte. Candidatos com score abaixo do limite automático permanecem para revisão manual.

## Escala

O sistema não tenta garantir 100% de cobertura. O objetivo é automatizar resultados confiáveis, preservar candidatos duvidosos para revisão e evitar repetir buscas de produtos já concluídos.
