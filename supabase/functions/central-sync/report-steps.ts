import { readGcOsForReconciliation, type GcOsReconciliationWarning } from "./gc-os-reconciliation.ts";

type Dependencies = {
  fetchOs: (headers: Record<string, string>, options: any) => Promise<any>;
  saveOs: (sb: any, result: any) => Promise<number>;
  backlink: (sb: any, os: any, budgets: any, strict: boolean) => Promise<any>;
  fetchBudgets: (headers: Record<string, string>, os: any, sb: any, limit: number, strict: boolean) => Promise<any>;
  getOs: (id: string) => Promise<Response>;
  mapOs: (os: any) => any;
  mirrorPatch: (os: any) => any;
};

const ids = (values: unknown) => Array.isArray(values)
  ? [...new Set(values.map(String).filter(value => /^\d+$/.test(value)))] : [];

// The report calls one bounded step at a time. A page never includes the
// potentially slow budget searches or the month's Auvo task import.
export async function runBoundedReportStep(sb: any, headers: Record<string, string>, body: any, deps: Dependencies) {
  const stage = body.report_step;
  const situationIds = ids(body.situacao_ids);
  if (stage === "os_page") {
    const page = Number(body.report_page || 1);
    if (situationIds.length !== 1 || !Number.isInteger(page) || page < 1 || page > 500) throw new Error("Lote de OS inválido.");
    const result = await deps.fetchOs(headers, { situacaoIds: situationIds, reportPage: page });
    await deps.backlink(sb, result, null, true);
    const upserted = await deps.saveOs(sb, result);
    const orders: any[] = Object.values(result.byCodigo || {});
    return {
      success: true, report_step: stage, upserted, next_page: result.nextPage,
      os_ids: orders.map(os => String(os.gc_os_id)),
      budget_codes: ids(orders.map(os => os.gc_os_orcamento_codigo)),
    };
  }

  if (stage === "budgets") {
    const codes = ids(body.budget_codes);
    if (!codes.length || codes.length > 3) throw new Error("O lote deve conter de um a três orçamentos.");
    const reference = { byCodigo: Object.fromEntries(codes.map(code => [code, { gc_os_orcamento_codigo: code }])) };
    const budgets = await deps.fetchBudgets(headers, reference, sb, 3, true);
    const result = await deps.backlink(sb, null, budgets, true);
    return { success: true, report_step: stage, ...result };
  }

  if (stage === "os_reconcile") {
    if (!situationIds.length || situationIds.length > 30) throw new Error("Situações para conferência inválidas.");
    const known = new Set(ids(body.known_os_ids));
    const after = String(body.after_os_id || "");
    if (after && !/^\d+$/.test(after)) throw new Error("Cursor de conferência inválido.");
    const pending = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("tarefas_central").select("gc_os_id,mirror_key")
        .in("gc_os_situacao_id", situationIds).not("gc_os_id", "is", null)
        .order("gc_os_id", { ascending: true }).order("mirror_key", { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`Falha ao ler OS para conferência: ${error.message}`);
      for (const row of data || []) {
        const id = String(row.gc_os_id || "");
        if (/^\d+$/.test(id) && id > after && !known.has(id)) pending.add(id);
      }
      if ((data || []).length < 1000) break;
    }
    const candidates = [...pending].sort();
    const batch = candidates.slice(0, 5);
    const warnings: GcOsReconciliationWarning[] = [];
    let transitioned = 0;
    for (const id of batch) {
      const result = await readGcOsForReconciliation(id, deps.getOs);
      if (result.kind === "unavailable") {
        warnings.push(result.warning);
        continue;
      }
      let patch;
      if (result.kind === "missing") {
        patch = { gc_os_situacao: "EXCLUÍDA NO GC", gc_os_situacao_id: "", atualizado_em: new Date().toISOString() };
      } else {
        patch = deps.mirrorPatch(deps.mapOs(result.os));
      }
      const { error } = await sb.from("tarefas_central").update(patch).eq("gc_os_id", id);
      if (error) throw new Error(`Falha ao atualizar situação da OS ${id}: ${error.message}`);
      transitioned++;
    }
    return { success: true, report_step: stage, checked: batch.length, transitioned, warnings,
      incomplete: warnings.length > 0, next_after: candidates.length > batch.length ? batch.at(-1) : null };
  }
  throw new Error("Etapa de sincronização desconhecida.");
}
