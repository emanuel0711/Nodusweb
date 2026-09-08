import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerPlanilha, categoriaPeloNomeDoArquivo } from "@/lib/planilha";
import { lerPreco } from "@/lib/comparar-textos";
import { COLUNAS_PRODUTO, COLUNAS_PRODUTO_BASE, carregarTodosProdutos, chaveDoProduto, erroDeCustoAusente, limparCodigo, limparEan, linhaParaProduto, type Produto } from "@/lib/catalogo";

export const POR_PAGINA = 20;
export const TODAS = "__all__";
export const SEM_CATEGORIA = "__uncategorized__";
export const FORMULARIO_VAZIO = { description: "", internal_code: "", promotion_code: "", ean: "", unit: "", category: "", unit_price: "", cost: "", image_url: "" };
export type FormularioProduto = typeof FORMULARIO_VAZIO;
export interface ResumoImportacao {
  id: string;
  file_name: string;
  category: string;
  inserted_count: number;
  updated_count: number;
  ignored_count: number;
  error_count: number;
  created_at: string;
  undone_at: string | null;
}

async function carregarCategorias(): Promise<string[]> {
  const produtos = await carregarTodosProdutos();
  const nomes = new Set<string>();
  let semCategoria = false;
  produtos.forEach((produto) => produto.category ? nomes.add(produto.category) : semCategoria = true);
  const lista = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return semCategoria ? [SEM_CATEGORIA, ...lista] : lista;
}

interface AtualizacaoImportacao {
  id: string;
  cost?: number;
  stock_quantity?: number;
  stock_updated_at?: string;
}

async function atualizarProdutosImportados(atualizacoes: AtualizacaoImportacao[]) {
  for (let i = 0; i < atualizacoes.length; i += 50) {
    const lote = atualizacoes.slice(i, i + 50);
    const resultados = await Promise.all(
      lote.map(({ id, ...dados }) => supabase.from("products").update(dados).eq("id", id)),
    );
    const erro = resultados.find((resultado) => resultado.error)?.error;
    if (erro) throw erro;
  }
}

async function inserirLote(lote: Array<Record<string, unknown>>) {
  const resultado = await supabase.from("products").insert(lote as never).select("id, ean, description, image_url");
  if (resultado.error) throw resultado.error;
  return (resultado.data ?? []) as Array<{ id: string; ean: string | null; description: string; image_url: string | null }>;
}

export function useCatalogo() {
  const queryClient = useQueryClient();
  const campoArquivo = useRef<HTMLInputElement>(null);
  const [busca, setBuscaAtual] = useState("");
  const [categoria, setCategoriaAtual] = useState(TODAS);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [pagina, setPagina] = useState(0);
  const [editando, setEditando] = useState<Produto | null>(null);
  const [formulario, setFormulario] = useState<FormularioProduto>(FORMULARIO_VAZIO);
  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [importando, setImportando] = useState(false);
  const [ultimoResumo, setUltimoResumo] = useState<ResumoImportacao | null>(null);

  const historico = useQuery({
    queryKey: ["catalog-imports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("catalog_imports")
        .select("id,file_name,category,inserted_count,updated_count,ignored_count,error_count,created_at,undone_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data as ResumoImportacao[];
    },
  });

  function setBusca(valor: string) {
    setBuscaAtual(valor);
    setPagina(0);
  }

  function setCategoria(valor: string) {
    setCategoriaAtual(valor);
    setPagina(0);
  }

  const atualizarListas = () => {
    queryClient.invalidateQueries({ queryKey: ["products"] });
    queryClient.invalidateQueries({ queryKey: ["product-categories"] });
    queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    queryClient.invalidateQueries({ queryKey: ["imagens-pendentes"] });
  };

  const categorias = useQuery({ queryKey: ["product-categories"], queryFn: carregarCategorias });
  const produtos = useQuery({
    queryKey: ["products", busca, categoria, pagina],
    queryFn: async () => {
      const termo = busca.trim().replace(/[,%]/g, " ");
      const consultar = async (colunas: string) => {
        let consulta = supabase.from("products").select(colunas, { count: "exact" })
          .order("description").range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
        if (termo) consulta = consulta.or(`description.ilike.%${termo}%,ean.ilike.%${termo}%,internal_code.ilike.%${termo}%,promotion_code.ilike.%${termo}%`);
        if (categoria === SEM_CATEGORIA) consulta = consulta.is("category", null);
        else if (categoria !== TODAS) consulta = consulta.eq("category", categoria);
        return consulta;
      };
      let consulta = await consultar(COLUNAS_PRODUTO);
      if (consulta.error && erroDeCustoAusente(consulta.error)) consulta = await consultar(COLUNAS_PRODUTO_BASE);
      if (consulta.error) throw consulta.error;
      return { linhas: ((consulta.data ?? []) as unknown as Produto[]).map((produto) => ({ ...produto, cost: produto.cost ?? null })), total: consulta.count ?? 0 };
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
        cost: lerPreco(formulario.cost),
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
      const existentesPorChave = new Map(existentes.map((produto) => [chaveDoProduto(produto), produto]));
      const imagemPorEan = new Map(existentes.filter((item) => item.ean && item.image_url).map((item) => [item.ean as string, item.image_url as string]));
      let importados = 0; let repetidos = 0; let semNome = 0;
      const atualizacoes: AtualizacaoImportacao[] = [];

      for (const arquivo of Array.from(arquivos)) {
        const linhas = await lerPlanilha(arquivo);
        const categoriaArquivo = categoriaPeloNomeDoArquivo(arquivo.name);
        const atualizadoEm = new Date().toISOString();
        const paraInserir: Array<Record<string, unknown>> = [];
        const inicioAtualizacoes = atualizacoes.length;
        const importadosAntes = importados;
        const repetidosAntes = repetidos;
        const errosAntes = semNome;
        const snapshot = existentes.filter((produto) => produto.category === categoriaArquivo);
        const convertidos = linhas
          .map((linha) => linhaParaProduto(linha, categoriaArquivo, atualizadoEm))
          .filter((produto): produto is NonNullable<typeof produto> => Boolean(produto));
        const categoriasDeclaradas = new Set(convertidos.map((produto) => produto.category));
        if ([...categoriasDeclaradas].some((categoria) => categoria !== categoriaArquivo))
          throw new Error(`O conteúdo de ${arquivo.name} informa outra categoria. A carga foi bloqueada.`);
        if (snapshot.length >= 20 && convertidos.length >= 10) {
          const chavesAnteriores = new Set(snapshot.map(chaveDoProduto));
          const comuns = convertidos.filter((produto) => chavesAnteriores.has(chaveDoProduto(produto))).length;
          if (comuns / Math.min(snapshot.length, convertidos.length) < 0.05)
            throw new Error(`O arquivo ${arquivo.name} quase não corresponde à categoria ${categoriaArquivo}. A carga foi bloqueada para evitar uma substituição incorreta.`);
        }

        for (const linha of linhas) {
          const produto = linhaParaProduto(linha, categoriaArquivo, atualizadoEm);
          if (!produto) { semNome++; continue; }
          const chave = chaveDoProduto(produto);
          const existente = existentesPorChave.get(chave);

          if (existente) {
            repetidos++;
            const atualizacao: AtualizacaoImportacao = { id: existente.id };
            if (produto.cost != null && produto.cost !== existente.cost)
              atualizacao.cost = produto.cost;
            if (produto.stock_quantity != null) {
              atualizacao.stock_quantity = produto.stock_quantity;
              atualizacao.stock_updated_at = atualizadoEm;
            }
            if (Object.keys(atualizacao).length > 1) atualizacoes.push(atualizacao);
            continue;
          }

          existentesPorChave.set(chave, { ...produto, id: `novo-${chave}` } as Produto);
          paraInserir.push({
            ...produto,
            user_id: sessao.user.id,
            image_url: produto.image_url || (produto.ean ? imagemPorEan.get(produto.ean) ?? null : null),
          });
        }

        for (let i = 0; i < paraInserir.length; i += 500) {
          const data = await inserirLote(paraInserir.slice(i, i + 500));
          importados += data.length;
        }
        const atualizacoesArquivo = atualizacoes.slice(inicioAtualizacoes);
        await atualizarProdutosImportados(atualizacoesArquivo);
        const resumo = {
          user_id: sessao.user.id,
          file_name: arquivo.name,
          category: categoriaArquivo,
          inserted_count: importados - importadosAntes,
          updated_count: atualizacoesArquivo.length,
          ignored_count: repetidos - repetidosAntes - atualizacoesArquivo.length,
          error_count: semNome - errosAntes,
          snapshot,
        };
        const { data: carga, error: erroCarga } = await supabase
          .from("catalog_imports")
          .insert(resumo as never)
          .select("id,file_name,category,inserted_count,updated_count,ignored_count,error_count,created_at,undone_at")
          .single();
        if (erroCarga) throw erroCarga;
        setUltimoResumo(carga as ResumoImportacao);
      }

      const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
      if (!importados && !atualizacoes.length) toast.warning(`Nenhum produto novo. ${repetidos} repetido(s) e ${semNome} linha(s) sem descrição.`);
      else toast.success(`${importados} produto(s) importado(s) e ${atualizacoes.length} produto(s) atualizado(s) em ${segundos}s. Imagens ficam na fila do Catálogo.`);
      atualizarListas();
      queryClient.invalidateQueries({ queryKey: ["catalog-imports"] });
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Falha na importação");
    } finally {
      setImportando(false);
      if (campoArquivo.current) campoArquivo.current.value = "";
    }
  }

  async function desfazerImportacao(id: string) {
    const { error } = await supabase.rpc("undo_catalog_import", { p_import_id: id });
    if (error) throw error;
    toast.success("Carga desfeita e categoria restaurada.");
    atualizarListas();
    queryClient.invalidateQueries({ queryKey: ["catalog-imports"] });
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
      unit_price: produto.unit_price != null ? String(produto.unit_price) : "",
      cost: produto.cost != null ? String(produto.cost) : "",
      image_url: produto.image_url ?? "",
    });
    setDialogoAberto(true);
  }

  function novoProduto() { setEditando(null); setFormulario(FORMULARIO_VAZIO); setDialogoAberto(true); }

  return {
    campoArquivo, busca, setBusca, categoria, setCategoria, selecionadas, setSelecionadas,
    pagina, setPagina, editando, formulario, setFormulario, dialogoAberto, setDialogoAberto,
    importando, categorias: categorias.data ?? [], produtos: produtos.data?.linhas ?? [],
    total: produtos.data?.total ?? 0, paginas: Math.max(1, Math.ceil((produtos.data?.total ?? 0) / POR_PAGINA)),
    salvar, excluir, importar, editar, novoProduto, excluirSelecionadas,
    ultimoResumo, historico: historico.data ?? [], desfazerImportacao,
  };
}
