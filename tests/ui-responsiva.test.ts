import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ler = (caminho: string) => readFile(new URL(`../${caminho}`, import.meta.url), "utf8");

test("tabela de ofertas omite preço clube e mantém dez colunas", async () => {
  const pagina = await ler("src/routes/_authenticated/ofertas.tsx");
  const cabecalho = pagina.match(/<TableHeader>[\s\S]*?<\/TableHeader>/)?.[0] ?? "";

  assert.equal(cabecalho.includes("Preço clube"), false);
  assert.equal((cabecalho.match(/<TableHead(?:>|\s)/g) ?? []).length, 10);
  assert.match(pagina, /<TableCell colSpan=\{10\}/);
});

test("tabela cabe no desktop e preserva rolagem legível no celular", async () => {
  const [ajustes, estilos] = await Promise.all([
    ler("src/app-overrides.css"),
    ler("src/styles.css"),
  ]);

  assert.match(ajustes, /@media \(min-width: 901px\)[\s\S]*?\.offers-table-wrap \.offers-table/);
  assert.match(ajustes, /\.offers-table-wrap \.offers-table[\s\S]*?min-width: 0 !important/);
  assert.match(estilos, /\.offers-table-wrap table \{[\s\S]*?min-width: 1280px/);
});

test("modais móveis ficam acima da navegação e com altura limitada", async () => {
  const estilos = await ler("src/app-overrides.css");

  assert.match(estilos, /\[data-slot="dialog-overlay"\] \{[\s\S]*?z-index: 120 !important/);
  assert.match(estilos, /\[data-slot="dialog-content"\] \{[\s\S]*?z-index: 121 !important/);
  assert.match(estilos, /max-height: 78dvh !important/);
});

test("perfil móvel mantém saída e setores do catálogo usam modal", async () => {
  const [shell, catalogo] = await Promise.all([
    ler("src/components/AppShell.tsx"),
    ler("src/routes/_authenticated/catalogo.tsx"),
  ]);

  assert.match(shell, /app-profile-actions[\s\S]*?handleSignOut\(\)[\s\S]*?Sair/);
  assert.match(catalogo, /catalog-files-mobile-trigger/);
  assert.match(catalogo, /<DialogTitle>Arquivos importados<\/DialogTitle>/);
});
