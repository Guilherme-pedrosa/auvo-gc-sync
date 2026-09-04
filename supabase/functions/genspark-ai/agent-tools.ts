// Ferramentas do agente de chat do Kanban de Orçamentos.
// Dão à IA acesso de leitura aos módulos: Controle OS, Preventivas,
// Peças/Serviços do equipamento (GestãoClick), Equipamentos e Observações de OS.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { installGcUsuarioId, gcHeaders } from "../_shared/gc-user.ts";

installGcUsuarioId();

const GC_BASE = "https://api.gestaoclick.com";

function sb() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

function clamp<T>(rows: T[] | null | undefined, max: number): T[] {
  return (rows || []).slice(0, max);
}

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "buscar_controle_os",
      description:
        "Consulta o módulo Controle OS (tarefas do Auvo cruzadas com OS/orçamentos do GestãoClick). Use para histórico de atendimentos, situação de OS/orçamento, técnico, datas, valores.",
      parameters: {
        type: "object",
        properties: {
          cliente: { type: "string", description: "Nome (ou parte) do cliente" },
          equipamento: { type: "string", description: "Nome ou série/identificador do equipamento" },
          numero: { type: "string", description: "Número da OS ou do orçamento no GC" },
          auvo_task_id: { type: "string", description: "ID da tarefa Auvo" },
          data_de: { type: "string", description: "Data inicial YYYY-MM-DD" },
          data_ate: { type: "string", description: "Data final YYYY-MM-DD" },
          situacao: { type: "string", description: "Texto da situação da OS/orçamento no GC" },
          limite: { type: "number", description: "Máximo de registros (padrão 25)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "historico_pecas_equipamento",
      description:
        "Varredura completa no GestãoClick das peças e serviços já orçados/vendidos para um equipamento específico (usa vínculo oficial de Tarefa OS / Tarefa Execução). Retorna itens consolidados com código, quantidade, valores e documentos de origem.",
      parameters: {
        type: "object",
        properties: {
          identificador: { type: "string", description: "Série/patrimônio do equipamento" },
          auvo_equipment_id: { type: "string", description: "ID do equipamento no Auvo" },
          nome: { type: "string", description: "Nome do equipamento" },
          auvo_task_id: { type: "string", description: "ID da tarefa Auvo do caso atual" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_preventivas",
      description:
        "Consulta o módulo de Preventiva de Equipamentos: última preventiva, próxima prevista, periodicidade, criticidade, status e plano preventivo do equipamento/cliente.",
      parameters: {
        type: "object",
        properties: {
          cliente: { type: "string" },
          equipamento: { type: "string", description: "Nome do equipamento" },
          identificador: { type: "string", description: "Série/patrimônio" },
          status: { type: "string", description: "Filtro por status_preventiva (ex.: Atrasada, Em dia, Sem registro)" },
          limite: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_equipamentos",
      description: "Lista equipamentos cadastrados (Auvo) por cliente/nome/série, com marca, tipo e status.",
      parameters: {
        type: "object",
        properties: {
          cliente: { type: "string" },
          nome: { type: "string" },
          identificador: { type: "string" },
          limite: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "consultar_gc",
      description:
        "Consulta direta na API do GestãoClick (somente leitura). Use para buscar produtos/peças por nome ou código, detalhes de uma OS/orçamento específico, clientes.",
      parameters: {
        type: "object",
        properties: {
          recurso: {
            type: "string",
            description: "Um de: produtos, ordens_servico, orcamentos, clientes, servicos",
          },
          id: { type: "string", description: "ID do registro para detalhe" },
          busca: { type: "string", description: "Texto de busca (nome)" },
          codigo: { type: "string", description: "Código do registro" },
        },
        required: ["recurso"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "observacoes_os",
      description: "Lê observações internas registradas no módulo Controle OS para uma OS/tarefa.",
      parameters: {
        type: "object",
        properties: {
          gc_os_codigo: { type: "string" },
          auvo_task_id: { type: "string" },
          cliente: { type: "string" },
          limite: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "gc_mcp",
      description:
        "Consulta AO VIVO o servidor MCP oficial do GestãoClick (somente leitura). Use quando precisar descobrir recursos/campos da API do ERP ou consultar a Central de Ajuda do GestãoClick (regras de negócio, o que um filtro faz). Operações: listar_recursos, describe_recurso, buscar_conhecimento, ler_conhecimento, chamar_api (apenas ações de leitura: listar/visualizar).",
      parameters: {
        type: "object",
        properties: {
          operacao: {
            type: "string",
            enum: [
              "listar_recursos",
              "describe_recurso",
              "buscar_conhecimento",
              "ler_conhecimento",
              "chamar_api",
            ],
          },
          recurso: { type: "string", description: "Nome do recurso do ERP (describe_recurso / chamar_api)" },
          acao: { type: "string", description: "Somente 'listar' ou 'visualizar'" },
          id: { type: "string", description: "ID do registro para 'visualizar'" },
          dados: { type: "object", description: "Filtros de consulta para 'listar'" },
          pergunta: { type: "string", description: "Pergunta para buscar_conhecimento" },
          ref: { type: "string", description: "Referência do artigo para ler_conhecimento" },
        },
        required: ["operacao"],
      },
    },
  },
];


async function toolBuscarControleOs(a: any) {
  const limit = Math.min(Number(a?.limite) || 25, 50);
  let q = sb()
    .from("tarefas_central")
    .select(
      "auvo_task_id, cliente, tecnico, data_tarefa, status_auvo, orientacao, descricao, equipamento_nome, equipamento_id_serie, gc_os_codigo, gc_os_situacao, gc_os_valor_total, gc_os_data, gc_os_link, gc_orcamento_codigo, gc_orc_situacao, gc_orc_valor_total, gc_orc_data, gc_orc_link, gc_os_tarefa_os, gc_os_tarefa_exec",
    )
    .order("data_tarefa", { ascending: false })
    .limit(limit);

  if (a?.cliente) q = q.ilike("cliente", `%${a.cliente}%`);
  if (a?.equipamento) {
    q = q.or(
      `equipamento_nome.ilike.%${a.equipamento}%,equipamento_id_serie.ilike.%${a.equipamento}%`,
    );
  }
  if (a?.numero) q = q.or(`gc_os_codigo.eq.${a.numero},gc_orcamento_codigo.eq.${a.numero}`);
  if (a?.auvo_task_id) q = q.eq("auvo_task_id", String(a.auvo_task_id));
  if (a?.data_de) q = q.gte("data_tarefa", a.data_de);
  if (a?.data_ate) q = q.lte("data_tarefa", a.data_ate);
  if (a?.situacao) q = q.or(`gc_os_situacao.ilike.%${a.situacao}%,gc_orc_situacao.ilike.%${a.situacao}%`);

  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: data?.length || 0, registros: data };
}

async function toolHistoricoPecas(a: any) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/equipamento-pecas`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
    },
    body: JSON.stringify({
      identificador: a?.identificador || "",
      auvo_equipment_id: a?.auvo_equipment_id || "",
      nome: a?.nome || "",
      auvo_task_id: a?.auvo_task_id || "",
    }),
  });
  const json = await res.json().catch(() => null);
  if (!json?.ok) return { ok: false, error: json?.error || "Falha na varredura de peças" };
  return {
    ok: true,
    equipamento: json.equipamento,
    cobertura: json.cobertura,
    totais: json.totais,
    pecas_consolidadas: clamp(json.consolidado, 40),
    servicos_consolidados: clamp(json.consolidado_servicos, 20),
    documentos: clamp(json.documentos, 30),
  };
}

async function toolPreventivas(a: any) {
  const limit = Math.min(Number(a?.limite) || 25, 60);
  let q = sb()
    .from("equipamento_preventiva_consolidado")
    .select(
      "nome, identificador, cliente, categoria, marca, tipo_nome, criticidade, periodicidade, periodicidade_meses, ultima_preventiva, ultima_preventiva_tecnico, ultima_preventiva_link, proxima_preventiva, status_preventiva, total_tarefas, equip_status",
    )
    .limit(limit);
  if (a?.cliente) q = q.ilike("cliente", `%${a.cliente}%`);
  if (a?.equipamento) q = q.ilike("nome", `%${a.equipamento}%`);
  if (a?.identificador) q = q.ilike("identificador", `%${a.identificador}%`);
  if (a?.status) q = q.ilike("status_preventiva", `%${a.status}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: data?.length || 0, equipamentos: data };
}

async function toolEquipamentos(a: any) {
  const limit = Math.min(Number(a?.limite) || 25, 60);
  let q = sb()
    .from("equipamentos_auvo")
    .select("nome, descricao, identificador, cliente, categoria, marca, status, auvo_equipment_id")
    .limit(limit);
  if (a?.cliente) q = q.ilike("cliente", `%${a.cliente}%`);
  if (a?.nome) q = q.ilike("nome", `%${a.nome}%`);
  if (a?.identificador) q = q.ilike("identificador", `%${a.identificador}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: data?.length || 0, equipamentos: data };
}

const GC_RECURSOS: Record<string, string> = {
  produtos: "/produtos",
  ordens_servico: "/ordens_servicos",
  orcamentos: "/orcamentos",
  clientes: "/clientes",
  servicos: "/servicos",
};

async function toolConsultarGc(a: any) {
  const path = GC_RECURSOS[String(a?.recurso || "").toLowerCase()];
  if (!path) return { ok: false, error: "Recurso GC inválido" };
  const url = new URL(`${GC_BASE}${path}${a?.id ? `/${a.id}` : ""}`);
  if (a?.busca) url.searchParams.set("nome", String(a.busca));
  if (a?.codigo) url.searchParams.set("codigo", String(a.codigo));
  url.searchParams.set("limit", "20");
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url.toString(), { headers: gcHeaders(), signal: ctrl.signal });
    clearTimeout(tid);
    if (!res.ok) return { ok: false, error: `GC HTTP ${res.status}` };
    const json = await res.json().catch(() => null);
    const data = Array.isArray(json?.data) ? clamp(json.data, 20) : json?.data ?? json;
    return { ok: true, recurso: a.recurso, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function toolObservacoes(a: any) {
  const limit = Math.min(Number(a?.limite) || 20, 50);
  let q = sb().from("os_observacoes").select("*").order("created_at", { ascending: false }).limit(limit);
  if (a?.gc_os_codigo) q = q.eq("gc_os_codigo", String(a.gc_os_codigo));
  if (a?.auvo_task_id) q = q.eq("auvo_task_id", String(a.auvo_task_id));
  if (a?.cliente) q = q.ilike("cliente", `%${a.cliente}%`);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  return { ok: true, total: data?.length || 0, observacoes: data };
}

// ---- MCP oficial do GestãoClick (somente leitura) ----
const GC_MCP_URL = "https://api.gestaoclick.com/mcp";
const GC_MCP_READ_ACTIONS = new Set(["listar", "visualizar"]);

async function toolGcMcp(a: any) {
  const operacao = String(a?.operacao || "").trim();
  const access = Deno.env.get("GC_ACCESS_TOKEN");
  const secret = Deno.env.get("GC_SECRET_TOKEN");
  if (!access || !secret) return { ok: false, error: "Credenciais do GestãoClick ausentes" };

  let toolName = operacao;
  let toolArgs: Record<string, unknown> = {};

  switch (operacao) {
    case "listar_recursos":
      break;
    case "describe_recurso":
      if (!a?.recurso) return { ok: false, error: "Informe o recurso" };
      toolArgs = { recurso: String(a.recurso), ...(a?.acao ? { acao: String(a.acao) } : {}) };
      break;
    case "buscar_conhecimento":
      if (!a?.pergunta) return { ok: false, error: "Informe a pergunta" };
      toolArgs = { pergunta: String(a.pergunta), k: 5 };
      break;
    case "ler_conhecimento":
      if (!a?.ref) return { ok: false, error: "Informe o ref do artigo" };
      toolArgs = { ref: String(a.ref) };
      break;
    case "chamar_api": {
      const acao = String(a?.acao || "listar").toLowerCase();
      if (!GC_MCP_READ_ACTIONS.has(acao)) {
        return { ok: false, error: "Somente leitura: use 'listar' ou 'visualizar'" };
      }
      if (!a?.recurso) return { ok: false, error: "Informe o recurso" };
      toolArgs = {
        recurso: String(a.recurso),
        acao,
        ...(a?.id ? { id: String(a.id) } : {}),
        ...(a?.dados && typeof a.dados === "object" ? { dados: a.dados } : {}),
      };
      break;
    }
    default:
      return { ok: false, error: `Operação MCP inválida: ${operacao}` };
  }

  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(GC_MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "access-token": access,
        "secret-access-token": secret,
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: toolArgs },
      }),
    });
    clearTimeout(tid);
    const raw = await res.text();
    if (!res.ok) return { ok: false, error: `GC MCP HTTP ${res.status}`, detalhe: raw.substring(0, 300) };

    let json: any = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // resposta em SSE: extrai o último bloco data:
      const last = raw.split("\n").filter((l) => l.startsWith("data:")).pop();
      if (last) json = JSON.parse(last.slice(5).trim());
    }
    if (!json) return { ok: false, error: "Resposta MCP ilegível" };
    if (json.error) return { ok: false, error: json.error?.message || "Erro no MCP do GestãoClick" };

    const content = json.result?.content;
    const texto = Array.isArray(content)
      ? content.map((c: any) => c?.text ?? "").join("\n").substring(0, 12000)
      : JSON.stringify(json.result ?? {}).substring(0, 12000);
    return { ok: true, operacao, resultado: texto };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function runAgentTool(name: string, args: any): Promise<any> {

  console.log(`[genspark-ai] [tool] ${name} args=${JSON.stringify(args).substring(0, 300)}`);
  try {
    switch (name) {
      case "buscar_controle_os": return await toolBuscarControleOs(args);
      case "historico_pecas_equipamento": return await toolHistoricoPecas(args);
      case "consultar_preventivas": return await toolPreventivas(args);
      case "buscar_equipamentos": return await toolEquipamentos(args);
      case "consultar_gc": return await toolConsultarGc(args);
      case "observacoes_os": return await toolObservacoes(args);
      default: return { ok: false, error: `Ferramenta desconhecida: ${name}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
