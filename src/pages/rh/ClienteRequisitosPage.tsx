import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { useRhClientes, useDocumentTypes, useClientRequirements, useToggleRequirement } from "@/hooks/rh/useRh";

export default function ClienteRequisitosPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: clientes = [] } = useRhClientes();
  const { data: types = [] } = useDocumentTypes();
  const { data: reqs = [] } = useClientRequirements(id);
  const toggle = useToggleRequirement();

  const cliente = useMemo(() => clientes.find((c) => c.id === id), [clientes, id]);
  const reqMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of reqs) m.set(`${r.document_type_id}:${r.required_for}`, r.is_required);
    return m;
  }, [reqs]);

  const setReq = (document_type_id: string, required_for: "COMPANY" | "TECHNICIAN", is_required: boolean) => {
    if (!id) return;
    toggle.mutate({ client_id: id, document_type_id, required_for, is_required });
  };

  const relevantTypes = types.filter((t) => t.ativo && t.scope !== "CLIENT");

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/rh/clientes")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <Card className="p-6">
        <h1 className="text-xl font-semibold">{cliente?.nome ?? "..."}</h1>
        <p className="text-sm text-muted-foreground">Requisitos de documentação exigidos por este cliente.</p>
      </Card>

      <div className="border rounded-lg bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Documento</TableHead>
              <TableHead>Escopo</TableHead>
              <TableHead className="text-center">Exige da empresa</TableHead>
              <TableHead className="text-center">Exige do técnico</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {relevantTypes.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.name}</TableCell>
                <TableCell><Badge variant="outline">{t.scope}</Badge></TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={reqMap.get(`${t.id}:COMPANY`) ?? false}
                    onCheckedChange={(v) => setReq(t.id, "COMPANY", !!v)}
                  />
                </TableCell>
                <TableCell className="text-center">
                  <Checkbox
                    checked={reqMap.get(`${t.id}:TECHNICIAN`) ?? false}
                    onCheckedChange={(v) => setReq(t.id, "TECHNICIAN", !!v)}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}