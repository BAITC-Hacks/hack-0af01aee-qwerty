import type { StudyMaterials } from '../shared/types.js';
import { InvalidGenerationError } from './errors.js';

export function normalizeSource(text: string): string {
  return text.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
}

export function materialQuotes(materials: StudyMaterials): { path: string; quote: string }[] {
  return [
    { path: 'summary.overview.sourceQuote', quote: materials.summary.overview.sourceQuote },
    ...materials.summary.sections.map((item, i) => ({ path: `summary.sections.${i}.sourceQuote`, quote: item.sourceQuote })),
    ...materials.summary.definitions.map((item, i) => ({ path: `summary.definitions.${i}.sourceQuote`, quote: item.sourceQuote })),
    { path: 'summary.conclusion.sourceQuote', quote: materials.summary.conclusion.sourceQuote },
    ...materials.keyPoints.map((item, i) => ({ path: `keyPoints.${i}.sourceQuote`, quote: item.sourceQuote })),
    ...materials.quiz.map((item, i) => ({ path: `quiz.${i}.sourceQuote`, quote: item.sourceQuote })),
    ...materials.flashcards.map((item, i) => ({ path: `flashcards.${i}.sourceQuote`, quote: item.sourceQuote })),
  ];
}

export function verifyQuotes(lecture: string, quotes: { path: string; quote: string }[]): number {
  const normalizedLecture = normalizeSource(lecture);
  const invalid = quotes.filter(({ quote }) => {
    const normalizedQuote = normalizeSource(quote);
    return normalizedQuote.length < 12 || !normalizedLecture.includes(normalizedQuote);
  });
  if (invalid.length > 0) {
    // Paths are fixed schema paths, not lecture/model text. They can safely be
    // used as repair feedback without promoting source instructions.
    throw new InvalidGenerationError(`Non-verbatim or too-short sourceQuote at: ${invalid.slice(0, 12).map(({ path }) => path).join(', ')}. Copy an exact, contiguous, supporting passage from the original lecture.`, true);
  }
  return quotes.length;
}

export function verifyMaterialGrounding(lecture: string, materials: StudyMaterials): number {
  return verifyQuotes(lecture, materialQuotes(materials));
}
