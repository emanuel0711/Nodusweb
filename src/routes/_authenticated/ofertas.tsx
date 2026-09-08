import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AlertTriangle, Download, ImageIcon, Loader2, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CARROSSEIS, separarCodigos, useOfertas } from "@/modules/ofertas/use-ofertas";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({
    meta: [
      { title: "Automação de ofertas — OfertaFlow" },
      { name: "description", content: "Envie a planilha da semana e gere o arquivo do clube." },
    ],
  }),
  component: PaginaOfertas,
});

function PaginaOfertas() {
  const oferta = useOfertas();
  const [filtroPendencia, setFiltroPendencia] = useState<FiltroPendencia>("todas");
  return (
    <AppShell
      title="Automação de ofertas"
      subtitle="Envie a planilha da semana, confira o cruzamento com o catálogo e baixe o arquivo aceito pelo Clube."
    >
      <BarraAcao {...oferta} />
      {oferta.ofertas.length ? (
        <>
          <PainelPendencias
            ofertas={oferta.ofertas}
            notaMinima={oferta.notaMinima}
            filtro={filtroPendencia}
            setFiltro={setFiltroPendencia}
          />
          <TabelaOfertas {...oferta} filtroPendencia={filtroPendencia} />
        </>
      ) : (
        <EmptyState />
      )}
      <DialogExportacao {...oferta} />
      <DialogVisualizacao {...oferta} />
    </AppShell>
  );
}

type FiltroPendencia =
  | "todas"
  | "pendentes"
  | "sem_imagem"
  | "sem_codigo"
  | "estoque_zerado"
  | "com_duvida";

function itemComEstoqueZerado(item: ReturnType<typeof useOfertas>["ofertas"][number]) {
  const estoques = item.codigos
    .map((codigo) => item.estoquePorCodigo?.[codigo])
    .filter((estoque): estoque is number => estoque != null);
  return estoques.length > 0 && estoques.every((estoque) => estoque <= 0);
}

function itemPrecisaRevisao(
  item: ReturnType<typeof useOfertas>["ofertas"][number],
  notaMinima: number,
) {
  return (
    !item.imagem?.trim() ||
    !item.codigos.length ||
    itemComEstoqueZerado(item) ||
    Boolean(item.motivoRevisao) ||
    item.nota < notaMinima
  );
}

function PainelPendencias({
  ofertas,
  notaMinima,
  filtro,
  setFiltro,
}: {
  ofertas: ReturnType<typeof useOfertas>["ofertas"];
  notaMinima: number;
  filtro: FiltroPendencia;
  setFiltro: (filtro: FiltroPendencia) => void;
}) {
  const opcoes: Array<[FiltroPendencia, string, number]> = [
    ["todas", "Todas", ofertas.length],
    ["pendentes", "Com pendência", ofertas.filter((item) => itemPrecisaRevisao(item, notaMinima)).length],
    ["sem_imagem", "Sem imagem", ofertas.filter((item) => !item.imagem?.trim()).length],
    ["sem_codigo", "Sem código", ofertas.filter((item) => !item.codigos.length).length],
    ["estoque_zerado", "Estoque zerado", ofertas.filter(itemComEstoqueZerado).length],
    [
      "com_duvida",
      "Com dúvida",
      ofertas.filter((item) => Boolean(item.motivoRevisao) || item.nota < notaMinima).length,
    ],
  ];

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium">Revisar:</span>
      {opcoes.map(([valor, rotulo, total]) => (
        <Button
          key={valor}
          type="button"
          size="sm"
          variant={filtro === valor ? "default" : "outline"}
          onClick={() => setFiltro(valor)}
        >
          {rotulo} ({total})
        </Button>
      ))}
    </div>
  );
}

function BarraAcao({
  campoArquivo,
  processando,
  ofertas,
  notaMinima,
  setNotaMinima,
  nomeArquivo,
  precisamRevisao,
  limparOfertas,
  setModalAberto,
  processar,
}: ReturnType<typeof useOfertas>) {
  return (
    <>
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input
          ref={campoArquivo}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) void processar(arquivo);
          }}
        />
        <Button disabled={processando} onClick={() => campoArquivo.current?.click()}>
          {processando ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}{" "}
          Enviar planilha da semana
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
            onChange={(e) => setNotaMinima(Number(e.target.value) || 0.55)}
          />
        </div>
        <Button
          variant="destructive"
          disabled={!ofertas.length}
          className="ml-auto"
          onClick={() => {
            if (confirm("Excluir a planilha carregada?")) limparOfertas();
          }}
        >
          <Trash2 className="size-4" /> Excluir planilha
        </Button>
        <Button
          variant="outline"
          disabled={!ofertas.length || processando}
          onClick={() => setModalAberto(true)}
        >
          <Download className="size-4" /> Baixar arquivo do Clube
        </Button>
      </div>
      {ofertas.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1 font-medium">{nomeArquivo}</span>
          <span className="rounded-full bg-secondary px-3 py-1">{ofertas.length} itens</span>
          {precisamRevisao ? (
            <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground">
              <AlertTriangle className="size-3.5" /> {precisamRevisao} precisam de revisão
            </span>
          ) : (
            <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">
              Tudo pronto para exportar
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            Clique para visualizar. Clique duas vezes para selecionar os itens compatíveis.
          </span>
        </div>
      )}
    </>
  );
}

function TabelaOfertas({
  ofertas,
  notaMinima,
  alterar,
  remover,
  setModalVisualizacao,
  setSelecaoExpandida,
  filtroPendencia,
}: ReturnType<typeof useOfertas> & { filtroPendencia: FiltroPendencia }) {
  const cliquePendente = useRef<number | null>(null);
  const ofertasVisiveis = ofertas.filter((item) => {
    if (filtroPendencia === "pendentes") return itemPrecisaRevisao(item, notaMinima);
    if (filtroPendencia === "sem_imagem") return !item.imagem?.trim();
    if (filtroPendencia === "sem_codigo") return !item.codigos.length;
    if (filtroPendencia === "estoque_zerado") return itemComEstoqueZerado(item);
    if (filtroPendencia === "com_duvida")
      return Boolean(item.motivoRevisao) || item.nota < notaMinima;
    return true;
  });

  return (
    <div className="surface mt-4 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Img</TableHead>
            <TableHead>Nome</TableHead>
            <TableHead>Produto encontrado</TableHead>
            <TableHead>Confiança</TableHead>
            <TableHead>Preço</TableHead>
            <TableHead>Preço clube</TableHead>
            <TableHead>Limite</TableHead>
            <TableHead>Tipo de produto</TableHead>
            <TableHead>EAN</TableHead>
            <TableHead>Código</TableHead>
            <TableHead>URL da imagem</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {!ofertasVisiveis.length && (
            <TableRow>
              <TableCell colSpan={12} className="h-24 text-center text-muted-foreground">
                Nenhuma oferta corresponde a este filtro.
              </TableCell>
            </TableRow>
          )}
          {ofertasVisiveis.map((item) => {
            const index = ofertas.indexOf(item);
            return (
              <TableRow
                key={`${item.nome}-${index}`}
              className={`${itemPrecisaRevisao(item, notaMinima) ? "bg-warn/40" : ""} h-20 cursor-pointer hover:bg-muted/60`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input,button")) return;
                  if (cliquePendente.current) window.clearTimeout(cliquePendente.current);
                  cliquePendente.current = window.setTimeout(() => {
                    setSelecaoExpandida(false);
                    setModalVisualizacao(item);
                    cliquePendente.current = null;
                  }, 220);
                }}
                onDoubleClick={(e) => {
                  if ((e.target as HTMLElement).closest("input,button")) return;
                  if (cliquePendente.current) window.clearTimeout(cliquePendente.current);
                  cliquePendente.current = null;
                  setSelecaoExpandida(true);
                  setModalVisualizacao(item);
                }}
              >
              <TableCell>
                {item.imagem ? (
                  <img
                    src={item.imagem}
                    alt={item.nome}
                    loading="lazy"
                    className="size-10 rounded-md object-contain bg-white"
                  />
                ) : (
                  <span
                    className="flex min-h-10 min-w-16 flex-col items-center justify-center rounded-md bg-warn px-1 text-warn-foreground"
                    title="Imagem ausente"
                  >
                    <ImageIcon className="size-4" />
                    <span className="mt-0.5 text-[10px] font-medium">Sem imagem</span>
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-64 font-medium">
                <span className="line-clamp-2">{item.nome}</span>
              </TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">
                <span className="line-clamp-2">{resumirProdutoDaOferta(item)}</span>
                {item.motivoRevisao && (
                  <p className="mt-1 line-clamp-1 text-warn-foreground">{item.motivoRevisao}</p>
                )}
              </TableCell>
              <TableCell>{Math.round(item.nota * 100)}%</TableCell>
              <TableCell>{item.preco ?? "—"}</TableCell>
              <TableCell>{item.precoClube ?? "—"}</TableCell>
              <TableCell>{item.limite ?? "—"}</TableCell>
              <TableCell>{item.unidade}</TableCell>
              <TableCell>
                {!item.porQuilo && (
                  <CodigoInput
                    value={item.codigos.join(";")}
                    onChange={(value) => {
                      const codigos = separarCodigos(value, true);
                      alterar(index, { codigos, ean: codigos[0] || "", codigo: codigos.join(";") });
                    }}
                  />
                )}
              </TableCell>
              <TableCell>
                {item.porQuilo && (
                  <CodigoInput
                    value={item.codigos.join(";")}
                    onChange={(value) => {
                      const codigos = separarCodigos(value);
                      alterar(index, { codigos, codigo: codigos.join(";") });
                    }}
                  />
                )}
              </TableCell>
              <TableCell>
                <CodigoInput
                  value={item.imagem}
                  maxLength={1000}
                  onChange={(imagem) => alterar(index, { imagem })}
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remover item"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    remover(index);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function CodigoInput({
  value,
  onChange,
  maxLength,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  return (
    <Input
      className="w-64"
      value={value}
      maxLength={maxLength}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function EmptyState() {
  return (
    <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">
      Envie a planilha da semana para começar. O sistema fará o cruzamento com o catálogo salvo.
    </div>
  );
}

function DialogExportacao({
  modalAberto,
  setModalAberto,
  carrossel,
  setCarrossel,
  ativarEm,
  setAtivarEm,
  inativarEm,
  setInativarEm,
  exportar,
}: ReturnType<typeof useOfertas>) {
  return (
    <Dialog open={modalAberto} onOpenChange={setModalAberto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configurar arquivo do Clube</DialogTitle>
          <DialogDescription>
            Escolha o carrossel e defina o período da oferta. A ativação usa data e hora.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <label className="block text-sm font-medium">
            Carrossel
            <select
              value={carrossel}
              onChange={(e) => setCarrossel(e.target.value)}
              className="mt-1.5 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
            >
              <option value="">Selecione um carrossel</option>
              {CARROSSEIS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-medium">
            Ativação automática
            <Input
              className="mt-1.5"
              type="datetime-local"
              step="60"
              value={ativarEm}
              onChange={(e) => setAtivarEm(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Inativar em
            <Input
              className="mt-1.5"
              type="datetime-local"
              step="60"
              value={inativarEm}
              onChange={(e) => setInativarEm(e.target.value)}
            />
          </label>
          <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
            Check-In: <strong>Não</strong> · Dias para resgate: <strong>1</strong> · App:{" "}
            <strong>Não exigir ativação</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setModalAberto(false)}>
            Cancelar
          </Button>
          <Button onClick={exportar}>
            <Download className="size-4" /> Gerar planilha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogVisualizacao({
  modalVisualizacao,
  setModalVisualizacao,
  ofertas,
  alterar,
  notaMinima,
  selecaoExpandida,
  setSelecaoExpandida,
}: ReturnType<typeof useOfertas>) {
  const indice = modalVisualizacao
    ? ofertas.findIndex(
        (oferta) =>
          oferta === modalVisualizacao ||
          (oferta.nome === modalVisualizacao.nome &&
            oferta.linhaOrigem === modalVisualizacao.linhaOrigem),
      )
    : -1;
  const decisoes = modalVisualizacao ? Object.entries(modalVisualizacao.decisoesPorCodigo ?? {}) : [];
  const candidatos = decisoes.length
    ? decisoes.map(([codigo, decisao]) => [codigo, decisao.nome] as const)
    : Object.entries(modalVisualizacao?.nomesPorCodigo ?? {});
  const nomesSelecionados = modalVisualizacao
    ? modalVisualizacao.codigos
        .map((codigo) => modalVisualizacao.nomesPorCodigo?.[codigo])
        .filter((nome): nome is string => Boolean(nome))
    : [];
  const produtoEncontrado = nomesSelecionados.length
    ? resumirProdutosEncontrados(nomesSelecionados)
    : modalVisualizacao?.encontrado || "Não encontrado";
  const indicesProblematicas = ofertas
    .map((item, index) => (itemPrecisaRevisao(item, notaMinima) ? index : -1))
    .filter((index) => index >= 0);
  const indiceProblematica = indicesProblematicas.indexOf(indice);

  function abrirProblematica(deslocamento: number) {
    const proxima = ofertas[indicesProblematicas[indiceProblematica + deslocamento] ?? -1];
    if (!proxima) return;
    setModalVisualizacao(proxima);
    setSelecaoExpandida(false);
  }

  function alternarCodigo(codigo: string, marcado: boolean) {
    if (!modalVisualizacao || indice < 0) return;
    const codigos = marcado
      ? [...new Set([...modalVisualizacao.codigos, codigo])]
      : modalVisualizacao.codigos.filter((item) => item !== codigo);
    const nomes = codigos
      .map((item) => modalVisualizacao.nomesPorCodigo?.[item])
      .filter(Boolean)
      .join(" / ");
    const mudanca = {
      codigos,
      decisoesPorCodigo: Object.fromEntries(
        Object.entries(modalVisualizacao.decisoesPorCodigo ?? {}).map(([item, decisao]) => [
          item,
          {
            ...decisao,
            status: codigos.includes(item) ? ("incluido" as const) : ("descartado" as const),
            motivos: [...decisao.motivos.filter((motivo) => motivo !== "decisão manual salva"), "decisão manual salva"],
          },
        ]),
      ),
      codigo: codigos.join(";"),
      encontrado: nomes || null,
      nota: codigos.length ? 1 : 0,
      motivoRevisao: codigos.length
        ? null
        : "Selecione pelo menos um item compatível para esta oferta.",
      ...(modalVisualizacao.porQuilo
        ? { codigoInterno: codigos[0] || "" }
        : { ean: codigos[0] || "" }),
    };
    alterar(indice, mudanca);
    setModalVisualizacao({ ...modalVisualizacao, ...mudanca, codigosEditados: true });
  }

  return (
    <Dialog
      open={!!modalVisualizacao}
      onOpenChange={(aberto) => {
        if (!aberto) {
          setModalVisualizacao(null);
          setSelecaoExpandida(false);
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{modalVisualizacao?.nome}</DialogTitle>
          <DialogDescription>Conferência completa do item importado.</DialogDescription>
        </DialogHeader>
        {modalVisualizacao && selecaoExpandida ? (
          <div className="rounded-md border p-3 text-sm">
            <p className="mb-3 font-medium">Itens compatíveis encontrados</p>
            <div className="space-y-2">
              {candidatos.map(([codigo, nome]) => (
                <label key={codigo} className="flex cursor-pointer items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={modalVisualizacao.codigos.includes(codigo)}
                    onChange={(evento) => alternarCodigo(codigo, evento.target.checked)}
                  />
                  <span>
                    <span className="block font-medium">{nome}</span>
                    <span className="text-xs text-muted-foreground">{codigo}</span>
                    {modalVisualizacao.decisoesPorCodigo?.[codigo] && (
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {modalVisualizacao.decisoesPorCodigo[codigo]!.motivos.join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        ) : modalVisualizacao ? (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted p-3">
              {modalVisualizacao.imagem ? (
                <img
                  src={modalVisualizacao.imagem}
                  alt={modalVisualizacao.nome}
                  className="max-h-52 w-full rounded-lg object-contain bg-white"
                />
              ) : (
                <ImageIcon className="size-10 text-muted-foreground" />
              )}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              {modalVisualizacao.motivoRevisao && (
                <div className="sm:col-span-2 rounded-md bg-warn p-3">
                  {modalVisualizacao.motivoRevisao}
                </div>
              )}
              <Info
                label="Produto encontrado"
                value={produtoEncontrado}
              />
              <Info label="Confiança" value={`${Math.round(modalVisualizacao.nota * 100)}%`} />
              <Info label="Preço" value={modalVisualizacao.preco ?? "—"} />
              <Info label="Preço clube" value={modalVisualizacao.precoClube ?? "—"} />
              <Info label="Limite lido da planilha" value={modalVisualizacao.limiteBruto || "—"} />
              <Info label="Limite para o Clube" value={modalVisualizacao.limite ?? "—"} />
              <Info label="Tipo de produto" value={modalVisualizacao.unidade} />
              <Info label="Tipo do código" value={modalVisualizacao.porQuilo ? "Interno" : "EAN"} />
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">Códigos gerados</span>
                <p className="font-medium break-words">
                  {modalVisualizacao.codigos.join(";") || "—"}
                </p>
              </div>
              {modalVisualizacao.excecoes.length > 0 && (
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Exceções detectadas</span>
                  <p className="font-medium break-words">
                    {modalVisualizacao.excecoes.map((e) => e.join(" ")).join(" | ")}
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {modalVisualizacao && indiceProblematica >= 0 && (
          <DialogFooter className="items-center sm:justify-between">
            <span className="text-xs text-muted-foreground">
              Pendência {indiceProblematica + 1} de {indicesProblematicas.length}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={indiceProblematica === 0}
                onClick={() => abrirProblematica(-1)}
              >
                Anterior
              </Button>
              <Button
                type="button"
                disabled={indiceProblematica === indicesProblematicas.length - 1}
                onClick={() => abrirProblematica(1)}
              >
                Próxima pendência
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function resumirProdutosEncontrados(nomes: string[]): string {
  const unicos = [...new Set(nomes.map((nome) => nome.trim()).filter(Boolean))];
  if (unicos.length <= 1) return unicos[0] || "Não encontrado";

  const palavras = unicos.map((nome) => nome.split(/\s+/));
  let prefixo = 0;
  while (
    palavras.every(
      (partes) =>
        partes[prefixo] &&
        partes[prefixo]!.localeCompare(palavras[0]![prefixo]!, "pt-BR", {
          sensitivity: "base",
        }) === 0,
    )
  ) {
    prefixo++;
  }

  if (prefixo < 2) return unicos.join(" / ");
  const variedades = palavras.map((partes, indice) => {
    const variedade = partes
      .slice(prefixo)
      .join(" ")
      .replace(/\s+(PET|GARRAFA|LATA|LT)$/i, "")
      .trim();
    return variedade || unicos[indice]!;
  });
  return [...new Set(variedades)].join(" / ");
}

function resumirProdutoDaOferta(
  oferta: ReturnType<typeof useOfertas>["ofertas"][number],
): string {
  const nomes = oferta.codigos
    .map((codigo) => oferta.nomesPorCodigo?.[codigo])
    .filter((nome): nome is string => Boolean(nome));
  return nomes.length
    ? resumirProdutosEncontrados(nomes)
    : oferta.encontrado || "Não encontrado";
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium">{value}</p>
    </div>
  );
}
