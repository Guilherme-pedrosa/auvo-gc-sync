// Dias úteis (seg-sex) excluindo feriados nacionais brasileiros.

function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export function brazilianHolidays(year: number): Set<string> {
  const easter = easterSunday(year);
  const pad = (value: number) => String(value).padStart(2, "0");
  const fixed = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  const dates = fixed.map((item) => `${year}-${item}`);
  dates.push(iso(shift(easter, -48))); // carnaval segunda
  dates.push(iso(shift(easter, -47))); // carnaval terça
  dates.push(iso(shift(easter, -2))); // sexta-feira santa
  dates.push(iso(shift(easter, 60))); // corpus christi
  return new Set(dates.map((item) => item.replace(/-(\d)-/g, (_, d) => `-${pad(Number(d))}-`)));
}

/** Conta dias úteis (seg-sex, sem feriados nacionais) no intervalo inclusivo. */
export function countBusinessDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  const holidays = new Set<string>();
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    for (const day of brazilianHolidays(year)) holidays.add(day);
  }
  let total = 0;
  for (let cursor = start; cursor <= end; cursor = shift(cursor, 1)) {
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    if (holidays.has(iso(cursor))) continue;
    total++;
  }
  return total;
}

export const DAILY_WORK_HOURS = 8;
