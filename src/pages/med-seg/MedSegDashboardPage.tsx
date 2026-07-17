import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CalendarCheck, ClipboardCheck, FileWarning, HeartPulse, ShieldAlert, Upload } from "lucide-react";
import { useASOs, useAgendamentos, useColaboradores } from "@/hooks/medSeg/useMedSeg";
import { diffDays, formatDate } from "@/lib/medSeg";

export default function MedSegDashboardPage() {
  const nav = useNavigate();
  const { data: asos = [] } = useASOs();
  const { data: agenda = [] } = useAgendamentos();
  const { data: colabs = [] } = useColaboradores();

  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);

  const vigentesByColab = useMemo(() => {
    const m = new Map<string, typeof asos[number]>();
    for (const a of asos) if (a.vigente) m.set(a.colaborador_id, a);
    return m;
  }, [asos]);

  const kpis = useMemo(() => {
    let validos = 0, vencendo = 0, vencidos = 0;
    for (const c of colabs) {
      const a = vigentesByColab.get(c.id);
      if (!a) continue;
      const d = diffDays(a.data_validade);
      if (d == null) { validos++; continue; }
      if (d < 0) vencidos++;
      else if (d <= 30) vencendo++;
      else validos++;
    }
    const agendados = agenda.filter((a) => a.status === "agendado" || a.status === "confirmado").length;
    const aguardandoDoc = agenda.filter((a) => a.status === "realizado" && !a.aso_id).length;
    return { total: colabs.length, validos, vencendo, vencidos, agendados, aguardandoDoc };
  }, [colabs, vigentesByColab, agenda]);

  // Fila priorizada
  type Acao = { prio: 1 | 2 | 3; icon: any; text: string; onClick: () => void; color: string };
  const acoes: Acao[] = useMemo(() => {
    const out: Acao[] = [];
    // Sem ASO
    for (const c of colabs) {
      if (!vigentesByColab.get(c.id)) {
        out.push({
          prio: 1, icon: ShieldAlert, color: "text-red-600",
          text: `Regularizar ${c.nome} — sem ASO cadastrado`,
          onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`),
        });
      }
    }
    for (const a of asos) {
      if (!a.vigente) continue;
      const d = diffDays(a.data_validade);
      if (d == null) continue;
      const c = colabMap.get(a.colaborador_id);
      if (!c) continue;
      if (d < 0)
        out.push({ prio: 1, icon: ShieldAlert, color: "text-red-600", text: `${c.nome} — ASO vencido há ${-d} dias`, onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`) });
      else if (d <= 7)
        out.push({ prio: 1, icon: AlertCircle, color: "text-red-600", text: `${c.nome} — ASO vence em ${d} dias`, onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`) });
      else if (d <= 30)
        out.push({ prio: 2, icon: AlertCircle, color: "text-amber-600", text: `${c.nome} — ASO vence em ${d} dias`, onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`) });
    }
    for (const ag of agenda) {
      const c = colabMap.get(ag.colaborador_id);
      if (!c) continue;
      if (ag.status === "realizado" && !ag.aso_id) {
        out.push({ prio: 2, icon: Upload, color: "text-yellow-600", text: `Anexar ASO de ${c.nome} — exame realizado em ${formatDate(ag.data)}`, onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`) });
      } else if (ag.status === "agendado") {
        const d = diffDays(ag.data);
        if (d != null && d >= 0 && d <= 2) {
          out.push({ prio: 2, icon: CalendarCheck, color: "text-amber-600", text: `Confirmar ${c.nome} — exame ${d === 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`}`, onClick: () => nav(`/med-seg/saude-ocupacional/${c.id}`) });
        }
      }
    }
    return out.sort((a, b) => a.prio - b.prio).slice(0, 30);
  }, [colabs, asos, agenda, vigentesByColab, colabMap, nav]);

  const K = ({ icon: Icon, label, value, tone }: any) => (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-semibold mt-1">{value}</p>
          </div>
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${tone}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold">Medicina e Segurança</h1>
        <p className="text-sm text-muted-foreground">Situação operacional dos exames ocupacionais.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <K icon={HeartPulse} label="Monitorados" value={kpis.total} tone="bg-primary/10 text-primary" />
        <K icon={ClipboardCheck} label="ASOs válidos" value={kpis.validos} tone="bg-emerald-500/10 text-emerald-600" />
        <K icon={AlertCircle} label="Vencendo ≤30d" value={kpis.vencendo} tone="bg-amber-500/10 text-amber-600" />
        <K icon={ShieldAlert} label="Vencidos" value={kpis.vencidos} tone="bg-red-500/10 text-red-600" />
        <K icon={CalendarCheck} label="Agendados" value={kpis.agendados} tone="bg-sky-500/10 text-sky-600" />
        <K icon={Upload} label="Aguard. documento" value={kpis.aguardandoDoc} tone="bg-yellow-500/10 text-yellow-600" />
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><FileWarning className="h-4 w-4" /> Fila de ações</CardTitle>
          <Badge variant="outline">{acoes.length}</Badge>
        </CardHeader>
        <CardContent className="p-0">
          {acoes.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma pendência 🎉</div>
          ) : (
            <ul className="divide-y">
              {acoes.map((a, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/40">
                  <div className="flex items-center gap-3 min-w-0">
                    <a.icon className={`h-4 w-4 flex-shrink-0 ${a.color}`} />
                    <span className="text-sm truncate">{a.text}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={a.onClick}>Abrir</Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}