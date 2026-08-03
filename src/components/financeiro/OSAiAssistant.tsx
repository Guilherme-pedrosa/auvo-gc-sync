import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, FolderSearch, Loader2, Send, Wrench } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  buildPartsHistoryContext,
  withBudgetAiTimeout,
  type BudgetAiPartsHistoryPayload,
} from "@/lib/budgetAi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type QuestionnaireAnswer = { question: string; reply: string };

export type OSKanbanAiItem = {
  auvo_task_id: string;
  cliente: string;
  tecnico: string;
  data_tarefa: string;
  descricao: string | null;
  orientacao: string | null;
  gc_os_codigo: string;
  gc_orcamento_codigo: string | null;
  questionario_respostas: QuestionnaireAnswer[] | null;
  equipamento_nome?: string | null;
  equipamento_id_serie?: string | null;
  auvo_equipment_id?: string | null;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  docs?: string[];
  tools?: string[];
  docsError?: string;
};

type Props = {
  os: OSKanbanAiItem;
  osDetail: unknown;
  onOpenParts: () => void;
};

type UnknownRecord = Record<string, unknown>;

const DEFAULT_ANALYSIS =
  "Analise esta OS cruzando as peças e serviços atuais com o histórico deste equipamento, as preventivas e a biblioteca técnica CHAT. Aponte o que está confirmado, os riscos, possíveis incompatibilidades, os testes necessários e cite os arquivos internos usados.";

function normalize(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function usefulReply(answer: QuestionnaireAnswer): boolean {
  const reply = String(answer?.reply || "").trim();
  return Boolean(reply) && !/^https?:\/\//i.test(reply);
}

function answerByQuestion(answers: QuestionnaireAnswer[], terms: string[]): string {
  const values = answers
    .filter(usefulReply)
    .filter((answer) => {
      const question = normalize(answer.question);
      return terms.some((term) => question.includes(term));
    })
    .map((answer) => String(answer.reply || "").trim())
    .filter(Boolean);
  return [...new Set(values)].join(" | ");
}

function extractEquipment(os: OSKanbanAiItem): { name: string; serial: string } {
  const answers = Array.isArray(os.questionario_respostas) ? os.questionario_respostas : [];
  let name = String(os.equipamento_nome || "").trim();
  let serial = String(os.equipamento_id_serie || "").trim();

  if (!name) name = answerByQuestion(answers, ["equip", "modelo", "maquina", "marca"]);
  if (!serial) serial = answerByQuestion(answers, ["patrimon", "serie", "serial", "tag", "placa", "id do equip"]);

  const description = `${os.orientacao || ""}\n${os.descricao || ""}`;
  if (!name) name = description.match(/(?:equipamento|modelo)\s*(?::|-)\s*([^\n;]+)/i)?.[1]?.trim() || "";
  if (!serial) serial = description.match(/(?:patrim[oô]nio|s[eé]rie|serial|tag|placa|id(?: do)? equipamento)\s*(?::|#|-)\s*([^\n;]+)/i)?.[1]?.trim() || "";

  return { name, serial };
}

function asRecord(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? value as UnknownRecord : {};
}

function firstValue(record: UnknownRecord, keys: string[]): unknown {
  return keys.map((key) => record[key]).find((value) => value !== null && value !== undefined && value !== "");
}

function gcItems(detail: unknown, kind: "produto" | "servico"): string {
  const detailRecord = asRecord(detail);
  const source = kind === "produto" ? detailRecord.produtos : detailRecord.servicos;
  const items = (Array.isArray(source) ? source : []).map((entry: unknown) => {
    const entryRecord = asRecord(entry);
    return asRecord(entryRecord[kind] || entryRecord);
  });
  return items
    .map((item) => {
      const name = firstValue(item, ["nome_produto", "nome_servico", "descricao", "nome", "detalhes"]);
      if (!name) return "";
      const code = firstValue(item, ["codigo_interno", "codigo", "referencia"]);
      const quantity = Number(firstValue(item, ["quantidade", "qtd"]) || 1);
      return `${quantity}x ${String(name).trim()}${code ? ` [cód. ${code}]` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

export default function OSAiAssistant({ os, osDetail, onOpenParts }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const historyCache = useRef(new Map<string, BudgetAiPartsHistoryPayload>());
  const equipment = useMemo(() => extractEquipment(os), [os]);
  const products = useMemo(() => gcItems(osDetail, "produto"), [osDetail]);
  const services = useMemo(() => gcItems(osDetail, "servico"), [osDetail]);

  const answers = useMemo(
    () => (Array.isArray(os.questionario_respostas) ? os.questionario_respostas : []),
    [os.questionario_respostas],
  );
  const questionnaireParts = useMemo(
    () => answerByQuestion(answers, ["peca", "peças", "material", "componente"]),
    [answers],
  );
  const questionnaireServices = useMemo(
    () => answerByQuestion(answers, ["servico", "serviço", "mao de obra"]),
    [answers],
  );
  const observations = useMemo(
    () => answerByQuestion(answers, ["observ", "diagnost", "defeito", "descricao", "descrição"]),
    [answers],
  );

  const currentParts = [questionnaireParts, products].filter(Boolean).join("\n");
  const currentServices = [questionnaireServices, services].filter(Boolean).join("\n");

  useEffect(() => {
    setMessages([]);
    setInput("");
  }, [os.auvo_task_id]);

  const fetchHistory = async () => {
    const key = equipment.serial || os.auvo_equipment_id || os.auvo_task_id;
    if (historyCache.current.has(key)) return historyCache.current.get(key);

    try {
      const { data, error } = await withBudgetAiTimeout(
        supabase.functions.invoke("equipamento-pecas", {
          body: {
            auvo_equipment_id: os.auvo_equipment_id || undefined,
            identificador: equipment.serial || undefined,
            auvo_task_id: os.auvo_task_id,
            nome: equipment.name || undefined,
          },
        }),
        50000,
      );
      if (error || !data?.ok) throw error || new Error(data?.error || "Falha no histórico de peças");
      const history = data as BudgetAiPartsHistoryPayload;
      historyCache.current.set(key, history);
      return history;
    } catch (error) {
      console.warn("[os-kanban-ai] Histórico de peças indisponível:", error);
      return null;
    }
  };

  const sendMessage = async (question?: string) => {
    const userMessage = String(question || input).trim();
    if (!userMessage || loading) return;

    const previousMessages = messages;
    setMessages((current) => [...current, { role: "user", content: userMessage }]);
    setInput("");
    setLoading(true);

    try {
      const history = await fetchHistory();
      const historyContext = buildPartsHistoryContext(
        history,
        [currentParts, currentServices].filter(Boolean).join("\n"),
      );
      const { data, error } = await withBudgetAiTimeout(
        supabase.functions.invoke("genspark-ai", {
          body: {
            action: "chat",
            context: {
              source: "kanban_os",
              use_internal_docs: true,
              cliente: os.cliente,
              tecnico: os.tecnico,
              equipamento: equipment.name,
              equipamento_id: equipment.serial,
              equipamento_serie: equipment.serial,
              auvo_equipment_id: os.auvo_equipment_id || "",
              auvo_task_id: os.auvo_task_id,
              gc_os_codigo: os.gc_os_codigo,
              gc_orcamento_codigo: os.gc_orcamento_codigo || "",
              data_tarefa: os.data_tarefa,
              orientacao: os.orientacao || os.descricao || "",
              pecas: currentParts,
              servicos: currentServices,
              observacoes: observations || os.descricao || "",
              historico_pecas: historyContext?.text || "",
            },
            analysis: "",
            userMessage,
            chatHistory: previousMessages.slice(-8).map(({ role, content }) => ({ role, content })),
          },
        }),
        120000,
      );

      if (error || data?.error || data?.errorCode || !data?.result) {
        throw error || new Error(data?.message || data?.error || "A IA não retornou uma resposta válida");
      }

      setMessages((current) => [...current, {
        role: "assistant",
        content: String(data.result),
        docs: Array.isArray(data.docs_titles) ? data.docs_titles : [],
        tools: Array.isArray(data.tools_used) ? [...new Set<string>(data.tools_used)] : [],
        docsError: typeof data.docs_error === "string" ? data.docs_error : undefined,
      }]);
    } catch (error: unknown) {
      console.error("[os-kanban-ai] Falha:", error);
      const errorMessage = error instanceof Error ? error.message : "";
      toast.error(errorMessage === "AI_REQUEST_TIMEOUT"
        ? "A análise técnica excedeu o tempo máximo. Tente novamente."
        : "Não foi possível concluir a análise técnica desta OS.");
      setMessages((current) => [...current, {
        role: "assistant",
        content: "A consulta não foi concluída. Nenhuma recomendação foi gerada para evitar resposta sem evidência.",
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex flex-wrap items-center gap-2 border-b border-sky-200 px-3 py-2 dark:border-sky-900">
        <Bot className="h-4 w-4 text-sky-700 dark:text-sky-300" />
        <span className="text-sm font-semibold">IA técnica da OS</span>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <FolderSearch className="h-3 w-3" /> Biblioteca CHAT
        </Badge>
        <Badge variant="outline" className="gap-1 text-[10px]">
          <Wrench className="h-3 w-3" /> Histórico do equipamento
        </Badge>
        <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={onOpenParts}>
          Ver rastreio de peças
        </Button>
      </div>

      <div className="space-y-3 p-3">
        {!equipment.name && !equipment.serial && (
          <div className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Equipamento/modelo não identificado no card. A IA consultará a tarefa, mas a busca de manuais ficará menos precisa.
          </div>
        )}

        {messages.length === 0 && (
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <span>
              Cruza esta OS com peças já usadas, preventivas, Controle OS e os arquivos internos por marca/modelo.
            </span>
            <Button type="button" size="sm" onClick={() => sendMessage(DEFAULT_ANALYSIS)} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Bot className="mr-2 h-4 w-4" />}
              Analisar esta OS
            </Button>
          </div>
        )}

        {messages.length > 0 && (
          <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={message.role === "user"
                  ? "ml-8 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                  : "mr-4 rounded-md border bg-background px-3 py-2 text-sm"}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                {message.role === "assistant" && ((message.docs?.length || 0) > 0 || (message.tools?.length || 0) > 0 || message.docsError) && (
                  <div className="mt-2 space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
                    {(message.docs?.length || 0) > 0 && (
                      <div><strong>Arquivos CHAT:</strong> {message.docs?.join(" · ")}</div>
                    )}
                    {(message.tools?.length || 0) > 0 && (
                      <div><strong>Consultas do sistema:</strong> {message.tools?.join(" · ")}</div>
                    )}
                    {message.docsError && (
                      <div className="text-amber-700 dark:text-amber-300"><strong>Biblioteca CHAT indisponível:</strong> {message.docsError}</div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-4 flex items-center gap-2 rounded-md border bg-background px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Consultando histórico, preventivas e biblioteca CHAT...
              </div>
            )}
          </div>
        )}

        {messages.length > 0 && (
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Pergunte sobre peça, falha, preventiva, código ou procedimento..."
              className="min-h-[68px] resize-none bg-background"
              disabled={loading}
            />
            <Button type="button" size="icon" onClick={() => sendMessage()} disabled={loading || !input.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
