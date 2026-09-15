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

test("abreviações plurais de unidade e embalagem não impedem correspondência", () => {
  const item = produto("10399", "REPOLHO VERDE", { ean: "10399" });
  assert.deepEqual(codigosDaFamiliaOferta("REPOLHO VERDE UNDS", undefined, [item], false), [
    "10399",
  ]);
});

test("estoque desempata marcas quando a oferta não informa a marca", () => {
  const itens = [
    produto("31", "AIPIM HORT PLENZ 1KG CONG", { stock_quantity: 268 }),
    produto("32", "AIPIM RAIZES DO SUL 1KG CONG", { stock_quantity: 0 }),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("AIPIM CONGELADO PACOTE 1KG", undefined, itens, false),
    [itens[0]!.ean],
  );
});

test("com osso aceita cadastro comum e rejeita desossado", () => {
  const itens = [
    produto("41", "PALETA NOV JOVEM KG", { internal_code: "123", ean: null, unit: "KG" }),
    produto("42", "C BOV PALETA DESOSSADA KG", { internal_code: "126", ean: null, unit: "KG" }),
    produto("43", "PALETA SETE BOV C/ OSSO", { internal_code: "170", ean: null, unit: "KG" }),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("PALETA BOV COM OSSO KG", undefined, itens, true),
    ["123"],
  );
});

test("variedades explícitas de fruta reúnem somente as pedidas", () => {
  const itens = [
    produto("51", "UVA ITALIA FRUTA NO PE 500G BDJ"),
    produto("52", "UVA ISIS FRUTA NO PE 500G S/SEMENTE BDJ"),
    produto("53", "UVA VITORIA GOTA DE MEL 500G S/SEMENTE BDJ"),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("UVA ISIS E ITÁLIA BDJ 500G", undefined, itens, false).sort(),
    [itens[0]!.ean, itens[1]!.ean].sort(),
  );
});

test("refrigerante sem sabor reúne as variedades da mesma marca e volume", () => {
  const itens = [
    produto("61", "REFRIG PEPITA 2L UVA"),
    produto("62", "REFRIG PEPITA 2L LIMAO"),
    produto("63", "REFRIG OUTRA MARCA 2L UVA"),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("REFRIGERANTE PEPITA 2L", undefined, itens, false).sort(),
    [itens[0]!.ean, itens[1]!.ean].sort(),
  );
});

test("sufixos técnicos curtos reúnem variações da mesma família", () => {
  const itens = [
    produto("71", "MASSA FRESCA BRESSIANI 400G PASTEL DG"),
    produto("72", "MASSA FRESCA BRESSIANI 400G PASTEL DL"),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("MASSA DE PASTEL BRESSIANI 400G", undefined, itens, false).sort(),
    itens.map((item) => item.ean).sort(),
  );
});

test("estoque não troca peito com osso por filé de peito", () => {
  const itens = [
    produto("81", "FRANGO CONG PEITO C OSSO", {
      internal_code: "590",
      ean: null,
      unit: "KG",
      stock_quantity: -1,
    }),
    produto("82", "FRANGO FILE PEITO KG CONG", {
      internal_code: "650",
      ean: null,
      unit: "KG",
      stock_quantity: 308,
    }),
  ];
  assert.deepEqual(
    codigosDaFamiliaOferta("PEITO DE FRANGO C/ OSSO CONG KG", undefined, itens, true),
    ["590"],
  );
});
