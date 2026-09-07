# Nódus — seleção e agrupamento de EANs

Implementação local sobre a versão `7d5be1a` de `emanuel0711/Nodusweb`, obtida em 07/09/2026. O site publicado e o repositório remoto não foram alterados nesta rodada.

## Comportamento implementado

- “Frisco sabores 25g” reúne os EANs compatíveis do catálogo em uma linha, com exclusões por sabor ou código.
- Produtos equivalentes com a mesma identidade podem fornecer vários EANs, sem duplicação.
- Tradicional/zero, com/sem gás, com/sem álcool e arroz branco/parboilizado são separados quando aparecem juntos na oferta.
- Marca, medidas e variantes participam da seleção. Litros/mililitros e quilos/gramas são convertidos, incluindo decimais.
- Correspondências ambíguas ficam sem códigos e recebem um motivo para revisão. A sugestão aproximada anterior não pode escolher uma marca arbitrariamente.
- A expansão de sabores usa palavras de sabores reconhecidas no código. Descrições com qualificadores desconhecidos ou famílias distintas podem exigir revisão; não há garantia de cobertura de todo catálogo sem validação com dados reais.
- O custo não altera a identidade do produto; custo acima do limite anterior gera aviso para conferir o preço.
- A importação de ofertas preserva a coluna A em CSV e XLSX. A regra anterior de descartar A no CSV continua restrita ao caminho de importação do catálogo.
- Títulos acima dos cabeçalhos são reconhecidos. Gramatura no nome não é usada como limite de compra.
- Pacotes de 5 kg continuam sendo produtos por unidade. Hortifruti por quilo usa código interno.
- Preços vazios permanecem ausentes; preço clube não preenche indevidamente preço normal.
- Exclusões e dados da linha original são conservados no rascunho. Remover uma linha não recarrega a página nem apaga a configuração de exportação.
- A exportação confere novamente se todos os códigos estão no catálogo e pertencem ao tipo de venda correto, incluindo edições manuais.
- Imagens ausentes não entram na contagem de revisão dos códigos.

## Verificação

| Verificação | Resultado |
| --- | --- |
| Regressões iniciais | 6 dos 7 primeiros testes falhavam antes da correção |
| Testes automatizados finais | 41 aprovados, nenhum reprovado |
| TypeScript | Aprovado com `tsc --noEmit` |
| ESLint dos módulos alterados e testes TypeScript | Aprovado |
| ESLint do repositório inteiro | 563 erros e 10 avisos em arquivos não alterados nesta rodada |
| Compilação do cliente | Aprovada |
| Compilação SSR | Aprovada |
| Empacotamento final Nitro | Bloqueado por `EPERM: readlink C:\Users\Economix` neste ambiente Windows |
| Catálogo Supabase real | Não validado nesta rodada |
| Três planilhas da pasta de rede | Não lidas: acesso à pasta negado, mesmo após concessão de permissão |
| Navegação autenticada no site | Não testada nesta rodada |

Os testes usam catálogo sintético, casos de CSV e XLSX e reabertura do XLSX produzido pelo próprio código. Conferem quantidade de linhas, códigos, zeros iniciais, preços, limites, tipos de venda, exclusões e ambiguidades. Isso valida os casos definidos, não a precisão sobre todos os produtos reais.

A árvore de rotas foi regenerada pelo Vite; isso corrigiu as referências de tipos às páginas de termos e privacidade que estavam ausentes no arquivo gerado.

## Executar

Ambiente utilizado: Node.js 24.19.0. O executor de testes usa `node:module.registerHooks` e o TypeScript já declarado no projeto.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Dependendo da versão do pnpm, a instalação pode pedir uma decisão sobre o script de instalação do Sharp, que pertence ao módulo de imagens já existente. Nenhum pacote novo foi adicionado. O lockfile registra as versões resolvidas nesta rodada.

## Próxima validação necessária

Disponibilizar as três planilhas como anexos locais e uma exportação do catálogo de produtos (descrição, EAN, código interno e unidade; custo se disponível). Comparar o resultado esperado linha a linha antes de publicar.

A interface de juntar/separar linhas manualmente e a revisão de senhas não foram implementadas nesta rodada; o trabalho aqui cobre seleção de EANs, agrupamento/ separação automáticos e integridade da importação/exportação.
