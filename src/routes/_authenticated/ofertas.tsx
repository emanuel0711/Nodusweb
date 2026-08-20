import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, AlertTriangle, ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerPlanilha, valorDoCampo, exportarModeloDoClube, type LinhaPlanilha, type OfertaParaExportar } from "@/lib/planilha";
import { melhorCorrespondencia, lerLimite, lerPreco } from "@/lib/comparar-textos";
import { buscarImagens } from "@/lib/imagens";
import { carregarTodosProdutos, limparCodigo, limparEan, type Produto } from "@/lib/catalogo";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({
    meta: [
      { title: "Automação de ofertas — OfertaFlow" },
      { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube já preenchido com códigos e imagens." },
      { property: "og:title", content: "Automação de ofertas — OfertaFlow" },
      { property: "og:description", content: "Envie a planilha da semana e gere o arquivo do clube já preenchido." },
    ],
  }),
  component: PaginaOfertas,
});

/** Uma linha da planilha de ofertas depois de cruzada com o catálogo. */
interface Oferta {
  nome: string;
  preco: number | null;
  precoClube: number | null;
  limite: number | null;
  ean: string;
  codigo: string;
  imagem: string;
  encontrado: string | null;
  nota: number;
}

const NOMES = ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao", "Mercadoria"];
const PRECOS = ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco", "Valor"];
const PRECOS_CLUBE = ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"];
const LIMITES = ["LIMITE", "Limite por CPF", "Limite", "Limite por cliente"];

function cruzar(linha: LinhaPlanilha, catalogo: Produto[], notaMinima: number): Oferta | null {
  const nome = String(valorDoCampo(linha, NOMES) || "").trim();
  if (!nome) return null;

  const ean = limparEan(valorDoCampo(linha, ["EAN", "Código de barras", "Codigo de barras", "GTIN"]));
  const codigo = limparCodigo(valorDoCampo(linha, ["Código da promoção", "Cód. Promoção", "Cód. Interno", "Codigo Interno", "Código"]));

  const exato =
    (ean && catalogo.find((produto) => limparEan(produto.ean) === ean)) ||
    (codigo && catalogo.find((produto) => limparCodigo(produto.promotion_code) === codigo || limparCodigo(produto.internal_code) === codigo)) ||
    undefined;
  const achado = exato ? { item: exato, score: 1 } : melhorCorrespondencia(nome, catalogo, notaMinima);
  const produto = achado?.item;

  return {
    nome,
    preco: lerPreco(valorDoCampo(linha, PRECOS)),
    precoClube: lerPreco(valorDoCampo(linha, PRECOS_CLUBE)),
    limite: lerLimite(valorDoCampo(linha, LIMITES)),
    ean: limparEan(produto?.ean) || ean,
    codigo: limparCodigo(produto?.promotion_code) || limparCodigo(produto?.internal_code) || codigo,
    imagem: produto?.image_url ?? "",
    encontrado: produto?.description ?? null,
    nota: achado?.score ?? 0,
  };
}

function PaginaOfertas() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [processando, setProcessando] = useState(false);
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [ofertas, setOfertas] = useState<Oferta[]>([]);
  const [notaMinima, setNotaMinima] = useState(0.62);

  function alterar(indice: number, mudanca: Partial<Oferta>) {
    setOfertas((atual) => atual.map((oferta, i) => (i === indice ? { ...oferta, ...mudanca } : oferta)));
  }

  async function processar(arquivo: File) {
    setProcessando(true);
    try {
      const [linhas, catalogo] = await Promise.all([lerPlanilha(arquivo), carregarTodosProdutos()]);
      if (!linhas.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");

      const cruzadas = linhas.map((linha) => cruzar(linha, catalogo, notaMinima)).filter((item): item is Oferta => item !== null);
      if (!cruzadas.length) throw new Error("Não encontrei uma coluna com o nome do produto na planilha.");

      const imagens = await buscarImagens(cruzadas.filter((item) => item.ean && !item.imagem).map((item) => item.ean));
      const finais = cruzadas.map((item) => ({ ...item, imagem: item.imagem || imagens.get(item.ean) || "" }));

      setOfertas(finais);
      setNomeArquivo(arquivo.name);

      const correspondidas = finais.filter((item) => item.nota >= notaMinima && item.codigo).length;
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        await supabase.from("offer_runs").insert({
          user_id: data.user.id,
          file_name: arquivo.name,
          total_items: finais.length,
          matched_items: correspondidas,
        });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${finais.length} oferta(s) processada(s) — ${correspondidas} com código encontrado.`);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha ao processar a planilha");
    } finally {
      setProcessando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function exportar() {
    if (!ofertas.length) return;
    const linhas: OfertaParaExportar[] = ofertas.map((oferta) => ({
      name: oferta.nome,
      price: oferta.preco,
      promotionalPrice: oferta.precoClube,
      limit: oferta.limite,
      imageUrl: oferta.imagem,
      code: oferta.codigo,
      codeType: "Interno",
    }));
    try {
      exportarModeloDoClube(linhas);
      toast.success("Arquivo do Clube gerado e enviado para download.");
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível gerar o arquivo.");
    }
  }

  const precisamRevisao = ofertas.filter((oferta) => !oferta.codigo || !oferta.imagem || oferta.nota < notaMinima).length;

  return (
    <AppShell title="Automação de ofertas" subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube.">
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input
          ref={campoArquivo}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={(evento) => {
            const arquivo = evento.target.files?.[0];
            if (arquivo) processar(arquivo);
          }}
        />
        <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>
          {processando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha da semana
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Sensibilidade</span>
          <Input
            type="number"
            min={0.3}
            max={1}
            step={0.05}
            className="w-24"
            value={notaMinima}
            onChange={(evento) => setNotaMinima(Number(evento.target.value) || 0.62)}
          />
        </div>
        <Button
          variant="destructive"
          disabled={!ofertas.length}
          className="ml-auto"
          onClick={() => {
            if (confirm("Excluir a planilha carregada?")) {
              setOfertas([]);
              setNomeArquivo("");
              toast.success("Planilha removida");
            }
          }}
        >
          <Trash2 className="size-4" /> Excluir planilha
        </Button>
        <Button variant="outline" disabled={!ofertas.length || processando} onClick={exportar}>
          <Download className="size-4" /> Baixar arquivo do Clube
        </Button>
      </div>

      {ofertas.length ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-secondary px-3 py-1 font-medium">{nomeArquivo}</span>
            <span className="rounded-full bg-secondary px-3 py-1">{ofertas.length} itens</span>
            {precisamRevisao ? (
              <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground">
                <AlertTriangle className="size-3.5" /> {precisamRevisao} precisam de revisão
              </span>
            ) : (
              <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Tudo pronto para exportar</span>
            )}
          </div>

          <div className="surface mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Img</TableHead>
                  <TableHead>Nome na sua planilha</TableHead>
                  <TableHead>Produto encontrado</TableHead>
                  <TableHead>Confiança</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Preço clube</TableHead>
                  <TableHead>Limite</TableHead>
                  <TableHead>EAN</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>URL da imagem</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ofertas.map((oferta, indice) => (
                  <TableRow
                    key={`${oferta.nome}-${indice}`}
                    className={!oferta.codigo || !oferta.imagem || oferta.nota < notaMinima ? "bg-warn/40" : ""}
                  >
                    <TableCell>
                      {oferta.imagem ? (
                        <img src={oferta.imagem} alt={oferta.nome} loading="lazy" className="size-10 rounded-md object-cover" />
                      ) : (
                        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <ImageIcon className="size-4" />
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-64 font-medium">{oferta.nome}</TableCell>
                    <TableCell className="max-w-72 text-xs text-muted-foreground">{oferta.encontrado || "Não encontrado"}</TableCell>
                    <TableCell>{Math.round(oferta.nota * 100)}%</TableCell>
                    <TableCell>{oferta.preco ?? "—"}</TableCell>
                    <TableCell>{oferta.precoClube ?? "—"}</TableCell>
                    <TableCell>{oferta.limite ?? "—"}</TableCell>
                    <TableCell>
                      <Input className="w-40" value={oferta.ean} maxLength={20} onChange={(e) => alterar(indice, { ean: limparEan(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-36" value={oferta.codigo} maxLength={60} onChange={(e) => alterar(indice, { codigo: limparCodigo(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-56" value={oferta.imagem} maxLength={1000} onChange={(e) => alterar(indice, { imagem: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover item"
                        onClick={() => setOfertas((atual) => atual.filter((_, i) => i !== indice))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">
          Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.
        </div>
      )}
    </AppShell>
  );
}
