import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";
import { useRhClientes, useColaboradores, useSaveIntegration } from "@/hooks/rh/useRh";

export default function NovaIntegracaoPage() {
  const navigate = useNavigate();
  const { data: clientes = [] } = useRhClientes();
  const { data: colabs = [] } = useColaboradores();
  const save = useSaveIntegration();
  const [clientId, setClientId] = useState<string>("");
  const [techIds, setTechIds] = useState<string[]>([]);
  const [obs, setObs] = useState("");
  const [search, setSearch] = useState("");

  const filteredClientes = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (s ? clientes.filter((c) => c.nome.toLowerCase().includes(s)) : clientes).slice(0, 200);
  }, [clientes, search]);

  const toggleTech = (id: string) => {
    setTechIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const submit = async () => {
    if (!clientId || techIds.length === 0) return;
    await save.mutateAsync({
      client_id: clientId,
      technician_ids: techIds,
      observacoes: obs || null,
      status: "draft",
    });
    navigate("/rh/integracoes");
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/integracoes")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">Nova integração</h1>
        <p className="text-sm text-muted-foreground">Selecione o cliente e os técnicos que serão alocados.</p>
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <Label>Cliente</Label>
          <Input placeholder="Filtrar clientes..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-2" />
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
            <SelectContent>
              {filteredClientes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>Técnicos</Label>
          <div className="border rounded-md max-h-64 overflow-auto divide-y">
            {colabs.filter((c) => c.ativo).map((c) => (
              <label key={c.id} className="flex items-center gap-2 p-2 cursor-pointer hover:bg-muted/40">
                <Checkbox checked={techIds.includes(c.id)} onCheckedChange={() => toggleTech(c.id)} />
                <span className="text-sm">{c.nome}</span>
                {c.cargo && <span className="text-xs text-muted-foreground">— {c.cargo}</span>}
              </label>
            ))}
            {colabs.length === 0 && <div className="p-4 text-sm text-muted-foreground">Nenhum colaborador cadastrado.</div>}
          </div>
        </div>

        <div>
          <Label>Observações</Label>
          <Input value={obs} onChange={(e) => setObs(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => navigate("/rh/integracoes")}>Cancelar</Button>
          <Button onClick={submit} disabled={!clientId || techIds.length === 0 || save.isPending}>Criar integração</Button>
        </div>
      </Card>
    </div>
  );
}