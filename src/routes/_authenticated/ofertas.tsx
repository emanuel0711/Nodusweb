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
import { readSpreadsheet, pick, exportClubTemplate, type ClubOfferExportRow } from "@/lib/spreadsheet";
import { bestMatch, extractLimit, parsePrice } from "@/lib/text-match";
import { findProductImages } from "@/lib/product-image";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({ meta: [{ title: "Automação de ofertas — OfertaFlow" }] }),
  component: OffersPage,
});

interface Candidate {
  id: string;
  description: string;
  ean: string;
  internal_code: string;
  image_url: string;
}

interface OfferRow {
  name: string;
  price: number | null;
  clubPrice: number | null;
  limit: number | null;
  ean: string;
  codeType: "Interno" | "EAN";
  imageUrl: string;
  matchedDescription: string | null;
  score: number;
}

function cleanCode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

async function loadAllProducts(): Promise<Candidate[]> {
  const result: Candidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("products")
      .select("id, description, ean, internal_code, image_url")
      .range(from, from + 999);
    if (error) throw error;
    result.push(...((data ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      ean: cleanCode(item.ean),
      internal_code: String(item.internal_code ?? "").trim(),
      image_url: item.image_url ?? "",
    }))));
    if ((data ?? []).length < 1000) break;
  }
  return result;
}

function toOfferRow(row: Record<string, unknown>, candidates: Candidate[], threshold: number): OfferRow | null {
  const name = String(pick(row, ["PRODUTO", "Produto", "Nome do Produto", "Nome", "Descrição", "Descricao"]) || "").trim();
  if (!name) return null;

  const directEan = cleanCode(pick(row, ["EAN", "Código", "Codigo", "Código de barras", "GTIN"]));
  const directCode = String(pick(row, ["Cód. Interno", "Codigo Interno", "Cod Interno", "Código interno"]) || "").trim();
  const exact = directEan ? candidates.find((item) => item.ean === directEan) : directCode ? candidates.find((item) => item.internal_code === directCode) : undefined;
  const match = exact ? { item: exact, score: 1 } : bestMatch(name, candidates, threshold);
  const matched = match?.item;

  const code = matched?.internal_code || directCode || matched?.ean || directEan || "";
  const codeType: "Interno" | "EAN" = matched?.internal_code || directCode ? "Interno" : "EAN";

  return {
    name,
    // The user's real file uses OFERTA and CLUBE. Supporting the older headers too keeps the importer backwards-compatible.
    price: parsePrice(pick(row, ["OFERTA", "Preço Normal", "Preco Normal", "Preço", "Preco"])),
    clubPrice: parsePrice(pick(row, ["CLUBE", "Preço Clube", "Preco Clube", "Preço promocional"])),
    limit: extractLimit(pick(row, ["LIMITE", "Limite por CPF", "Limite", "Limite por cliente"])),
    ean: code,
    codeType,
    imageUrl: matched?.image_url ?? "",
    matchedDescription: matched?.description ?? null,
    score: match?.score ?? 0,
  };
}

function OffersPage() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<OfferRow[]>([]);
  const [threshold, setThreshold] = useState(0.55);

  async function processFile(file: File) {
    setProcessing(true);
    try {
      const [sheet, candidates] = await Promise.all([readSpreadsheet(file), loadAllProducts()]);
      if (!sheet.length) throw new Error("A planilha não possui linhas de produtos reconhecíveis.");

      const processed = sheet
        .map((row) => toOfferRow(row, candidates, threshold))
        .filter((row): row is OfferRow => row !== null);
      if (!processed.length) throw new Error("Não encontrei uma coluna de produto na planilha.");

      const missingImageEans = processed.filter((row) => row.ean && !row.imageUrl).map((row) => row.ean);
      const autoImages = await findProductImages(missingImageEans);
      const completed = processed.map((row) => ({ ...row, imageUrl: row.imageUrl || autoImages.get(row.ean) || "" }));

      setRows(completed);
      setFileName(file.name);
      const matched = completed.filter((row) => row.score >= threshold).length;
      const withImages = completed.filter((row) => row.imageUrl).length;
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("offer_runs").insert({ user_id: userData.user.id, file_name: file.name, total_items: completed.length, matched_items: matched });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${completed.length} oferta(s) processada(s). ${matched} correspondência(s), ${withImages} imagem(ns).`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar a planilha");
    } finally {
      setProcessing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleExport() {
    if (!rows.length) return;
    const exportRows: ClubOfferExportRow[] = rows.map((row) => ({
      name: row.name,
      price: row.price,
      promotionalPrice: row.clubPrice,
      limit: row.limit,
      imageUrl: row.imageUrl,
      code: row.ean,
      codeType: row.codeType,
    }));
    try {
      exportClubTemplate(exportRows, "modelo para o clube.xlsx");
      toast.success("Arquivo do Clube gerado e enviado para download.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível gerar o arquivo.");
    }
  }

  const pending = rows.filter((row) => !row.ean || !row.imageUrl || row.score < threshold).length;

  return (
    <AppShell title="Automação de ofertas" subtitle="Envie sua planilha pessoal, encontre os produtos equivalentes no catálogo e gere o arquivo aceito pelo Clube.">
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) processFile(file); }} />
        <Button disabled={processing} onClick={() => fileInput.current?.click()}>
          {processing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Enviar planilha pessoal
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Sensibilidade</span>
          <Input type="number" min={0.3} max={1} step={0.05} className="w-24" value={threshold} onChange={(event) => setThreshold(Number(event.target.value) || 0.55)} />
        </div>
        <Button variant="destructive" disabled={!rows.length} className="ml-auto" onClick={() => { if (confirm("Excluir a planilha carregada?")) { setRows([]); setFileName(""); toast.success("Planilha removida"); } }}>
          <Trash2 className="size-4" /> Limpar
        </Button>
        <Button variant="outline" disabled={!rows.length || processing} onClick={handleExport}><Download className="size-4" /> Baixar arquivo do Clube</Button>
      </div>

      <div className="mt-4 rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Como funciona:</strong> o sistema não exige que o nome da sua planilha seja igual ao catálogo. Ele procura a correspondência mais provável, reaproveita EAN/código e imagem salvos e tenta uma imagem externa pelo EAN quando necessário.
      </div>

      {rows.length ? <>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="rounded-full bg-secondary px-3 py-1 font-medium">{fileName}</span>
          <span className="rounded-full bg-secondary px-3 py-1">{rows.length} itens</span>
          {pending ? <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground"><AlertTriangle className="size-3.5" /> {pending} precisam de revisão</span> : <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">Tudo pronto para exportar</span>}
        </div>
        <div className="surface mt-4 overflow-x-auto">
          <Table><TableHeader><TableRow><TableHead>Img</TableHead><TableHead>Nome da sua planilha</TableHead><TableHead>Produto encontrado no catálogo</TableHead><TableHead>Confiança</TableHead><TableHead>Preço</TableHead><TableHead>Preço clube</TableHead><TableHead>Limite</TableHead><TableHead>Código</TableHead><TableHead>URL da imagem</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map((row, index) => <TableRow key={`${row.name}-${index}`} className={!row.ean || !row.imageUrl || row.score < threshold ? "bg-warn/40" : ""}>
              <TableCell>{row.imageUrl ? <img src={row.imageUrl} alt={row.name} loading="lazy" className="size-10 rounded-md object-cover" /> : <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}</TableCell>
              <TableCell className="max-w-64 font-medium">{row.name}</TableCell>
              <TableCell className="max-w-72 text-xs text-muted-foreground">{row.matchedDescription ? row.matchedDescription : "Não encontrado"}</TableCell>
              <TableCell>{Math.round(row.score * 100)}%</TableCell>
              <TableCell>{row.price ?? "—"}</TableCell><TableCell>{row.clubPrice ?? "—"}</TableCell><TableCell>{row.limit ?? "—"}</TableCell>
              <TableCell><Input className="w-36" value={row.ean} maxLength={60} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, ean: event.target.value } : item))} /></TableCell>
              <TableCell><Input className="w-56" value={row.imageUrl} maxLength={1000} onChange={(event) => setRows((current) => current.map((item, i) => i === index ? { ...item, imageUrl: event.target.value } : item))} /></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </> : <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">Envie sua planilha pessoal para começar. O sistema fará o cruzamento com o catálogo salvo.</div>}
    </AppShell>
  );
}
