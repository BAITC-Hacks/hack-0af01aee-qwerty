import { z } from 'zod';

const shortText = z.string().trim().min(1).max(300);
const paragraph = z.string().trim().min(1).max(2_500);
export const sourceQuoteSchema = z.string().trim().min(12).max(1_200);
const sourceTextSchema = z.object({ text: paragraph, sourceQuote: sourceQuoteSchema }).strict();
const definitionSchema = z.object({
  term: shortText,
  definition: paragraph,
  sourceQuote: sourceQuoteSchema,
}).strict();

// Keep the structural schema separate from cross-field checks: the same shape is
// converted to OpenAI's strict JSON schema by the server-side SDK helper.
export const materialsStructureSchema = z.object({
  lectureTitle: shortText,
  summary: z.object({
    overview: sourceTextSchema,
    sections: z.array(z.object({
      title: shortText,
      content: paragraph,
      concepts: z.array(shortText).max(8),
      sourceQuote: sourceQuoteSchema,
    }).strict()).min(1).max(8),
    definitions: z.array(definitionSchema).max(12),
    conclusion: sourceTextSchema,
  }).strict(),
  keyPoints: z.array(z.object({ point: paragraph, sourceQuote: sourceQuoteSchema }).strict()).min(1).max(10),
  quiz: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    question: z.string().trim().min(1).max(700),
    options: z.array(z.string().trim().min(1).max(500)).length(4),
    correctAnswer: z.number().int().min(0).max(3),
    explanation: paragraph,
    sourceQuote: sourceQuoteSchema,
  }).strict()).min(1).max(10),
  flashcards: z.array(z.object({
    id: z.string().trim().min(1).max(64),
    front: z.string().trim().min(1).max(500),
    back: paragraph,
    sourceQuote: sourceQuoteSchema,
  }).strict()).min(1).max(12),
}).strict();

const comparable = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();

export const materialsSchema = materialsStructureSchema.superRefine((materials, ctx) => {
  for (const collection of ['quiz', 'flashcards'] as const) {
    const ids = new Set<string>();
    materials[collection].forEach((item, index) => {
      if (ids.has(item.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [collection, index, 'id'], message: 'IDs must be unique.' });
      }
      ids.add(item.id);
    });
  }

  const questions = new Set<string>();
  materials.quiz.forEach((question, index) => {
    if (new Set(question.options.map(comparable)).size !== 4) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quiz', index, 'options'], message: 'Answer options must be distinct.' });
    }
    const normalized = comparable(question.question);
    if (questions.has(normalized)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quiz', index, 'question'], message: 'Questions must be distinct.' });
    }
    questions.add(normalized);
  });
});

export const generationResponseSchema = z.object({
  materials: materialsSchema,
  grounding: z.object({ verified: z.literal(true), checkedQuotes: z.number().int().positive() }).strict(),
  metadata: z.object({ model: shortText, generatedAt: z.string().datetime() }).strict(),
}).strict();
