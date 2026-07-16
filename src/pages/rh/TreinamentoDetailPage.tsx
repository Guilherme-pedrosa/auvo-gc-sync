import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Upload, Download, Plus, Trash2, Users, GraduationCap, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useTreinamento, useTreinamentoTipos, useTreinamentoParticipantes,
  useAddParticipantes, useRemoveParticipante, useSaveTreinamento,
  useColaboradores, computeTrainingStatus, useSaveParticipante,
} from "@/hooks/rh/useRh";

const statusVariant = (s: string) => s === "expired" ? "destructive" : s === "expiring" ? "secondary" : "default";
const statusLabel = (s: string) => s === "expired" ? "Vencido" : s === "expiring" ? "Vencendo" : "Vigente";

export default function TreinamentoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: treino } = useTreinamento(id);
  const { data: tipos = [] } = useTreinamentoTipos();
  const { data: participantes = [] } = useTreinamentoParticipantes(id);
  const { data: colabs = [] } = useColaboradores();
  const add = useAddParticipantes();
  const remove = useRemoveParticipante();
  const save = useSaveTreinamento();
  const saveParticipante = useSaveParticipante();
  const [uploadingCertId, setUploadingCertId] = useState<string | null>(null);

  const slugify = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();

  const uploadParticipanteCert = async (participanteId: string, colabNome: string, file: File | null) => {
    if (!file || !id) return;
    setUploadingCertId(participanteId);
    try {
      const dotIdx = file.name.lastIndexOf(".");
      const ext = dotIdx >= 0 ? file.name.slice(dotIdx).toLowerCase() : "";
      const tipoCode = tipo?.code ?? "";
      const tipoSlug = slugify(tipoCode || treino?.titulo || "TREINAMENTO").slice(0, 40);
      const colabSlug = slugify(colabNome).slice(0, 60);
      const shortId = id.slice(0, 8).toUpperCase();
      const baseName = `${shortId}_${tipoSlug}_${colabSlug}`;
      const path = `treinamentos/${id}/certificados/${baseName}-${Date.now()}${ext}`;
      const { error } = await supabase.storage.from("rh-documentos").upload(path, file, { upsert: false });
      if (error) throw error;
      await saveParticipante.mutateAsync({
        id: participanteId,
        treinamento_id: id,
        certificado_url: path,
        certificado_nome: `${baseName}${ext}`,
      });
    } catch (e) {
      toast.error("Falha no upload: " + (e as Error).message);
    } finally {
      setUploadingCertId(null);
    }
  };

  const tipo = useMemo(() => tipos.find((t) => t.id === treino?.tipo_id), [tipos, treino]);
  const colabMap = useMemo(() => new Map(colabs.map((c) => [c.id, c])), [colabs]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [searchColab, setSearchColab] = useState("");
  const [uploading, setUploading] = useState<"cert" | "presenca" | null>(null);

  const jaVinculados = useMemo(() => new Set(participantes.map((p) => p.colaborador_id)), [participantes]);
  const disponiveis = useMemo(() => {
    const s = searchColab.trim().toLowerCase();
    return colabs
      .filter((c) => c.ativo && !jaVinculados.has(c.id))
      .filter((c) => !s || c.nome.toLowerCase().includes(s) || (c.cpf_cnpj ?? "").toLowerCase().includes(s));
  }, [colabs, jaVinculados, searchColab]);

  const toggle = (cid: string) => {
    const next = new Set(selecionados);
    next.has(cid) ? next.delete(cid) : next.add(cid);
    setSelecionados(next);
  };

  const vincular = async () => {
    if (!id || selecionados.size === 0) return;
    await add.mutateAsync({ treinamento_id: id, colaborador_ids: Array.from(selecionados) });
    setSelecionados(new Set()); setDialogOpen(false);
  };

  const openArquivo = async (url: string) => {
    if (!url) return;
    if (/^https?:\/\//i.test(url)) { window.open(url, "_blank"); return; }
    const { data, error } = await supabase.storage.from("rh-documentos").createSignedUrl(url, 60 * 60);
    if (error || !data?.signedUrl) { toast.error("Falha ao abrir arquivo"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const uploadArquivo = async (kind: "cert" | "presenca", file: File | null) => {
    if (!file || !id) return;
    setUploading(kind);
    try {
      const path = `treinamentos/${id}/${kind}-${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await supabase.storage.from("rh-documentos").upload(path, file, { upsert: false });
      if (error) throw error;
      const patch = kind === "cert"
        ? { certificado_url: path, certificado_nome: file.name }
        : { lista_presenca_url: path, lista_presenca_nome: file.name };
      await save.mutateAsync({ id, ...patch });
    } catch (e) {
      toast.error("Falha no upload: " + (e as Error).message);
    } finally {
      setUploading(null);
    }
  };

  if (!treino) return <div className="p-6">Carregando...</div>;

  const st = computeTrainingStatus(treino);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/treinamentos")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-xl uppercase flex items-center gap-2">
                <GraduationCap className="h-5 w-5" /> {treino.titulo}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {tipo?.name ?? "—"}
              </p>
            </div>
            <Badge variant={statusVariant(st) as never}>{statusLabel(st)}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><Label className="text-xs">Realização</Label><div>{treino.data_realizacao}</div></div>
          <div><Label className="text-xs">Validade</Label><div>{treino.data_validade ?? "—"}</div></div>
          <div><Label className="text-xs">Instrutor</Label><div>{treino.instrutor ?? "—"}</div></div>
          <div><Label className="text-xs">Carga horária</Label><div>{treino.carga_horaria != null ? `${treino.carga_horaria} h` : "—"}</div></div>
          <div className="col-span-2"><Label className="text-xs">Local</Label><div>{treino.local ?? "—"}</div></div>
          <div className="col-span-full"><Label className="text-xs">Observações</Label><div className="whitespace-pre-wrap">{treino.observacoes ?? "—"}</div></div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Certificado</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {treino.certificado_url ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openArquivo(treino.certificado_url!)}>
                  <Download className="h-4 w-4 mr-1" /> {treino.certificado_nome ?? "baixar"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => id && save.mutate({ id, certificado_url: null, certificado_nome: null })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Sem arquivo.</p>}
            <label className="inline-flex">
              <input type="file" hidden onChange={(e) => uploadArquivo("cert", e.target.files?.[0] ?? null)} />
              <Button asChild size="sm" variant="secondary" disabled={uploading === "cert"}>
                <span><Upload className="h-4 w-4 mr-1" /> {uploading === "cert" ? "Enviando..." : "Anexar"}</span>
              </Button>
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Lista de presença</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {treino.lista_presenca_url ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => openArquivo(treino.lista_presenca_url!)}>
                  <Download className="h-4 w-4 mr-1" /> {treino.lista_presenca_nome ?? "baixar"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => id && save.mutate({ id, lista_presenca_url: null, lista_presenca_nome: null })}>
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ) : <p className="text-xs text-muted-foreground">Sem arquivo.</p>}
            <label className="inline-flex">
              <input type="file" hidden onChange={(e) => uploadArquivo("presenca", e.target.files?.[0] ?? null)} />
              <Button asChild size="sm" variant="secondary" disabled={uploading === "presenca"}>
                <span><Upload className="h-4 w-4 mr-1" /> {uploading === "presenca" ? "Enviando..." : "Anexar"}</span>
              </Button>
            </label>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" /> Participantes
            <Badge variant="secondary" className="ml-1">{participantes.length}</Badge>
          </CardTitle>
          <Button size="sm" onClick={() => { setSelecionados(new Set()); setSearchColab(""); setDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Vincular colaboradores
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead className="w-32">CPF/CNPJ</TableHead>
                <TableHead className="w-24 text-center">Presente</TableHead>
                <TableHead className="w-64 text-right">Certificado</TableHead>
                <TableHead className="w-20 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {participantes.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  Nenhum participante vinculado.
                </TableCell></TableRow>
              ) : participantes.map((p) => {
                const c = colabMap.get(p.colaborador_id);
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium uppercase">{c?.nome ?? p.colaborador_id}</TableCell>
                    <TableCell className="font-mono text-xs">{c?.cpf_cnpj ?? "—"}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={p.presente ? "default" : "outline"}>{p.presente ? "Sim" : "Não"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {p.certificado_url && (
                          <Button size="sm" variant="ghost" onClick={() => openArquivo(p.certificado_url!)} title={p.certificado_nome ?? "abrir"}>
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <label className="inline-flex">
                          <input
                            type="file"
                            hidden
                            onChange={(e) => uploadParticipanteCert(p.id, c?.nome ?? p.colaborador_id, e.target.files?.[0] ?? null)}
                          />
                          <Button asChild size="sm" variant="outline" disabled={uploadingCertId === p.id}>
                            <span>
                              <Upload className="h-3.5 w-3.5 mr-1" />
                              {uploadingCertId === p.id ? "Enviando..." : p.certificado_url ? "Substituir" : "Anexar"}
                            </span>
                          </Button>
                        </label>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => id && remove.mutate({ id: p.id, treinamento_id: id })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Vincular colaboradores</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Nome ou CPF/CNPJ..." value={searchColab} onChange={(e) => setSearchColab(e.target.value)} />
            </div>
            <div className="border rounded max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Nome</TableHead>
                    <TableHead className="w-28">Tipo</TableHead>
                    <TableHead className="w-32">CPF/CNPJ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {disponiveis.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                      Nenhum colaborador disponível.
                    </TableCell></TableRow>
                  ) : disponiveis.map((c) => (
                    <TableRow key={c.id} className="cursor-pointer" onClick={() => toggle(c.id)}>
                      <TableCell><Checkbox checked={selecionados.has(c.id)} onCheckedChange={() => toggle(c.id)} /></TableCell>
                      <TableCell className="uppercase font-medium">{c.nome}</TableCell>
                      <TableCell><Badge variant="outline">{c.tipo_pessoa}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{c.cpf_cnpj ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={vincular} disabled={selecionados.size === 0 || add.isPending}>
              Vincular {selecionados.size > 0 ? `(${selecionados.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}