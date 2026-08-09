import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface AgendaRelatorioItem {
  data: string;
  tecnico: string;
  veiculo?: string;
  horario: string;
  cliente: string;
  descricao?: string;
  auvo_task_id?: string;
  gc_codigo?: string;
  origem: string;
}

const brDate = (iso: string) => iso.split("-").reverse().join("/");

export function gerarPdfAgenda(
  titulo: string,
  periodo: string,
  itens: AgendaRelatorioItem[]
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Cabeçalho
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(titulo, 40, 40);
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Período: ${periodo}`, 40, 58);
  doc.text(`Emitido em: ${new Date().toLocaleString("pt-BR")}`, pageW - 40, 58, { align: "right" });

  // Tabela
  autoTable(doc, {
    startY: 70,
    head: [["Data", "Técnico", "Horário", "Código", "Cliente", "Descrição", "Link Auvo"]],
    body: itens.map((it) => [
      brDate(it.data),
      it.tecnico,
      it.horario || "08:00 - 18:00",
      it.gc_codigo || "—",
      it.cliente,
      it.descricao || "—",
      it.auvo_task_id ? "ABRIR TAREFA" : "—",
    ]),
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 100 },
      2: { cellWidth: 70 },
      3: { cellWidth: 50 },
      4: { cellWidth: 120 },
      6: { halign: "center", textColor: [37, 99, 235], fontStyle: 'bold' },
    },
    didDrawCell: (data: any) => {
      if (data.section !== "body") return;
      const it = itens[data.row.index];
      if (data.column.index === 6 && it.auvo_task_id) {
        // Mesmo endereço usado no espelho de Premiação e nas demais telas.
        const url = `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${it.auvo_task_id}`;
        doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
      }
    },
  });

  // Rodapé
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${totalPages}`, pageW - 40, pageH - 20, { align: "right" });
  }

  // Retorna uma Promise para permitir que o chamador aguarde a conclusão.
  doc.save(`agenda-coletiva-${new Date().getTime()}.pdf`);
}
