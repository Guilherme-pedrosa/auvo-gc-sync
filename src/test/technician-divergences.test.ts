import { describe, expect, it } from "vitest";
import {
  auditTechnicianTask,
  buildTechnicianDivergenceRecords,
  countExecutionPhotos,
  hasComprehensibleExecutionReport,
  summarizeDivergenceRecords,
} from "@/lib/technicianDivergences";

const photos = (amount: number) => Array.from({ length: amount }, (_, index) => ({
  question: "FOTOS DA EXECUÇÃO",
  reply: `https://auvo-producao.s3.amazonaws.com/foto-${index}.jpg`,
}));

describe("auditoria de divergências dos técnicos", () => {
  it("conta fotos únicas nas respostas do formulário", () => {
    expect(countExecutionPhotos([...photos(3), photos(1)[0]])).toBe(3);
  });

  it("reconhece um relato técnico compreensível", () => {
    expect(hasComprehensibleExecutionReport([
      { question: "OBSERVAÇÕES", reply: "Foi identificado vazamento na conexão, realizado reaperto e teste completo sem novos vazamentos." },
    ])).toBe(true);
    expect(hasComprehensibleExecutionReport([
      { question: "OBSERVAÇÕES", reply: "ok" },
    ])).toBe(false);
  });

  it("interpreta o formato aninhado retornado pelo detalhe da tarefa Auvo", () => {
    const questionnaire = [{
      questionnaireId: 214757,
      questionnaireDescription: "EXECUÇÃO DE SERVIÇOS",
      answers: [
        { questionDescription: "SERVIÇOS REALIZADOS", reply: "Higienização técnica, lubrificação e troca de peças do equipamento." },
        ...photos(4).map((answer, index) => ({ questionDescription: answer.question, reply: answer.reply, replyId: index + 1 })),
        { questionDescription: "ASSINATURA TÉCNICO", reply: "https://cdn.test/assinatura.png" },
        { questionDescription: "OBSERVAÇÕES", reply: "Equipamento testado em todas as condições de operação e entregue funcionando corretamente." },
      ],
    }];

    expect(countExecutionPhotos(questionnaire)).toBe(4);
    expect(hasComprehensibleExecutionReport(questionnaire)).toBe(true);
    expect(auditTechnicianTask({
      auvo_task_id: "nested-1",
      status_auvo: "Finalizada",
      questionario_preenchido: true,
      questionario_respostas: questionnaire,
    })).toMatchObject({ formIssue: false, reportIssue: false, photoIssue: false, photoCount: 4 });
  });

  it("classifica formulário, relato e fotos de uma tarefa finalizada", () => {
    const audit = auditTechnicianTask({
      auvo_task_id: "100",
      tecnico_id: "1",
      tecnico: "Técnico Um",
      cliente: "Cliente",
      descricao: "Manutenção corretiva",
      data_tarefa: "2026-08-07",
      status_auvo: "Finalizada",
      questionario_preenchido: false,
      questionario_respostas: photos(1),
    });
    expect(audit).toMatchObject({
      description: "Manutenção corretiva",
      formIssue: true,
      reportIssue: true,
      photoIssue: true,
      photoCount: 1,
    });
  });

  it("não audita formulário e fotos antes da conclusão", () => {
    expect(auditTechnicianTask({
      auvo_task_id: "101",
      status_auvo: "Em andamento",
      questionario_preenchido: false,
    })).toBeNull();
  });

  it("consolida atraso e falhas de execução na mesma visão", () => {
    const audit = auditTechnicianTask({
      auvo_task_id: "200",
      tecnico_id: "1",
      tecnico: "Técnico Um",
      cliente: "Cliente",
      data_tarefa: "2026-08-07",
      status_auvo: "Finalizada",
      questionario_preenchido: true,
      questionario_respostas: [
        ...photos(1),
        { question: "OBSERVAÇÕES", reply: "ok" },
      ],
    })!;
    const records = buildTechnicianDivergenceRecords([{
      auvo_task_id: "300",
      tecnico_id: "1",
      tecnico_nome: "Técnico Um",
      data_planejada: "2026-08-06",
      motivo: "Não realizou check-in",
    }], [audit]);

    expect(summarizeDivergenceRecords(records)).toMatchObject({ schedule: 1, report: 1, photos: 1, records: 2, technicians: 1 });
    expect(records.find((record) => record.taskId === "200")?.issues.find((issue) => issue.kind === "report")?.detail).toContain("Relato encontrado: “ok”");
    expect(records.find((record) => record.taskId === "200")?.auvoUrl).toContain("200");
  });
});
