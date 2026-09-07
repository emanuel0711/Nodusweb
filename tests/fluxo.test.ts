import assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  processarLinhasOfertas,
  validarCodigosNoCatalogo,
} from "../src/modules/ofertas/processar-ofertas.ts";
import {
  selecionarCodigosOferta,
  separarVariantesOferta,
  extrairExcecoes,
} from "../src/modules/ofertas/codigos-oferta.ts";
import {
  lerPlanilha,
  gerarPlanilhaDoClube,
  valorDoCampo,
} from "../src/modules/planilhas/planilha.ts";
import { ehPorQuilo } from "../src/modules/ofertas/regras-oferta.ts";
import type { Produto } from "../src/modules/catalogo/catalogo.ts";

const produto = (id: string, description: string, extra: Partial<Produto> = {}): Produto => ({
  id,
  description,
  ean: "789000000" + id.padStart(4, "0"),
  internal_code: null,
  promotion_code: null,
  unit: "UN",
  unit_price: null,
  cost: null,
  category: null,
  image_url: null,
  ...extra,
});
const catalogo = [
  produto("1", "Refresco em pó Frisco uva 25g"),
  produto("2", "Refresco em pó Frisco laranja 25g"),
  produto("3", "Refresco em pó Frisco limão 25g"),
  produto("4", "Refresco em pó Tang uva 25g"),
  produto("5", "Refresco em pó Frisco uva 18g"),
  produto("6", "Coca Cola tradicional 2L"),
  produto("7", "Coca Cola zero 2L"),
  produto("8", "Arroz Tio João branco 5kg"),
  produto("9", "Arroz Tio João parboilizado 5kg"),
  produto("10", "Banana prata KG", { unit: "KG", ean: null, internal_code: "0012" }),
];
const linha = (PRODUTO: string) => ({ PRODUTO, OFERTA: 5.99, CLUBE: 4.99, LIMITE: "3 unidades" });
test("fluxo reúne Frisco em uma linha e conserva preços e limite", () => {
  const ofertas = processarLinhasOfertas([linha("Frisco sabores 25g")], catalogo);
  assert.equal(ofertas.length, 1);
  assert.equal(ofertas[0]!.codigos.length, 3);
  assert.equal(ofertas[0]!.preco, 5.99);
  assert.equal(ofertas[0]!.precoClube, 4.99);
  assert.equal(ofertas[0]!.limite, 3);
  assert.equal(ofertas[0]!.motivoRevisao, null);
});
test("oferta combinada de refrigerante vira duas linhas", () => {
  const ofertas = processarLinhasOfertas([linha("Coca Cola tradicional e zero 2L")], catalogo);
  assert.equal(ofertas.length, 2);
  assert.deepEqual(
    ofertas.map((o) => o.codigos),
    [[catalogo[5]!.ean], [catalogo[6]!.ean]],
  );
});
test("arroz branco e parboilizado separados usam EAN de pacote", () => {
  const ofertas = processarLinhasOfertas(
    [linha("Arroz Tio João branco e parboilizado 5 kg")],
    catalogo,
  );
  assert.equal(ofertas.length, 2);
  assert.deepEqual(
    ofertas.map((o) => o.codigos),
    [[catalogo[7]!.ean], [catalogo[8]!.ean]],
  );
  assert.ok(ofertas.every((o) => !o.porQuilo));
});
test("ofertas com limites diferentes não são fundidas", () => {
  const ofertas = processarLinhasOfertas(
    [linha("Frisco sabores 25g"), { ...linha("Frisco sabores 25g"), LIMITE: "2 unidades" }],
    catalogo,
  );
  assert.equal(ofertas.length, 2);
});
test("hortifruti por kg conserva código interno com zero inicial", () => {
  const ofertas = processarLinhasOfertas(
    [{ PRODUTO: "Banana prata KG", OFERTA: 3.99, LIMITE: "2 kg" }],
    catalogo,
  );
  assert.deepEqual(ofertas[0]!.codigos, ["0012"]);
  assert.equal(ofertas[0]!.unidade, "Kg");
});
test("gramatura decimal equivalente sem perda da vírgula", () => {
  const p = produto("21", "Suco Aurora uva 1500ml");
  assert.deepEqual(selecionarCodigosOferta("Suco Aurora uva 1,5 L", [p], false).codigos, [p.ean]);
});
test("sabores sem gramatura pede revisão", () => {
  const r = selecionarCodigosOferta("Frisco sabores", catalogo, false);
  assert.deepEqual(r.codigos, []);
  assert.match(r.motivo!, /gramatura/);
});
test("zero nunca entra na oferta tradicional", () => {
  assert.deepEqual(selecionarCodigosOferta("Coca Cola tradicional 2L", catalogo, false).codigos, [
    catalogo[5]!.ean,
  ]);
});
test("marca aproximada não autoriza código de outra marca", () => {
  assert.deepEqual(
    selecionarCodigosOferta("Frisco sabores 25g", [produto("30", "Refresco Frisky uva 25g")], false)
      .codigos,
    [],
  );
});
test("EAN repetido é exportado uma vez", () => {
  const p = produto("32", "Sabão em pó Brilhante 800g");
  assert.deepEqual(
    selecionarCodigosOferta("Sabão em pó Brilhante 800g", [p, { ...p, id: "outro" }], false)
      .codigos,
    [p.ean],
  );
});
test("custo alto sinaliza revisão sem alterar identidade", () => {
  const p = produto("33", "Sabão em pó Brilhante 800g", { cost: 20 });
  const r = selecionarCodigosOferta(p.description, [p], false, [], 5);
  assert.deepEqual(r.codigos, [p.ean]);
  assert.match(r.motivo!, /custo/);
});
test("exceção por EAN remove somente o código indicado", () => {
  const nome = "Frisco sabores 25g exceto " + catalogo[0]!.ean;
  assert.equal(
    selecionarCodigosOferta(nome, catalogo, false, extrairExcecoes({}, nome)).codigos.length,
    2,
  );
});
test("exclusão de zero não desaparece na extração", () => {
  const nome = "Coca Cola 2L exceto zero";
  assert.deepEqual(
    selecionarCodigosOferta(nome, catalogo, false, extrairExcecoes({}, nome)).codigos,
    [catalogo[5]!.ean],
  );
});
test("EAN da entrada ausente no catálogo não passa para exportação", () => {
  const oferta = processarLinhasOfertas(
    [{ ...linha("Frisco sabores 25g"), EAN: "7899999999999" }],
    catalogo,
  )[0]!;
  assert.deepEqual(oferta.codigos, []);
  assert.equal(oferta.ean, "");
});
test("edição manual só exporta códigos presentes no catálogo", () => {
  const oferta = processarLinhasOfertas([linha("Frisco sabores 25g")], catalogo)[0]!;
  assert.equal(validarCodigosNoCatalogo(oferta, catalogo), true);
  assert.equal(
    validarCodigosNoCatalogo({ ...oferta, codigos: ["7899999999999"] }, catalogo),
    false,
  );
});
test("embalagem de 5 kg não vira venda por quilo", () => {
  assert.equal(ehPorQuilo("Arroz Tio João 5 kg", "", "", "7890000000008"), false);
  assert.equal(ehPorQuilo("Banana prata KG", "", "", ""), true);
});
test("limite não é deduzido da gramatura no nome", () => {
  assert.equal(valorDoCampo({ PRODUTO: "Arroz Tio João 5 kg", OFERTA: 20 }, ["LIMITE"]), "");
});
test("CSV de ofertas mantém coluna A", async () => {
  const linhas = await lerPlanilha(
    new File(
      ["PRODUTO;OFERTA;CLUBE;LIMITE\nFrisco sabores 25g;5,99;4,99;3 unidades"],
      "ofertas.csv",
    ),
    { preservarColunaA: true },
  );
  assert.equal(linhas[0]!["PRODUTO"], "Frisco sabores 25g");
  assert.equal(processarLinhasOfertas(linhas, catalogo)[0]!.codigos.length, 3);
});
test("CSV do catálogo continua descartando coluna A de referência", async () => {
  const linhas = await lerPlanilha(
    new File(["Ref;Produto;EAN\nreferencia;Frisco uva 25g;7890000000001"], "catalogo.csv"),
  );
  assert.equal(linhas[0]!["Ref"], undefined);
  assert.equal(linhas[0]!["Produto"], "Frisco uva 25g");
});
test("XLSX encontra cabeçalho depois de título com duas células", async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ["Ofertas da semana", "01/09"],
      [],
      ["PRODUTO", "OFERTA", "CLUBE", "LIMITE"],
      ["Frisco sabores 25g", 5.99, 4.99, "3 unidades"],
    ]),
    "Ofertas",
  );
  const file = new File([XLSX.write(wb, { bookType: "xlsx", type: "buffer" })], "ofertas.xlsx");
  const linhas = await lerPlanilha(file, { preservarColunaA: true });
  assert.equal(linhas[0]!["PRODUTO"], "Frisco sabores 25g");
});
test("exportação XLSX conserva EANs, preço, unidade e campos do Clube", () => {
  const ofertas = processarLinhasOfertas([linha("Frisco sabores 25g")], catalogo);
  const bytes = gerarPlanilhaDoClube(
    ofertas.map((o) => ({
      name: o.nome,
      price: o.preco,
      promotionalPrice: o.precoClube,
      limit: o.limite,
      imageUrl: "",
      code: o.codigo,
      codeType: "EAN",
      unidade: o.unidade,
    })),
    {
      carrossel: "6431 - Promoções",
      ativarEm: "07/09/2026 08:00:00",
      inativarEm: "08/09/2026 22:00:00",
    },
  );
  const wb = XLSX.read(bytes, { type: "array" }),
    aba = wb.Sheets[wb.SheetNames[0]!]!;
  const rows = XLSX.utils.sheet_to_json(aba);
  assert.equal(rows.length, 1);
  const r = rows[0] as Record<string, unknown>;
  assert.equal(r["Códigos dos produtos"], ofertas[0]!.codigos.join(";"));
  assert.equal(r["Preço"], 5.99);
  assert.equal(r["Preço promocional"], 4.99);
  assert.equal(r["Unidade"], "Unidade");
  assert.equal(r["URL da imagem"], "");
  assert.equal(r["Tipo do código"], "EAN");
  assert.equal(aba["N2"].t, "s");
});
test("nenhuma variante é criada para lista de sabores", () => {
  assert.deepEqual(separarVariantesOferta("Frisco sabores 25g"), ["Frisco sabores 25g"]);
});

test("resultado não depende da ordem do catálogo", () => {
  const nome = "Frisco sabores 25g";
  assert.deepEqual(
    selecionarCodigosOferta(nome, catalogo, false).codigos,
    selecionarCodigosOferta(nome, [...catalogo].reverse(), false).codigos,
  );
});
test("sabores sem variante mantém a versão comum e exclui zero", () => {
  const itens = [
    produto("50", "Refresco Frisco uva 25g"),
    produto("51", "Refresco Frisco zero uva 25g"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Frisco sabores 25g", itens, false).codigos, [
    itens[0]!.ean,
  ]);
});
test("recarregar mantém exclusão vinda de outra coluna", () => {
  const o = processarLinhasOfertas(
    [{ ...linha("Frisco sabores 25g"), OBS: "exceto uva" }],
    catalogo,
  )[0]!;
  assert.equal(o.codigos.length, 2);
  const recarregada = processarLinhasOfertas([o.linhaOrigem!], catalogo)[0]!;
  assert.deepEqual(recarregada.codigos, o.codigos);
});
test("EAN zero à esquerda sobrevive à leitura e exportação", () => {
  const p = produto("52", "Biscoito Aurora 100g", { ean: "0123456789012" });
  const o = processarLinhasOfertas([linha("Biscoito Aurora 100g")], [p])[0]!;
  assert.equal(o.codigo, "0123456789012");
});
test("EAN malformado no catálogo não é escolhido", () => {
  const p = produto("53", "Frisco uva 25g", { ean: "abc7890000000053" });
  assert.deepEqual(selecionarCodigosOferta("Frisco uva 25g", [p], false).codigos, []);
});
test("gás explícito separa as duas ofertas", () => {
  const itens = [
    produto("54", "Água Crystal com gás 500ml"),
    produto("55", "Água Crystal sem gás 500ml"),
  ];
  const r = processarLinhasOfertas([linha("Água Crystal com e sem gás 500ml")], itens);
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((o) => o.codigos),
    itens.map((p) => [p.ean]),
  );
});
test("mesmo produto com preços distintos mantém duas linhas", () => {
  const r = processarLinhasOfertas(
    [linha("Frisco sabores 25g"), { ...linha("Frisco sabores 25g"), CLUBE: 3.99 }],
    catalogo,
  );
  assert.equal(r.length, 2);
});

test("preço clube não preenche indevidamente o preço normal ausente", () => {
  const o = processarLinhasOfertas(
    [{ PRODUTO: "Frisco sabores 25g", "Preço Clube": 1.99 }],
    catalogo,
  )[0]!;
  assert.equal(o.preco, null);
  assert.equal(o.precoClube, 1.99);
});
test("traço de preço vazio não vira zero", () => {
  const o = processarLinhasOfertas(
    [{ PRODUTO: "Frisco sabores 25g", OFERTA: "—", CLUBE: "—" }],
    catalogo,
  )[0]!;
  assert.equal(o.preco, null);
  assert.equal(o.precoClube, null);
});
test("unidade UN e Unidade representam a mesma família", () => {
  const itens = [
    produto("71", "Sabão Brilhante 800g", { unit: "UN" }),
    produto("72", "Sabão Brilhante 800g", { unit: "Unidade" }),
  ];
  assert.equal(selecionarCodigosOferta("Sabão Brilhante 800g", itens, false).codigos.length, 2);
});
test("validação final rejeita código interno em produto vendido por unidade", () => {
  const o = processarLinhasOfertas([linha("Frisco sabores 25g")], catalogo)[0]!;
  assert.equal(
    validarCodigosNoCatalogo({ ...o, porQuilo: true, codigos: ["123"] }, [
      produto("73", "Frisco uva 25g", { internal_code: "123" }),
    ]),
    false,
  );
});

test("separar variantes preserva acentos e gramatura no nome", () => {
  assert.deepEqual(separarVariantesOferta("Arroz Tio João branco e parboilizado 5 kg"), [
    "Arroz Tio João 5 kg branco",
    "Arroz Tio João 5 kg parboilizado",
  ]);
});

test("modelo de cartaz ignora o aviso de vigência na coluna EAN", () => {
  const itens = [produto("74", "Refresco em pó Frisco uva 18g")];
  const oferta = processarLinhasOfertas(
    [{ PRODUTO: "Refresco em pó Frisco 18g", EAN: "OFERTA DISPONIVEL NOS DIAS 01 E 02" }],
    itens,
  )[0]!;
  assert.deepEqual(oferta.codigos, [itens[0]!.ean]);
});

test("Frisco sem sabor expande a família de sabores", () => {
  const itens = [
    produto("75", "Refresco em pó Frisco uva 18g"),
    produto("76", "Refresco em pó Frisco limão 18g"),
    produto("77", "Refresco em pó Frisco zero uva 18g"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Refresco em pó Frisco 18g", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
  ]);
});

test("oferta comum não inclui cerveja 0,0%", () => {
  const itens = [
    produto("78", "Cerveja Heineken 330ml long neck"),
    produto("79", "Cerveja Heineken 330ml 0,0% long neck"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Cerveja Heineken 330ml", itens, false).codigos, [
    itens[0]!.ean,
  ]);
});

test("descrição genérica prefere o produto-base", () => {
  const itens = [
    produto("80", "Peça int patinho kg", { unit: "KG", ean: null, internal_code: "68" }),
    produto("81", "Bife light patinho jovem kg", { unit: "KG", ean: null, internal_code: "1930" }),
  ];
  assert.deepEqual(selecionarCodigosOferta("Carne bov patinho kg", itens, true).codigos, ["68"]);
});

test("alternativas separadas por ou ficam na mesma linha", () => {
  const itens = [produto("82", "Uva Itália 500g bandeja"), produto("83", "Uva Isis 500g bdj")];
  assert.deepEqual(
    selecionarCodigosOferta("Uva Itália ou Isis bandeja 500g", itens, false).codigos,
    [itens[0]!.ean, itens[1]!.ean],
  );
});

test("alternativa ausente mantém a linha em revisão", () => {
  const itens = [produto("84", "Uva Isis 500g bandeja")];
  const resultado = selecionarCodigosOferta("Uva Itália ou Isis bandeja 500g", itens, false);
  assert.deepEqual(resultado.codigos, []);
  assert.match(resultado.motivo!, /todos os produtos/);
});

test("Red Horse sem sabor reúne sabores comuns e exclui zero", () => {
  const itens = [
    produto("85", "Energético Red Horse 473ml tradicional lata"),
    produto("86", "Energético Red Horse 473ml melancia lata"),
    produto("87", "Energético Red Horse 473ml melancia zero lata"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Energético Red Horse 473ml", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
  ]);
});

test("abreviação QJ encontra queijo do catálogo", () => {
  const item = produto("88", "QJ Frimesa 300g mussarela fat");
  assert.deepEqual(
    selecionarCodigosOferta("Queijo Frimesa 300g mussarela fatiado", [item], false).codigos,
    [item.ean],
  );
});

test("quantidade 03UND equivale a C/3UNID do catálogo", () => {
  const item = produto("89", "Milho verde BDJ C/3UNID");
  assert.deepEqual(
    selecionarCodigosOferta("Milho verde bandeja com 03UND", [item], false).codigos,
    [item.ean],
  );
});

test("Red Horse reúne sabores reais adicionais", () => {
  const itens = [
    produto("90", "Energético Red Horse 473ml frutas tropicais"),
    produto("91", "Energético Red Horse 473ml açaí e guaraná"),
    produto("92", "Energético Red Horse 473ml maçã verde"),
    produto("93", "Energético Red Horse 473ml mangarito zero"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Energético Red Horse 473ml", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
    itens[2]!.ean,
  ]);
});

test("Red Horse real reúne todas as latas comuns e exclui zero", () => {
  const itens = [
    produto("94", "Energético Red Horse 473ml frutas tropicais LT"),
    produto("95", "Energético Red Horse 473ml coco e açaí LT"),
    produto("96", "Energético Red Horse 473ml mangarito"),
    produto("97", "Energético Red Horse 473ml tradicional zero"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Energético Red Horse 473ml", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
    itens[2]!.ean,
  ]);
});

test("cerveja com álcool aceita a descrição comum do catálogo", () => {
  const item = produto("98", "Cerveja Heineken 330ml long neck");
  const semAlcool = produto("103", "Cerveja Heineken 330ml 0,0% long neck");
  assert.deepEqual(
    selecionarCodigosOferta("Cerveja Heineken 330ml com álcool", [item], false).codigos,
    [item.ean],
  );
  assert.deepEqual(
    selecionarCodigosOferta("Cerveja Heineken 330ml sem álcool", [item, semAlcool], false).codigos,
    [semAlcool.ean],
  );
});

test("vinho genérico reúne variedades da mesma marca e volume", () => {
  const itens = [
    produto("99", "Vinho Exemplo 750ml tinto seco garrafa"),
    produto("100", "Vinho Exemplo 750ml tinto suave GRF"),
    produto("101", "Vinho Outra Marca 750ml tinto suave"),
    produto("102", "Vinho Exemplo 750ml sem álcool"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Vinho Exemplo 750ml", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
  ]);
});

test("açúcar Alto Alegre sem tipo escolhe somente refinado", () => {
  const refinado = produto("104", "Açúcar Alto Alegre 1kg refinado");
  const demerara = produto("105", "Açúcar Alto Alegre 1kg demerara");
  assert.deepEqual(
    selecionarCodigosOferta("Açúcar Alto Alegre 1kg", [refinado, demerara], false).codigos,
    [refinado.ean],
  );
});

test("detergente Ypê sem variedade reúne todos de 500ml", () => {
  const itens = [
    produto("106", "Detergente Ypê 500ml coco"),
    produto("107", "Detergente Ypê 500ml capim limão líquido"),
    produto("108", "Detergente Ypê 500ml neutro"),
    produto("109", "Detergente Outra Marca 500ml neutro"),
  ];
  assert.deepEqual(selecionarCodigosOferta("Detergente Ypê 500ml", itens, false).codigos, [
    itens[0]!.ean,
    itens[1]!.ean,
    itens[2]!.ean,
  ]);
});

test("Abacaxi Pérola por unidade aceita o PLU 1663 confirmado", () => {
  const item = produto("110", "Abacaxi Pérola", {
    ean: "1663",
    internal_code: null,
    unit: "UN",
  });
  assert.deepEqual(selecionarCodigosOferta("Abacaxi Pérola UND", [item], false).codigos, ["1663"]);
});

test("famílias comerciais confirmadas reúnem todas as variedades", () => {
  const casos = [
    [
      "Lava roupas líquido Brilhante 3L",
      "Lava roupas liq Brilhante 3L delicadeza",
      "Kit lava roupas liq Brilhante 500ml + garrafa 3L vazia",
    ],
    [
      "Amaciante conc Aquafast 1,5L",
      "Amaciante conc Aquafast 1,5L branco ternura",
      "Amaciante conc Aquafast 1,5L rosa romance",
    ],
    [
      "Massa Isabela 400g sêmola",
      "Massa Isabela 400g sêmola espaguete",
      "Massa Isabela 400g sêmola penne",
    ],
    ["Sopão Apti 180g", "Sopão Apti 180g carne com macarrão", "Sopão Apti 180g canjão com arroz"],
    [
      "Inseticida Mat Inset aero 360ml",
      "Inseticida Mat Inset aero 360ml citronela",
      "Inseticida Mat Inset aero 360ml sem odor",
    ],
  ];
  for (const [oferta, ...descricoes] of casos) {
    const itens = descricoes.map((descricao, indice) => produto(String(120 + indice), descricao!));
    assert.equal(selecionarCodigosOferta(oferta!, itens, false).codigos.length, 2, oferta);
  }
});

test("Pom Pom Clássica Jumbo reúne todos os tamanhos Jumbo", () => {
  const itens = [
    produto("130", "Fralda desc Pom Pom clássica P C/24UN Jumbo"),
    produto("131", "Fralda desc Pom Pom clássica G C/20UN Jumbo"),
    produto("132", "Fralda desc Pom Pom outra linha G C/20UN"),
  ];
  assert.deepEqual(
    selecionarCodigosOferta("Fralda desc Pom Pom clássica Jumbo", itens, false).codigos,
    [itens[0]!.ean, itens[1]!.ean],
  );
});

test("abreviações e ordem do catálogo não impedem Nescau e Biscobom", () => {
  const nescau = produto("133", "ACHOC PO NESCAU 550G SACHE");
  const biscoito = produto("134", "BISC BISCOBOM 260G MARIA TRADICIONAL");
  assert.deepEqual(
    selecionarCodigosOferta("Achocolatado em pó Nescau 550g sachê", [nescau], false).codigos,
    [nescau.ean],
  );
  assert.deepEqual(
    selecionarCodigosOferta("Biscoito Biscobom Maria tradicional 260g", [biscoito], false).codigos,
    [biscoito.ean],
  );
});

test("repolho genérico usa o PLU confirmado do verde", () => {
  const verde = produto("135", "Repolho verde", { ean: "10399", internal_code: null });
  const roxo = produto("136", "Repolho roxo", { ean: "10382", internal_code: null });
  assert.deepEqual(selecionarCodigosOferta("Repolho UND", [verde, roxo], false).codigos, ["10399"]);
});

test("estoque é o último critério para resolver uma família ambígua", () => {
  const itens = [
    produto("137", "Aipim Marca A 1kg congelado", { stock_quantity: 0 }),
    produto("138", "Aipim Marca B 1kg congelado", { stock_quantity: 8 }),
    produto("139", "Aipim Marca C 1kg congelado", { stock_quantity: null }),
  ];
  assert.deepEqual(selecionarCodigosOferta("Aipim congelado 1kg", itens, false).codigos, [
    itens[1]!.ean,
  ]);
});

test("catálogo continua funcionando quando estoque ainda não foi carregado", () => {
  const item = produto("140", "Produto Exemplo 500g", { stock_quantity: null });
  assert.deepEqual(selecionarCodigosOferta("Produto Exemplo 500g", [item], false).codigos, [
    item.ean,
  ]);
});
