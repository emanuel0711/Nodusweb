import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerPlanilha, categoriaPeloNomeDoArquivo } from "@/lib/planilha";
import { lerPreco } from "@/lib/comparar-textos";
import { buscarImagens } from "@/lib/imagens";
import { COLUNAS_PRODUTO, carregarTodosProdutos, chaveDoProduto, limparCodigo, limparEan, linhaParaProduto, type Produto } from "@/lib/catalogo";

export const POR_PAGINA = 20;
export const TODAS = "__all__";
export const SEM_CATEGORIA = "__uncategorized__";
export const FORMULARIO_VAZIO = { description: "", internal_code: "", promotion_code: "", ean: "", unit: "", category: "", image_url: "", unit_price: "" };
export type FormularioProduto = typeof FORMULARIO_VAZIO;

async function carregarCategorias(): Promise<string[]> {
  const produtos = await carregarTodosProdutos();
  const nomes = new Set<string>();
  let semCategoria = false;
  produtos.forEach((produto) => produto.category ? nomes.add(produto.category) : semCategoria = true);
  const lista = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return semCategoria ? [SEM_CATEGORIA, ...lista] : lista;
}

async function completarImagens(novos: Array<{ id: string; ean: string | null }>) {
  const eans = novos.map((item) => item.ean).filter((ean): ean is string => Boolean(ean));
  if (!eans.length) return;
  const imagens = await buscarImagens(eans);
  await Promise.all(novos.map(async (item) => {
    const url = item.ean ? imagens.get(item.ean) : undefined;
    if (url) await supabase.from("products").update({ image_url: url }).eq("id", item.id);
  }));
}

export function useCatalogo() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [busca, setBusca] = useState("");
  const [categoria, setCategoria] = useState(TODAS);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [formulario, setFormulario] = useState<FormularioProduto>(FORMULARIO_VAZIO);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [importando, setImportando] = useState(false);

  const atualizarListas = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
  };

  const categorias = useQuery({ queryKey: ["product-categories"], queryFn: carregarCategorias });
  const produtos = useQuery({
    queryKey: ["products", busca, categoria, pagina],
    queryFn: async () => {
      let consulta = supabase.from("products").select(COLUNAS_PRODUTO, { count: "exact" })
        .order("description").range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
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
      setDialogoAberto(false); setEditando(null); setFormulario(FORMULARIO_VAZIO); atualizarListas();
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
    const nomes = selecionadas.map((item) => item === SEM_CATEGORIA ? "Sem categoria" : item);
    if (!confirm(`Excluir todos os produtos destes ${selecionadas.length} arquivo(s)?\n\n${nomes.join("\n")}`)) return;
    try {
      for (const grupo of selecionadas) {
        const consulta = supabase.from("products").delete();
        const resultado = grupo === SEM_CATEGORIA ? await consulta.is("category", null) : await consulta.eq("category", grupo);
        if (resultado.error) throw resultado.error;
      }
      setSelecionadas([]); setCategoria(TODAS); setPagina(0); toast.success("Importações excluídas"); atualizarListas();
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
      const chaves = new Set(existentes.map(chaveDoProduto));
      const imagemPorEan = new Map(existentes.filter((item) => item.ean && item.image_url).map((item) => [item.ean as string, item.image_url as string]));
      let importados = 0; let repetidos = 0; let semNome = 0;
      const novos: Array<{ id: string; ean: string | null }> = [];

      for (const arquivo of Array.from(arquivos)) {
        const linhas = await lerPlanilha(arquivo);
        const categoriaArquivo = categoriaPeloNomeDoArquivo(arquivo.name);
        const paraInserir = [];
        for (const linha of linhas) {
          const produto = linhaParaProduto(linha, categoriaArquivo);
          if (!produto) { semNome++; continue; }
          const chave = chaveDoProduto(produto);
          if (chaves.has(chave)) { repetidos++; continue; }
          chaves.add(chave);
          paraInserir.push({ ...produto, user_id: sessao.user.id, image_url: produto.image_url || (produto.ean ? imagemPorEan.get(produto.ean) ?? null : null) });
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
      if (!importados) toast.warning(`Nenhum produto novo. ${repetidos} repetido(s) e ${semNome} linha(s) sem descrição.`);
      else toast.success(`${importados} produto(s) importado(s) em ${segundos}s. ${repetidos} repetido(s) ignorado(s). As imagens que faltam são buscadas em segundo plano.`);
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

  function novoProduto() {
    setEditando(null); setFormulario(FORMULARIO_VAZIO); setDialogoAberto(true);
  }

  return {
    campoArquivo, busca, setBusca, categoria, setCategoria, selecionadas, setSelecionadas,
    pagina, setPagina, editando, formulario, setFormulario, dialogoAberto, setDialogoAberto,
    importando, categorias: categorias.data ?? [], produtos: produtos.data?.linhas ?? [],
    total: produtos.data?.total ?? 0, paginas: Math.max(1, Math.ceil((produtos.data?.total ?? 0) / POR_PAGINA)),
    salvar, excluir, importar, editar, novoProduto, excluirSelecionadas,
  };
}
