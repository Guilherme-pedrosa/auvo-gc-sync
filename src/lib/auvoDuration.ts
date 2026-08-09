// Auvo lê a duração da tarefa SEMPRE como relógio "HH:mm" (ex.: 20 min => "00:20").
export function minutesToClock(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function clockToMinutes(clock: string): number {
  const [h = "0", m = "0"] = String(clock || "").split(":");
  const total = (Number(h) || 0) * 60 + (Number(m) || 0);
  return Math.max(0, Math.round(total));
}
