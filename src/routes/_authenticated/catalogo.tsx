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
import { readSpreadsheet, pick, columnValue, categoryFromFileName } from "@/lib/spreadsheet";
import { bestMatch, parsePrice } from "@/lib/text-match";
import { findProductImages } from "@/lib/product-image";

export const Route = createFileRoute("/_authenticated/catalogo")({
  head: () => ({ meta: [{ title: "Catálogo de produtos — OfertaFlow" }] }),
  component: CatalogPage,
});

const PAGE_SIZE = 20;
const ALL = "__all__";
const UNCATEGORIZED = "__uncategorized__";
type Product = { id: string; internal_code: string | null; promotion_code: string | null; ean: string | null; description: string; unit: string | null; unit_price: number | null; category: string | null; image_url: string | null };
const emptyForm = { description: "", internal_code: "", promotion_code: "", ean: "", unit: "", category: "", image_url: "", unit_price: "" };

function cleanEan(value: unknown): string { return String(value ?? "").replace(/\D/g, ""); }
function cleanPromotionCode(value: unknown): string { return String(value ?? "").trim().replace(/\.0$/, ""); }

async function loadCategories() {
  const values = new Set<string>(); let hasUncategorized = false;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("products").select("category").range(from, from + 999);
    if (error) throw error;
    for (const row of data ?? []) { if (row.category) values.add(row.category); else hasUncategorized = true; }
    if ((data ?? []).length < 1000) break;
  }
  const categories = [...values].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return hasUncategorized ? [UNCATEGORIZED, ...categories] : categories;
}

async function loadAllProducts(): Promise<Product[]> {
  const result: Product[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("products").select("id, internal_code, promotion_code, ean, description, unit, unit_price, category, image_url").range(from, from + 999);
    if (error) throw error;
    result.push(...((data ?? []) as Product[]));
    if ((data ?? []).length < 1000) break;
  }
  return result;
}

async function enrichImagesInBackground(rows: Array<{ id: string; ean: string | null; image_url: string | null }>, queryClient: ReturnType<typeof useQueryClient>) {
  const missing = rows.filter((row) => !row.image_url && row.ean).map((row) => row.ean as string);
  if (!missing.length) return;
  const images = await findProductImages(missing);
  if (!images.size) return;
  const queue = rows.filter((row) => !row.image_url && row.ean && images.has(row.ean));
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const row = queue[cursor++]; const url = images.get(row.ean!); if (!url) continue;
      const { error } = await supabase.from("products").update({ image_url: url }).eq("id", row.id);
      if (error) console.warn("Could not save product image", row.id, error);
    }
  };
  await Promise.all(Array.from({ length: Math.min(12, queue.length) }, () => worker()));
  queryClient.invalidateQueries({ queryKey: ["products"] });
}

function CatalogPage() {
  const queryClient = useQueryClient(); const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(""); const [category, setCategory] = useState(ALL); const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [page, setPage] = useState(0); const [editing, setEditing] = useState<Product | null>(null); const [form, setForm] = useState(emptyForm); const [open, setOpen] = useState(false); const [importing, setImporting] = useState(false);

  const categories = useQuery({ queryKey: ["product-categories"], queryFn: loadCategories });
  const products = useQuery({
    queryKey: ["products", search, category, page],
    queryFn: async () => {
      let query = supabase.from("products").select("id, internal_code, promotion_code, ean, description, unit, unit_price, category, image_url", { count: "exact" }).order("description").range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      const term = search.trim().replace(/[,%]/g, " ");
      if (term) query = query.or(`description.ilike.%${term}%,ean.ilike.%${term}%,internal_code.ilike.%${term}%,promotion_code.ilike.%${term}%`);
      if (category === UNCATEGORIZED) query = query.is("category", null); else if (category !== ALL) query = query.eq("category", category);
      const { data, error, count } = await query; if (error) throw error; return { rows: (data ?? []) as Product[], count: count ?? 0 };
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.description.trim()) throw new Error("Descrição obrigatória");
      const { data: auth } = await supabase.auth.getUser(); if (!auth.user) throw new Error("Sessão expirada");
      const payload = { description: form.description.trim(), internal_code: form.internal_code.trim() || null, promotion_code: cleanPromotionCode(form.promotion_code) || null, ean: cleanEan(form.ean) || null, unit: form.unit.trim() || null, category: form.category.trim() || null, image_url: form.image_url.trim() || null, unit_price: parsePrice(form.unit_price) };
      const result = editing ? await supabase.from("products").update(payload).eq("id", editing.id) : await supabase.from("products").insert({ ...payload, user_id: auth.user.id });
      if (result.error) throw result.error;
    },
    onSuccess: () => { toast.success(editing ? "Produto atualizado" : "Produto cadastrado"); setOpen(false); setEditing(null); setForm(emptyForm); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] }); },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from("products").delete().eq("id", id); if (error) throw error; }, onSuccess: () => { toast.success("Produto excluído"); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] }); }, onError: (error: Error) => toast.error(error.message) });

  async function deleteGroups() {
    if (!selectedGroups.length) return;
    const labels = selectedGroups.map((item) => item === UNCATEGORIZED ? "Sem categoria" : item);
    if (!confirm(`Excluir todos os produtos dos ${selectedGroups.length} CSV/Excel selecionados?\n\n${labels.join("\n")}`)) return;
    try {
      for (const group of selectedGroups) { const query = supabase.from("products").delete(); const result = group === UNCATEGORIZED ? await query.is("category", null) : await query.eq("category", group); if (result.error) throw result.error; }
      setSelectedGroups([]); setCategory(ALL); setPage(0); toast.success("Importações selecionadas excluídas"); queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Não foi possível excluir as importações"); }
  }

  async function handleImport(files: FileList | null) {
    if (!files?.length) return;
    setImporting(true); const startedAt = performance.now();
    try {
      const { data: auth } = await supabase.auth.getUser(); if (!auth.user) throw new Error("Sessão expirada");
      const existing = await loadAllProducts();
      const byEan = new Map(existing.filter((item) => item.ean).map((item) => [cleanEan(item.ean), item]));
      const existingCodes = new Set(existing.filter((item) => item.promotion_code).map((item) => cleanPromotionCode(item.promotion_code)));
      let imported = 0; let skipped = 0;
      const insertedForImage: Array<{ id: string; ean: string | null; image_url: string | null }> = [];

      for (const file of Array.from(files)) {
        const rows = await readSpreadsheet(file); const categoryName = categoryFromFileName(file.name);
        const mapped = rows.map((row) => {
          // Column B is the operational promotion/checkout code. It is NOT the EAN and NOT the Supabase id.
          const promotionCode = cleanPromotionCode(columnValue(row, 1));
          const ean = cleanEan(pick(row, ["EAN", "Código de barras", "GTIN", "EAN13", "EAN-13"]));
          return {
            user_id: auth.user!.id,
            internal_code: String(pick(row, ["Cód. Interno", "Codigo Interno", "Cod Interno", "Código Interno Sistema"]) || "").trim() || null,
            promotion_code: promotionCode || null,
            ean: ean || null,
            description: String(pick(row, ["Descrição", "Descricao", "Produto", "Nome"]) || "").trim(),
            unit: String(pick(row, ["Un.", "Un", "Unidade"]) || "").trim() || null,
            unit_price: parsePrice(pick(row, ["Preço Un.", "Preco Un", "Preço", "Preco"])),
            category: String(pick(row, ["Categoria", "Category"]) || categoryName).trim() || categoryName,
            image_url: String(pick(row, ["URL da imagem", "URL Imagem", "Imagem", "Image", "Foto"]) || "").trim() || null,
          };
        }).filter((row) => row.description);

        const uniqueRows = [];
        for (const row of mapped) {
          if (!row.promotion_code || existingCodes.has(row.promotion_code)) { skipped++; continue; }
          existingCodes.add(row.promotion_code);
          const exact = row.ean ? byEan.get(row.ean) : undefined;
          const fuzzy = exact ?? (bestMatch(row.description, existing, 0.62)?.item as Product | undefined);
          uniqueRows.push({ ...row, image_url: row.image_url || fuzzy?.image_url || null });
        }

        for (let i = 0; i < uniqueRows.length; i += 1000) {
          const chunk = uniqueRows.slice(i, i + 1000);
          const { data, error } = await supabase.from("products").insert(chunk).select("id, ean, image_url");
          if (error) throw error;
          insertedForImage.push(...((data ?? []) as Array<{ id: string; ean: string | null; image_url: string | null }>)); imported += chunk.length;
        }
      }

      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1); setImporting(false); if (fileInput.current) fileInput.current.value = "";
      toast.success(`${imported} produto(s) importado(s) em ${seconds}s. ${skipped} repetido(s)/sem código ignorado(s). As imagens faltantes serão buscadas em segundo plano.`);
      queryClient.invalidateQueries({ queryKey: ["products"] }); queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      void enrichImagesInBackground(insertedForImage, queryClient).catch((error) => console.warn("Image enrichment failed", error));
    } catch (error) { setImporting(false); if (fileInput.current) fileInput.current.value = ""; toast.error(error instanceof Error ? error.message : "Falha na importação"); }
  }

  function edit(product: Product) { setEditing(product); setForm({ description: product.description, internal_code: product.internal_code ?? "", promotion_code: product.promotion_code ?? "", ean: product.ean ?? "", unit: product.unit ?? "", category: product.category ?? "", image_url: product.image_url ?? "", unit_price: product.unit_price != null ? String(product.unit_price) : "" }); setOpen(true); }

  const total = products.data?.count ?? 0; const pages = Math.max(1, Math.ceil(total / PAGE_SIZE)); const selectableGroups = (categories.data ?? []).filter((item) => item !== ALL);

  return <AppShell title="Catálogo de produtos" subtitle="Base usada no cruzamento automático das ofertas.">
    <div className="surface p-4 space-y-4"><div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" placeholder="Buscar por descrição, EAN ou código da promoção" value={search} maxLength={120} onChange={(e) => { setSearch(e.target.value); setPage(0); }} /></div>
      <Select value={category} onValueChange={(value) => { setCategory(value); setPage(0); }}><SelectTrigger className="w-60"><SelectValue placeholder="Categoria" /></SelectTrigger><SelectContent><SelectItem value={ALL}>Todas as categorias</SelectItem>{(categories.data ?? []).map((item) => <SelectItem key={item} value={item}>{item === UNCATEGORIZED ? "Sem categoria" : item}</SelectItem>)}</SelectContent></Select>
      <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" multiple hidden onChange={(e) => handleImport(e.target.files)} />
      <Button variant="outline" disabled={importing} onClick={() => fileInput.current?.click()}>{importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Importar CSV/Excel</Button>
      <Button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}><Plus className="size-4" /> Novo produto</Button>
    </div>
    <div className="border-t pt-3"><div className="mb-2 flex items-center gap-2 text-sm font-medium"><CheckSquare className="size-4" /> Importações/CSV salvos</div><div className="flex flex-wrap gap-x-5 gap-y-2">{selectableGroups.length ? selectableGroups.map((item) => <label key={item} className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={selectedGroups.includes(item)} onChange={(e) => setSelectedGroups((current) => e.target.checked ? [...current, item] : current.filter((value) => value !== item))} /><span>{item === UNCATEGORIZED ? "Sem categoria" : item}</span></label>) : <span className="text-sm text-muted-foreground">Nenhum CSV importado ainda.</span>}</div><div className="mt-3"><Button variant="destructive" size="sm" disabled={!selectedGroups.length} onClick={deleteGroups}><Trash2 className="size-4" /> Excluir selecionados ({selectedGroups.length})</Button></div></div></div>

    <div className="surface mt-4 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Imagem</TableHead><TableHead>Descrição</TableHead><TableHead>EAN</TableHead><TableHead>Cód. promoção</TableHead><TableHead>Cód. interno</TableHead><TableHead>Un.</TableHead><TableHead>Preço</TableHead><TableHead>Categoria</TableHead><TableHead>Ações</TableHead></TableRow></TableHeader><TableBody>{(products.data?.rows ?? []).map((product) => <TableRow key={product.id}><TableCell>{product.image_url ? <img src={product.image_url} alt={product.description} loading="lazy" className="size-12 rounded-md object-cover" /> : <span className="flex size-12 items-center justify-center rounded-md bg-muted"><ImageIcon className="size-4 text-muted-foreground" /></span>}</TableCell><TableCell className="font-medium">{product.description}</TableCell><TableCell>{product.ean || "—"}</TableCell><TableCell>{product.promotion_code || "—"}</TableCell><TableCell>{product.internal_code || "—"}</TableCell><TableCell>{product.unit || "—"}</TableCell><TableCell>{product.unit_price ?? "—"}</TableCell><TableCell>{product.category || "Sem categoria"}</TableCell><TableCell><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={() => edit(product)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" onClick={() => { if (confirm(`Excluir ${product.description}?`)) remove.mutate(product.id); }}><Trash2 className="size-4 text-destructive" /></Button></div></TableCell></TableRow>)}</TableBody></Table></div>

    <div className="mt-4 flex items-center justify-between text-sm"><span>{total} produto(s)</span><div className="flex items-center gap-2"><Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</Button><span>Página {page + 1} de {pages}</span><Button variant="outline" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Próxima</Button></div></div>

    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle></DialogHeader><div className="grid gap-3">{([['description','Descrição'],['promotion_code','Código da promoção/caixa'],['internal_code','Código interno do sistema'],['ean','EAN'],['unit','Unidade'],['category','Categoria'],['unit_price','Preço'],['image_url','URL da imagem']] as const).map(([key,label]) => <div key={key} className="grid gap-1"><Label>{label}</Label><Input value={form[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} /></div>)}</div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <Loader2 className="size-4 animate-spin" /> : null} Salvar</Button></DialogFooter></DialogContent></Dialog>
  </AppShell>;
}
