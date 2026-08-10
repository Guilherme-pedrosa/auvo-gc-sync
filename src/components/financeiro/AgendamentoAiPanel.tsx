import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Bot, Loader2, Send, Sparkles, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ChatMsg = { role: "user" | "assistant"; content: string; tools?: string[] };

type Props = {
  /** Resumo textual do quadro atual, enviado como contexto para a IA. */
  boardSummary: string;
  /** Métricas rápidas exibidas no cabeçalho do painel. */
  contexto: Record<string, unknown>;
};

const PLANO_PROMPT = `Você é o planejador de agendamentos da assistência técnica.
Com base no quadro abaixo e nas ferramentas que você tem (Controle OS, preventivas, peças do GestãoClick, equipamentos, observações de OS), monte uma recomendação de agendamento.
Responda em português, objetivo, nesta estrutura:
1. Prioridade imediata (até 5 OS, com motivo: valor, atraso, peça já chegada, risco de retorno)
2. Agrupamentos por cliente/região que valem uma única visita
3. Orçamentos travados em compra/chegada que precisam de cobrança do comprador
4. Riscos e o que confirmar antes de agendar
Cite sempre número da OS/orçamento, cliente e valor. Não invente dados: se faltar informação, diga o que consultar.`;

export default function AgendamentoAiPanel({ boardSummary, contexto }: Props) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const ask = async (userMessage: string, visible: string) => {
    if (loading) return;
    const history = messages.slice(-8);
    setMessages((prev) => [...prev, { role: "user", content: visible }]);
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("genspark-ai", {
        body: {
          action: "chat",
          context: { ...contexto, modulo: "agendamento", quadro: boardSummary },
          analysis: boardSummary,
          userMessage,
          chatHistory: history,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: String(data?.result || "Sem resposta."), tools: data?.tools_used || [] },
      ]);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: 9e6, behavior: "smooth" }));
    } catch (e: any) {
      const msg = String(e?.message || e);
      toast.error(msg.includes("429") ? "Limite de uso da IA atingido. Tente em instantes." : `Erro na IA: ${msg}`);
      setMessages((prev) => [...prev, { role: "assistant", content: `Não consegui responder agora: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="h-4 w-4 text-primary" /> Copiloto de agendamento
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading}
          onClick={() => ask(`${PLANO_PROMPT}\n\nQUADRO ATUAL:\n${boardSummary}`, "Montar plano de agendamento")}
        >
          {loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
          Plano do dia
        </Button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Peça um plano do dia ou pergunte livremente — a IA consulta Controle OS, preventivas, peças do
              GestãoClick (incluindo rastreamento Pick & Pack), equipamentos e observações antes de responder.
            </p>
          )}
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-md px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                m.role === "user" ? "bg-primary/10 text-foreground" : "bg-muted text-foreground",
              )}
            >
              {m.content}
              {!!m.tools?.length && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {m.tools.map((t) => (
                    <Badge key={t} variant="outline" className="gap-1 text-[10px]">
                      <Wrench className="h-2.5 w-2.5" /> {t}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando os módulos...
            </div>
          )}
        </div>
      </div>

      <form
        className="flex items-center gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = input.trim();
          if (!text) return;
          setInput("");
          ask(`${text}\n\nQUADRO ATUAL:\n${boardSummary}`, text);
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ex.: quais OS da Rede IZ posso fechar em uma visita?"
          className="h-8 text-xs"
          disabled={loading}
        />
        <Button type="submit" size="icon" className="h-8 w-8" disabled={loading || !input.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}