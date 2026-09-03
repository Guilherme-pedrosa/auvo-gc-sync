import { useMemo } from "react";
import {
  AlertTriangle,
  CalendarX2,
  Camera,
  CheckCircle2,
  ChevronDown,
  ClipboardX,
  Download,
  ExternalLink,
  MessageSquareWarning,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  summarizeDivergenceRecords,
  type DivergenceKind,
  type TechnicianDivergenceRecord,
} from "@/lib/technicianDivergences";
import { format } from "date-fns";

type Props = {
  records: TechnicianDivergenceRecord[];
  loading: boolean;
  syncing: boolean;
  onRefresh: () => void;
  onExport: () => void;
};

const issueStyle: Record<DivergenceKind, { badge: string; border: string; icon: typeof AlertTriangle }> = {
  schedule: { badge: "border-red-200 bg-red-50 text-red-700", border: "border-l-red-400", icon: CalendarX2 },
  form: { badge: "border-amber-200 bg-amber-50 text-amber-800", border: "border-l-amber-400", icon: ClipboardX },
  report: { badge: "border-violet-200 bg-violet-50 text-violet-700", border: "border-l-violet-400", icon: MessageSquareWarning },
  photos: { badge: "border-blue-200 bg-blue-50 text-blue-700", border: "border-l-blue-400", icon: Camera },
  checkin: { badge: "border-emerald-200 bg-emerald-50 text-emerald-700", border: "border-l-emerald-400", icon: ExternalLink },
};

function SummaryBox({ label, value, icon: Icon, className }: { label: string; value: number; icon: typeof AlertTriangle; className: string }) {
  return (
    <div className={`rounded-lg border p-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4" />
        <strong className="text-lg tabular-nums">{value}</strong>
      </div>
      <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide">{label}</p>
    </div>
  );
}

export default function TechnicianDivergencesPanel({ records, loading, syncing, onRefresh, onExport }: Props) {
  const summary = useMemo(() => summarizeDivergenceRecords(records), [records]);
  const groups = useMemo(() => {
    const byTechnician = new Map<string, { name: string; records: TechnicianDivergenceRecord[] }>();
    for (const record of records) {
      const key = record.technicianId || record.technicianName;
      const current = byTechnician.get(key) || { name: record.technicianName, records: [] };
      current.records.push(record);
      byTechnician.set(key, current);
    }
    return [...byTechnician.entries()].sort((a, b) => b[1].records.length - a[1].records.length || a[1].name.localeCompare(b[1].name));
  }, [records]);

  if (loading) {
    return <div className="flex items-center justify-center py-10"><RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <SummaryBox label="Não atendidas" value={summary.schedule} icon={CalendarX2} className="border-red-200 bg-red-50/60 text-red-700" />
        <SummaryBox label="Formulários" value={summary.form} icon={ClipboardX} className="border-amber-200 bg-amber-50/60 text-amber-800" />
        <SummaryBox label="Relatos insuficientes" value={summary.report} icon={MessageSquareWarning} className="border-violet-200 bg-violet-50/60 text-violet-700" />
        <SummaryBox label="Poucas/sem fotos" value={summary.photos} icon={Camera} className="border-blue-200 bg-blue-50/60 text-blue-700" />
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2">
        <div>
          <p className="text-xs font-semibold">{summary.records} atendimento(s) com divergência</p>
          <p className="text-[10px] text-muted-foreground">{summary.technicians} técnico(s) afetado(s) · fotos: mínimo operacional de 3 por execução</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onExport} disabled={records.length === 0}>
            <Download className="mr-1 h-3 w-3" /> PDF
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onRefresh} disabled={syncing}>
            <RefreshCw className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> Atualizar
          </Button>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          <p className="mt-2 text-sm font-semibold">Nenhuma divergência no período</p>
          <p className="text-xs text-muted-foreground">Agendamentos, formulários, relatos e fotos estão em conformidade.</p>
        </div>
      ) : (
        <ScrollArea className="h-[calc(100vh-19rem)] pr-3">
          <div className="space-y-2 pb-4">
            {groups.map(([technicianId, group]) => {
              const initials = group.name.split(" ").map((name) => name[0]).filter(Boolean).slice(0, 2).join("");
              const issueCount = group.records.reduce((total, record) => total + record.issues.length, 0);
              return (
                <Collapsible key={technicianId} defaultOpen={groups.length <= 4}>
                  <CollapsibleTrigger className="group flex w-full items-center justify-between rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/50">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{initials || "?"}</div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{group.name}</p>
                        <p className="text-[10px] text-muted-foreground">{group.records.length} atendimento(s) · {issueCount} alerta(s)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="h-5 text-[10px]">{issueCount}</Badge>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="ml-4 space-y-2 border-l-2 border-muted py-2 pl-3">
                      {group.records.map((record) => (
                        <div key={record.key} className={`rounded-lg border border-l-4 bg-background p-3 ${issueStyle[record.issues[0].kind].border}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="truncate text-xs font-semibold">{record.client}</p>
                                {record.gcOsCode && <Badge variant="outline" className="h-5 font-mono text-[9px]">OS {record.gcOsCode}</Badge>}
                              </div>
                              {record.description && <p className="mt-0.5 text-[10px] text-muted-foreground">{record.description}</p>}
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span>{record.date ? format(new Date(`${record.date}T12:00:00`), "dd/MM/yyyy") : "Sem data"}</span>
                                <span>·</span>
                                {record.auvoUrl ? (
                                  <a href={record.auvoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-semibold text-blue-600 underline-offset-2 hover:underline">
                                    Tarefa Auvo #{record.taskId || "—"}<ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : <span className="font-mono">Tarefa Auvo #{record.taskId || "—"}</span>}
                              </div>
                            </div>
                          </div>
                          <div className="mt-2 space-y-1.5">
                            {record.issues.map((issue) => {
                              const style = issueStyle[issue.kind];
                              const Icon = style.icon;
                              return (
                                <div key={`${record.key}-${issue.kind}`} className="flex items-start gap-2 text-[10px]">
                                  <Badge variant="outline" className={`h-5 shrink-0 gap-1 px-1.5 text-[9px] ${style.badge}`}><Icon className="h-3 w-3" />{issue.label}</Badge>
                                  <span className="pt-0.5 leading-relaxed text-muted-foreground">{issue.detail}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
