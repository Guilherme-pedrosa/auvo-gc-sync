import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus } from "lucide-react";
import { useAgendamentos, useColaboradores, useTiposASO, useClinicas } from "@/hooks/medSeg/useMedSeg";
import { diffDays, formatDate } from "@/lib/medSeg";
import AgendamentoDialog from "@/components/medSeg/AgendamentoDialog";

export default function AgendaPage() {
  const nav = useNavigate();
  const { data: agenda = [] } = useAgendamentos();
  const { data: colabs = [] } = useColaboradores();
  const { data: tipos = [] } = useTiposASO();
  const { data: clinicas = [] } = useClinicas();
  const [open, setOpen] = useState(false);

  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);
  const tipoMap = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const clinicaMap = useMemo(() => new Map(clinicas.map((c) => [c.id, c])), [clinicas]);

  const filter = (max: number) =>
    agenda
      .filter((a) => a.status !== "cancelado")
      .filter((a) => {
        const d = diffDays(a.data);
        return d != null && d >= 0 && d <= max;
      })
      .sort((a, b) => a.data.localeCompare(b.data));

  const buckets = {
    hoje: filter(0),
    sete: filter(7),
    trinta: filter(30),
  };

  const List = ({ items }: { items: typeof agenda }) => (
    <div className="border rounded-lg bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Colaborador</TableHead>
            <TableHead>Tipo</TableHead>
            <TableHead>Clínica</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => {
            const c = colabMap.get(a.colaborador_id);
            return (
              <TableRow key={a.id} className="cursor-pointer" onClick={() => c && nav(`/med-seg/saude-ocupacional/${c.id}`)}>
                <TableCell>{formatDate(a.data)}{a.hora ? ` ${a.hora.slice(0,5)}` : ""}</TableCell>
                <TableCell className="font-medium">{c?.nome ?? "—"}</TableCell>
                <TableCell>{tipoMap.get(a.tipo_id)?.nome ?? "—"}</TableCell>
                <TableCell>{a.clinica_id ? clinicaMap.get(a.clinica_id)?.nome ?? "—" : "—"}</TableCell>
                <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
              </TableRow>
            );
          })}
          {items.length === 0 && (
            <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum exame nesta janela.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Agenda de exames</h1>
          <p className="text-sm text-muted-foreground">Próximos exames ocupacionais.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Novo agendamento</Button>
      </div>

      <Tabs defaultValue="sete">
        <TabsList>
          <TabsTrigger value="hoje">Hoje ({buckets.hoje.length})</TabsTrigger>
          <TabsTrigger value="sete">Próximos 7 dias ({buckets.sete.length})</TabsTrigger>
          <TabsTrigger value="trinta">Próximos 30 dias ({buckets.trinta.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="hoje" className="mt-4"><List items={buckets.hoje} /></TabsContent>
        <TabsContent value="sete" className="mt-4"><List items={buckets.sete} /></TabsContent>
        <TabsContent value="trinta" className="mt-4"><List items={buckets.trinta} /></TabsContent>
      </Tabs>

      <AgendamentoDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}