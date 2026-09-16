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
test("congelado e resfriado respeitam o estado informado na oferta", () => {
  const a = p("FRANGO COXA E SOBRECOXA CONGELADA", "", { unit: "KG", internal_code: "507" });
  const b = p("FRANGO COXA E SOBRECOXA RESFRIADA KG", "", { unit: "KG", internal_code: "505" });
  const c = p("NUTRIFRANGO BDJ KG COXA E SOBRECOXA", "", { unit: "KG", internal_code: "902" });
  assert.deepEqual(selecionarCodigosOferta("COXA E SOBRECOXA CONG KG", [a, b, c], true).codigos, [
    "507",
  ]);
  assert.deepEqual(selecionarCodigosOferta("COXA E SOBRECOXA RESF KG", [a, b, c], true).codigos, [
    "505",
  ]);
});
test("atributos com e sem nao se misturam independentemente do produto", () => {
  for (const atributo of ["PIMENTA", "RECHEIO", "CORANTE"]) {
    const a = p(`PRODUTO MARCA 230G COM ${atributo}`, "1234567890123");
    const b = p(`PRODUTO MARCA 230G SEM ${atributo}`, "1234567890124");
    assert.deepEqual(selecionarCodigosOferta(a.description, [a, b], false).codigos, [a.ean]);
    assert.deepEqual(selecionarCodigosOferta(b.description, [a, b], false).codigos, [b.ean]);
  }
});
test("massa para pizza nao herda agrupamento de sabores de pizza pronta", () => {
  const a = p("MASSA PIZZA MARCA 150G", "1234567890123");
  const b = p("MASSA PIZZA MARCA 150G INTEGRAL", "1234567890124");
  assert.deepEqual(selecionarCodigosOferta(a.description, [a, b], false).codigos, [a.ean]);
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
test("preparo ausente na oferta nao inclui empanado ou temperado", () => {
  const comum = p("FRANGO LAR 700G FILE SASSAMI IQF", "7896419727798", {
    stock_quantity: 57,
    cost: 9.43,
  });
  const temperado = p("FRANGO LAR 700G FILE SASSAMI TEMP IQF", "7896419730217", {
    stock_quantity: 0,
    cost: 13.63,
  });
  const empanado = p("FILEZINHO LAR 700G SASSAMI EMPANADO", "7896419716129", {
    stock_quantity: 17,
    cost: 13.57,
  });
  assert.deepEqual(
    selecionarCodigosOferta("SASSAMI LAR 700G", [temperado, empanado, comum], false, [], 15.99)
      .codigos,
    [comum.ean],
  );
});
test("nome base e medida reunem aromas adicionais do catalogo", () => {
  for (const [nome, descricoes] of [
    ["SABONETE IARA 160G", ["SABONETE IARA 160G LAVANDA", "SABONETE IARA 160G ERVA DOCE"]],
    [
      "DESODORANTE MARCA 150ML",
      ["DESODORANTE MARCA 150ML FRESH", "DESODORANTE MARCA 150ML ACTIVE"],
    ],
    ["BISCOITO MARCA 100G", ["BISCOITO MARCA 100G CHOCOLATE", "BISCOITO MARCA 100G MORANGO"]],
  ] as [string, string[]][]) {
    const itens = descricoes.map((descricao, indice) =>
      p(descricao, String(7890000000300 + indice)),
    );
    assert.deepEqual(
      selecionarCodigosOferta(nome, itens, false).codigos.sort(),
      itens.map((item) => item.ean).sort(),
    );
  }
});
test("descricao generica sem marca continua exigindo revisao", () => {
  const itens = [
    p("AMACIANTE YPE 5L LAVANDA", "7890000000401"),
    p("AMACIANTE COMFORT 5L LAVANDA", "7890000000402"),
  ];
  const resultado = selecionarCodigosOferta("AMACIANTE 5L", itens, false);
  assert.deepEqual(resultado.codigos, []);
  assert.match(resultado.motivo!, /Mais de uma família/);
});
