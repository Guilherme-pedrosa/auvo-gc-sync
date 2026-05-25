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
  ordens?: Array<{
    gc_os_codigo?: string;
    gc_os_id?: string;
    cliente?: string;
    data_saida?: string;
    valor_pecas?: number;
    valor_servicos?: number;
    comissao_pecas?: number;
    comissao_servicos?: number;
    comissao_total?: number;
  }>;
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
      head: [["Faturamento", "Peças", "Serviços", "Prem. peças (1%)", "Prem. serv.", "Prem. bruta"]],
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

    // OS detalhadas
    const ordens = t.ordens || [];
    if (ordens.length > 0) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text("OS consideradas", 40, y);
      doc.setFont("helvetica", "normal");
      autoTable(doc, {
        startY: y + 4,
        head: [["OS", "Cliente", "Saída", "Peças", "Serviços", "Prem. peças", "Prem. serv.", "Total"]],
        body: ordens.map((o) => [
          o.gc_os_codigo || o.gc_os_id || "—",
          o.cliente || "—",
          o.data_saida || "—",
          brl(o.valor_pecas ?? 0),
          brl(o.valor_servicos ?? 0),
          brl(o.comissao_pecas ?? 0),
          brl(o.comissao_servicos ?? 0),
          brl(o.comissao_total ?? 0),
        ]),
        styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [240, 240, 245], textColor: 30, fontStyle: "bold" },
        columnStyles: {
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
          6: { halign: "right" },
          7: { halign: "right", fontStyle: "bold" },
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