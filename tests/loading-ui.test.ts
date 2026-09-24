import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ler = (caminho: string) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("loading compartilhado comunica o estado para leitores de tela", async () => {
  const componente = await ler("src/components/LoadingState.tsx");

  assert.match(componente, /role="status"/);
  assert.match(componente, /aria-live="polite"/);
  assert.match(componente, /aria-busy="true"/);
});

test("sessão tem loading antes de exibir páginas públicas ou protegidas", async () => {
  const [inicio, autenticacao, protegida] = await Promise.all([
    ler("src/routes/index.tsx"),
    ler("src/routes/auth.tsx"),
    ler("src/routes/_authenticated/route.tsx"),
  ]);

  assert.match(inicio, /verificandoSessao[\s\S]*?<PageLoading/);
  assert.match(autenticacao, /verificandoSessao[\s\S]*?<PageLoading/);
  assert.match(protegida, /pendingComponent:[\s\S]*?<PageLoading/);
});

test("catálogo diferencia primeira carga de atualização dos resultados", async () => {
  const [hook, pagina] = await Promise.all([
    ler("src/modules/catalogo/use-catalogo.ts"),
    ler("src/routes/_authenticated/catalogo.tsx"),
  ]);

  assert.match(hook, /carregandoProdutos: produtos\.isLoading/);
  assert.match(hook, /atualizandoProdutos: produtos\.isFetching && !produtos\.isLoading/);
  assert.match(pagina, /title="Carregando produtos"/);
  assert.match(pagina, /title="Atualizando resultados"/);
});

test("processamento de ofertas substitui o estado vazio por retorno de progresso", async () => {
  const pagina = await ler("src/routes/_authenticated/ofertas.tsx");

  assert.match(pagina, /oferta\.processando[\s\S]*?title="Processando a planilha"/);
  assert.match(pagina, /!oferta\.processando && oferta\.ofertas\.length/);
  assert.match(pagina, /!oferta\.processando \? \([\s\S]*?<EmptyState/);
});
