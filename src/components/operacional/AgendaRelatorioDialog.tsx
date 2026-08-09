import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Loader2, Calendar as CalendarIcon } from "lucide-react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isWithinInterval, parseISO, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { gerarPdfAgenda, AgendaRelatorioItem } from "@/lib/pdf/agendaPdf";
import { AgendaAgendamento } from "@/hooks/operacional/useAgendamentoEquipe";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agendamentos: AgendaAgendamento[];
  veiculoDias: any[];
}

export default function AgendaRelatorioDialog({ open, onOpenChange, agendamentos, veiculoDias }: Props) {
  const [tipo, setTipo] = useState<"diario" | "amanha" | "semanal" | "mensal" | "selecionar">("semanal");
  const [dataSelecionada, setDataSelecionada] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    try {
      const hoje = new Date();
      let inicio: Date;
      let fim: Date;
      let labelPeriodo = "";

      if (tipo === "diario") {
        inicio = hoje;
        fim = hoje;
        labelPeriodo = format(hoje, "dd/MM/yyyy");
      } else if (tipo === "amanha") {
        inicio = addDays(hoje, 1);
        fim = addDays(hoje, 1);
        labelPeriodo = format(inicio, "dd/MM/yyyy");
      } else if (tipo === "selecionar") {
        const data = dataSelecionada || hoje;
        inicio = data;
        fim = data;
        labelPeriodo = format(data, "dd/MM/yyyy");
      } else if (tipo === "semanal") {
        inicio = startOfWeek(dataSelecionada || hoje, { weekStartsOn: 1 });
        fim = endOfWeek(dataSelecionada || hoje, { weekStartsOn: 1 });
        labelPeriodo = `${format(inicio, "dd/MM")} a ${format(fim, "dd/MM/yyyy")}`;
      } else {
        inicio = startOfMonth(dataSelecionada || hoje);
        fim = endOfMonth(dataSelecionada || hoje);
        labelPeriodo = format(dataSelecionada || hoje, "MMMM yyyy", { locale: ptBR });
      }

      const filtrados = agendamentos.filter((a) => {
        const d = parseISO(a.data);
        // Ajustamos para considerar apenas a data (sem hora) para evitar problemas de fuso no início/fim do dia
        const start = new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate(), 0, 0, 0);
        const end = new Date(fim.getFullYear(), fim.getMonth(), fim.getDate(), 23, 59, 59);
        return isWithinInterval(d, { start, end });
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
          horario: a.hora_inicio && a.hora_fim ? `${a.hora_inicio.slice(0, 5)} - ${a.hora_fim.slice(0, 5)}` : "08:00 - 18:00",
          cliente: a.cliente,
          descricao: a.descricao || undefined,
          auvo_task_id: a.auvo_task_id || undefined,
          gc_codigo: a.gc_os_codigo || a.gc_orcamento_codigo || undefined,
          origem: a.origem || "MANUAL"
        };
      });

      // Ordena por data e depois por técnico
      itens.sort((x, y) => x.data.localeCompare(y.data) || x.tecnico.localeCompare(y.tecnico));

      if (itens.length === 0) {
        toast.warning("Não há agendamentos no período selecionado.");
        return;
      }

      await gerarPdfAgenda(
        `Relatório Coletivo de Agendamento — ${tipo.toUpperCase()}`,
        labelPeriodo,
        itens
      );
      toast.success("PDF coletivo gerado com sucesso.");
      onOpenChange(false);
    } catch (err) {
      console.error(err);
      toast.error("Não foi possível gerar o PDF coletivo. Tente novamente.");
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
            <Label>Selecione a Data Referência</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !dataSelecionada && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dataSelecionada ? format(dataSelecionada, "PPP", { locale: ptBR }) : <span>Selecione uma data</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={dataSelecionada}
                  onSelect={setDataSelecionada}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
            <p className="text-[10px] text-muted-foreground">
              Esta data servirá como base para os cálculos de "Semana" ou "Mês" abaixo.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Tipo de Exportação</Label>
            <Select value={tipo} onValueChange={(v: any) => setTipo(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="selecionar">O Dia Selecionado</SelectItem>
                <SelectItem value="diario">Hoje ({format(new Date(), "dd/MM")})</SelectItem>
                <SelectItem value="amanha">Amanhã ({format(addDays(new Date(), 1), "dd/MM")})</SelectItem>
                <SelectItem value="semanal">A Semana da data acima</SelectItem>
                <SelectItem value="mensal">O Mês da data acima</SelectItem>
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
