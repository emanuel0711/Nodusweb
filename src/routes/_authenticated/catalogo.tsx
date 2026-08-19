import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Upload, Pencil, Trash2, ImageIcon, Loader2, CheckSquare } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { lerPlanilha, categoriaPeloNomeDoArquivo } from "@/lib/planilha";
import { lerPreco } from "@/lib/comparar-textos";
import { buscarImagens } from "@/lib/imagens";
import {
  COLUNAS_PRODUTO, carregarTodosProdutos, chaveDoProduto, limparCodigo, limparEan, linhaParaProduto,
  type Produto,
} from "@/lib/catalogo";

export const Route = createFileRoute("/_authenticated/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de produtos — OfertaFlow" },
      { name: "description", content: "Cadastre, importe e organize os produtos usados no cruzamento automático das ofertas." },
      { property: "og:title", content: "Catálogo de produtos — OfertaFlow" },
      { property: "og:description", content: "Importe CSV/Excel e mantenha códigos, preços e imagens dos produtos." },
    ],
  }),
  component: PaginaCatalogo,
});

const POR_PAGINA = 20;
const TODAS = "__all__";
const SEM_CATEGORIA = "__uncategorized__";
const formularioVazio = { description: "", internal_code: "", promotion_code: "", ean: "", unit: "", category: "", image_url: "", unit_price: "" };

async function carregarCategorias(): Promise<string[]> {
  const produtos = await carregarTodosProdutos();
  const nomes = new Set<string>();
  let temSemCategoria = false;
  for (const produto of produtos) {
    if (produto.category) nomes.add(produto.category);
    else temSemCategoria = true;
  }
  const lista = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return temSemCategoria ? [SEM_CATEGORIA, ...lista] : lista;
}

/** Depois da importação, procura as fotos que faltam sem travar a tela. */
async function completarImagens(novos: Array<{ id: string; ean: string | null }>) {
  const eans = novos.map((item) => item.ean).filter((ean): ean is string => Boolean(ean));
  if (!eans.length) return;
  const imagens = await buscarImagens(eans);
  for (const item of novos) {
    const url = item.ean ? imagens.get(item.ean) : undefined;
    if (url) await supabase.from("products").update({ image_url: url }).eq("id", item.id);
  }
}

function PaginaCatalogo() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState(TODAS);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [formulario, setFormulario] = useState(formularioVazio);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [importando, setImportando] = useState(false);

  function atualizarListas() {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
  }

  const categorias = useQuery({ queryKey: ["product-categories"], queryFn: carregarCategorias });
  const produtos = useQuery({
    queryKey: ["products", busca, categoria, pagina],
    queryFn: async () => {
      let consulta = supabase.from("products").select(COLUNAS_PRODUTO, { count: "exact" })
        .order("description")
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      const termo = busca.trim().replace(/[,%]/g, " ");
      if (termo) consulta = consulta.or(`description.ilike.%${termo}%,ean.ilike.%${termo}%,internal_code.ilike.%${termo}%,promotion_code.ilike.%${termo}%`);
      if (categoria === SEM_CATEGORIA) consulta = consulta.is("category", null);
      else if (categoria !== TODAS) consulta = consulta.eq("category", categoria);
      const { data, error, count } = await consulta;
      if (error) throw error;
      return { linhas: (data ?? []) as unknown as Produto[], total: count ?? 0 };
    },
  });

  const salvar = useMutation({
    mutationFn: async () => {
      if (!formulario.description.trim()) throw new Error("Informe a descrição do produto.");
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error("Sessão expirada. Entre novamente.");
      const dados = {
        description: formulario.description.trim(),
        internal_code: formulario.internal_code.trim() || null,
        promotion_code: limparCodigo(formulario.promotion_code) || null,
        ean: limparEan(formulario.ean) || null,
        unit: formulario.unit.trim() || null,
        category: formulario.category.trim() || null,
        image_url: formulario.image_url.trim() || null,
        unit_price: lerPreco(formulario.unit_price),
      };
      const resultado = editando
        ? await supabase.from("products").update(dados).eq("id", editando.id)
        : await supabase.from("products").insert({ ...dados, user_id: sessao.user.id });
      if (resultado.error) throw resultado.error;
    },
    onSuccess: () => {
      toast.success(editando ? "Produto atualizado" : "Produto cadastrado");
      setDialogoAberto(false); setEditando(null); setFormulario(formularioVazio);
      atualizarListas();
    },
    onError: (erro: Error) => toast.error(erro.message),
  });

  const excluir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Produto excluído"); atualizarListas(); },
    onError: (erro: Error) => toast.error(erro.message),
  });

  async function excluirSelecionadas() {
    if (!selecionadas.length) return;
    const nomes = selecionadas.map((item) => (item === SEM_CATEGORIA ? "Sem categoria" : item));
    if (!confirm(`Excluir todos os produtos destes ${selecionadas.length} arquivo(s)?\n\n${nomes.join("\n")}`)) return;
    try {
      for (const grupo of selecionadas) {
        const consulta = supabase.from("products").delete();
        const resultado = grupo === SEM_CATEGORIA ? await consulta.is("category", null) : await consulta.eq("category", grupo);
        if (resultado.error) throw resultado.error;
      }
      setSelecionadas([]); setCategoria(TODAS); setPagina(0);
      toast.success("Importações excluídas");
      atualizarListas();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível excluir");
    }
  }

  async function importar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setImportando(true);
    const inicio = performance.now();
    try {
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error("Sessão expirada. Entre novamente.");

      const existentes = await carregarTodosProdutos();
      const chavesExistentes = new Set(existentes.map(chaveDoProduto));
      const imagemPorEan = new Map(existentes.filter((item) => item.ean && item.image_url).map((item) => [item.ean as string, item.image_url as string]));

      let importados = 0;
      let repetidos = 0;
      let semNome = 0;
      const novos: Array<{ id: string; ean: string | null }> = [];

      for (const arquivo of Array.from(arquivos)) {
        const linhas = await lerPlanilha(arquivo);
        const categoriaArquivo = categoriaPeloNomeDoArquivo(arquivo.name);
        const paraInserir = [];

        for (const linha of linhas) {
          const produto = linhaParaProduto(linha, categoriaArquivo);
          if (!produto) { semNome++; continue; }
          const chave = chaveDoProduto(produto);
          if (chavesExistentes.has(chave)) { repetidos++; continue; }
          chavesExistentes.add(chave);
          paraInserir.push({
            ...produto,
            user_id: sessao.user.id,
            image_url: produto.image_url || (produto.ean ? imagemPorEan.get(produto.ean) ?? null : null),
          });
        }

        for (let i = 0; i < paraInserir.length; i += 500) {
          const lote = paraInserir.slice(i, i + 500);
          const { data, error } = await supabase.from("products").insert(lote).select("id, ean");
          if (error) throw error;
          novos.push(...((data ?? []) as Array<{ id: string; ean: string | null }>));
          importados += lote.length;
        }
      }

      const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
      if (!importados) {
        toast.warning(`Nenhum produto novo. ${repetidos} repetido(s) e ${semNome} linha(s) sem descrição.`);
      } else {
        toast.success(`${importados} produto(s) importado(s) em ${segundos}s. ${repetidos} repetido(s) ignorado(s). As imagens que faltam são buscadas em segundo plano.`);
      }
      atualizarListas();
      void completarImagens(novos).then(atualizarListas).catch(() => undefined);
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha na importação");
    } finally {
      setImportando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  function editar(produto: Produto) {
    setEditando(produto);
    setFormulario({
      description: produto.description,
      internal_code: produto.internal_code ?? "",
      promotion_code: produto.promotion_code ?? "",
      ean: produto.ean ?? "",
      unit: produto.unit ?? "",
      category: produto.category ?? "",
      image_url: produto.image_url ?? "",
      unit_price: produto.unit_price != null ? String(produto.unit_price) : "",
    });
    setDialogoAberto(true);
  }

  const total = produtos.data?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const arquivosImportados = categorias.data ?? [];

  return <AppShell title="Catálogo de produtos" subtitle="Base usada no cruzamento automático das ofertas.">
    <div className="surface space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar por descrição, EAN ou código" value={busca} maxLength={120} onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
        </div>
        <Select value={categoria} onValueChange={(valor) => { setCategoria(valor); setPagina(0); }}>
          <SelectTrigger className="w-60"><SelectValue placeholder="Categoria" /></SelectTrigger>
          <SelectContent>
            <SelectItem value={TODAS}>Todas as categorias</SelectItem>
            {arquivosImportados.map((item) => <SelectItem key={item} value={item}>{item === SEM_CATEGORIA ? "Sem categoria" : item}</SelectItem>)}
          </SelectContent>
        </Select>
        <input ref={campoArquivo} type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={(e) => importar(e.target.files)} />
        <Button variant="outline" disabled={importando} onClick={() => campoArquivo.current?.click()}>
          {importando ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Importar CSV/Excel
        </Button>
        <Button onClick={() => { setEditando(null); setFormulario(formularioVazio); setDialogoAberto(true); }}><Plus className="size-4" /> Novo produto</Button>
      </div>

      <div className="border-t pt-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckSquare className="size-4" /> Arquivos importados</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {arquivosImportados.length ? arquivosImportados.map((item) => (
            <label key={item} className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={selecionadas.includes(item)} onChange={(e) => setSelecionadas((atual) => e.target.checked ? [...atual, item] : atual.filter((valor) => valor !== item))} />
              <span>{item === SEM_CATEGORIA ? "Sem categoria" : item}</span>
            </label>
          )) : <span className="text-sm text-muted-foreground">Nenhum arquivo importado ainda.</span>}
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" disabled={!arquivosImportados.length} onClick={() => setSelecionadas(selecionadas.length === arquivosImportados.length ? [] : arquivosImportados)}>
            {selecionadas.length === arquivosImportados.length && arquivosImportados.length ? "Limpar seleção" : "Selecionar tudo"}
          </Button>
          <Button variant="destructive" size="sm" disabled={!selecionadas.length} onClick={excluirSelecionadas}>
            <Trash2 className="size-4" /> Excluir selecionados ({selecionadas.length})
          </Button>
        </div>
      </div>
    </div>

    <div className="surface mt-4 overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Imagem</TableHead><TableHead>Descrição</TableHead><TableHead>EAN</TableHead><TableHead>Cód. promoção</TableHead>
          <TableHead>Cód. interno</TableHead><TableHead>Un.</TableHead><TableHead>Preço</TableHead><TableHead>Arquivo</TableHead><TableHead>Ações</TableHead>
        </TableRow></TableHeader>
        <TableBody>{(produtos.data?.linhas ?? []).map((produto) => (
          <TableRow key={produto.id}>
            <TableCell>{produto.image_url
              ? <img src={produto.image_url} alt={produto.description} loading="lazy" className="size-12 rounded-md object-cover" />
              : <span className="flex size-12 items-center justify-center rounded-md bg-muted"><ImageIcon className="size-4 text-muted-foreground" /></span>}</TableCell>
            <TableCell className="font-medium">{produto.description}</TableCell>
            <TableCell>{produto.ean || "—"}</TableCell>
            <TableCell>{produto.promotion_code || "—"}</TableCell>
            <TableCell>{produto.internal_code || "—"}</TableCell>
            <TableCell>{produto.unit || "—"}</TableCell>
            <TableCell>{produto.unit_price ?? "—"}</TableCell>
            <TableCell>{produto.category || "Sem categoria"}</TableCell>
            <TableCell><div className="flex gap-1">
              <Button variant="ghost" size="icon" onClick={() => editar(produto)}><Pencil className="size-4" /></Button>
              <Button variant="ghost" size="icon" onClick={() => { if (confirm(`Excluir ${produto.description}?`)) excluir.mutate(produto.id); }}><Trash2 className="size-4 text-destructive" /></Button>
            </div></TableCell>
          </TableRow>
        ))}</TableBody>
      </Table>
    </div>

    <div className="mt-4 flex items-center justify-between text-sm">
      <span>{total} produto(s)</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
        <span>Página {pagina + 1} de {paginas}</span>
        <Button variant="outline" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)}>Próxima</Button>
      </div>
    </div>

    <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editando ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">{([
          ["description", "Descrição"], ["promotion_code", "Código da promoção/caixa"], ["internal_code", "Código interno"],
          ["ean", "EAN"], ["unit", "Unidade"], ["category", "Categoria"], ["unit_price", "Preço"], ["image_url", "URL da imagem"],
        ] as const).map(([campo, rotulo]) => (
          <div key={campo} className="grid gap-1">
            <Label>{rotulo}</Label>
            <Input value={formulario[campo]} onChange={(e) => setFormulario((atual) => ({ ...atual, [campo]: e.target.value }))} />
          </div>
        ))}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogoAberto(false)}>Cancelar</Button>
          <Button disabled={salvar.isPending} onClick={() => salvar.mutate()}>{salvar.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </AppShell>;
}
