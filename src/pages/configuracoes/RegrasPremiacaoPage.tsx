import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";

type FaixaReducao = { km_min: number; km_max: number | null; pct: number };
type FaixaBonus = { km_total_min: number; km_tel_min: number; pct: number };

const num = (v: string) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

export default function RegrasPremiacaoPage() {
  const [reducoes, setReducoes] = useState<FaixaReducao[]>([]);
  const [bonus, setBonus] = useState<FaixaBonus[]>([]);
  const [saving, setSaving] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["premiacao-regras-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("premiacao_regras_config")
        .select("*")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!data) return;
    setReducoes(((data as any).reducoes ?? []) as FaixaReducao[]);
    setBonus(((data as any).bonus_telemetria ?? []) as FaixaBonus[]);
  }, [data]);

  const salvar = async () => {
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const ordenadas = [...reducoes].sort((a, b) => a.km_min - b.km_min);
    const { error } = await supabase
      .from("premiacao_regras_config")
      .update({
        reducoes: ordenadas as any,
        bonus_telemetria: bonus as any,
        atualizado_em: new Date().toISOString(),
        atualizado_por: userData?.user?.email ?? null,
      })
      .eq("id", "default");
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Regras salvas. Recalcule a premiação para aplicar.");
    refetch();
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando regras…
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Regras de Premiação</h1>
        <p className="text-sm text-muted-foreground">
          Faixas de redução (demérito) e de bônus por KM/telemetria usadas no cálculo da premiação.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Reduções por KM/telemetria</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReducoes([...reducoes, { km_min: 0, km_max: null, pct: 0 }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Faixa
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A faixa vale quando KM/telemetria ≥ mínimo e &lt; máximo. Deixe o máximo vazio para "sem limite".
          Acima da última faixa não há redução.
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>KM/telem. mínimo</TableHead>
              <TableHead>KM/telem. máximo</TableHead>
              <TableHead>Redução (%)</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reducoes.map((f, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    type="number"
                    value={f.km_min}
                    onChange={(e) =>
                      setReducoes(reducoes.map((r, j) => (j === i ? { ...r, km_min: num(e.target.value) } : r)))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    placeholder="sem limite"
                    value={f.km_max ?? ""}
                    onChange={(e) =>
                      setReducoes(
                        reducoes.map((r, j) =>
                          j === i ? { ...r, km_max: e.target.value === "" ? null : num(e.target.value) } : r,
                        ),
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.5"
                    value={Number((f.pct * 100).toFixed(2))}
                    onChange={(e) =>
                      setReducoes(reducoes.map((r, j) => (j === i ? { ...r, pct: num(e.target.value) / 100 } : r)))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setReducoes(reducoes.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {reducoes.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Nenhuma faixa de redução — nenhum demérito de telemetria será aplicado.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Bônus por telemetria</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setBonus([...bonus, { km_total_min: 0, km_tel_min: 0, pct: 0 }])}
          >
            <Plus className="mr-1 h-4 w-4" /> Faixa
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Aplica o maior bônus cujas condições sejam atendidas (KM total no mês ≥ mínimo e KM/telemetria &gt; mínimo).
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>KM total mínimo</TableHead>
              <TableHead>KM/telem. mínimo</TableHead>
              <TableHead>Bônus (%)</TableHead>
              <TableHead className="w-16"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bonus.map((f, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Input
                    type="number"
                    value={f.km_total_min}
                    onChange={(e) =>
                      setBonus(bonus.map((r, j) => (j === i ? { ...r, km_total_min: num(e.target.value) } : r)))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    value={f.km_tel_min}
                    onChange={(e) =>
                      setBonus(bonus.map((r, j) => (j === i ? { ...r, km_tel_min: num(e.target.value) } : r)))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    step="0.5"
                    value={Number((f.pct * 100).toFixed(2))}
                    onChange={(e) =>
                      setBonus(bonus.map((r, j) => (j === i ? { ...r, pct: num(e.target.value) / 100 } : r)))
                    }
                  />
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setBonus(bonus.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {bonus.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Nenhuma faixa de bônus configurada.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={salvar} disabled={saving}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar regras
        </Button>
        {(data as any)?.atualizado_em && (
          <span className="text-xs text-muted-foreground">
            Última alteração: {new Date((data as any).atualizado_em).toLocaleString("pt-BR")}
            {(data as any).atualizado_por ? ` por ${(data as any).atualizado_por}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}
