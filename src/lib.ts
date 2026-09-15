import { generationResponseSchema } from '../shared/schema';
import type { GenerationResponse } from '../shared/types';

export type Progress = { summaryRead: boolean; answers: Record<string, number>; submitted: boolean; seen: string[]; difficult: string[] };
export const freshProgress = (): Progress => ({ summaryRead: false, answers: {}, submitted: false, seen: [], difficult: [] });
export const STORAGE_KEY = 'studyai.session.v1';
const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();

export function parseResult(value: unknown, lecture: string): GenerationResponse {
  const parsed = generationResponseSchema.parse(value);
  const m = parsed.materials;
  const quotes = [m.summary.overview, ...m.summary.sections, ...m.summary.definitions, m.summary.conclusion, ...m.keyPoints, ...m.quiz, ...m.flashcards];
  if (!parsed.grounding.verified || quotes.some((item) => !normalize(item.sourceQuote) || !normalize(lecture).includes(normalize(item.sourceQuote)))) {
    throw new Error('Не удалось подтвердить источники в ответе. Попробуйте создать материалы ещё раз.');
  }
  return parsed;
}

export function loadSession(): { result: GenerationResponse; lecture: string; progress: Progress } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || typeof saved.lecture !== 'string') return null;
    const result = parseResult(saved.result, saved.lecture);
    const p = saved.progress;
    const progress = freshProgress();
    if (p && typeof p === 'object') {
      progress.summaryRead = p.summaryRead === true;
      for (const q of result.materials.quiz) {
        if (Number.isInteger(p.answers?.[q.id]) && p.answers[q.id] >= 0 && p.answers[q.id] < 4) progress.answers[q.id] = p.answers[q.id];
      }
      progress.submitted = p.submitted === true && Object.keys(progress.answers).length === result.materials.quiz.length;
      const ids = result.materials.flashcards.map((c) => c.id);
      progress.seen = ids.filter((id) => Array.isArray(p.seen) && p.seen.includes(id));
      progress.difficult = ids.filter((id) => Array.isArray(p.difficult) && p.difficult.includes(id));
    }
    return { result, lecture: saved.lecture, progress };
  } catch { return null; }
}

export async function generateMaterials(lecture: string, signal: AbortSignal): Promise<GenerationResponse> {
  let response: Response;
  try {
    response = await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lecture }), signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new Error('Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.');
  }
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error('Сервер вернул некорректный ответ. Попробуйте ещё раз.'); }
  if (!response.ok) {
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    throw new Error(typeof message === 'string' ? message : 'Не удалось обработать лекцию. Попробуйте ещё раз.');
  }
  try { return parseResult(body, lecture); } catch { throw new Error('Не удалось проверить структуру или источники материалов. Попробуйте ещё раз.'); }
}
