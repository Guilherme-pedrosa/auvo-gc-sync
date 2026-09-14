import { afterEach, describe, expect, it, vi } from "vitest";
import { agendaDateIsInRange, scrollAgendaToDate } from "@/lib/agendaDateNavigation";

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });
describe("navegação por data na agenda", () => {
  it("limita ao período carregado e rejeita datas impossíveis", () => {
    expect(agendaDateIsInRange("2026-09-14", "2026-07-16", "2026-12-12")).toBe(true);
    expect(agendaDateIsInRange("2026-07-16", "2026-07-16", "2026-12-12")).toBe(true);
    expect(agendaDateIsInRange("2026-12-12", "2026-07-16", "2026-12-12")).toBe(true);
    expect(agendaDateIsInRange("2026-12-13", "2026-07-16", "2026-12-12")).toBe(false);
    expect(agendaDateIsInRange("2026-07-15", "2026-07-16", "2026-12-12")).toBe(false);
    expect(agendaDateIsInRange("2026-09-31", "2026-07-16", "2026-12-12")).toBe(false);
  });
  it("alinha o dia escolhido e Hoje descontando a coluna fixa, sem alterar os dados", () => {
    document.body.innerHTML = '<div data-agenda-scroll="1"><table><thead><tr><th>Técnico</th><th data-agenda-date="2026-09-14">Hoje</th><th data-agenda-date="2026-09-28">Escolhida</th></tr></thead></table></div>';
    const container = document.querySelector<HTMLElement>("div")!;
    const headers = [...container.querySelectorAll<HTMLElement>("th")];
    const rect = (left: number, width: number) => ({ left, width }) as DOMRect;
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue(rect(20, 1000));
    vi.spyOn(headers[0], "getBoundingClientRect").mockReturnValue(rect(20, 144));
    vi.spyOn(headers[1], "getBoundingClientRect").mockReturnValue(rect(164, 240));
    vi.spyOn(headers[2], "getBoundingClientRect").mockReturnValue(rect(3524, 240));
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    scrollAgendaToDate("2026-09-28", "smooth");
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 3360, behavior: "smooth" });
    scrollAgendaToDate("2026-09-14");
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: "auto" });
    expect(headers[2].getAttribute("data-agenda-date")).toBe("2026-09-28");
  });
});
