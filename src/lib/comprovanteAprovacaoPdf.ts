import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type AprovacaoPdfInput = {
  codigo: string;
  cliente: string | null;
  valorAprovado: string | null;
  situacaoAntes: string;
  situacaoDepois: string;
  link: string | null;
  responsavelNome: string | null;
  emailAprovacao: string | null;
  contaAcesso: string | null;
  userId: string | null;
  dataHoraBR: string;
  dataHoraUTC: string;
  ipOrigem: string | null;
  cadeiaIps: string[];
  userAgent: string | null;
  termoAceito: boolean;
  observacaoCliente: string | null;
  logId: string;
  gcData: any | null;
};

const brl = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n)
    ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
    : "—";
};

const qtd = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 4 }) : String(v ?? "");
};

const dataBR = (s?: string | null) => {
  if (!s) return "—";
  const d = new Date(`${s}T00:00:00`);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("pt-BR");
};

export function gerarComprovanteAprovacaoPdf(input: AprovacaoPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const M = 40;
  let y = 46;

  const d = input.gcData || {};

  // Cabeçalho
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`Orçamento #${input.codigo}`, M, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text("Comprovante de aprovação eletrônica", M, (y += 14));
  doc.setTextColor(0);
  doc.setDrawColor(200);
  doc.line(M, (y += 8), pageW - M, y);
  y += 16;

  // Dados do orçamento
  const infoEsq: [string, string][] = [
    ["Cliente", input.cliente || d.nome_cliente || "—"],
    ["Data do orçamento", dataBR(d.data)],
    ["Validade", d.validade || "—"],
    ["Vendedor", d.nome_vendedor || "—"],
  ];
  const infoDir: [string, string][] = [
    ["Valor aprovado", input.valorAprovado || brl(d.valor_total)],
    ["Centro de custo", d.nome_centro_custo || "—"],
    ["Situação atual", d.nome_situacao || input.situacaoDepois],
    ["Previsão de entrega", dataBR(d.previsao_entrega)],
  ];
  doc.setFontSize(9);
  const linhaInfo = (pares: [string, string][], x: number, largura: number) => {
    let yy = y;
    for (const [k, v] of pares) {
      doc.setTextColor(120);
      doc.text(k, x, yy);
      doc.setTextColor(0);
      const txt = doc.splitTextToSize(String(v), largura - 105);
      doc.text(txt, x + 100, yy);
      yy += 12 * Math.max(1, txt.length);
    }
    return yy;
  };
  const meio = (pageW - M * 2) / 2;
  const y1 = linhaInfo(infoEsq, M, meio);
  const y2 = linhaInfo(infoDir, M + meio + 10, meio - 10);
  y = Math.max(y1, y2) + 10;

  // Atributos
  const atributos: any[] = Array.isArray(d.atributos) ? d.atributos : [];
  if (atributos.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [235, 238, 243], textColor: 40 },
      head: [["Informação", "Conteúdo"]],
      body: atributos.map((a) => [a?.atributo?.descricao || "", a?.atributo?.conteudo || ""]),
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // Produtos
  const produtos: any[] = Array.isArray(d.produtos) ? d.produtos : [];
  if (produtos.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [235, 238, 243], textColor: 40 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      head: [["Produto", "Qtde", "Valor unit.", "Total"]],
      body: produtos.map((p) => {
        const i = p?.produto || {};
        return [
          `${i.nome_produto || ""}${i.sigla_unidade ? ` (${i.sigla_unidade})` : ""}`,
          qtd(i.quantidade),
          brl(i.valor_venda),
          brl(i.valor_total),
        ];
      }),
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  }

  // Serviços
  const servicos: any[] = Array.isArray(d.servicos) ? d.servicos : [];
  if (servicos.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: { fillColor: [235, 238, 243], textColor: 40 },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
      head: [["Serviço", "Qtde", "Valor unit.", "Total"]],
      body: servicos.map((s) => {
        const i = s?.servico || {};
        return [i.nome_servico || "", qtd(i.quantidade), brl(i.valor_venda), brl(i.valor_total)];
      }),
    });
    y = (doc as any).lastAutoTable.finalY + 12;
  }

  // Totais
  if (d.valor_total != null || input.valorAprovado) {
    autoTable(doc, {
      startY: y,
      margin: { left: pageW / 2, right: M },
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { textColor: 110 }, 1: { halign: "right", fontStyle: "bold" } },
      body: [
        ["Produtos", brl(d.valor_produtos)],
        ["Serviços", brl(d.valor_servicos)],
        ["Desconto", brl(d.desconto_valor)],
        ["Frete", brl(d.valor_frete)],
        ["Total aprovado", input.valorAprovado || brl(d.valor_total)],
      ],
    });
    y = (doc as any).lastAutoTable.finalY + 14;
  }

  // Observações
  const obs = [d.observacoes, input.observacaoCliente ? `Observação do cliente: ${input.observacaoCliente}` : null]
    .filter(Boolean)
    .join("\n");
  if (obs) {
    doc.setFontSize(8);
    doc.setTextColor(90);
    const txt = doc.splitTextToSize(obs, pageW - M * 2);
    if (y + txt.length * 10 > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 46;
    }
    doc.text(txt, M, y);
    y += txt.length * 10 + 10;
    doc.setTextColor(0);
  }

  // Carimbo de aprovação
  const linhasCarimbo: [string, string][] = [
    ["Responsável", input.responsavelNome || "—"],
    ["E-mail da aprovação", input.emailAprovacao || "—"],
    ["Conta de acesso", input.contaAcesso || "—"],
    ["Identificador do usuário", input.userId || "—"],
    ["Data e hora (Brasília)", input.dataHoraBR],
    ["Registro em UTC", input.dataHoraUTC],
    ["IP de origem", input.ipOrigem || "—"],
    ["Cadeia de IPs", input.cadeiaIps.length ? input.cadeiaIps.join(" > ") : "—"],
    ["Termo de aceite", input.termoAceito ? "Aceito" : "Não aceito"],
    ["Situação antes", input.situacaoAntes],
    ["Situação depois", input.situacaoDepois],
    ["Dispositivo / navegador", input.userAgent || "—"],
    ["Documento do orçamento", input.link || "—"],
    ["Registro de auditoria", input.logId],
  ];

  const larguraCarimbo = pageW - M * 2;
  const alturaEstimada = 46 + linhasCarimbo.length * 12 + 26;
  if (y + alturaEstimada > doc.internal.pageSize.getHeight() - 40) {
    doc.addPage();
    y = 46;
  }

  const topo = y;
  doc.setDrawColor(21, 101, 192);
  doc.setLineWidth(1.2);
  doc.roundedRect(M, topo, larguraCarimbo, alturaEstimada, 6, 6);
  doc.setLineWidth(0.2);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(21, 101, 192);
  doc.text("APROVADO ELETRONICAMENTE VIA SISTEMA", M + 14, topo + 22);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(90);
  doc.text(
    "Aprovação registrada no portal WeDo com aceite do termo. Evidências de auditoria abaixo.",
    M + 14,
    topo + 34,
  );

  let yc = topo + 50;
  doc.setFontSize(8);
  for (const [k, v] of linhasCarimbo) {
    doc.setTextColor(120);
    doc.text(k, M + 14, yc);
    doc.setTextColor(20);
    const txt = doc.splitTextToSize(String(v), larguraCarimbo - 180);
    doc.text(txt[0] || "", M + 155, yc);
    if (txt.length > 1) {
      // mantém o carimbo compacto: encurta valores longos
      doc.text(`${txt[1].slice(0, 80)}${txt.length > 2 ? "…" : ""}`, M + 155, yc + 9);
      yc += 9;
    }
    yc += 12;
  }

  // Rodapé
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFontSize(7);
    doc.setTextColor(140);
    doc.text(
      `Comprovante gerado em ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — orçamento #${input.codigo} — página ${p}/${total}`,
      M,
      doc.internal.pageSize.getHeight() - 22,
    );
  }

  doc.save(`orcamento-${input.codigo}-aprovacao.pdf`);
}
