import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare, ImageIcon, Loader2, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ImagensPendentes } from "@/components/ImagensPendentes";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Produto } from "@/lib/catalogo";
import { SEM_CATEGORIA, TODAS, useCatalogo } from "@/modules/catalogo/use-catalogo";

export const Route = createFileRoute("/_authenticated/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de produtos — Nódus" },
      {
        name: "description",
        content: "Cadastre, importe e organize os produtos usados no cruzamento automático das ofertas.",
      },
      { property: "og:title", content: "Catálogo de produtos — Nódus" },
      {
        property: "og:description",
        content: "Importe CSV/Excel e mantenha códigos, preços, custos e imagens dos produtos.",
      },
    ],
  }),
  component: PaginaCatalogo,
});

function PaginaCatalogo() {
  const catalogo = useCatalogo();
  const [produtoVisualizado, setProdutoVisualizado] = useState<Produto | null>(null);

  return (
    <AppShell title="Catálogo de produtos" subtitle="Base usada no cruzamento automático das ofertas.">
      <BarraCatalogo {...catalogo} />
      <ImagensPendentes categoria={catalogo.categoria} />
      <TabelaCatalogo {...catalogo} onVisualizar={setProdutoVisualizado} />
      <Paginacao {...catalogo} />
      <DialogProduto {...catalogo} />
      <DialogVisualizacao produto={produtoVisualizado} onClose={() => setProdutoVisualizado(null)} />
    </AppShell>
  );
}

function BarraCatalogo({
  busca,
  setBusca,
  categoria,
  setCategoria,
  categorias,
  campoArquivo,
  importar,
  importando,
  novoProduto,
  selecionadas,
  setSelecionadas,
  excluirSelecionadas,
}: ReturnType<typeof useCatalogo>) {
  return (
    <div className="surface space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por descrição, EAN ou código"
            value={busca}
            maxLength={120}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <Select value={categoria} onValueChange={setCategoria}>
          <SelectTrigger className="w-60">
            <SelectValue placeholder="Categoria" />
          </SelectTrigger>
          <SelectContent className="of-category-menu">
            <SelectItem value={TODAS}>Todas as categorias</SelectItem>
            {categorias.map((item) => (
              <SelectItem key={item} value={item}>
                {item === SEM_CATEGORIA ? "Sem categoria" : item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <input
          ref={campoArquivo}
          type="file"
          accept=".csv,.xlsx,.xls"
          multiple
          hidden
          onChange={(e) => void importar(e.target.files)}
        />

        <Button variant="outline" disabled={importando} onClick={() => campoArquivo.current?.click()}>
          {importando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Importar CSV/Excel
        </Button>

        <Button onClick={novoProduto}>
          <Plus className="size-4" /> Novo produto
        </Button>
      </div>

      <div className="border-t pt-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <CheckSquare className="size-4" /> Arquivos importados
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {categorias.length ? (
            categorias.map((item) => (
              <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selecionadas.includes(item)}
                  onChange={(e) =>
                    setSelecionadas((atual) =>
                      e.target.checked ? [...atual, item] : atual.filter((valor) => valor !== item),
                    )
                  }
                />
                <span>{item === SEM_CATEGORIA ? "Sem categoria" : item}</span>
              </label>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">Nenhum arquivo importado ainda.</span>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!categorias.length}
            onClick={() => setSelecionadas(selecionadas.length === categorias.length ? [] : categorias)}
          >
            {selecionadas.length === categorias.length && categorias.length ? "Limpar seleção" : "Selecionar tudo"}
          </Button>

          <Button
            variant="destructive"
            size="sm"
            disabled={!selecionadas.length}
            onClick={() => void excluirSelecionadas()}
          >
            <Trash2 className="size-4" /> Excluir selecionados ({selecionadas.length})
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabelaCatalogo({
  produtos,
  editar,
  excluir,
  onVisualizar,
}: ReturnType<typeof useCatalogo> & { onVisualizar: (produto: Produto) => void }) {
  return (
    <div className="surface mt-4 overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Imagem</TableHead>
            <TableHead>Descrição</TableHead>
            <TableHead>EAN</TableHead>
            <TableHead>Cód. promoção</TableHead>
            <TableHead>Cód. interno</TableHead>
            <TableHead>Un.</TableHead>
            <TableHead>Preço</TableHead>
            <TableHead>Custo</TableHead>
            <TableHead>Arquivo</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {produtos.map((produto) => (
            <TableRow
              key={produto.id}
              className="cursor-pointer hover:bg-muted/60"
              onClick={(e) => {
                if ((e.target as HTMLElement).closest("button,input,a")) return;
                onVisualizar(produto);
              }}
            >
              <TableCell>
                {produto.image_url ? (
                  <img
                    src={produto.image_url}
                    alt={produto.description}
                    loading="lazy"
                    className="size-12 rounded-md bg-white object-contain"
                  />
                ) : (
                  <span className="flex size-12 items-center justify-center rounded-md bg-muted">
                    <ImageIcon className="size-4 text-muted-foreground" />
                  </span>
                )}
              </TableCell>
              <TableCell className="font-medium">{produto.description}</TableCell>
              <TableCell>{produto.ean || "—"}</TableCell>
              <TableCell>{produto.promotion_code || "—"}</TableCell>
              <TableCell>{produto.internal_code || "—"}</TableCell>
              <TableCell>{produto.unit || "—"}</TableCell>
              <TableCell>{produto.unit_price ?? "—"}</TableCell>
              <TableCell>{produto.cost ?? "—"}</TableCell>
              <TableCell>{produto.category || "Sem categoria"}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${produto.description}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      editar(produto);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${produto.description}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Excluir ${produto.description}?`)) excluir.mutate(produto.id);
                    }}
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Paginacao({ total, pagina, paginas, setPagina }: ReturnType<typeof useCatalogo>) {
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span>{total} produto(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
          Anterior
        </Button>
        <span>
          Página {pagina + 1} de {paginas}
        </span>
        <Button variant="outline" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}

function DialogProduto({
  dialogoAberto,
  setDialogoAberto,
  editando,
  formulario,
  setFormulario,
  salvar,
}: ReturnType<typeof useCatalogo>) {
  const campos = [
    ["description", "Descrição"],
    ["promotion_code", "Código da promoção/caixa"],
    ["internal_code", "Código interno"],
    ["ean", "EAN"],
    ["unit", "Unidade"],
    ["category", "Categoria"],
    ["unit_price", "Preço"],
    ["cost", "Custo"],
    ["image_url", "URL da imagem"],
  ] as const;

  return (
    <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
      <DialogContent className="of-product-dialog">
        <DialogHeader>
          <DialogTitle>{editando ? "Editar produto" : "Novo produto"}</DialogTitle>
        </DialogHeader>

        <div className="of-product-form">
          {campos.map(([campo, rotulo]) => (
            <div key={campo} className="of-product-field">
              <Label htmlFor={`produto-${campo}`}>{rotulo}</Label>
              <Input
                id={`produto-${campo}`}
                className="of-product-input"
                value={formulario[campo]}
                onChange={(e) => setFormulario((atual) => ({ ...atual, [campo]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogoAberto(false)}>
            Cancelar
          </Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>
            {salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DialogVisualizacao({ produto, onClose }: { produto: Produto | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(produto)} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{produto?.description}</DialogTitle>
          <DialogDescription>Conferência completa do produto cadastrado no catálogo.</DialogDescription>
        </DialogHeader>

        {produto ? (
          <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
            <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted p-3">
              {produto.image_url ? (
                <img
                  src={produto.image_url}
                  alt={produto.description}
                  className="max-h-52 w-full rounded-lg bg-white object-contain"
                />
              ) : (
                <ImageIcon className="size-10 text-muted-foreground" />
              )}
            </div>

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="EAN" value={produto.ean || "—"} />
              <Info label="Código da promoção/caixa" value={produto.promotion_code || "—"} />
              <Info label="Código interno" value={produto.internal_code || "—"} />
              <Info label="Unidade" value={produto.unit || "—"} />
              <Info label="Preço" value={produto.unit_price ?? "—"} />
              <Info label="Custo" value={produto.cost ?? "—"} />
              <Info label="Arquivo / categoria" value={produto.category || "Sem categoria"} />
              <div className="sm:col-span-2">
                <span className="text-muted-foreground">URL da imagem</span>
                <p className="break-all font-medium">{produto.image_url || "—"}</p>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className="font-medium">{value}</p>
    </div>
  );
}
