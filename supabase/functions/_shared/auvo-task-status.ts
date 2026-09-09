const AUVO_STATUS: Record<number, string> = {
  1: "Aberta", 2: "Em deslocamento", 3: "Em andamento",
  4: "Finalizada", 5: "Finalizada", 6: "Pausada",
};

/** The current Auvo status takes precedence over historical check-in events. */
export function auvoTaskStatus(task: any): string {
  for (const value of [task?.taskStatus, task?.status]) {
    const rawCode = typeof value === "object" && value !== null
      ? value.id ?? value.status : value;
    const code = Number(rawCode);
    if (AUVO_STATUS[code]) return AUVO_STATUS[code];
    const description = typeof value === "object" && value !== null
      ? value.description : typeof value === "string" && !Number.isFinite(code) ? value : null;
    if (description?.trim()) return description.trim();
  }
  if (task?.finished === true || task?.checkOut === true) return "Finalizada";
  const controls = task?.timeControl ?? task?.TimeControl;
  if (task?.paused === true || (Array.isArray(controls) && controls.some((control: any) =>
    (control.pauseStart || control.startPause) && !(control.pauseEnd || control.endPause || control.resumeDate),
  ))) return "Pausada";
  if (task?.checkIn === true) return "Em andamento";
  return "Agendada";
}
