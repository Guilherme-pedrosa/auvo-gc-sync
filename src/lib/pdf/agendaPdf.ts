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

export interface AgendaVeiculoLinha {
  data: string;
  veiculo: string;
  texto: string;
}

const brDate = (iso: string) => iso.split("-").reverse().join("/");

export function gerarPdfAgenda(
  titulo: string,
  periodo: string,
  itens: AgendaRelatorioItem[],
  veiculos: AgendaVeiculoLinha[] = []
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

  let cursorY = 74;

  // 1) Tabela de VEÍCULOS (sempre primeiro)
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Veículos", 40, cursorY);
  cursorY += 8;

  autoTable(doc, {
    startY: cursorY,
    columns: [
      { header: "Data", dataKey: "data" },
      { header: "Veículo", dataKey: "veiculo" },
      { header: "Texto inserido no dia", dataKey: "texto" },
    ],
    body: veiculos.length
      ? veiculos.map((v) => ({
          data: brDate(v.data),
          veiculo: v.veiculo,
          texto: v.texto,
        }))
      : [{ data: "—", veiculo: "Nenhum texto de veículo salvo neste dia", texto: "—" }],
    rowPageBreak: "avoid",
    styles: { fontSize: 8, cellPadding: 3 },
    headStyles: { fillColor: [15, 118, 110], textColor: 255, fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 220 },
      2: { cellWidth: 490 },
    },
  });

  // 2) Uma seção (nova página) por técnico
  const tecnicos = Array.from(new Set(itens.map((i) => i.tecnico))).sort((a, b) =>
    a.localeCompare(b)
  );

  tecnicos.forEach((tec) => {
    doc.addPage();
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text(`Técnico: ${tec}`, 40, 40);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`Período: ${periodo}`, 40, 56);

    const linhas = itens
      .filter((it) => it.tecnico === tec)
      .map((it) => ({
        data: brDate(it.data),
        horario: it.horario || "08:00 - 18:00",
        veiculo: it.veiculo || "—",
        codigo: it.gc_codigo || "—",
        cliente: it.cliente,
        descricao: it.descricao || "—",
        link: it.auvo_task_id ? "ABRIR TAREFA" : "—",
        taskId: it.auvo_task_id,
      }));

    autoTable(doc, {
      startY: 66,
      columns: [
        { header: "Data", dataKey: "data" },
        { header: "Horário", dataKey: "horario" },
        { header: "Veículo", dataKey: "veiculo" },
        { header: "Código", dataKey: "codigo" },
        { header: "Cliente", dataKey: "cliente" },
        { header: "Descrição", dataKey: "descricao" },
        { header: "Link Auvo", dataKey: "link" },
      ],
      body: linhas,
      rowPageBreak: "avoid",
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold" },
      columnStyles: {
        0: { cellWidth: 55 },
        1: { cellWidth: 70 },
        2: { cellWidth: 90 },
        3: { cellWidth: 50 },
        4: { cellWidth: 120 },
        6: { halign: "center", textColor: [37, 99, 235], fontStyle: "bold" },
      },
      didDrawCell: (data: any) => {
        if (data.section !== "body") return;
        const linha = data.row.raw as { taskId?: string } | undefined;
        if (data.column.dataKey === "link" && linha?.taskId) {
          const url = `https://app2.auvo.com.br/relatorioTarefas/DetalheTarefa/${linha.taskId}`;
          doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, { url });
        }
      },
    });
  });

  // Rodapé
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${totalPages}`, pageW - 40, pageH - 20, { align: "right" });
  }

  // O save ocorre ainda dentro do clique do usuário, preservando a permissão
  // de download exigida pelo navegador.
  doc.save(`agenda-coletiva-${new Date().getTime()}.pdf`);
}
