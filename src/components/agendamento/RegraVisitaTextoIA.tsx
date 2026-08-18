import { useState } from "react";
import { Loader2, Sparkles, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

export type RegraInterpretada = {
  qtd_visitas: number | null;
  meses_ativos: number[] | null;
  semanas_mes: number[] | null;
  dias_semana: number[] | null;
  hora_inicio: string | null;
  qtd_tecnicos: number | null;
  confianca: number;
  resumo: string;
  perguntas: string[];
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onApply: (resultado: RegraInterpretada) => void;
};

export function RegraVisitaTextoIA({ value, onChange, onApply }: Props) {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<RegraInterpretada | null>(null);
  const [historico, setHistorico] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [resposta, setResposta] = useState("");

  async function interpretar(texto: string, base: Array<{ role: "user" | "assistant"; content: string }>) {
    if (!texto.trim()) {
      toast.error("Escreva a regra em texto antes de interpretar.");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("visita-regra-parser", {
        body: { texto, historico: base },
      });
      if (error) throw error;
      if (!data?.ok) {
        toast.error(data?.mensagem || "Não consegui interpretar a regra.");
        return;
      }
      const parsed = data.resultado as RegraInterpretada;
      setResultado(parsed);
      setHistorico([
        ...base,
        { role: "user", content: texto },
        { role: "assistant", content: JSON.stringify(parsed) },
      ]);
      if (parsed.perguntas.length) toast.warning("Entendi parcialmente — responda as dúvidas abaixo.");
      else toast.success("Regra interpretada. Confira antes de salvar.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao interpretar a regra.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Descreva a recorrência em texto
        </Label>
        <Button size="sm" variant="secondary" onClick={() => void interpretar(value, [])} disabled={loading}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Interpretar
        </Button>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ex.: 1 vez a cada 2 meses, na primeira e última semana do mês, sempre às terças pela manhã."
        className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />

      {resultado && (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={resultado.confianca >= 0.75 ? "default" : "outline"}>
              Confiança {Math.round(resultado.confianca * 100)}%
            </Badge>
            <p className="text-sm">{resultado.resumo || "Sem resumo."}</p>
          </div>

          {resultado.perguntas.length > 0 && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-900">
                <HelpCircle className="h-4 w-4" /> Preciso confirmar:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-900">
                {resultado.perguntas.map((pergunta) => <li key={pergunta}>{pergunta}</li>)}
              </ul>
              <div className="flex gap-2">
                <input
                  value={resposta}
                  onChange={(event) => setResposta(event.target.value)}
                  placeholder="Responda aqui para refinar a interpretação"
                  className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={loading || !resposta.trim()}
                  onClick={() => {
                    const texto = resposta.trim();
                    setResposta("");
                    void interpretar(texto, historico);
                  }}
                >
                  Responder
                </Button>
              </div>
            </div>
          )}

          <Button size="sm" onClick={() => onApply(resultado)} disabled={loading}>
            Aplicar aos campos
          </Button>
        </div>
      )}
    </div>
  );
}