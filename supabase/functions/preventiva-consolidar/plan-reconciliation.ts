export type PreventiveSnapshot = {
  ultima_preventiva: string | null;
  ultima_preventiva_task_id: string | null;
  proxima_preventiva: string | null;
};

export type PreventivePlanCache = {
  ultima_execucao_data: string | null;
  ultima_execucao_task_id: string | null;
  proxima_data: string | null;
};

export type PreventivePlanPatch = Partial<PreventivePlanCache>;

function isoDate(value: string | null | undefined): string {
  return value?.slice(0, 10) || "";
}

export function buildPreventivePlanPatch(
  plan: PreventivePlanCache,
  snapshot: PreventiveSnapshot,
): PreventivePlanPatch | null {
  const last = isoDate(snapshot.ultima_preventiva);
  if (!last) return null;

  const cachedLast = isoDate(plan.ultima_execucao_data);
  const patch: PreventivePlanPatch = {};

  if (
    cachedLast !== last
    || plan.ultima_execucao_task_id !== snapshot.ultima_preventiva_task_id
  ) {
    patch.ultima_execucao_data = last;
    patch.ultima_execucao_task_id = snapshot.ultima_preventiva_task_id;
  }

  const cachedNext = isoDate(plan.proxima_data);
  const correctNext = isoDate(snapshot.proxima_preventiva);
  if (cachedNext && cachedNext <= last && correctNext) {
    patch.proxima_data = correctNext;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
