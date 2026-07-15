import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Save, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useDocumentTypes, type DocumentType } from "@/hooks/rh/useRh";
import { useQueryClient } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type Pack = "MEI" | "CLT";

export default function PacotesPadraoPage() {
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useDocumentTypes();

  const tecs = useMemo(
    () => types.filter((t) => t.scope === "TECHNICIAN" && t.ativo).sort((a, b) => a.name.localeCompare(b.name)),
    [types],
  );

  // Estado local por id -> Set<Pack>
  const [dirty, setDirty] = useState<Record<string, Set<Pack>>>({});
  const [saving, setSaving] = useState(false);

  const current = (t: DocumentType): Set<Pack> => {
    if (dirty[t.id]) return dirty[t.id];
    const s = new Set<Pack>();
    for (const p of t.pacote_padrao ?? []) {
      if (p === "MEI" || p === "CLT") s.add(p);
    }
    return s;
  };

  const toggle = (t: DocumentType, p: Pack) => {
    const cur = new Set(current(t));
    cur.has(p) ? cur.delete(p) : cur.add(p);
    setDirty((d) => ({ ...d, [t.id]: cur }));
  };

  const hasChanges = Object.keys(dirty).length > 0;

  const salvar = async () => {
    setSaving(true);
    try {
      for (const [id, packs] of Object.entries(dirty)) {
        const t = tecs.find((x) => x.id === id);
        if (!t) continue;
        // Preserva COMPANY se existir (não deve, mas por segurança)
        const others = (t.pacote_padrao ?? []).filter((p) => p !== "MEI" && p !== "CLT");
        const novo = [...others, ...Array.from(packs)];
        const { error } = await sb.from("rh_document_types").update({ pacote_padrao: novo }).eq("id", id);
        if (error) throw error;
      }
      toast.success("Pacotes atualizados");
      setDirty({});
      qc.invalidateQueries({ queryKey: ["rh_document_types"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Pacote padrão por profissão</h1>
          <p className="text-sm text-muted-foreground">
            Marque quais documentos são obrigatórios para técnicos <b>MEI (CNPJ)</b> e <b>CLT (CPF)</b>.
            O dashboard usa esta lista para apontar quem está com documentos faltantes.
          </p>
        </div>
        <Button onClick={salvar} disabled={!hasChanges || saving}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Salvando..." : "Salvar alterações"}
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Info className="h-4 w-4 text-muted-foreground" />
            Documentos de técnicos
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Documento</TableHead>
                <TableHead className="w-24 text-center">MEI</TableHead>
                <TableHead className="w-24 text-center">CLT</TableHead>
                <TableHead className="w-32">Pacote atual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8">Carregando...</TableCell></TableRow>
              ) : tecs.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Nenhum documento de técnico cadastrado.</TableCell></TableRow>
              ) : tecs.map((t) => {
                const packs = current(t);
                const isDirty = !!dirty[t.id];
                return (
                  <TableRow key={t.id} className={isDirty ? "bg-amber-50/40 dark:bg-amber-950/10" : undefined}>
                    <TableCell>
                      <div className="font-medium text-sm">{t.name}</div>
                      <div className="text-[11px] font-mono text-muted-foreground">{t.code}</div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={packs.has("MEI")} onCheckedChange={() => toggle(t, "MEI")} />
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox checked={packs.has("CLT")} onCheckedChange={() => toggle(t, "CLT")} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {packs.size === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          Array.from(packs).map((p) => (
                            <Badge key={p} variant="secondary" className="text-[10px]">{p}</Badge>
                          ))
                        )}
                        {isDirty && <Badge variant="outline" className="text-[10px]">alterado</Badge>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}