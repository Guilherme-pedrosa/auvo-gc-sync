import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { startOfMonth, endOfMonth, format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";
import HorasTrabalhadasTab from "@/components/relatorios/HorasTrabalhadasTab";

const normalizeClient = (s: string) =>
  (s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+(ltda|me|sa|s\.a\.|s\/a|eireli|epp)\s*\.?$/i, "")
    .replace(/\s+/g, " ");

export default function PortalHorasPage() {
  const { user, profile, role, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading) return;
    if (!user || role !== "cliente") navigate("/portal/login", { replace: true });
  }, [user, role, authLoading, navigate]);

  const today = new Date();
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(today));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(today));

  // Group + members for this user
  const { data: grupoInfo } = useQuery({
    queryKey: ["portal-grupo", profile?.grupo_id],
    enabled: !!profile?.grupo_id,
    queryFn: async () => {
      const [{ data: grupo }, { data: membros }] = await Promise.all([
        supabase.from("grupos_clientes").select("nome").eq("id", profile!.grupo_id!).maybeSingle(),
        supabase.from("grupo_cliente_membros").select("cliente_nome").eq("grupo_id", profile!.grupo_id!),
      ]);
      const memberList = (membros || []).map((m) => m.cliente_nome as string);
      return {
        id: profile!.grupo_id!,
        nome: grupo?.nome || "Grupo",
        clientes: memberList,
        clientesNorm: new Set(memberList.map((n) => normalizeClient(n))),
      };
    },
  });

  const { data: valorHoraConfigs } = useQuery({
    queryKey: ["portal-valor-hora"],
    queryFn: async () => {
      const { data } = await supabase.from("valor_hora_config").select("*");
      return data || [];
    },
  });

  const { data: tasksRaw, isLoading } = useQuery({
    queryKey: ["portal-horas", format(dateFrom, "yyyy-MM-dd"), format(dateTo, "yyyy-MM-dd")],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("horas-trabalhadas-fetch", {
        body: { startDate: format(dateFrom, "yyyy-MM-dd"), endDate: format(dateTo, "yyyy-MM-dd") },
      });
      if (error) throw error;
      if (data?.ok === false) throw new Error(data.error || "Erro");
      return (data?.tasks || []) as any[];
    },
    staleTime: 60_000,
  });

  // Internal review statuses are loaded only so the component can calculate totals;
  // the portal hides the internal review UI through clientMode.
  const { data: revisaoMap } = useQuery({
    queryKey: ["portal-revisao"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("os_revisao")
        .select("auvo_task_id, status_revisao");
      const map = new Map<string, string>();
      for (const r of data || []) map.set(String(r.auvo_task_id), String(r.status_revisao));
      return map;
    },
    staleTime: 60_000,
  });

  // Filter tasks: only this group's clients. Do not remove "em revisão" here:
  // it must remain in the same total the internal report shows.
  const visibleTasks = useMemo(() => {
    if (!tasksRaw || !grupoInfo) return [];
    const set = grupoInfo.clientesNorm;
    return tasksRaw.filter((t) => {
      const cli = normalizeClient(t.cliente || t.gc_os_cliente || "");
      if (!set.has(cli)) return false;
      return true;
    });
  }, [tasksRaw, grupoInfo, revisaoMap]);

  const allClientes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of visibleTasks) {
      const raw = (t.cliente || t.gc_os_cliente || "").trim();
      if (!raw) continue;
      const k = normalizeClient(raw);
      if (!seen.has(k)) seen.set(k, raw);
    }
    return Array.from(seen.values()).sort();
  }, [visibleTasks]);

  const allTecnicos = useMemo(() => {
    const s = new Set<string>();
    for (const t of visibleTasks) if (t.tecnico) s.add(t.tecnico);
    return Array.from(s).sort();
  }, [visibleTasks]);

  const allTiposTarefa = useMemo(() => {
    const s = new Set<string>();
    for (const t of visibleTasks) {
      const tipo = (t.descricao || "").trim();
      s.add(tipo || "Sem tipo");
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [visibleTasks]);

  const grupos = useMemo(
    () => (grupoInfo ? [{ id: grupoInfo.id, nome: grupoInfo.nome }] : []),
    [grupoInfo],
  );
  const membros = useMemo(
    () =>
      grupoInfo
        ? grupoInfo.clientes.map((nome) => ({ grupo_id: grupoInfo.id, cliente_nome: nome }))
        : [],
    [grupoInfo],
  );

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile?.grupo_id) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-2xl mx-auto pt-20 text-center space-y-4">
          <h1 className="text-2xl font-semibold">Sem grupo liberado</h1>
          <p className="text-muted-foreground">
            Seu usuário ainda não foi vinculado a um grupo de clientes. Entre em contato com o responsável.
          </p>
          <Button variant="outline" onClick={() => signOut().then(() => navigate("/portal/login"))}>
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <span className="text-primary-foreground font-bold">W</span>
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">Portal do Cliente</p>
              <p className="text-xs text-muted-foreground leading-tight">{grupoInfo?.nome}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground hidden sm:inline">{profile?.nome || profile?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => signOut().then(() => navigate("/portal/login"))}>
              <LogOut className="h-4 w-4 mr-1" /> Sair
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-6">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-foreground">Horas Trabalhadas</h1>
          <p className="text-sm text-muted-foreground">
            Atendimentos do grupo <span className="font-medium text-foreground">{grupoInfo?.nome}</span>
          </p>
        </div>
        <HorasTrabalhadasTab
          clientMode
          data={visibleTasks}
          isLoading={isLoading || !grupoInfo}
          allClientes={allClientes}
          allTecnicos={allTecnicos}
          allTiposTarefa={allTiposTarefa}
          grupos={grupos}
          membros={membros}
          valorHoraConfigs={valorHoraConfigs || []}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
      </main>
    </div>
  );
}
