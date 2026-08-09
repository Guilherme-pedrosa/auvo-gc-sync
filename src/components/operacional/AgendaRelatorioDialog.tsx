import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2 } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { gerarPdfAgenda, AgendaRelatorioItem } from "@/lib/pdf/agendaPdf";
import { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agendamentos: AgendaAgendamento[];
  veiculoDias: any[];
}

export default function AgendaRelatorioDialog({ open, onOpenChange, agendamentos, veiculoDias }: Props) {
  const [tipo, setTipo] = useState<"diario" | "semanal" | "mensal">("semanal");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const hoje = new Date();
      let inicio: Date;
      let fim: Date;
      let labelPeriodo = "";

      if (tipo === "diario") {
        inicio = hojefim = hoje;
        labelPeriodo = format(hoje, "dd/MM/yyyy");
      } else if (tipo === "semanal") {
        inicio = startOfWeek(hoje, { weekStartsOn: 1 });
        fim = endOfWeek(hoje, { weekStartsOn: 1 });
        labelPeriodo = `${format(inicio, "dd/MM")} a ${format(fim, "dd/MM/yyyy")}`;
      } else {
        inicio = startOfMonth(hoje);
        fim = endOfMonth(hoje);
        labelPeriodo = format(hoje, "MMMM yyyy", { locale: ptBR });
      }

      const filtrados = agendamentos.filter((a) => {
        const d = parseISO(a.data);
        return isWithinInterval(d, { start: inicio, end: fim });
      });

      // Mapeia veículos por técnico e dia
      const mapVei = new Map<string, string>();
      veiculoDias.forEach((vd) => {
        mapVei.set(`${vd.data}|${vd.veiculo_id}`, vd.texto);
      });

      const itens: AgendaRelatorioItem[] = filtrados.map((a) => {
        // Tenta encontrar se o técnico está associado a algum veículo nesse dia
        // Como o agendamento local nem sempre tem o veículo_id direto no objeto 'a' 
        // (às vezes está na tabela agenda_veiculo_dia que é texto livre),
        // vamos buscar se o técnico aparece em algum veículo
        // No modelo atual, o veículo_id está no agendamento se selecionado no modal
        
        return {
          data: a.data,
          tecnico: a.colaborador_nome,
          horario: `${a.hora_inicio.slice(0, 5)} - ${a.hora_fim.slice(0, 5)}`,
          cliente: a.cliente,
          descricao: a.descricao || undefined,
          auvo_task_id: a.auvo_task_id || undefined,
          gc_codigo: a.gc_os_codigo || a.gc_orcamento_codigo || undefined,
          origem: a.origem || "MANUAL"
        };
      });

      // Ordena por data e depois por técnico
      itens.sort((x, y) => x.data.localeCompare(y.data) || x.tecnico.localeCompare(y.tecnico));

      await gerarPdfAgenda(
        `Relatório Coletivo de Agendamento — ${tipo.toUpperCase()}`,
        labelPeriodo,
        itens
      );
      onOpenChange(false);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Exportar Agendamento
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label>Tipo de Exportação</Label>
            <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="diario">Diário (Hoje)</SelectItem>
                <SelectItem value="semanal">Semanal (Esta semana)</SelectItem>
                <SelectItem value="mensal">Mensal (Este mês)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            O arquivo PDF conterá a escala de todos os técnicos no período selecionado, seguindo o modelo do espelho de premiação.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleExport} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
            Gerar PDF Coletivo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
