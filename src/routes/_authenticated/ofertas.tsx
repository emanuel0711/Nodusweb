import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Upload, Download, Loader2, AlertTriangle, ImageIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { readSpreadsheet, pick, exportRows } from "@/lib/spreadsheet";
import { bestMatch, extractLimit, parsePrice } from "@/lib/text-match";

export const Route = createFileRoute("/_authenticated/ofertas")({
  head: () => ({
    meta: [
      { title: "Automação de ofertas — OfertaFlow" },
      {
        name: "description",
        content:
          "Suba a planilha da semana, cruze com o catálogo e exporte o modelo do clube já preenchido.",
      },
      { property: "og:title", content: "Automação de ofertas — OfertaFlow" },
      {
        property: "og:description",
        content: "Cruzamento automático de nome do produto com EAN e imagem do catálogo.",
      },
    ],
  }),
  component: OffersPage,
});

interface OfferRow {
  name: string;
  price: number | null;
  clubPrice: number | null;
  limit: number | null;
  ean: string;
  imageUrl: string;
  matchedDescription: string | null;
  score: number;
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
      const [sheet, catalog] = await Promise.all([
        readSpreadsheet(file),
        supabase.from("products").select("id, description, ean, internal_code, image_url").limit(10000),
      ]);
      if (catalog.error) throw catalog.error;
      const candidates = (catalog.data ?? []).map((item) => ({
        id: item.id,
        description: item.description,
        ean: item.ean ?? "",
        internal_code: item.internal_code ?? "",
        image_url: item.image_url ?? "",
      }));

      const processed: OfferRow[] = sheet
        .map((row) => {
          const name = String(
            pick(row, ["Nome do Produto", "Nome", "Produto", "Descrição", "Descricao"]) || "",
          ).trim();
          if (!name) return null;
          const match = bestMatch(name, candidates, threshold);
          return {
            name,
            price: parsePrice(pick(row, ["Preço Normal", "Preco Normal", "Preço", "Preco"])),
            clubPrice: parsePrice(pick(row, ["Preço Clube", "Preco Clube", "Preço promocional"])),
            limit: extractLimit(pick(row, ["Limite por CPF", "Limite", "Limite por cliente"])),
            ean: match ? match.item.ean || match.item.internal_code : "",
            imageUrl: match ? match.item.image_url : "",
            matchedDescription: match ? match.item.description : null,
            score: match ? match.score : 0,
          } satisfies OfferRow;
        })
        .filter((row): row is OfferRow => row !== null);

      setRows(processed);
      setFileName(file.name);

      const matched = processed.filter((row) => row.ean && row.imageUrl).length;
      const { data: userData } = await supabase.auth.getUser();
      if (userData.user) {
        await supabase.from("offer_runs").insert({
          user_id: userData.user.id,
          file_name: file.name,
          total_items: processed.length,
          matched_items: matched,
        });
        queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      }
      toast.success(`${processed.length} oferta(s) processada(s) — ${matched} com código e imagem`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar a planilha");
    } finally {
      setProcessing(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleExport() {
    if (rows.length === 0) return;
    exportRows(
      rows.map((row) => ({
        Nome: row.name,
        Preço: row.price ?? "",
        "Preço promocional": row.clubPrice ?? "",
        "Limite por cliente": row.limit ?? "",
        "URL da imagem": row.imageUrl,
        "Códigos dos produtos": row.ean,
      })),
      "modelo para o clube.xlsx",
      "Ofertas",
    );
    toast.success("Planilha exportada");
  }

  function updateRow(index: number, patch: Partial<OfferRow>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setRows((current) => current.filter((_, i) => i !== index));
  }

  function clearFile() {
    setRows([]);
    setFileName("");
    if (fileInput.current) fileInput.current.value = "";
    toast.success("Planilha removida");
  }

  const pending = rows.filter((row) => !row.ean || !row.imageUrl).length;

  return (
    <AppShell
      title="Automação de ofertas"
      subtitle="Do SABADOU.xlsx ao “modelo para o clube.xlsx” com códigos e imagens preenchidos."
    >
      <div className="surface flex flex-wrap items-center gap-3 p-5">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) processFile(file);
          }}
        />
        <Button disabled={processing} onClick={() => fileInput.current?.click()}>
          {processing ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          Enviar planilha de ofertas
        </Button>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Sensibilidade da busca</span>
          <Input
            type="number"
            min={0.3}
            max={1}
            step={0.05}
            className="w-24"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value) || 0.55)}
          />
        </div>
        <Button
          variant="destructive"
          disabled={rows.length === 0}
          className="ml-auto"
          onClick={() => {
            if (confirm("Excluir a planilha carregada?")) clearFile();
          }}
        >
          <Trash2 className="size-4" />
          Excluir planilha
        </Button>
        <Button variant="outline" disabled={rows.length === 0} onClick={handleExport}>
          <Download className="size-4" />
          Exportar planilha preenchida
        </Button>
      </div>


      {rows.length > 0 ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="rounded-full bg-secondary px-3 py-1 font-medium">{fileName}</span>
            <span className="rounded-full bg-secondary px-3 py-1">{rows.length} itens</span>
            {pending > 0 ? (
              <span className="flex items-center gap-2 rounded-full bg-warn px-3 py-1 font-medium text-warn-foreground">
                <AlertTriangle className="size-3.5" />
                {pending} sem correspondência completa
              </span>
            ) : (
              <span className="rounded-full bg-accent px-3 py-1 text-accent-foreground">
                Todos os itens com código e imagem
              </span>
            )}
          </div>

          <div className="surface mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">Img</TableHead>
                  <TableHead>Nome (planilha)</TableHead>
                  <TableHead>Correspondência no catálogo</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Preço clube</TableHead>
                  <TableHead>Limite</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>URL da imagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const incomplete = !row.ean || !row.imageUrl;
                  return (
                    <TableRow key={`${row.name}-${index}`} className={incomplete ? "bg-warn/40" : ""}>
                      <TableCell>
                        {row.imageUrl ? (
                          <img
                            src={row.imageUrl}
                            alt={row.name}
                            loading="lazy"
                            className="size-10 rounded-md object-cover"
                          />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                            <ImageIcon className="size-4" />
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-64 font-medium">{row.name}</TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">
                        {row.matchedDescription ? (
                          <>
                            {row.matchedDescription}
                            <span className="ml-1 opacity-70">({Math.round(row.score * 100)}%)</span>
                          </>
                        ) : (
                          "Não encontrado"
                        )}
                      </TableCell>
                      <TableCell>{row.price ?? "—"}</TableCell>
                      <TableCell>{row.clubPrice ?? "—"}</TableCell>
                      <TableCell>{row.limit ?? "—"}</TableCell>
                      <TableCell>
                        <Input
                          className="w-36"
                          value={row.ean}
                          maxLength={60}
                          onChange={(event) => updateRow(index, { ean: event.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          className="w-56"
                          value={row.imageUrl}
                          maxLength={1000}
                          onChange={(event) => updateRow(index, { imageUrl: event.target.value })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="surface mt-4 p-10 text-center text-sm text-muted-foreground">
          Envie a planilha da semana (ex.: SABADOU.xlsx) para ver a pré-visualização aqui.
          <br />
          Colunas reconhecidas: Nome do Produto, Preço Normal, Preço Clube e Limite por CPF.
        </div>
      )}
    </AppShell>
  );
}
