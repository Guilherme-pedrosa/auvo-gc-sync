import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, Plus, Upload, Trash2, Pencil } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  useASOs, useAgendamentos, useTiposASO, useClinicas, useSignedUrl,
  useDeleteAgendamento, useHistorico, type MedAgendamento,
} from "@/hooks/medSeg/useMedSeg";
import { diffDays, formatDate, situacaoBadge, situacaoDoColaborador } from "@/lib/medSeg";
import ASODialog from "@/components/medSeg/ASODialog";
import AgendamentoDialog from "@/components/medSeg/AgendamentoDialog";

export default function ColaboradorSaudePage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { data: colab } = useQuery({
    queryKey: ["rh_colab", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("rh_colaboradores").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });
  const { data: asos = [] } = useASOs({ colaboradorId: id });
  const { data: agenda = [] } = useAgendamentos({ colaboradorId: id });
  const { data: tipos = [] } = useTiposASO();
  const { data: clinicas = [] } = useClinicas();
  const { data: historico = [] } = useHistorico(id);
  const signed = useSignedUrl();
  const delAg = useDeleteAgendamento();

  const tipoMap = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const clinicaMap = useMemo(() => new Map(clinicas.map((c) => [c.id, c])), [clinicas]);
  const vigente = useMemo(() => asos.find((a) => a.vigente), [asos]);
  const situacao = situacaoDoColaborador(vigente, agenda);

  const [asoOpen, setAsoOpen] = useState(false);
  const [asoDefaults, setAsoDefaults] = useState<{ agendamentoId?: string; tipoId?: string }>({});
  const [agOpen, setAgOpen] = useState(false);
  const [agEdit, setAgEdit] = useState<Partial<MedAgendamento> | undefined>();

  const openDocument = async (path: string | null) => {
    if (!path) return;
    const url = await signed.mutateAsync(path);
    window.open(url, "_blank");
  };

  const openDocByAsoDocId = async (documentoId: string | null) => {
    if (!documentoId) return;
    const { data } = await supabase.from("rh_colaborador_docs").select("arquivo_url").eq("id", documentoId).maybeSingle();
    if (data?.arquivo_url) await openDocument(data.arquivo_url);
  };

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => nav("/med-seg/saude-ocupacional")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
          <div>
            <h1 className="text-xl font-semibold">{colab?.nome ?? "—"}</h1>
            <p className="text-xs text-muted-foreground">{colab?.cargo ?? "—"} · {colab?.tipo_pessoa}</p>
          </div>
        </div>
        <Badge variant="outline" className={situacaoBadge(situacao)}>{situacao}</Badge>
      </div>

      <Tabs defaultValue="dados">
        <TabsList>
          <TabsTrigger value="dados">Dados</TabsTrigger>
          <TabsTrigger value="asos">ASOs</TabsTrigger>
          <TabsTrigger value="agenda">Agendamentos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="dados" className="mt-4">
          <Card>
            <CardContent className="p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Info label="Cargo" value={colab?.cargo} />
              <Info label="Função" value={colab?.funcao} />
              <Info label="Tipo de vínculo" value={colab?.tipo_pessoa} />
              <Info label="Último ASO" value={vigente ? formatDate(vigente.data_emissao) : "—"} />
              <Info label="Validade" value={vigente ? formatDate(vigente.data_validade) : "—"} />
              <Info label="Situação" value={situacao} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="asos" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => { setAsoDefaults({}); setAsoOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Novo ASO
            </Button>
          </div>
          <div className="border rounded-lg bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Emissão</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Clínica</TableHead>
                  <TableHead>Médico</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead>Documento</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {asos.map((a) => {
                  const d = diffDays(a.data_validade);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{tipoMap.get(a.tipo_id)?.nome ?? "—"}</TableCell>
                      <TableCell>{formatDate(a.data_emissao)}</TableCell>
                      <TableCell>
                        {formatDate(a.data_validade)}
                        {a.vigente && d != null && (
                          <span className={`ml-2 text-xs ${d < 0 ? "text-red-600" : d <= 30 ? "text-amber-600" : "text-muted-foreground"}`}>
                            {d < 0 ? `há ${-d}d` : `em ${d}d`}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>{a.clinica_id ? clinicaMap.get(a.clinica_id)?.nome ?? "—" : "—"}</TableCell>
                      <TableCell>{a.medico_nome ?? "—"}</TableCell>
                      <TableCell>
                        {a.vigente ? <Badge>vigente</Badge> : <Badge variant="secondary">{a.situacao}</Badge>}
                      </TableCell>
                      <TableCell>
                        {a.documento_id ? (
                          <Button size="sm" variant="ghost" onClick={() => openDocByAsoDocId(a.documento_id)}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        ) : <span className="text-xs text-muted-foreground">sem arquivo</span>}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {asos.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-muted-foreground">Nenhum ASO cadastrado.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="agenda" className="mt-4">
          <div className="flex justify-end mb-3">
            <Button size="sm" onClick={() => { setAgEdit(undefined); setAgOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Novo agendamento
            </Button>
          </div>
          <div className="border rounded-lg bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Clínica</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {agenda.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{formatDate(a.data)}{a.hora ? ` ${a.hora.slice(0,5)}` : ""}</TableCell>
                    <TableCell>{tipoMap.get(a.tipo_id)?.nome ?? "—"}</TableCell>
                    <TableCell>{a.clinica_id ? clinicaMap.get(a.clinica_id)?.nome ?? "—" : "—"}</TableCell>
                    <TableCell><Badge variant="outline">{a.status}</Badge></TableCell>
                    <TableCell className="flex gap-1">
                      {a.status === "realizado" && !a.aso_id && (
                        <Button size="sm" variant="secondary" onClick={() => { setAsoDefaults({ agendamentoId: a.id, tipoId: a.tipo_id }); setAsoOpen(true); }}>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Anexar ASO
                        </Button>
                      )}
                      {a.status !== "realizado" && (
                        <Button size="sm" variant="secondary" onClick={() => { setAsoDefaults({ agendamentoId: a.id, tipoId: a.tipo_id }); setAsoOpen(true); }}>
                          Marcar realizado
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setAgEdit(a); setAgOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => delAg.mutate(a.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {agenda.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">Nenhum agendamento.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="historico" className="mt-4">
          <div className="border rounded-lg bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Quando</TableHead>
                  <TableHead>Evento</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historico.map((h) => (
                  <TableRow key={h.id}>
                    <TableCell>{new Date(h.criado_em).toLocaleString("pt-BR")}</TableCell>
                    <TableCell><Badge variant="outline">{h.evento}</Badge></TableCell>
                    <TableCell className="text-xs font-mono text-muted-foreground">{JSON.stringify(h.payload)}</TableCell>
                  </TableRow>
                ))}
                {historico.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center py-6 text-muted-foreground">Sem eventos.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      <ASODialog
        open={asoOpen}
        onOpenChange={setAsoOpen}
        colaboradorId={id}
        agendamentoId={asoDefaults.agendamentoId}
        defaultTipoId={asoDefaults.tipoId}
      />
      <AgendamentoDialog
        open={agOpen}
        onOpenChange={setAgOpen}
        initial={agEdit}
        fixedColaboradorId={id}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="mt-0.5">{value || "—"}</p>
    </div>
  );
}