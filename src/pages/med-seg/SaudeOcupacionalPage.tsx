import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search } from "lucide-react";
import { useASOs, useAgendamentos, useColaboradores, useTiposASO } from "@/hooks/medSeg/useMedSeg";
import { diffDays, formatDate, situacaoBadge, situacaoDoColaborador } from "@/lib/medSeg";
import { cn } from "@/lib/utils";

export default function SaudeOcupacionalPage() {
  const nav = useNavigate();
  const { data: colabs = [] } = useColaboradores();
  const { data: asos = [] } = useASOs();
  const { data: agenda = [] } = useAgendamentos();
  const { data: tipos = [] } = useTiposASO();
  const [q, setQ] = useState("");

  const tipoMap = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const vigentesByColab = useMemo(() => {
    const m = new Map<string, typeof asos[number]>();
    for (const a of asos) if (a.vigente) m.set(a.colaborador_id, a);
    return m;
  }, [asos]);
  const agendaByColab = useMemo(() => {
    const m = new Map<string, typeof agenda>();
    for (const a of agenda) {
      const list = m.get(a.colaborador_id) ?? [];
      list.push(a);
      m.set(a.colaborador_id, list);
    }
    return m;
  }, [agenda]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return colabs
      .filter((c) => !term || c.nome.toLowerCase().includes(term) || (c.cargo ?? "").toLowerCase().includes(term))
      .map((c) => {
        const vig = vigentesByColab.get(c.id);
        const ags = agendaByColab.get(c.id) ?? [];
        const proximo = ags
          .filter((a) => a.status === "agendado" || a.status === "confirmado")
          .sort((a, b) => a.data.localeCompare(b.data))[0];
        const situacao = situacaoDoColaborador(vig, ags);
        return { c, vig, proximo, situacao };
      });
  }, [colabs, vigentesByColab, agendaByColab, q]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Saúde Ocupacional</h1>
        <p className="text-sm text-muted-foreground">Situação dos ASOs por colaborador.</p>
      </div>

      <div className="mb-4 relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou cargo..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Último ASO</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Validade</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Próximo exame</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ c, vig, proximo, situacao }) => {
              const d = vig ? diffDays(vig.data_validade) : null;
              return (
                <TableRow key={c.id} className="cursor-pointer" onClick={() => nav(`/med-seg/saude-ocupacional/${c.id}`)}>
                  <TableCell className="font-medium">{c.nome}</TableCell>
                  <TableCell className="text-muted-foreground">{c.cargo ?? "—"}</TableCell>
                  <TableCell>{formatDate(vig?.data_emissao)}</TableCell>
                  <TableCell>{vig ? tipoMap.get(vig.tipo_id)?.nome ?? "—" : "—"}</TableCell>
                  <TableCell>
                    {formatDate(vig?.data_validade)}
                    {d != null && (
                      <span className={cn("ml-2 text-xs", d < 0 ? "text-red-600" : d <= 30 ? "text-amber-600" : "text-muted-foreground")}>
                        {d < 0 ? `há ${-d}d` : `em ${d}d`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline" className={situacaoBadge(situacao)}>{situacao}</Badge></TableCell>
                  <TableCell>{proximo ? `${formatDate(proximo.data)}${proximo.hora ? " " + proximo.hora.slice(0,5) : ""}` : "—"}</TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhum colaborador encontrado.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}