import { aplicarRegras, ehPorQuilo, unidadesPorFardo, extrairNumeroLimite } from "../src/modules/ofertas/regras-oferta";
const casos: [string,string,string,string,string][] = [
 ["ACEM BOVINO KG","2 KG","1234","","KG"],
 ["PICANHA BOV KG","1,5","98765","",""],
 ["CERVEJA SKOL 473ML","1 FARDO","","7891234567895","UN"],
 ["REFRIGERANTE COCA 2L","2 FARDOS","","7891000000000","UN"],
 ["COXAO MOLE","3 KG","55","",""],
 ["FILE DE PEITO","2","1234567","",""],
 ["QUEIJO MUSSARELA KG","0,5 KG","4001","","KG"],
];
for (const c of casos) console.log(c[0],"| limite:",c[1],"=>",JSON.stringify(aplicarRegras(c[0],c[1],c[2],c[3],c[4])));
