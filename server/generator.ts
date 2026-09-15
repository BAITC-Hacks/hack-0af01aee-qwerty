import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { materialsSchema, materialsStructureSchema, sourceQuoteSchema } from '../shared/schema.js';
import type { StudyMaterials } from '../shared/types.js';
import { ApiError, InvalidGenerationError } from './errors.js';
import { verifyMaterialGrounding, verifyQuotes } from './grounding.js';
import { STUDY_SYSTEM_PROMPT } from './prompts.js';

const extractedFactSchema = z.object({
  text: z.string().trim().min(1).max(700),
  sourceQuote: sourceQuoteSchema,
}).strict();

export const aiEnvelopeSchema = z.object({
  analysis: z.object({
    suitable: z.boolean(),
    topics: z.array(z.string().trim().min(1).max(180)).max(10),
    keyConcepts: z.array(extractedFactSchema).max(12),
    definitions: z.array(extractedFactSchema).max(10),
    causalRelations: z.array(extractedFactSchema).max(8),
    facts: z.array(extractedFactSchema).max(15),
    importantPassages: z.array(sourceQuoteSchema).max(10),
  }).strict(),
  materials: materialsStructureSchema.nullable(),
}).strict();

export type MaterialsGenerator = (lecture: string, signal: AbortSignal) => Promise<StudyMaterials>;
export interface ProviderOutput {
  text: string;
  status?: string;
  refused?: boolean;
}
export interface ProviderRequest {
  lecture: string;
  repairFeedback?: string;
}
export type ModelProvider = (request: ProviderRequest, signal: AbortSignal) => Promise<ProviderOutput>;

export const DEFAULT_MODEL = 'gpt-4.1-mini';

export function createOpenAIProvider(apiKey: string, model: string): ModelProvider {
  // No automatic SDK retry: the app enforces one shared 90-second budget and
  // only retries invalid structured/grounded output once.
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 90_000 });
  return async ({ lecture, repairFeedback }, signal) => {
    const response = await client.responses.create({
      model,
      store: false,
      instructions: STUDY_SYSTEM_PROMPT + (repairFeedback
        ? `\nПовтори извлечение и генерацию. Сервер отклонил предыдущий результат: ${repairFeedback}`
        : ''),
      input: [{ role: 'user', content: JSON.stringify({ lecture }) }],
      text: { format: zodTextFormat(aiEnvelopeSchema, 'study_materials') },
      max_output_tokens: 13_000,
    }, { signal });

    const refused = response.output.some((item) => item.type === 'message'
      && item.content.some((content) => content.type === 'refusal'));
    return { text: response.output_text, status: response.status, refused };
  };
}

function parseAndVerify(output: ProviderOutput, lecture: string): StudyMaterials {
  if (output.refused) {
    throw new ApiError(422, 'AI_REFUSAL', 'AI не смог обработать этот текст. Попробуйте другой учебный фрагмент.');
  }
  if (output.status && output.status !== 'completed') {
    throw new InvalidGenerationError('The response was incomplete. Produce fewer, shorter items while preserving all schema fields.');
  }
  let json: unknown;
  try {
    json = JSON.parse(output.text);
  } catch {
    throw new InvalidGenerationError('Invalid JSON. Return one complete JSON object matching the schema.');
  }
  const parsed = aiEnvelopeSchema.safeParse(json);
  if (!parsed.success) {
    // Do not send untrusted schema keys/messages back as higher-priority text.
    throw new InvalidGenerationError('The response did not match the required JSON schema. Check required fields, array limits, four answer options and non-empty strings.');
  }
  const { analysis, materials } = parsed.data;
  if (!analysis.suitable) {
    throw new ApiError(422, 'INSUFFICIENT_CONTENT', 'В тексте недостаточно учебной информации для материалов. Добавьте содержательный фрагмент лекции.');
  }
  if (!materials || !analysis.topics.length || !analysis.facts.length || !analysis.importantPassages.length) {
    throw new InvalidGenerationError('A suitable lecture requires a non-empty source analysis (topics, facts and importantPassages) and complete materials.');
  }
  const checked = materialsSchema.safeParse(materials);
  if (!checked.success) {
    throw new InvalidGenerationError('Use unique IDs, distinct questions, four distinct options per question and correctAnswer from 0 to 3.');
  }
  const analysisQuotes = [
    ...(['keyConcepts', 'definitions', 'causalRelations', 'facts'] as const).flatMap((key) =>
      analysis[key].map((item, index) => ({ path: `analysis.${key}.${index}.sourceQuote`, quote: item.sourceQuote }))),
    ...analysis.importantPassages.map((quote, index) => ({ path: `analysis.importantPassages.${index}`, quote })),
  ];
  verifyQuotes(lecture, analysisQuotes);
  verifyMaterialGrounding(lecture, checked.data);
  return checked.data;
}

export function createStudyGenerator(provider: ModelProvider): MaterialsGenerator {
  return async (lecture, signal) => {
    let repairFeedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal.throwIfAborted();
      const output = await provider({ lecture, repairFeedback }, signal);
      signal.throwIfAborted();
      try {
        return parseAndVerify(output, lecture);
      } catch (error) {
        if (!(error instanceof InvalidGenerationError) || attempt === 1) throw error;
        repairFeedback = error.feedback;
      }
    }
    throw new InvalidGenerationError('Unable to produce valid materials.');
  };
}
