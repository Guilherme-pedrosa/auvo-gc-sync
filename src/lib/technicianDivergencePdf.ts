import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { TechnicianDivergenceRecord } from "./technicianDivergences";

export function exportTechnicianDivergencesPdf(records: TechnicianDivergenceRecord[], periodLabel: string) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  doc.setFontSize(15);
  doc.text(`Divergências de execução — ${periodLabel}`, 14, 15);
  doc.setFontSize(8);
  doc.setTextColor(90, 90, 90);
  doc.text(`Gerado em ${new Date().toLocaleString("pt-BR")} · critérios: agenda, formulário, relato técnico e mínimo de 3 fotos`, 14, 21);
  doc.setTextColor(0, 0, 0);

  const grouped = new Map<string, TechnicianDivergenceRecord[]>();
  for (const record of records) {
    const list = grouped.get(record.technicianName) || [];
    list.push(record);
    grouped.set(record.technicianName, list);
  }

  let startY = 29;
  for (const [technician, items] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (startY > 175) {
      doc.addPage();
      startY = 15;
    }
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`${technician} (${items.length})`, 14, startY);
    doc.setFont("helvetica", "normal");
    autoTable(doc, {
      startY: startY + 2,
      head: [["Data", "Cliente", "Referência", "Divergências", "Detalhes"]],
      body: items.map((record) => [
        record.date ? new Date(`${record.date}T12:00:00`).toLocaleDateString("pt-BR") : "—",
        record.client,
        record.gcOsCode ? `OS ${record.gcOsCode} / Auvo ${record.taskId}` : `Auvo ${record.taskId}`,
        record.issues.map((issue) => issue.label).join(" · "),
        record.issues.map((issue) => issue.detail).join(" | "),
      ]),
      styles: { fontSize: 7, cellPadding: 2, overflow: "linebreak" },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 52 },
        2: { cellWidth: 38 },
        3: { cellWidth: 45 },
        4: { cellWidth: 110 },
      },
    });
    startY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
  }

  doc.save(`divergencias-tecnicos-${new Date().toISOString().slice(0, 10)}.pdf`);
}
