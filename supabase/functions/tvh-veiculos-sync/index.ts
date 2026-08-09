import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TVH_FALLBACK_URL = "https://qfmpyrekjbbqekxrjgov.supabase.co";
// Chave pública (anon) do Technician & Vehicle Hub — leitura apenas, segura em código.
const TVH_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmbXB5cmVramJicWVreHJqZ292Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4Njc5NzMsImV4cCI6MjA4OTQ0Mzk3M30.ac7r6m5dLzMrEQxMQr74Bo38bgeupr5-bs0Ja4CCo2s";
// Só interessam não conformidades de manutenção do último checklist.
// Alertas de "veículo rodou X km sem checklist" são ruído e ficam de fora.
const OPEN_STATUSES = ["aberto", "em_andamento", "aguardando_peca"];
// Ruído: qualquer alerta de quilometragem/checklist não preenchido ou veículo bloqueado por falta de checklist.
const IGNORAR_TITULO =
  /rodou|sem\s+checklist|checklist\s*(n[ãa]o|vencid|atrasad|pendent|em\s+atraso|obrigat)|bloquead|\d+([.,]\d+)?\s*km/i;
// Só interessam problemas reais de manutenção apontados no checklist.
const PROBLEMA_KEYWORDS =
  /(n[ãa]o[\s_-]?conform|avaria|dano|quebrad|trincad|rachad|vazamento|[óo]leo|freio|pneu|careca|suspens[ãa]o|farol|lanterna|luz|bateria|motor|embreagem|escapamento|amortecedor|correia|filtro|radiador|arrefec|limpador|palheta|retrovisor|para-?brisa|estepe|extintor|revis[ãa]o|troca|manuten|desgaste|folga|barulho|ru[íi]do|fum[aç]|superaquec|painel|alinhamento|balanceamento)/i;

const STATUS_LABEL: Record<string, string> = {
  disponivel: "Disponível",
  em_uso: "Em uso",
  manutencao: "Em manutenção",
};

type Vehicle = {
  id: string;
  placa: string;
  modelo: string | null;
  marca: string | null;
  status: string | null;
  km_atual: number | null;
};

type Ticket = {
  vehicle_id: string;
  titulo: string;
  prioridade: string;
  status: string;
  descricao?: string | null;
  created_at?: string | null;
};

// Itens que são ruído de auditoria de foto/IA — não são dano no veículo.
const ITEM_RUIDO =
  /(foto|imagem|selfie|reprovad[ao] pela ia|tire uma nova|refa[çc]a a foto|qualidade da (foto|imagem)|enquadr|ilegív|nítid)/i;

// Extrai os itens não conformes descritos no checklist
function detalharNaoConformidade(t: Ticket): string | null {
  const desc = String(t.descricao || "");
  const linhas = desc.split("\n").map((l) => l.trim()).filter(Boolean);

  const itens: string[] = [];
  let coletando = false;
  for (const l of linhas) {
    if (/itens? com problema/i.test(l)) { coletando = true; continue; }
    const ehBullet = /^[•\-*]\s+/.test(l);
    if (coletando && /^(observa|resultado|t[ée]cnico|ve[íi]culo|data)\b/i.test(l)) { coletando = false; continue; }
    if (coletando || ehBullet) {
      const item = l
        .replace(/^[•\-*]\s*/, "")
        .replace(/:\s*nao_conforme/i, " (NÃO CONFORME)")
        .replace(/:\s*nao\b/i, " (NÃO CONFORME)")
        .replace(/\s+—\s+"/, ' — "')
        .trim();
      // Ignora reprovação de foto pela IA — só interessa avaria/manutenção
      if (item && !ITEM_RUIDO.test(item)) itens.push(item);
    }
  }

  // Sem item de dano real → nada a exibir
  if (!itens.length) return null;

  const resultado = linhas.find((l) => /^resultado:/i.test(l))?.replace(/^resultado:\s*/i, "") || "";
  const obs = linhas.find((l) => /^observa/i.test(l))?.replace(/^observa[çc][õo]es:\s*/i, "") || "";
  const data = linhas.find((l) => /^data:/i.test(l))?.replace(/^data:\s*/i, "") || "";

  const partes: string[] = [];
  if (data) partes.push(`Checklist ${data}`);
  if (resultado) partes.push(`Resultado: ${resultado}`);
  partes.push(itens.map((i) => `• ${i}`).join("\n"));
  if (obs && !ITEM_RUIDO.test(obs)) partes.push(`Obs.: ${obs}`);
  partes.push(`Situação: ${String(t.status).replace(/_/g, " ")} · prioridade ${String(t.prioridade).toUpperCase()}`);
  return partes.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "Não autenticado" });

    const localAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await localAuth.auth.getUser();
    if (userError || !userData.user) return json({ ok: false, error: "Não autenticado" });

    const tvhUrl = (Deno.env.get("TVH_SUPABASE_URL") || TVH_FALLBACK_URL).replace(/\/$/, "");
    const tvhKey = TVH_ANON_KEY;

    async function hub(path: string) {
      const res = await fetch(`${tvhUrl}/rest/v1/${path}`, {
        headers: { apikey: tvhKey, Authorization: `Bearer ${tvhKey}` },
      });
      const text = await res.text();
      if (!res.ok) {
        throw new Error(
          res.status === 401
            ? "O Technician & Vehicle Hub recusou a leitura pública (401). Verifique as políticas de leitura das tabelas vehicles e maintenance_tickets."
            : `Hub respondeu ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      return JSON.parse(text || "[]");
    }

    const vehicles = (await hub(
      "vehicles?select=id,placa,modelo,marca,status,km_atual&order=placa.asc",
    )) as Vehicle[];

    const tickets = (await hub(
      `maintenance_tickets?select=vehicle_id,titulo,prioridade,status,descricao,created_at,tipo&tipo=eq.nao_conformidade&status=in.(${OPEN_STATUSES.join(",")})&order=created_at.desc`,
    )) as Ticket[];

    // Não conformidade mais recente de cada veículo que contenha dano/manutenção real
    const porVeiculo = new Map<string, string>();
    for (const t of tickets) {
      const titulo = String(t.titulo || "");
      const desc = String(t.descricao || "");
      // Descarta alertas de "rodou X km sem checklist" / veículo bloqueado por checklist
      if (IGNORAR_TITULO.test(titulo)) continue;
      // Exige menção a problema/avaria/manutenção no título ou na descrição
      if (!PROBLEMA_KEYWORDS.test(titulo) && !PROBLEMA_KEYWORDS.test(desc)) continue;
      if (porVeiculo.has(t.vehicle_id)) continue;
      const detalhe = detalharNaoConformidade(t);
      if (detalhe) porVeiculo.set(t.vehicle_id, detalhe);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: existentes } = await admin
      .from("agenda_veiculos")
      .select("id,placa,tvh_vehicle_id,ordem");

    const porPlaca = new Map<string, { id: string; ordem: number | null }>();
    for (const v of existentes ?? []) {
      if (v.placa) porPlaca.set(String(v.placa).toUpperCase().replace(/[^A-Z0-9]/g, ""), v as never);
    }
    const porTvh = new Map<string, { id: string; ordem: number | null }>();
    for (const v of existentes ?? []) {
      if (v.tvh_vehicle_id) porTvh.set(String(v.tvh_vehicle_id), v as never);
    }

    let ordem = (existentes ?? []).reduce((m, v: any) => Math.max(m, Number(v.ordem) || 0), 0);
    let criados = 0;
    let atualizados = 0;
    let comAlerta = 0;

    for (const v of vehicles) {
      const nc = porVeiculo.get(v.id);
      const observacao = nc ? detalharNaoConformidade(nc) : null;
      if (observacao) comAlerta++;

      const placaNorm = String(v.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const alvo = porTvh.get(v.id) ?? porPlaca.get(placaNorm);

      const payload = {
        nome: [v.marca, v.modelo].filter(Boolean).join(" ").toUpperCase() || String(v.placa || "").toUpperCase(),
        placa: String(v.placa || "").toUpperCase() || null,
        modelo: v.modelo,
        marca: v.marca,
        status: STATUS_LABEL[String(v.status)] ?? v.status,
        observacao,
        tvh_vehicle_id: v.id,
        ativo: true,
        sincronizado_em: new Date().toISOString(),
      };

      if (alvo) {
        const { error } = await admin.from("agenda_veiculos").update(payload).eq("id", alvo.id);
        if (error) throw error;
        atualizados++;
      } else {
        ordem++;
        const { error } = await admin.from("agenda_veiculos").insert({ ...payload, ordem } as never);
        if (error) throw error;
        criados++;
      }
    }

    return json({ ok: true, total: vehicles.length, criados, atualizados, com_alerta: comAlerta });
  } catch (err) {
    console.error("[tvh-veiculos-sync]", err);
    return json({ ok: false, error: (err as Error).message });
  }
});
