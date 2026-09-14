import assert from "node:assert/strict";
import { test } from "node:test";
import { processarLinhasOfertas } from "../src/modules/ofertas/processar-ofertas";
import {
  selecionarCodigosOferta,
  separarVariantesOferta,
} from "../src/modules/ofertas/codigos-oferta";
import type { Produto } from "../src/modules/catalogo/catalogo";
const p = (description: string, ean: string, extra: Partial<Produto> = {}): Produto => ({
  id: ean,
  description,
  ean,
  internal_code: null,
  promotion_code: null,
  unit: "UN",
  unit_price: null,
  cost: null,
  category: null,
  image_url: null,
  ...extra,
});
test("cartaz ignora qualquer valor da coluna EAN preservando a origem", () => {
  for (const ean of ["VALIDADE 12/09", "9999999999999", "texto qualquer"]) {
    const row = { DESCRICAO: "CAFE MARCA 500G", REFERENCIA: "LIMITE DE 3 UN POR CPF", EAN: ean };
    const [o] = processarLinhasOfertas([row], [p("CAFE MARCA 500G", "1234567890123")]);
    assert.deepEqual(o.codigos, ["1234567890123"]);
    assert.equal(o.linhaOrigem?.EAN, ean);
  }
});
test("pares abreviados de alcool e gas sao separados sem regra de marca", () => {
  for (const tipo of ["ALCOOL", "GAS"])
    assert.equal(separarVariantesOferta(`BEBIDA MARCA 330ML C/ E S/ ${tipo}`).length, 2);
});
test("integral de arroz nao recebe o codigo da versao comum", () => {
  const a = p("ARROZ MARCA 1KG PARBOLIZADO INTEGRAL", "1234567890123"),
    b = p("ARROZ MARCA 1KG PARBOLIZADO", "1234567890124");
  assert.deepEqual(selecionarCodigosOferta(a.description, [a, b], false).codigos, [a.ean]);
});
test("com pele nunca inclui sem pele", () => {
  const a = p("CARNE SUINA PALETA COM PELE", "", { unit: "KG", internal_code: "420" }),
    b = p("CARNE SUINA PALETA SEM PELE", "", { unit: "KG", internal_code: "437" });
  assert.deepEqual(selecionarCodigosOferta("PALETA SUINA COM PELE RESF KG", [a, b], true).codigos, [
    "420",
  ]);
});
test("preserva identificadores numericos do ERP sem completar digitos", () => {
  for (const code of ["70847033301", "4718"])
    assert.deepEqual(
      selecionarCodigosOferta("PRODUTO MARCA 650G", [p("PRODUTO MARCA 650G", code)], false).codigos,
      [code],
    );
});
test("pizza e amaciante sem variedade agrupam marcas novas", () => {
  for (const [nome, descs] of [
    ["PIZZA MARCA 400G", ["PIZZA MARCA 400G CALABRESA", "PIZZA MARCA 400G FRANGO"]],
    [
      "AMACIANTE CONCENTRADO MARCA 1,5L",
      ["AMACIANTE CONC MARCA 1,5L ALFAZEMA", "AMACIANTE CONC MARCA 1,5L BRISA"],
    ],
  ] as [string, string[]][]) {
    const items = descs.map((d, i) => p(d, String(1234567890123 + i)));
    assert.equal(selecionarCodigosOferta(nome, items, false).codigos.length, 2);
  }
});
