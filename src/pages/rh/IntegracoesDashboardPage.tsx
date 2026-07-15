import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  LayoutDashboard, Plus, Settings, ShieldCheck, ShieldX, Clock,
  AlertTriangle, TrendingUp, Users, Building2, FileWarning, CalendarClock,
  FileSpreadsheet,
} from "lucide-react";
import * as XLSX from "xlsx";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  useIntegrations, useRhClientes, useColaboradores, useCompanyDocs,
  useDocumentTypes, computeDocStatus,
} from "@/hooks/rh/useRh";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Row = {
  tipo: string;
  titular: string;
  escopo: "Empresa" | "Colaborador" | "Integração";
  venc: string;
  status: "expiring" | "expired";
  dias: number;
};

function daysUntil(dateStr: string): number {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const venc = new Date(dateStr);
  return Math.floor((venc.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  docs_enviados: "Docs Enviados",
  docs_aceitos: "Docs Aceitos",
  agendada: "Agendada",
  realizada: "Realizada",
  bloqueada: "Bloqueada",
  expirada: "Expirada",
};

export default function IntegracoesDashboardPage() {
  const navigate = useNavigate();
  const { data: integrations = [] } = useIntegrations();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const { data: companyDocs = [] } = useCompanyDocs();
  const { data: types = [] } = useDocumentTypes();
  const { data: allColabDocs = [] } = useQuery({
    queryKey: ["rh_colaborador_docs_all"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_colaborador_docs")
        .select("id, colaborador_id, document_type_id, data_vencimento");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; colaborador_id: string; document_type_id: string; data_vencimento: string | null }>;
    },
  });
  const { data: allRequirements = [] } = useQuery({
    queryKey: ["rh_client_requirements_all"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("rh_client_requirements")
        .select("id, client_id, document_type_id, required_for, is_required");
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; client_id: string; document_type_id: string; required_for: "COMPANY" | "TECHNICIAN"; is_required: boolean }>;
    },
  });

  const typeMap = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);
  const clienteMap = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);

  const kpis = useMemo(() => {
    const byStatus: Record<string, number> = {
      draft: 0, docs_enviados: 0, docs_aceitos: 0, agendada: 0,
      realizada: 0, bloqueada: 0, expirada: 0,
    };
    for (const i of integrations) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    return byStatus;
  }, [integrations]);

  // Vencimento aggregates
  const vencAgg = useMemo(() => {
    const inDays = (d: string | null) => (d ? daysUntil(d) : null);
    let e7 = 0, e15 = 0, e30 = 0, expired = 0;
    const consider = (venc: string | null) => {
      const d = inDays(venc);
      if (d === null) return;
      if (d < 0) expired++;
      else if (d <= 7) e7++;
      else if (d <= 15) e15++;
      else if (d <= 30) e30++;
    };
    companyDocs.forEach((d) => consider(d.data_vencimento));
    allColabDocs.forEach((d) => consider(d.data_vencimento));
    integrations.forEach((i) => consider(i.integration_valid_until || i.earliest_expiry_date));
    return { e7, e15, e30, expired };
  }, [companyDocs, allColabDocs, integrations]);

  // Pendências críticas: para cada integração ativa (não realizada/expirada), quais docs required estão missing/expired
  const pendingByRequirement = useMemo(() => {
    const acc: Record<string, { count: number; clients: Set<string>; tecnicos: Set<string> }> = {};

    // Índices auxiliares
    const companyDocByType = new Map<string, typeof companyDocs[number]>();
    for (const d of companyDocs) {
      const cur = companyDocByType.get(d.document_type_id);
      // pegar o mais recente por vencimento
      if (!cur || (d.data_vencimento && (!cur.data_vencimento || d.data_vencimento > cur.data_vencimento))) {
        companyDocByType.set(d.document_type_id, d);
      }
    }
    const colabDocsByColab = new Map<string, Map<string, typeof allColabDocs[number]>>();
    for (const d of allColabDocs) {
      let m = colabDocsByColab.get(d.colaborador_id);
      if (!m) { m = new Map(); colabDocsByColab.set(d.colaborador_id, m); }
      const cur = m.get(d.document_type_id);
      if (!cur || (d.data_vencimento && (!cur.data_vencimento || d.data_vencimento > cur.data_vencimento))) {
        m.set(d.document_type_id, d);
      }
    }
    const reqByClient = new Map<string, typeof allRequirements>();
    for (const r of allRequirements) {
      if (!r.is_required) continue;
      const arr = reqByClient.get(r.client_id) ?? [];
      arr.push(r);
      reqByClient.set(r.client_id, arr);
    }

    const addPend = (typeId: string, clientName: string, tecName?: string) => {
      const tName = typeMap.get(typeId)?.name ?? "Documento";
      const bucket = acc[tName] ?? { count: 0, clients: new Set(), tecnicos: new Set() };
      bucket.count++;
      bucket.clients.add(clientName);
      if (tecName) bucket.tecnicos.add(tecName);
      acc[tName] = bucket;
    };

    for (const i of integrations) {
      if (i.status === "realizada") continue;
      const cli = clienteMap.get(i.client_id);
      const cliName = cli?.nome_fantasia || cli?.nome || "Cliente";
      const reqs = reqByClient.get(i.client_id) ?? [];

      for (const r of reqs) {
        if (r.required_for === "COMPANY") {
          const doc = companyDocByType.get(r.document_type_id);
          const st = computeDocStatus(doc);
          if (st === "missing" || st === "expired") addPend(r.document_type_id, cliName);
        } else {
          for (const tid of i.technician_ids ?? []) {
            const tec = colabMap.get(tid);
            const tecName = tec?.nome_fantasia || tec?.nome || "Técnico";
            const doc = colabDocsByColab.get(tid)?.get(r.document_type_id);
            const st = computeDocStatus(doc);
            if (st === "missing" || st === "expired") addPend(r.document_type_id, cliName, tecName);
          }
        }
      }
    }
    return Object.entries(acc)
      .map(([name, v]) => ({ name, count: v.count, clients: Array.from(v.clients), tecnicos: Array.from(v.tecnicos) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [integrations, allRequirements, companyDocs, allColabDocs, clienteMap, colabMap, typeMap]);

  // Técnicos com mais pendências (docs vencidos + faltando os do pacote padrão)
  const topTecnicosPendentes = useMemo(() => {
    const acc: Record<string, number> = {};
    // Docs do próprio técnico expirando ou expirados
    for (const d of allColabDocs) {
      const st = computeDocStatus(d);
      if (st === "expired" || st === "expiring") {
        const c = colabMap.get(d.colaborador_id);
        const name = c?.nome_fantasia || c?.nome || "Colaborador";
        acc[name] = (acc[name] ?? 0) + 1;
      }
    }
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [allColabDocs, colabMap]);

  // Documentos faltantes do PACOTE PADRÃO por profissão (PJ=MEI, PF=CLT)
  const faltantesPacote = useMemo(() => {
    const meiTypes = types.filter((t) => t.scope === "TECHNICIAN" && t.ativo && (t.pacote_padrao ?? []).includes("MEI"));
    const cltTypes = types.filter((t) => t.scope === "TECHNICIAN" && t.ativo && (t.pacote_padrao ?? []).includes("CLT"));

    const docsByColab = new Map<string, Set<string>>();
    for (const d of allColabDocs) {
      let s = docsByColab.get(d.colaborador_id);
      if (!s) { s = new Set(); docsByColab.set(d.colaborador_id, s); }
      s.add(d.document_type_id);
    }

    const rows = colabs
      .filter((c) => c.ativo)
      .map((c) => {
        const pack = c.tipo_pessoa === "PJ" ? "MEI" : "CLT";
        const required = pack === "MEI" ? meiTypes : cltTypes;
        const has = docsByColab.get(c.id) ?? new Set<string>();
        const missing = required.filter((t) => !has.has(t.id));
        return {
          id: c.id,
          nome: c.nome_fantasia || c.nome,
          pack,
          missingNames: missing.map((t) => t.name),
          missingCount: missing.length,
          totalRequired: required.length,
        };
      })
      .filter((r) => r.missingCount > 0)
      .sort((a, b) => b.missingCount - a.missingCount);

    return rows;
  }, [colabs, types, allColabDocs]);

  const vencendo = useMemo(() => {
    const rows: Row[] = [];

    for (const d of companyDocs) {
      const st = computeDocStatus(d);
      if ((st === "expiring" || st === "expired") && d.data_vencimento) {
        rows.push({
          tipo: typeMap.get(d.document_type_id)?.name ?? "—",
          titular: "Empresa",
          escopo: "Empresa",
          venc: d.data_vencimento,
          status: st,
          dias: daysUntil(d.data_vencimento),
        });
      }
    }

    for (const d of allColabDocs) {
      const st = computeDocStatus(d);
      if ((st === "expiring" || st === "expired") && d.data_vencimento) {
        const colab = colabMap.get(d.colaborador_id);
        rows.push({
          tipo: typeMap.get(d.document_type_id)?.name ?? "—",
          titular: colab?.nome_fantasia || colab?.nome || "Colaborador",
          escopo: "Colaborador",
          venc: d.data_vencimento,
          status: st,
          dias: daysUntil(d.data_vencimento),
        });
      }
    }

    for (const i of integrations) {
      const venc = i.integration_valid_until || i.earliest_expiry_date;
      if (!venc) continue;
      const st = computeDocStatus({ data_vencimento: venc });
      if (st !== "expiring" && st !== "expired") continue;
      const cli = clienteMap.get(i.client_id);
      rows.push({
        tipo: "Integração",
        titular: cli?.nome_fantasia || cli?.nome || "Cliente",
        escopo: "Integração",
        venc,
        status: st,
        dias: daysUntil(venc),
      });
    }

    return rows.sort((a, b) => a.dias - b.dias);
  }, [companyDocs, allColabDocs, integrations, typeMap, colabMap, clienteMap]);

  const totais = useMemo(() => ({
    vencidos: vencendo.filter((r) => r.status === "expired").length,
    vencendo: vencendo.filter((r) => r.status === "expiring").length,
  }), [vencendo]);

  // Integrações recentes
  const recentIntegrations = useMemo(() => {
    return integrations.slice(0, 10).map((i) => {
      const cli = clienteMap.get(i.client_id);
      return {
        ...i,
        clientName: cli?.nome_fantasia || cli?.nome || "Cliente",
      };
    });
  }, [integrations, clienteMap]);

  const exportarExcel = () => {
    const rows = integrations.map((i) => {
      const cli = clienteMap.get(i.client_id);
      return {
        "Cliente": cli?.nome_fantasia || cli?.nome || "",
        "Status": STATUS_LABEL[i.status] ?? i.status,
        "Canal": i.send_channel ?? "-",
        "Enviado em": i.docs_sent_at ? format(new Date(i.docs_sent_at), "dd/MM/yyyy") : "-",
        "Aceito em": i.docs_accepted_at ? format(new Date(i.docs_accepted_at), "dd/MM/yyyy") : "-",
        "Agendada": i.scheduled_at ? format(new Date(i.scheduled_at), "dd/MM/yyyy") : "-",
        "Realizada": i.completed_at ? format(new Date(i.completed_at), "dd/MM/yyyy") : "-",
        "Válida até": i.integration_valid_until ? format(new Date(i.integration_valid_until), "dd/MM/yyyy") : "-",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Integrações");
    XLSX.writeFile(wb, `Dashboard_Integracoes_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard de Integrações</h1>
          <p className="text-sm text-muted-foreground">Visão consolidada de kits de documentação, pendências e vencimentos.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => navigate("/rh/clientes")}>
            <Settings className="mr-2 h-4 w-4" /> Requisitos por cliente
          </Button>
          <Button variant="outline" onClick={() => navigate("/rh/integracoes")}>
            <LayoutDashboard className="mr-2 h-4 w-4" /> Ver matriz
          </Button>
          <Button onClick={() => navigate("/rh/integracoes/nova")}>
            <Plus className="mr-2 h-4 w-4" /> Nova integração
          </Button>
        </div>
      </div>

      {/* KPIs por status */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Card className="p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><LayoutDashboard className="h-3.5 w-3.5" />Rascunho</div><div className="text-2xl font-semibold mt-1">{kpis.draft ?? 0}</div></Card>
        <Card className="p-4 border-blue-200 bg-blue-50/60 dark:bg-blue-950/20"><div className="flex items-center gap-2 text-xs text-blue-700 dark:text-blue-400"><TrendingUp className="h-3.5 w-3.5" />Docs Enviados</div><div className="text-2xl font-semibold text-blue-700 dark:text-blue-400 mt-1">{kpis.docs_enviados ?? 0}</div></Card>
        <Card className="p-4 border-indigo-200 bg-indigo-50/60 dark:bg-indigo-950/20"><div className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-400"><ShieldCheck className="h-3.5 w-3.5" />Docs Aceitos</div><div className="text-2xl font-semibold text-indigo-700 dark:text-indigo-400 mt-1">{kpis.docs_aceitos ?? 0}</div></Card>
        <Card className="p-4 border-amber-200 bg-amber-50/60 dark:bg-amber-950/20"><div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-500"><CalendarClock className="h-3.5 w-3.5" />Agendadas</div><div className="text-2xl font-semibold text-amber-700 dark:text-amber-500 mt-1">{kpis.agendada ?? 0}</div></Card>
        <Card className="p-4 border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/20"><div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400"><ShieldCheck className="h-3.5 w-3.5" />Realizadas</div><div className="text-2xl font-semibold text-emerald-700 dark:text-emerald-400 mt-1">{kpis.realizada ?? 0}</div></Card>
        <Card className="p-4 border-red-200 bg-red-50/60 dark:bg-red-950/20"><div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400"><ShieldX className="h-3.5 w-3.5" />Bloqueadas</div><div className="text-2xl font-semibold text-red-700 dark:text-red-400 mt-1">{kpis.bloqueada ?? 0}</div></Card>
        <Card className="p-4 border-orange-200 bg-orange-50/60 dark:bg-orange-950/20"><div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400"><AlertTriangle className="h-3.5 w-3.5" />Expiradas</div><div className="text-2xl font-semibold text-orange-700 dark:text-orange-400 mt-1">{kpis.expirada ?? 0}</div></Card>
      </div>

      {/* Faixa de vencimentos */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertTriangle className="h-3.5 w-3.5" />Vencidos</div>
          <div className="text-2xl font-semibold text-destructive mt-1">{vencAgg.expired}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">empresa + colaboradores + integrações</div>
        </Card>
        <Card className="p-4 border-red-300/40 bg-red-50/40 dark:bg-red-950/10">
          <div className="flex items-center gap-2 text-xs text-red-700 dark:text-red-400"><Clock className="h-3.5 w-3.5" />Vencendo em 7 dias</div>
          <div className="text-2xl font-semibold text-red-700 dark:text-red-400 mt-1">{vencAgg.e7}</div>
        </Card>
        <Card className="p-4 border-orange-300/40 bg-orange-50/40 dark:bg-orange-950/10">
          <div className="flex items-center gap-2 text-xs text-orange-700 dark:text-orange-400"><Clock className="h-3.5 w-3.5" />Vencendo em 15 dias</div>
          <div className="text-2xl font-semibold text-orange-700 dark:text-orange-400 mt-1">{vencAgg.e15}</div>
        </Card>
        <Card className="p-4 border-yellow-300/40 bg-yellow-50/40 dark:bg-yellow-950/10">
          <div className="flex items-center gap-2 text-xs text-yellow-700 dark:text-yellow-500"><Clock className="h-3.5 w-3.5" />Vencendo em 30 dias</div>
          <div className="text-2xl font-semibold text-yellow-700 dark:text-yellow-500 mt-1">{vencAgg.e30}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Total próximos 30d</div>
          <div className="text-2xl font-semibold mt-1">{totais.vencendo}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">todas as fontes</div>
        </Card>
      </div>

      {/* 2 colunas: pendências + técnicos */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-destructive" /> Pendências críticas por documento
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pendingByRequirement.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma pendência identificada.</p>
            ) : (
              <div className="space-y-2">
                {pendingByRequirement.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-3 p-2 rounded bg-muted/40">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.clients.slice(0, 3).join(", ")}
                        {p.clients.length > 3 ? ` +${p.clients.length - 3}` : ""}
                        {p.tecnicos.length > 0 && ` · ${p.tecnicos.length} téc.`}
                      </p>
                    </div>
                    <Badge variant="destructive">{p.count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" /> Técnicos com mais pendências
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topTecnicosPendentes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma pendência de técnico.</p>
            ) : (
              <div className="space-y-2">
                {topTecnicosPendentes.map(([name, count]) => (
                  <div key={name} className="flex items-center justify-between gap-3 p-2 rounded bg-muted/40">
                    <span className="text-sm truncate">{name}</span>
                    <Badge variant="outline">{count} doc(s)</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vencimentos + Recentes */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-yellow-600" /> Vencimentos próximos / vencidos
            </CardTitle>
            <Button size="sm" variant="outline" onClick={exportarExcel}>
              <FileSpreadsheet className="mr-2 h-3.5 w-3.5" /> Exportar
            </Button>
          </CardHeader>
          <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead>Titular</TableHead>
                <TableHead>Escopo</TableHead>
                  <TableHead>Venc.</TableHead>
                <TableHead className="text-right">Dias</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vencendo.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Sem pendências.</TableCell></TableRow>
                ) : vencendo.slice(0, 20).map((v, i) => (
                <TableRow key={i}>
                    <TableCell className="max-w-[220px] truncate">{v.tipo}</TableCell>
                  <TableCell>{v.titular}</TableCell>
                  <TableCell><Badge variant="outline">{v.escopo}</Badge></TableCell>
                  <TableCell>{new Date(v.venc).toLocaleDateString("pt-BR")}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {v.dias < 0 ? `${Math.abs(v.dias)}d atrás` : `${v.dias}d`}
                  </TableCell>
                  <TableCell>
                    <Badge variant={v.status === "expired" ? "destructive" : "secondary"}>
                      {v.status === "expired" ? "Vencido" : "Vencendo"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Integrações recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentIntegrations.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nenhuma integração cadastrada.</p>
            ) : (
              <div className="space-y-2">
                {recentIntegrations.map((i) => {
                  const isOk = i.status === "realizada" || i.status === "docs_aceitos";
                  const isPend = i.status === "bloqueada" || i.status === "expirada";
                  return (
                    <button
                      key={i.id}
                      onClick={() => navigate(`/rh/integracoes/${i.id}`)}
                      className="w-full text-left flex items-center justify-between gap-3 p-2 rounded bg-muted/40 hover:bg-muted transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{i.clientName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatDistanceToNow(new Date(i.criado_em), { addSuffix: true, locale: ptBR })}
                          {i.integration_valid_until && ` · válida até ${format(new Date(i.integration_valid_until), "dd/MM/yyyy")}`}
                        </p>
                      </div>
                      <Badge
                        variant={isOk ? "default" : isPend ? "destructive" : "secondary"}
                        className={isOk ? "bg-emerald-600 hover:bg-emerald-600" : ""}
                      >
                        {STATUS_LABEL[i.status] ?? i.status}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="text-xs text-muted-foreground">
        {integrations.length} integração(ões) · {clientes.length} cliente(s) · {colabs.length} colaborador(es)
      </div>
    </div>
  );
}