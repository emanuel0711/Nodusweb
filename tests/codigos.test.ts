import assert from "node:assert/strict";
import { test } from "node:test";
import {
  codigosDaFamiliaOferta,
  chaveBaseOferta,
  extrairExcecoes,
} from "../src/modules/ofertas/codigos-oferta.ts";
import type { Produto } from "../src/modules/catalogo/catalogo.ts";
function produto(id: string, description: string, overrides: Partial<Produto> = {}): Produto {
  return {
    id,
    description,
    ean: `789000000${id.padStart(4, "0")}`,
    internal_code: null,
    promotion_code: null,
    unit: "UN",
    unit_price: null,
    cost: null,
    category: null,
    image_url: null,
    ...overrides,
  };
}
const frisco = [
  produto("1", "Refresco em pó Frisco laranja 25g"),
  produto("2", "Refresco em pó Frisco uva 25g"),
  produto("3", "Refresco em pó Frisco limão 25g"),
  produto("4", "Refresco em pó Tang uva 25g"),
  produto("5", "Refresco em pó Frisco uva 18g"),
];
test("Frisco sabores reúne todos os EANs da marca e gramatura", () => {
  assert.deepEqual(
    codigosDaFamiliaOferta("Frisco sabores 25g", undefined, frisco, false).sort(),
    frisco
      .slice(0, 3)
      .map((p) => p.ean)
      .sort(),
  );
});
test("sabores respeita exclusão explícita", () => {
  const nome = "Frisco sabores 25g exceto uva";
  assert.deepEqual(
    codigosDaFamiliaOferta(nome, undefined, frisco, false, extrairExcecoes({}, nome)).sort(),
    [frisco[0]!.ean, frisco[2]!.ean].sort(),
  );
});
test("equivalentes Brilhante mantêm todos os EANs", () => {
  const itens = [
    produto("10", "Sabão em pó Brilhante 800g"),
    produto("11", "Sabão em pó Brilhante 800 g"),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("Sabão em pó Brilhante 800g", itens[0], itens, false).sort(),
    itens.map((p) => p.ean).sort(),
  );
});
test("1 L e 1000 ml são equivalentes", () => {
  const item = produto("12", "Suco Aurora uva 1000ml");
  assert.deepEqual(codigosDaFamiliaOferta("Suco Aurora uva 1L", undefined, [item], false), [
    item.ean,
  ]);
});
test("tradicional e zero possuem chaves distintas", () => {
  assert.notEqual(
    chaveBaseOferta("Coca Cola tradicional 2L"),
    chaveBaseOferta("Coca Cola zero 2L"),
  );
});
test("produto genérico ambíguo não escolhe a primeira marca", () => {
  const itens = [produto("20", "Amaciante Ype 5L"), produto("21", "Amaciante Comfort 5L")];
  assert.deepEqual(codigosDaFamiliaOferta("Amaciante 5L", undefined, itens, false), []);
});
test("catálogo vazio não inventa código", () => {
  assert.deepEqual(codigosDaFamiliaOferta("Frisco sabores 25g", undefined, [], false), []);
});
