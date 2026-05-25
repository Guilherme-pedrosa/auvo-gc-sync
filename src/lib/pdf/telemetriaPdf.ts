import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type TelemetriaTech = {
  tecnico: string;
  km_total?: number;
  telemetrias?: number;
  km_por_telemetria?: number | null;
  km_motorista_match?: string | null;
  comissao_total: number;
  comissao_final?: number;
  reducao_pct?: number;
  reducao_valor?: number;
  reducoes?: Array<{ motivo: string; pct: number; valor: number }>;
};

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function gerarPdfTelemetrias(month: string, tecnicos: TelemetriaTech[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("Telemetrias por Técnico", 40, 40);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Mês de referência: ${month}`, 40, 58);
  doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageW - 40, 58, { align: "right" });

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "Faixas de redução por KM/telemetria: <40 km → −30% · 40–70 → −25% · 70–100 → −20% · 100–120 → −15% · ≥120 → sem redução por KM.",
    40,
    74,
    { maxWidth: pageW - 80 }
  );
  doc.setTextColor(0);

  const sorted = [...tecnicos].sort((a, b) => (b.comissao_total || 0) - (a.comissao_total || 0));

  autoTable(doc, {
    startY: 92,
    head: [[
      "Técnico",
      "Motorista TVH",
      "KM total",
      "Telemetrias",
      "KM/telem.",
      "Redução",
      "Prem. bruta",
      "Prem. final",
    ]],
    body: sorted.map((t) => [
      t.tecnico,
      t.km_motorista_match || "—",
      (t.km_total ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 }),
      String(t.telemetrias ?? 0),
      t.km_por_telemetria != null ? t.km_por_telemetria.toFixed(1) : "—",
      (t.reducao_pct ?? 0) > 0 ? `−${Math.round((t.reducao_pct || 0) * 100)}% (${brl(t.reducao_valor || 0)})` : "—",
      brl(t.comissao_total),
      brl(t.comissao_final ?? t.comissao_total),
    ]),
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right", fontStyle: "bold" },
    },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 4) {
        const v = parseFloat(String(data.cell.raw || "").replace(",", "."));
        if (Number.isFinite(v) && v < 120) {
          data.cell.styles.textColor = [200, 30, 30];
          data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  // Detalhamento das reduções por técnico
  let y = (doc as any).lastAutoTable.finalY + 20;
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Detalhamento das reduções", 40, y);
  y += 6;
  doc.setFont("helvetica", "normal");

  const withReducoes = sorted.filter((t) => (t.reducoes || []).length > 0);
  if (withReducoes.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("Nenhum técnico com redução aplicada neste mês.", 40, y + 14);
  } else {
    autoTable(doc, {
      startY: y + 6,
      head: [["Técnico", "Motivo", "%", "Valor"]],
      body: withReducoes.flatMap((t) =>
        (t.reducoes || []).map((r) => [
          t.tecnico,
          r.motivo,
          `${Math.round(r.pct * 100)}%`,
          brl(r.valor),
        ])
      ),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold" },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right" } },
    });
  }

  // Rodapé
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${pages}`, pageW - 40, doc.internal.pageSize.getHeight() - 20, { align: "right" });
  }

  doc.save(`telemetrias-${month}.pdf`);
}