import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lerPlanilha, categoriaPeloNomeDoArquivo } from "@/lib/planilha";
import { lerPreco } from "@/lib/comparar-textos";
import { buscarImagens, buscarImagensPorProduto } from "@/lib/imagens";
import { COLUNAS_PRODUTO, COLUNAS_PRODUTO_BASE, carregarTodosProdutos, chaveDoProduto, erroDeCustoAusente, limparCodigo, limparEan, linhaParaProduto, type Produto } from "@/lib/catalogo";

export const POR_PAGINA = 20;
export const TODAS = "__all__";
export const SEM_CATEGORIA = "__uncategorized__";
export const FORMULARIO_VAZIO = { description: "", internal_code: "", promotion_code: "", ean: "", unit: "", category: "", unit_price: "", cost: "", image_url: "" };
export type FormularioProduto = typeof FORMULARIO_VAZIO;
type ImagemPendente = { id: string; ean: string | null; nome: string };

async function carregarCategorias(): Promise<string[]> {
  const produtos = await carregarTodosProdutos();
  const nomes = new Set<string>();
  let semCategoria = false;
  produtos.forEach((produto) => produto.category ? nomes.add(produto.category) : semCategoria = true);
  const lista = [...nomes].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return semCategoria ? [SEM_CATEGORIA, ...lista] : lista;
}

/** Preenche imagens por EAN e, para itens sem EAN (ex.: Kg), por nome. */
async function completarImagens(itens: ImagemPendente[]) {
  const pendentes = itens.filter((item) => item.nome.trim());
  if (!pendentes.length) return;

  const porEan = await buscarImagens(pendentes.map((item) => item.ean ?? ""));
  const semEan = pendentes.filter((item) => !item.ean);
  const porNome = semEan.length
    ? await buscarImagensPorProduto(semEan.map((item) => ({ ean: "", nome: item.nome })))
    : new Map<string, string>();

  await Promise.all(pendentes.map(async (item) => {
    const url = item.ean ? porEan.get(item.ean) : porNome.get(item.nome);
    if (url) await supabase.from("products").update({ image_url: url }).eq("id", item.id);
  }));
}

async function verificarColunaDeCusto() {
  const { error } = await supabase.from("products").select("id, cost").limit(1);
  if (error && erroDeCustoAusente(error)) {
    throw new Error("O banco do Nódus ainda não possui a coluna de custo. A migração de custo precisa ser aplicada no Supabase/Lovable antes de importar o catálogo.");
  }
  if (error) throw error;
}

async function atualizarCustos(atualizacoes: Array<{ id: string; cost: number }>) {
  for (let i = 0; i < atualizacoes.length; i += 50) {
    const lote = atualizacoes.slice(i, i + 50);
    const resultados = await Promise.all(lote.map(({ id, cost }) => supabase.from("products").update({ cost }).eq("id", id)));
    const erro = resultados.find((resultado) => resultado.error)?.error;
    if (erro) throw erro;
  }
}

async function inserirLote(lote: Array<Record<string, unknown>>) {
  const resultado = await supabase.from("products").insert(lote).select("id, ean, description, image_url");
  if (resultado.error) throw resultado.error;
  return (resultado.data ?? []) as Array<{ id: string; ean: string | null; description: string; image_url: string | null }>;
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
      await verificarColunaDeCusto();
      const { data: sessao } = await supabase.auth.getUser();
      if (!sessao.user) throw new Error("Sessão expirada. Entre novamente.");

      const existentes = await carregarTodosProdutos();
      const existentesPorChave = new Map(existentes.map((produto) => [chaveDoProduto(produto), produto]));
      const imagemPorEan = new Map(existentes.filter((item) => item.ean && item.image_url).map((item) => [item.ean as string, item.image_url as string]));
      let importados = 0; let repetidos = 0; let semNome = 0;
      const atualizacoesCusto: Array<{ id: string; cost: number }> = [];
      const imagensPendentes: ImagemPendente[] = [];

      for (const arquivo of Array.from(arquivos)) {
        const linhas = await lerPlanilha(arquivo);
        const categoriaArquivo = categoriaPeloNomeDoArquivo(arquivo.name);
        const paraInserir: Array<Record<string, unknown>> = [];

        for (const linha of linhas) {
          const produto = linhaParaProduto(linha, categoriaArquivo);
          if (!produto) { semNome++; continue; }
          const chave = chaveDoProduto(produto);
          const existente = existentesPorChave.get(chave);

          if (existente) {
            repetidos++;
            if (produto.cost != null && produto.cost !== existente.cost) atualizacoesCusto.push({ id: existente.id, cost: produto.cost });
            if (!existente.image_url) imagensPendentes.push({ id: existente.id, ean: existente.ean, nome: existente.description });
            continue;
          }

          existentesPorChave.set(chave, { ...produto, id: `novo-${chave}` } as Produto);
          paraInserir.push({ ...produto, user_id: sessao.user.id, image_url: produto.image_url || (produto.ean ? imagemPorEan.get(produto.ean) ?? null : null) });
        }

        for (let i = 0; i < paraInserir.length; i += 500) {
          const data = await inserirLote(paraInserir.slice(i, i + 500));
          data.forEach((item) => {
            if (!item.image_url) imagensPendentes.push({ id: item.id, ean: item.ean, nome: item.description });
          });
          importados += data.length;
        }
      }

      await atualizarCustos(atualizacoesCusto);
      const segundos = ((performance.now() - inicio) / 1000).toFixed(1);
      if (!importados && !atualizacoesCusto.length) toast.warning(`Nenhum produto novo. ${repetidos} repetido(s) e ${semNome} linha(s) sem descrição.`);
      else toast.success(`${importados} produto(s) importado(s), ${atualizacoesCusto.length} custo(s) atualizado(s) em ${segundos}s.`);

      atualizarListas();
      void completarImagens(imagensPendentes).then(atualizarListas).catch((erro) => console.error("Falha ao completar imagens", erro));
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
  };
}
