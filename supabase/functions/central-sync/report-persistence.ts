// GC refreshes must not reset the technician, schedule, execution or questionnaire.
export async function persistGcShells(sb: any, shells: any[]): Promise<number> {
  let saved = 0;
  for (let from = 0; from < shells.length; from += 5) {
    const batch = shells.slice(from, from + 5);
    const { data: existing, error: readError } = await sb.from("tarefas_central")
      .select("mirror_key,gc_os_id").in("gc_os_id", batch.map(row => row.gc_os_id));
    if (readError) throw new Error(`Falha ao conferir OS existentes: ${readError.message}`);
    const orderIds = new Set((existing || []).map((row: any) => String(row.gc_os_id)));
    const missing = batch.filter(row => !orderIds.has(String(row.gc_os_id)));
    if (missing.length) {
      // A concurrent sync may insert the row after our read. Never overwrite it.
      const { error } = await sb.from("tarefas_central").upsert(missing, {
        onConflict: "mirror_key", ignoreDuplicates: true, defaultToNull: false,
      });
      if (error) throw new Error(`Falha ao gravar novas OS: ${error.message}`);
    }
    for (const row of batch) {
      const patch = Object.fromEntries(Object.entries(row)
        .filter(([key]) => key.startsWith("gc_os_") || key === "os_realizada" || key === "atualizado_em"));
      const { error } = await sb.from("tarefas_central").update(patch).eq("gc_os_id", row.gc_os_id);
      if (error) throw new Error(`Falha ao atualizar OS ${row.gc_os_codigo}: ${error.message}`);
      saved++;
    }
  }
  return saved;
}

export async function persistReportTasks(sb: any, rows: any[]): Promise<number> {
  let saved = 0;
  // Each row runs contract reconciliation triggers. Large statements timed out
  // and rolled back the whole batch even though the screen announced success.
  for (let from = 0; from < rows.length; from += 5) {
    const batch = rows.slice(from, from + 5);
    const { error } = await sb.from("tarefas_central").upsert(batch, {
      onConflict: "mirror_key", ignoreDuplicates: false, defaultToNull: false,
    });
    if (error) throw new Error(`Falha ao salvar tarefas do lote ${from + 1}: ${error.message}`);
    saved += batch.length;
  }
  return saved;
}
