export type NormalizedQuestionnaireAnswer = {
  question: string;
  reply: string;
  questionnaireId?: string;
  questionnaireDescription?: string;
  questionId?: string;
  replyId?: string;
  fromGallery?: boolean;
  subtitle?: string;
};

type QuestionnaireData = {
  questionnaireId: string | null;
  answers: NormalizedQuestionnaireAnswer[];
  filled: boolean;
};

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    : [];

function normalizedAnswer(
  answer: Record<string, unknown>,
  questionnaire?: Record<string, unknown>,
): NormalizedQuestionnaireAnswer {
  return {
    question: String(answer.question ?? answer.questionDescription ?? "").trim(),
    reply: String(answer.reply ?? "").trim(),
    questionnaireId: questionnaire?.questionnaireId == null ? undefined : String(questionnaire.questionnaireId),
    questionnaireDescription: questionnaire?.questionnaireDescription == null
      ? undefined
      : String(questionnaire.questionnaireDescription),
    questionId: answer.questionId == null ? undefined : String(answer.questionId),
    replyId: answer.replyId == null ? undefined : String(answer.replyId),
    fromGallery: answer.fromGallery === true || answer.fromGallery === 1,
    subtitle: answer.subtitle == null ? undefined : String(answer.subtitle),
  };
}

export function normalizeQuestionnaireAnswers(...sources: unknown[]): NormalizedQuestionnaireAnswer[] {
  const answers = new Map<string, NormalizedQuestionnaireAnswer>();

  for (const source of sources) {
    for (const item of asArray(source)) {
      const nested = asArray(item.answers);
      const candidates = nested.length > 0 ? nested.map((answer) => normalizedAnswer(answer, item)) : [normalizedAnswer(item)];

      for (const answer of candidates) {
        if (!answer.question && !answer.reply) continue;
        const key = answer.replyId
          ? `reply:${answer.replyId}`
          : `${answer.questionnaireId || ""}::${answer.questionId || answer.question}::${answer.reply}`;
        answers.set(key, answer);
      }
    }
  }

  return [...answers.values()];
}

export function resolveQuestionnaireData(
  preferredQuestionnaireId: string,
  ...sources: unknown[]
): QuestionnaireData {
  const answers = normalizeQuestionnaireAnswers(...sources);
  const questionnaireIds = sources
    .flatMap(asArray)
    .map((questionnaire) => questionnaire.questionnaireId)
    .filter((id): id is string | number => id !== null && id !== undefined)
    .map(String);
  const questionnaireId = questionnaireIds.includes(preferredQuestionnaireId)
    ? preferredQuestionnaireId
    : questionnaireIds[0] || answers.find((answer) => answer.questionnaireId)?.questionnaireId || null;

  return {
    questionnaireId,
    answers,
    filled: answers.some((answer) => answer.reply.trim() !== ""),
  };
}
