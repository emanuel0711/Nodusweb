import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Plus, Search, Upload, Pencil, Trash2, ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { readSpreadsheet, pick, categoryFromFileName } from "@/lib/spreadsheet";
import { parsePrice } from "@/lib/text-match";

export const Route = createFileRoute("/_authenticated/catalogo")({
  head: () => ({
    meta: [
      { title: "Catálogo de produtos — OfertaFlow" },
      {
        name: "description",
        content:
          "Importe, cadastre, edite e exclua produtos com código interno, EAN, unidade, preço e imagem.",
      },
      { property: "og:title", content: "Catálogo de produtos — OfertaFlow" },
      {
        property: "og:description",
        content: "Base de dados de produtos com importação de CSV/Excel e vínculo de imagens.",
      },
    ],
  }),
  component: CatalogPage,
});

const PAGE_SIZE = 20;
const ALL = "__all__";

const productSchema = z.object({
  description: z.string().trim().min(1, "Descrição obrigatória").max(300),
  internal_code: z.string().trim().max(60).optional().or(z.literal("")),
  ean: z.string().trim().max(60).optional().or(z.literal("")),
  unit: z.string().trim().max(20).optional().or(z.literal("")),
  category: z.string().trim().max(120).optional().or(z.literal("")),
  image_url: z
    .string()
    .trim()
    .max(1000)
    .url("URL da imagem inválida")
    .optional()
    .or(z.literal("")),
  unit_price: z.string().trim().max(20).optional().or(z.literal("")),
});

type ProductRow = {
  id: string;
  internal_code: string | null;
  ean: string | null;
  description: string;
  unit: string | null;
  unit_price: number | null;
  category: string | null;
  image_url: string | null;
};

const emptyForm = {
  description: "",
  internal_code: "",
  ean: "",
  unit: "",
  category: "",
  image_url: "",
  unit_price: "",
};

function CatalogPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);

  const categories = useQuery({
    queryKey: ["product-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("category")
        .not("category", "is", null)
        .limit(1000);
      if (error) throw error;
      return [...new Set((data ?? []).map((row) => row.category).filter(Boolean))].sort() as string[];
    },
  });

  const products = useQuery({
    queryKey: ["products", search, category, page],
    queryFn: async () => {
      let query = supabase
        .from("products")
        .select("id, internal_code, ean, description, unit, unit_price, category, image_url", {
          count: "exact",
        })
        .order("description")
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const term = search.trim();
      if (term) {
        const safe = term.replace(/[,%]/g, " ");
        query = query.or(
          `description.ilike.%${safe}%,ean.ilike.%${safe}%,internal_code.ilike.%${safe}%`,
        );
      }
      if (category !== ALL) query = query.eq("category", category);

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as ProductRow[], count: count ?? 0 };
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsed = productSchema.safeParse(form);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Dados inválidos");
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Sessão expirada");

      const payload = {
        description: parsed.data.description,
        internal_code: parsed.data.internal_code || null,
        ean: parsed.data.ean || null,
        unit: parsed.data.unit || null,
        category: parsed.data.category || null,
        image_url: parsed.data.image_url || null,
        unit_price: parsePrice(parsed.data.unit_price),
      };

      if (editing) {
        const { error } = await supabase.from("products").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({ ...payload, user_id: userId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
      setOpen(false);
      setEditing(null);
      setForm(emptyForm);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Produto excluído");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const groups = useQuery({
    queryKey: ["product-groups"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("category").limit(20000);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        const key = row.category ?? "Sem categoria";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const deleteGroupsMutation = useMutation({
    mutationFn: async (names: string[]) => {
      for (const name of names) {
        const query = supabase.from("products").delete();
        const { error } =
          name === "Sem categoria"
            ? await query.is("category", null)
            : await query.eq("category", name);
        if (error) throw error;
      }
    },
    onSuccess: (_data, names) => {
      toast.success(`${names.length} arquivo(s) removido(s) do catálogo`);
      setSelectedGroups([]);
      setCategory(ALL);
      setPage(0);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-groups"] });
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });



  async function handleImport(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Sessão expirada");

      let imported = 0;
      for (const file of Array.from(files)) {
        const fileCategory = categoryFromFileName(file.name);
        const rows = await readSpreadsheet(file);
        const mapped = rows
          .map((row) => ({
            user_id: userId,
            internal_code: String(pick(row, ["Cód. Interno", "Codigo Interno", "Cod Interno"]) || "") || null,
            ean: String(pick(row, ["Código", "Codigo", "EAN", "Código de barras"]) || "") || null,
            description: String(pick(row, ["Descrição", "Descricao", "Produto", "Nome"]) || "").trim(),
            unit: String(pick(row, ["Un.", "Un", "Unidade"]) || "") || null,
            unit_price: parsePrice(pick(row, ["Preço Un.", "Preco Un", "Preço", "Preco"])),
            category: fileCategory,
            image_url: String(pick(row, ["URL da imagem", "Imagem", "Image"]) || "") || null,
          }))
          .filter((row) => row.description.length > 0);

        for (let i = 0; i < mapped.length; i += 500) {
          const chunk = mapped.slice(i, i + 500);
          const { error } = await supabase.from("products").insert(chunk);
          if (error) throw error;
          imported += chunk.length;
        }
      }
      toast.success(`${imported} produto(s) importado(s)`);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha na importação");
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setForm({
      description: product.description,
      internal_code: product.internal_code ?? "",
      ean: product.ean ?? "",
      unit: product.unit ?? "",
      category: product.category ?? "",
      image_url: product.image_url ?? "",
      unit_price: product.unit_price != null ? String(product.unit_price) : "",
    });
    setOpen(true);
  }

  const total = products.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AppShell
      title="Catálogo de produtos"
      subtitle="Base usada no cruzamento automático das ofertas."
    >
      <div className="surface p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por descrição, EAN ou código interno"
              value={search}
              maxLength={120}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <Select
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setPage(0);
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas as categorias</SelectItem>
              {(categories.data ?? []).map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.xls"
            multiple
            hidden
            onChange={(event) => handleImport(event.target.files)}
          />
          <Button variant="outline" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            Importar CSV/Excel
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setForm(emptyForm);
              setOpen(true);
            }}
          >
            <Plus className="size-4" />
            Novo produto
          </Button>
        </div>
      </div>

      <div className="surface mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Img</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Cód. interno</TableHead>
              <TableHead>EAN</TableHead>
              <TableHead>Un.</TableHead>
              <TableHead>Preço</TableHead>
              <TableHead>Categoria</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Carregando...
                </TableCell>
              </TableRow>
            ) : (products.data?.rows.length ?? 0) === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  Nenhum produto encontrado. Importe uma planilha ou cadastre manualmente.
                </TableCell>
              </TableRow>
            ) : (
              products.data?.rows.map((product) => (
                <TableRow key={product.id}>
                  <TableCell>
                    {product.image_url ? (
                      <img
                        src={product.image_url}
                        alt={product.description}
                        loading="lazy"
                        className="size-10 rounded-md object-cover"
                      />
                    ) : (
                      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                        <ImageIcon className="size-4" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-72 font-medium">{product.description}</TableCell>
                  <TableCell className="text-muted-foreground">{product.internal_code ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{product.ean ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{product.unit ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.unit_price != null
                      ? product.unit_price.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{product.category ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(product)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        if (confirm(`Excluir "${product.description}"?`)) {
                          deleteMutation.mutate(product.id);
                        }
                      }}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} produto(s) — página {page + 1} de {pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            Anterior
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pages}
            onClick={() => setPage((value) => value + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription>
              Vincule o código de barras e a URL da imagem para o preenchimento automático das ofertas.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="description">Descrição</Label>
              <Input
                id="description"
                maxLength={300}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internal_code">Cód. interno</Label>
              <Input
                id="internal_code"
                maxLength={60}
                value={form.internal_code}
                onChange={(event) => setForm({ ...form, internal_code: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ean">Código (EAN)</Label>
              <Input
                id="ean"
                maxLength={60}
                value={form.ean}
                onChange={(event) => setForm({ ...form, ean: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">Unidade</Label>
              <Input
                id="unit"
                maxLength={20}
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit_price">Preço unitário</Label>
              <Input
                id="unit_price"
                maxLength={20}
                value={form.unit_price}
                onChange={(event) => setForm({ ...form, unit_price: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="category">Categoria</Label>
              <Input
                id="category"
                maxLength={120}
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="image_url">URL da imagem</Label>
              <Input
                id="image_url"
                maxLength={1000}
                placeholder="https://..."
                value={form.image_url}
                onChange={(event) => setForm({ ...form, image_url: event.target.value })}
              />
              {form.image_url ? (
                <img
                  src={form.image_url}
                  alt="Pré-visualização do produto"
                  className="mt-2 size-24 rounded-md border border-border object-cover"
                />
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
