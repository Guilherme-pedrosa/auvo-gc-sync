import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTiposASO, useClinicas, useSaveASO } from "@/hooks/medSeg/useMedSeg";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  colaboradorId: string;
  agendamentoId?: string;
  defaultTipoId?: string;
};

export default function ASODialog({ open, onOpenChange, colaboradorId, agendamentoId, defaultTipoId }: Props) {
  const { data: tipos = [] } = useTiposASO();
  const { data: clinicas = [] } = useClinicas();
  const save = useSaveASO();

  const [tipoId, setTipoId] = useState<string>("");
  const [dataEmissao, setDataEmissao] = useState<string>(new Date().toISOString().slice(0, 10));
  const [dataValidade, setDataValidade] = useState<string>("");
  const [clinicaId, setClinicaId] = useState<string>("");
  const [medico, setMedico] = useState("");
  const [crm, setCrm] = useState("");
  const [obs, setObs] = useState("");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (open) {
      setTipoId(defaultTipoId ?? "");
      setDataEmissao(new Date().toISOString().slice(0, 10));
      setDataValidade("");
      setClinicaId("");
      setMedico(""); setCrm(""); setObs(""); setFile(null);
    }
  }, [open, defaultTipoId]);

  const tipoSel = useMemo(() => tipos.find((t) => t.id === tipoId), [tipos, tipoId]);

  // Auto-calcula validade quando muda tipo ou emissão
  useEffect(() => {
    if (!tipoSel?.periodicidade_meses || !dataEmissao) return;
    const d = new Date(dataEmissao + "T00:00:00");
    d.setMonth(d.getMonth() + tipoSel.periodicidade_meses);
    setDataValidade(d.toISOString().slice(0, 10));
  }, [tipoSel, dataEmissao]);

  const submit = async () => {
    if (!tipoId || !dataEmissao) return;
    await save.mutateAsync({
      colaborador_id: colaboradorId,
      tipo_id: tipoId,
      data_emissao: dataEmissao,
      data_validade: dataValidade || null,
      clinica_id: clinicaId || null,
      medico_nome: medico || null,
      medico_crm: crm || null,
      observacoes: obs || null,
      agendamento_id: agendamentoId ?? null,
      file,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo ASO</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tipo</Label>
            <Select value={tipoId} onValueChange={setTipoId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>{tipos.filter((t) => t.ativo).map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Data de emissão</Label>
              <Input type="date" value={dataEmissao} onChange={(e) => setDataEmissao(e.target.value)} />
            </div>
            <div>
              <Label>Validade</Label>
              <Input type="date" value={dataValidade} onChange={(e) => setDataValidade(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Clínica</Label>
            <Select value={clinicaId} onValueChange={(v) => setClinicaId(v)}>
              <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>{clinicas.filter((c) => c.ativo).map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Médico</Label><Input value={medico} onChange={(e) => setMedico(e.target.value)} /></div>
            <div><Label>CRM</Label><Input value={crm} onChange={(e) => setCrm(e.target.value)} /></div>
          </div>
          <div>
            <Label>Documento (PDF/imagem)</Label>
            <Input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground mt-1">
              O arquivo anexado é gravado também no Prontuário → Saúde Ocupacional do colaborador.
            </p>
          </div>
          <div><Label>Observações</Label><Textarea value={obs} onChange={(e) => setObs(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={save.isPending}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}