import { describe, expect, it } from "vitest";
import {
  normalizeQuestionnaireAnswers,
  resolveQuestionnaireData,
} from "../../supabase/functions/central-sync/questionnaire-normalizer";

describe("normalização de questionários do central-sync", () => {
  it("aceita qualquer questionário e achata as respostas do detalhe Auvo", () => {
    const detail = [{
      questionnaireId: 214757,
      questionnaireDescription: "EXECUÇÃO DE SERVIÇOS",
      answers: [
        { questionId: 1, replyId: 10, questionDescription: "SERVIÇOS REALIZADOS", reply: "Troca de rolamentos" },
        { questionId: 2, replyId: 11, questionDescription: "FOTOS", reply: "https://cdn.test/foto.jpg", fromGallery: 1 },
      ],
    }];

    const result = resolveQuestionnaireData("216040", [], detail);

    expect(result.questionnaireId).toBe("214757");
    expect(result.filled).toBe(true);
    expect(result.answers).toHaveLength(2);
    expect(result.answers[0]).toMatchObject({
      question: "SERVIÇOS REALIZADOS",
      reply: "Troca de rolamentos",
      questionnaireDescription: "EXECUÇÃO DE SERVIÇOS",
    });
  });

  it("mescla listagem e detalhe sem duplicar respostas pelo replyId", () => {
    const questionnaire = [{
      questionnaireId: 214757,
      answers: [{ questionId: 1, replyId: 10, questionDescription: "OBSERVAÇÕES", reply: "Teste concluído" }],
    }];

    expect(normalizeQuestionnaireAnswers(questionnaire, questionnaire)).toHaveLength(1);
  });
});
