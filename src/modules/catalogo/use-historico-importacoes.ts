import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { invalidarCacheCatalogo } from "./catalogo";

export interface ResumoImportacao {
  id: string;
  file_name: string;
  category: string;
  inserted_count: number;
  updated_count: number;
  ignored_count: number;
  error_count: number;
  stock_updated_at: string | null;
  stock_covered_count: number;
  product_count: number;
  created_at: string;
  undone_at: string | null;
}

export function useHistoricoImportacoes() {
  const queryClient = useQueryClient();
  const historico = useQuery({
    queryKey: ["catalog-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_imports")
        .select(
          "id,file_name,category,inserted_count,updated_count,ignored_count,error_count,stock_updated_at,stock_covered_count,product_count,created_at,undone_at",
        )
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as ResumoImportacao[];
    },
  });

  async function desfazerImportacao(id: string) {
    const { error } = await supabase.rpc("undo_catalog_import", { p_import_id: id });
    if (error) throw error;
    invalidarCacheCatalogo();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["catalog-imports"] }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
      queryClient.invalidateQueries({ queryKey: ["product-categories"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] }),
      queryClient.invalidateQueries({ queryKey: ["image-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["image-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["image-review"] }),
    ]);
    toast.success("Carga desfeita e categoria restaurada.");
  }

  return {
    historico: historico.data ?? [],
    carregando: historico.isLoading,
    erro: historico.error,
    desfazerImportacao,
  };
}
