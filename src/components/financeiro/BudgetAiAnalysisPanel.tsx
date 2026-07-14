import { AlertTriangle, CheckCircle2, CircleHelp, FileSearch, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { BudgetAiResponseMeta, BudgetAiStructuredAnalysis } from "@/lib/budgetAi";

type Props = {
  analysis: BudgetAiStructuredAnalysis | null;
  legacyText: string | null;
  fallback: boolean;
  meta: BudgetAiResponseMeta | null;
};

const statusLabel: Record<BudgetAiStructuredAnalysis["status"], string> = {
  pode_seguir: "Orçamento pode seguir",
  pode_seguir_com_ressalvas: "Pode seguir com ressalvas",
  validacao_adicional: "Validação adicional necessária",
};

export default function BudgetAiAnalysisPanel({ analysis, legacyText, fallback, meta }: Props) {
  if (fallback) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        <div className="mb-1 flex items-center gap-1.5 font-semibold">
          <AlertTriangle className="h-4 w-4" /> A IA não concluiu esta análise
        </div>
        <p className="whitespace-pre-wrap">{legacyText || "Revise os dados técnicos manualmente e tente novamente."}</p>
      </div>
    );
  }

  if (!analysis) {
    return <div className="whitespace-pre-wrap text-sm leading-relaxed text-purple-900">{legacyText}</div>;
  }

  const statusVariant = analysis.status === "pode_seguir" ? "default" : analysis.status === "validacao_adicional" ? "destructive" : "secondary";

  return (
    <div className="space-y-4 text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusVariant}>{statusLabel[analysis.status]}</Badge>
        <Badge variant="outline">Confiança do equipamento: {analysis.equipment.confidence}</Badge>
      </div>

      <p className="font-medium leading-relaxed">{analysis.summary}</p>

      <section className="rounded-md border bg-background p-3">
        <h5 className="mb-2 flex items-center gap-1.5 font-semibold"><FileSearch className="h-4 w-4" /> Equipamento identificado</h5>
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          <div><span className="text-muted-foreground">Equipamento:</span> {analysis.equipment.name || "Não identificado"}</div>
          <div><span className="text-muted-foreground">Fabricante:</span> {analysis.equipment.manufacturer || "Não identificado"}</div>
          <div><span className="text-muted-foreground">Modelo:</span> {analysis.equipment.model || "Não identificado"}</div>
          <div><span className="text-muted-foreground">ID/Série:</span> {analysis.equipment.id || "Não informado"}</div>
        </div>
        {analysis.equipment.evidence && <p className="mt-2 text-xs text-muted-foreground">Base: {analysis.equipment.evidence}</p>}
      </section>

      {(analysis.readiness.reasons.length > 0 || analysis.readiness.missing.length > 0) && (
        <section className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <h5 className="mb-2 flex items-center gap-1.5 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Pendências antes do orçamento</h5>
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-950">
            {[...analysis.readiness.reasons, ...analysis.readiness.missing].map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
          </ul>
        </section>
      )}

      {analysis.facts.length > 0 && (
        <section>
          <h5 className="mb-2 flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Fatos sustentados pelos dados</h5>
          <div className="space-y-2">
            {analysis.facts.map((fact, index) => (
              <div key={index} className="rounded-md border bg-background p-2.5">
                <div>{fact.statement}</div>
                <div className="mt-1 text-xs text-muted-foreground">Evidência: {fact.evidence} · Fonte: {fact.source}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.hypotheses.length > 0 && (
        <section>
          <h5 className="mb-2 flex items-center gap-1.5 font-semibold"><CircleHelp className="h-4 w-4 text-amber-600" /> Hipóteses — precisam de validação</h5>
          <div className="space-y-2">
            {analysis.hypotheses.map((hypothesis, index) => (
              <div key={index} className="rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
                <div>{hypothesis.statement}</div>
                <div className="mt-1 text-xs text-muted-foreground">{hypothesis.reason} · Confiança: {hypothesis.confidence}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.recommendations.length > 0 && (
        <section>
          <h5 className="mb-2 flex items-center gap-1.5 font-semibold"><Wrench className="h-4 w-4 text-blue-600" /> Itens e ações sugeridos</h5>
          <div className="space-y-2">
            {analysis.recommendations.map((recommendation, index) => (
              <div key={index} className="rounded-md border bg-background p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{recommendation.status}</Badge>
                  <span className="font-medium">{recommendation.item}</span>
                </div>
                <p className="mt-1 text-xs">{recommendation.reason}</p>
                <p className="mt-1 text-xs text-muted-foreground">Base: {recommendation.evidence} · Fonte: {recommendation.source} · Confiança: {recommendation.confidence}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {analysis.observation_suggested && (
        <section className="rounded-md border bg-background p-3">
          <h5 className="mb-2 font-semibold">Observação técnica sugerida</h5>
          <p className="whitespace-pre-wrap text-xs leading-relaxed">{analysis.observation_suggested}</p>
        </section>
      )}

      {analysis.questions.length > 0 && (
        <section>
          <h5 className="mb-2 font-semibold">Perguntas que destravam o orçamento</h5>
          <ol className="list-decimal space-y-1 pl-5 text-xs">
            {analysis.questions.map((question, index) => <li key={index}>{question}</li>)}
          </ol>
        </section>
      )}

      {meta && (
        <div className="border-t pt-2 text-[10px] text-muted-foreground">
          Modelo: {meta.model || "não informado"} · Modo: {meta.mode || "standard"} · Fotos usadas: {meta.photos_used ?? 0}/{meta.photos_received ?? 0} · Docs: {meta.docs ?? 0} · Web: {meta.web ? "sim" : "não"} · {meta.elapsed_ms ?? 0} ms
        </div>
      )}
    </div>
  );
}
