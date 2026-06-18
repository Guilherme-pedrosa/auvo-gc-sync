import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import JSZip from "jszip";

export type TelemetriaTech = {
  tecnico: string;
  os_count?: number;
  valor_pecas?: number;
  valor_servicos?: number;
  faturamento?: number;
  comissao_pecas?: number;
  comissao_servicos?: number;
  km_total?: number;
  telemetrias?: number;
  km_por_telemetria?: number | null;
  km_motorista_match?: string | null;
  comissao_total: number;
  comissao_final?: number;
  reducao_pct?: number;
  reducao_valor?: number;
  reducoes?: Array<{ motivo: string; pct: number; valor: number }>;
  meta?: number | null;
  meta_atingida?: boolean;
  bonus_meta_pct?: number;
  bonus_meta_valor?: number;
  bonus_telemetria_pct?: number;
  bonus_telemetria_valor?: number;
  ordens?: Array<{
    gc_os_codigo?: string;
    gc_os_id?: string;
    auvo_link?: string | null;
    gc_link?: string | null;
    cliente?: string;
    data_saida?: string;
    valor_pecas?: number;
    valor_servicos?: number;
    comissao_pecas?: number;
    comissao_servicos?: number;
    comissao_total?: number;
  }>;
  preventivas?: {
    count: number;
    horas: number;
    valor: number;
    atividades: Array<{
      auvo_task_id?: string;
      data?: string;
      cliente?: string;
      contrato?: string | null;
      horas?: number;
      valor_hora?: number;
      valor?: number;
      auvo_link?: string | null;
    }>;
  };
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function sanitize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildPdfForTech(month: string, t: TelemetriaTech): jsPDF {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(`Espelho de Cálculo — ${t.tecnico}`, 40, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Mês de referência: ${month}`, 40, 58);
  doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageW - 40, 58, { align: "right" });

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Regra: 1% peças + 15% serviços (excl. deslocamento). Reduções por KM/telemetria: <40→−30% · 40–70→−25% · 70–100→−20% · 100–120→−15% · ≥120 sem redução. Deméritos somam ao percentual de redução.",
    40,
    74,
    { maxWidth: pageW - 80 }
  );
  doc.setTextColor(0);

  // Quadro de totais
  autoTable(doc, {
      startY: 92,
      head: [["Faturamento", "Peças", "Serviços", "Prem. peças", "Prem. serv.", "Prem. bruta"]],
      body: [[
        brl(t.faturamento ?? (t.valor_pecas ?? 0) + (t.valor_servicos ?? 0)),
        brl(t.valor_pecas ?? 0),
        brl(t.valor_servicos ?? 0),
        brl(t.comissao_pecas ?? 0),
        brl(t.comissao_servicos ?? 0),
        brl(t.comissao_total),
      ]],
      styles: { fontSize: 9, cellPadding: 5, halign: "right" },
      headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold", halign: "right" },
    });

    // Telemetria
    let y = (doc as any).lastAutoTable.finalY + 14;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Telemetria", 40, y);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: y + 4,
      head: [["Motorista TVH", "KM total", "Telemetrias", "KM/telem."]],
      body: [[
        t.km_motorista_match || "—",
        (t.km_total ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
        String(t.telemetrias ?? 0),
        t.km_por_telemetria != null ? t.km_por_telemetria.toFixed(1) : "—",
      ]],
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    });

    // Reduções
    y = (doc as any).lastAutoTable.finalY + 14;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Reduções aplicadas", 40, y);
    doc.setFont("helvetica", "normal");
    const reducoes = t.reducoes || [];
    if (reducoes.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text("Nenhuma redução aplicada.", 40, y + 16);
      doc.setTextColor(0);
      y += 20;
    } else {
      autoTable(doc, {
        startY: y + 4,
        head: [["Motivo", "%", "Valor"]],
        body: [
          ...reducoes.map((r) => [r.motivo, `${Math.round(r.pct * 100)}%`, `−${brl(r.valor)}`]),
          [
            { content: "Total de reduções", styles: { fontStyle: "bold" } },
            { content: `${Math.round((t.reducao_pct || 0) * 100)}%`, styles: { fontStyle: "bold", halign: "right" } },
            { content: `−${brl(t.reducao_valor || 0)}`, styles: { fontStyle: "bold", halign: "right" } },
          ],
        ],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold" },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
      });
      y = (doc as any).lastAutoTable.finalY;
    }

    // Bônus por meta de faturamento (discriminado)
    y += 14;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Bônus por meta de faturamento", 40, y);
    doc.setFont("helvetica", "normal");
    const fat = t.faturamento ?? ((t.valor_pecas ?? 0) + (t.valor_servicos ?? 0));
    const meta = t.meta ?? null;
    const ratio = meta && meta > 0 ? fat / meta : 0;
    const bonusPct = t.bonus_meta_pct || 0;
    const bonusValor = t.bonus_meta_valor || 0;
    if (!meta || meta <= 0) {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text("Sem meta cadastrada para este técnico.", 40, y + 16);
      doc.setTextColor(0);
      y += 20;
    } else {
      const faixa = bonusPct >= 0.135 ? "≥ 111% da meta" :
                    bonusPct >= 0.10  ? "100% – 110% da meta" :
                    bonusPct >= 0.075 ? "75% – 99% da meta" :
                    "< 75% da meta (sem bônus)";
      autoTable(doc, {
        startY: y + 4,
        head: [["Meta", "Faturamento", "Atingimento", "Faixa", "Bônus %", "Bônus R$"]],
        body: [[
          brl(meta),
          brl(fat),
          `${(ratio * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`,
          faixa,
          bonusPct > 0 ? `+${(bonusPct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—",
          bonusValor > 0 ? `+${brl(bonusValor)}` : brl(0),
        ]],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [34, 197, 94], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          0: { halign: "right" }, 1: { halign: "right" }, 2: { halign: "right" },
          4: { halign: "right" }, 5: { halign: "right", fontStyle: "bold" },
        },
      });
      y = (doc as any).lastAutoTable.finalY;
    }

    // Bônus por telemetria (km e km/telem.)
    y += 14;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Bônus por telemetria", 40, y);
    doc.setFont("helvetica", "normal");
    {
      const btPct = t.bonus_telemetria_pct || 0;
      const btVal = t.bonus_telemetria_valor || 0;
      const kmT = t.km_total ?? 0;
      const kmpt = t.km_por_telemetria ?? null;
      const faixaT =
        btPct >= 0.05 ? "≥ 2.000 km e > 200 km/telem." :
        btPct >= 0.03 ? "≥ 800 km e > 150 km/telem." :
        (kmT < 800
          ? "Sem bônus (KM total < 800)"
          : (kmpt == null || kmpt <= 150)
            ? "Sem bônus (KM/telem. ≤ 150)"
            : "Sem bônus");
      autoTable(doc, {
        startY: y + 4,
        head: [["KM total", "KM/telem.", "Faixa", "Bônus %", "Bônus R$"]],
        body: [[
          kmT.toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
          kmpt != null ? kmpt.toFixed(1) : "—",
          faixaT,
          btPct > 0 ? `+${(btPct * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—",
          btVal > 0 ? `+${brl(btVal)}` : brl(0),
        ]],
        styles: { fontSize: 9, cellPadding: 4 },
        headStyles: { fillColor: [16, 185, 129], textColor: 255, fontStyle: "bold" },
        columnStyles: {
          0: { halign: "right" }, 1: { halign: "right" },
          3: { halign: "right" }, 4: { halign: "right", fontStyle: "bold" },
        },
      });
      y = (doc as any).lastAutoTable.finalY;
    }

    // Resultado final
    y += 14;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setFillColor(37, 99, 235);
    doc.setTextColor(255);
    doc.rect(40, y - 4, pageW - 80, 24, "F");
    doc.text("Premiação final", 50, y + 12);
    doc.text(brl(t.comissao_final ?? t.comissao_total), pageW - 50, y + 12, { align: "right" });
    doc.setTextColor(0);
    y += 32;

    // Visitas Preventivas de Contrato
    if (t.preventivas && t.preventivas.count > 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(
        `Visitas Preventivas de Contrato — ${t.preventivas.count} visitas · ${t.preventivas.horas.toFixed(2)}h · ${brl(t.preventivas.valor)}`,
        40,
        y
      );
      doc.setFont("helvetica", "normal");
      autoTable(doc, {
        startY: y + 4,
        head: [["Data", "Cliente", "Contrato", "Horas", "R$/hora", "Valor"]],
        body: [
          ...t.preventivas.atividades.map((a) => [
            a.data || "—",
            a.cliente || "—",
            a.contrato || "—",
            (a.horas ?? 0).toFixed(2),
            (a.valor_hora ?? 0) > 0 ? brl(a.valor_hora ?? 0) : "—",
            brl(a.valor ?? 0),
          ]),
          [
            { content: "TOTAL", styles: { fontStyle: "bold" } },
            { content: "", styles: {} },
            { content: "", styles: {} },
            { content: t.preventivas.horas.toFixed(2), styles: { fontStyle: "bold", halign: "right" } },
            { content: "", styles: {} },
            { content: brl(t.preventivas.valor), styles: { fontStyle: "bold", halign: "right", textColor: [37, 99, 235] } },
          ],
        ],
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
        columnStyles: {
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right", fontStyle: "bold" },
        },
        didDrawCell: (data: any) => {
          if (data.section !== "body") return;
          const a = t.preventivas!.atividades[data.row.index];
          if (!a) return;
          if (data.column.index === 0 && a.auvo_link) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: a.auvo_link });
          }
        },
      });
      y = (doc as any).lastAutoTable.finalY + 14;
    }

    // OS detalhadas
    const ordens = t.ordens || [];
    if (ordens.length > 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("OS consideradas", 40, y);
      doc.setFont("helvetica", "normal");
      autoTable(doc, {
        startY: y + 4,
        head: [["OS", "Cliente", "Saída", "Peças", "Serviços", "Prem. peças", "Prem. serv.", "Total", "Relatório"]],
      body: ordens.map((o) => {
          const vp = o.valor_pecas ?? 0;
          const cp = o.comissao_pecas ?? 0;
          const taxa = vp > 0 ? cp / vp : 0;
          const taxaTxt = vp > 0 ? `${(taxa * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—";
          return [
            o.gc_os_codigo || o.gc_os_id || "—",
            o.cliente || "—",
            o.data_saida || "—",
            brl(vp),
            brl(o.valor_servicos ?? 0),
            `${brl(cp)}  (${taxaTxt})`,
            brl(o.comissao_servicos ?? 0),
            brl(o.comissao_total ?? 0),
            o.auvo_link ? "Abrir" : "—",
          ];
        }),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
        columnStyles: {
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right", fontStyle: "bold" },
          8: { halign: "center", textColor: [37, 99, 235] },
        },
        didDrawCell: (data: any) => {
          if (data.section !== "body") return;
          const o = ordens[data.row.index];
          if (!o) return;
          if (data.column.index === 0 && o.gc_link) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: o.gc_link });
          }
          if (data.column.index === 8 && o.auvo_link) {
            doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url: o.auvo_link });
          }
        },
      });
    }

  // Rodapé
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${pages}`, pageW - 40, pageH - 20, { align: "right" });
  }

  return doc;
}

export function gerarPdfTecnico(month: string, t: TelemetriaTech) {
  const doc = buildPdfForTech(month, t);
  doc.save(`espelho-${sanitize(t.tecnico)}-${month}.pdf`);
}

export async function gerarPdfsTelemetrias(month: string, tecnicos: TelemetriaTech[]) {
  const zip = new JSZip();
  const sorted = [...tecnicos].sort((a, b) => (b.comissao_total || 0) - (a.comissao_total || 0));

  // Resumo unificado
  const resumo = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = resumo.internal.pageSize.getWidth();
  const pageH = resumo.internal.pageSize.getHeight();
  resumo.setFontSize(16);
  resumo.setFont("helvetica", "bold");
  resumo.text(`Resumo de Premiação — ${month}`, 40, 40);
  resumo.setFont("helvetica", "normal");
  resumo.setFontSize(10);
  resumo.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageW - 40, 40, { align: "right" });
  resumo.text(`Técnicos: ${sorted.length}`, 40, 58);

  const totals = sorted.reduce((acc, t) => {
    const fat = t.faturamento ?? ((t.valor_pecas ?? 0) + (t.valor_servicos ?? 0));
    acc.fat += fat;
    acc.bruta += t.comissao_total || 0;
    acc.red += t.reducao_valor || 0;
    acc.bonus += t.bonus_meta_valor || 0;
    acc.final += t.comissao_final ?? t.comissao_total ?? 0;
    return acc;
  }, { fat: 0, bruta: 0, red: 0, bonus: 0, final: 0 });

  autoTable(resumo, {
    startY: 76,
    head: [["Técnico", "OS", "Faturamento", "Meta", "% Meta", "Prem. bruta", "Redução", "Bônus meta", "Premiação final"]],
    body: [
      ...sorted.map((t) => {
        const fat = t.faturamento ?? ((t.valor_pecas ?? 0) + (t.valor_servicos ?? 0));
        const meta = t.meta ?? null;
        const ratio = meta && meta > 0 ? fat / meta : null;
        return [
          t.tecnico,
          String(t.os_count ?? (t.ordens?.length ?? 0)),
          brl(fat),
          meta ? brl(meta) : "—",
          ratio != null ? `${(ratio * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—",
          brl(t.comissao_total || 0),
          (t.reducao_valor || 0) > 0 ? `−${brl(t.reducao_valor || 0)}` : brl(0),
          (t.bonus_meta_valor || 0) > 0 ? `+${brl(t.bonus_meta_valor || 0)}` : brl(0),
          brl(t.comissao_final ?? t.comissao_total ?? 0),
        ];
      }),
      [
        { content: "TOTAL", styles: { fontStyle: "bold" } },
        { content: String(sorted.reduce((a, t) => a + (t.os_count ?? (t.ordens?.length ?? 0)), 0)), styles: { fontStyle: "bold", halign: "right" } },
        { content: brl(totals.fat), styles: { fontStyle: "bold", halign: "right" } },
        { content: "", styles: {} },
        { content: "", styles: {} },
        { content: brl(totals.bruta), styles: { fontStyle: "bold", halign: "right" } },
        { content: `−${brl(totals.red)}`, styles: { fontStyle: "bold", halign: "right" } },
        { content: `+${brl(totals.bonus)}`, styles: { fontStyle: "bold", halign: "right" } },
        { content: brl(totals.final), styles: { fontStyle: "bold", halign: "right" } },
      ],
    ],
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      1: { halign: "right" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right", fontStyle: "bold", textColor: [37, 99, 235] },
    },
  });

  const pages = resumo.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    resumo.setPage(i);
    resumo.setFontSize(8);
    resumo.setTextColor(150);
    resumo.text(`Página ${i} de ${pages}`, pageW - 40, pageH - 20, { align: "right" });
  }
  zip.file(`00-resumo-${month}.pdf`, resumo.output("blob"));

  for (const t of sorted) {
    const doc = buildPdfForTech(month, t);
    const blob = doc.output("blob");
    zip.file(`espelho-${sanitize(t.tecnico)}-${month}.pdf`, blob);
  }
  const content = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(content);
  const a = document.createElement("a");
  a.href = url;
  a.download = `espelhos-premiacao-${month}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// compat
export const gerarPdfTelemetrias = gerarPdfsTelemetrias;