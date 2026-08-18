import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Upload, Pencil, Trash2, ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { readSpreadsheet, pick, categoryFromFileName } from "@/lib/spreadsheet";
import { parsePrice } from "@/lib/text-match";
import { findProductImages } from "@/lib/product-image";

export const Route = createFileRoute("/_authenticated/catalogo")({
  head: () => ({ meta: [{ title: "Catálogo de produtos — OfertaFlow" }] }),
  component: CatalogPage,
});

const PAGE_SIZE = 20;
const ALL = "__all__";
const UNCATEGORIZED = "__uncategorized__";
type Product = { id: string; internal_code: string | null; ean: string | null; description: string; unit: string | null; unit_price: number | null; category: string | null; image_url: string | null };
const emptyForm = { description: "", internal_code: "", ean: "", unit: "", category: "", image_url: "", unit_price: "" };

async function loadCategories() {
  const values = new Set<string>();
  let hasUncategorized = false;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("products").select("category").range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.category) values.add(row.category);
      else hasUncategorized = true;
    }
    if ((data ?? []).length < 1000) break;
  }
  const categories = [...values].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return hasUncategorized ? [UNCATEGORIZED, ...categories] : categories;
}

function CatalogPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const categories = useQuery({ queryKey: ["product-categories"], queryFn: loadCategories });
  const products = useQuery({
    queryKey: ["products", search, category, page],
    queryFn: async () => {
      let query = supabase.from("products").select("id, internal_code, ean, description, unit, unit_price, category, image_url", { count: "exact" }).order("description").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const term = search.trim().replace(/[,%]/g, " ");
      if (term) query = query.or(`description.ilike.%${term}%,ean.ilike.%${term}%,internal_code.ilike.%${term}%`);
      if (category === UNCATEGORIZED) query = query.is("category", null);
      else if (category !== ALL) query = query.eq("category", category);
      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as Product[], count: count ?? 0 };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.description.trim()) throw new Error("Descrição obrigatória");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada");
      const payload = { description: form.description.trim(), internal_code: form.internal_code.trim() || null, ean: form.ean.trim() || null, unit: form.unit.trim() || null, category: form.category.trim() || null, image_url: form.image_url.trim() || null, unit_price: parsePrice(form.unit_price) };
      const result = editing ? await supabase.from("products").update(payload).eq("id", editing.id) : await supabase.from("products").insert({ ...payload, user_id: auth.user.id });
      if (result.error) throw result.error;
    },
    onSuccess: () => { toast.success(editing ? "Produto atualizado" : "Produto cadastrado"); setOpen(false); setEditing(null); setForm(emptyForm); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("products").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { toast.success("Produto excluído"); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  async function handleImport(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sessão expirada");
      let imported = 0;
      let imagesFound = 0;
      for (const file of Array.from(files)) {
        const rows = await readSpreadsheet(file);
        const categoryName = categoryFromFileName(file.name);
        const mapped = rows.map((row) => ({
          user_id: auth.user.id,
          internal_code: String(pick(row, ["Cód. Interno", "Codigo Interno", "Cod Interno"]) || "").trim() || null,
          ean: String(pick(row, ["Código", "Codigo", "EAN", "Código de barras", "GTIN"]) || "").trim() || null,
          description: String(pick(row, ["Descrição", "Descricao", "Produto", "Nome"]) || "").trim(),
          unit: String(pick(row, ["Un.", "Un", "Unidade"]) || "").trim() || null,
          unit_price: parsePrice(pick(row, ["Preço Un.", "Preco Un", "Preço", "Preco"])),
          category: String(pick(row, ["Categoria", "Category"]) || categoryName).trim() || categoryName,
          image_url: String(pick(row, ["URL da imagem", "URL Imagem", "Imagem", "Image", "Foto"]) || "").trim() || null,
        })).filter((row) => row.description);

        const missingEans = mapped.filter((row) => !row.image_url && row.ean).map((row) => row.ean as string);
        const images = await findProductImages(missingEans);
        const completed = mapped.map((row) => {
          const url = row.image_url || (row.ean ? images.get(row.ean) : "") || null;
          if (url && !row.image_url) imagesFound++;
          return { ...row, image_url: url };
        });

        for (let i = 0; i < completed.length; i += 500) {
          const chunk = completed.slice(i, i + 500);
          const { error } = await supabase.from("products").insert(chunk);
          if (error) throw error;
          imported += chunk.length;
        }
      }
      toast.success(`${imported} produto(s) importado(s). ${imagesFound} imagem(ns) encontrada(s) automaticamente.`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Falha na importação"); }
    finally { setImporting(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  function edit(product: Product) {
    setEditing(product); setForm({ description: product.description, internal_code: product.internal_code ?? "", ean: product.ean ?? "", unit: product.unit ?? "", category: product.category ?? "", image_url: product.image_url ?? "", unit_price: product.unit_price != null ? String(product.unit_price) : "" }); setOpen(true);
  }

  const total = products.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <AppShell title="Catálogo de produtos" subtitle="Base usada no cruzamento automático das ofertas.">
    <div className="surface p-4"><div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por descrição, EAN ou código interno" value={search} maxLength={120} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
      <Select value={category} onValueChange={(value) => { setCategory(value); setPage(0); }}><SelectTrigger className="w-60"><SelectValue placeholder="Categoria" /></SelectTrigger><SelectContent><SelectItem value={ALL}>Todas as categorias</SelectItem>{(categories.data ?? []).map((item) => <SelectItem key={item} value={item}>{item === UNCATEGORIZED ? "Sem categoria" : item}</SelectItem>)}</SelectContent></Select>
      <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={(e) => handleImport(e.target.files)} />
      <Button variant="outline" disabled={importing} onClick={() => fileInput.current?.click()}>{importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Importar CSV/Excel</Button>
      <Button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}><Plus className="size-4" /> Novo produto</Button>
    </div></div>

    <div className="surface mt-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Imagem</TableHead><TableHead>Descrição</TableHead><TableHead>EAN</TableHead><TableHead>Código</TableHead><TableHead>Un.</TableHead><TableHead>Preço</TableHead><TableHead>Categoria</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>
      {(products.data?.rows ?? []).map((product) => <TableRow key={product.id}><TableCell>{product.image_url ? <img src={product.image_url} alt={product.description} loading="lazy" className="size-12 rounded-md object-cover" /> : <span className="flex size-12 items-center justify-center rounded-md bg-muted"><ImageIcon className="size-4 text-muted-foreground" /></span>}</TableCell><TableCell className="font-medium">{product.description}</TableCell><TableCell>{product.ean || "—"}</TableCell><TableCell>{product.internal_code || "—"}</TableCell><TableCell>{product.unit || "—"}</TableCell><TableCell>{product.unit_price ?? "—"}</TableCell><TableCell>{product.category || "Sem categoria"}</TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => edit(product)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => { if (confirm(`Excluir ${product.description}?`)) remove.mutate(product.id); }}><Trash2 className="size-4 text-destructive" /></Button></div></TableCell></TableRow>)}
    </TableBody></Table></div>

    <div className="mt-4 flex items-center justify-between text-sm"><span>{total} produto(s)</span><div className="flex items-center gap-2"><Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button><span>Página {page + 1} de {pages}</span><Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button></div></div>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader><div className="grid gap-3">
      {([['description','Descrição'],['internal_code','Código interno'],['ean','EAN'],['unit','Unidade'],['category','Categoria'],['unit_price','Preço'],['image_url','URL da imagem']] as const).map(([key,label]) => <div key={key} className="grid gap-1"><Label>{label}</Label><Input value={form[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} /></div>)}
    </div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Salvar</Button></DialogFooter></DialogContent></Dialog>
  </AppShell>;
}
