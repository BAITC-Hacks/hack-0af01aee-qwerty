import type { StudyMaterials } from '../../shared/types.js';

// Test-only source and generated fixture. Production never imports this file.
export const lecture = `Рабочая память удерживает небольшой объём информации во время решения задачи. Повторение помогает дольше удерживать сведения в рабочей памяти.
Долговременная память хранит информацию длительное время. Интервальное повторение — это возвращение к материалу через увеличивающиеся промежутки времени.
Активное воспроизведение означает попытку вспомнить информацию без подсказки. После попытки нужно проверить ответ по исходному материалу и исправить ошибки.`;
export const memoryQuote = 'Рабочая память удерживает небольшой объём информации во время решения задачи.';
export const repetitionQuote = 'Интервальное повторение — это возвращение к материалу через увеличивающиеся промежутки времени.';

export function makeMaterials(): StudyMaterials {
  return {
    lectureTitle: 'Память и повторение',
    summary: {
      overview: { text: 'Рабочая память временно удерживает небольшой объём информации.', sourceQuote: memoryQuote },
      sections: [
        { title: 'Рабочая память', content: 'Во время задачи рабочая память удерживает небольшой объём информации.', concepts: ['Рабочая память'], sourceQuote: memoryQuote },
        { title: 'Интервальное повторение', content: 'Возвращайтесь к материалу через увеличивающиеся промежутки времени.', concepts: ['Интервальное повторение'], sourceQuote: repetitionQuote },
      ],
      definitions: [{ term: 'Интервальное повторение', definition: 'Возвращение к материалу через увеличивающиеся промежутки времени.', sourceQuote: repetitionQuote }],
      conclusion: { text: 'Интервальное повторение организует возвращение к материалу во времени.', sourceQuote: repetitionQuote },
    },
    keyPoints: [
      { point: 'Рабочая память удерживает небольшой объём информации.', sourceQuote: memoryQuote },
      { point: 'Интервалы между повторениями увеличиваются.', sourceQuote: repetitionQuote },
    ],
    quiz: [
      { id: 'q1', question: 'Когда рабочая память удерживает информацию?', options: ['Во время решения задачи', 'Только после завершения задачи', 'Только при проверке ошибок', 'Только через большой интервал'], correctAnswer: 0, explanation: 'Лекция связывает рабочую память с решением задачи.', sourceQuote: memoryQuote },
      { id: 'q2', question: 'Как меняются промежутки при интервальном повторении?', options: ['Исчезают', 'Увеличиваются', 'Всегда равны', 'Сокращаются до нуля'], correctAnswer: 1, explanation: 'В определении прямо указаны увеличивающиеся промежутки.', sourceQuote: repetitionQuote },
    ],
    flashcards: [
      { id: 'f1', front: 'Что удерживает рабочая память?', back: 'Небольшой объём информации во время решения задачи.', sourceQuote: memoryQuote },
      { id: 'f2', front: 'Что такое интервальное повторение?', back: 'Возвращение к материалу через увеличивающиеся промежутки времени.', sourceQuote: repetitionQuote },
    ],
  };
}

export function makeEnvelope() {
  return {
    analysis: {
      suitable: true,
      topics: ['Рабочая память', 'Интервальное повторение'],
      keyConcepts: [{ text: 'Рабочая память удерживает информацию во время задачи.', sourceQuote: memoryQuote }],
      definitions: [{ text: 'Интервальное повторение возвращает к материалу.', sourceQuote: repetitionQuote }],
      causalRelations: [],
      facts: [{ text: 'Объём рабочей памяти небольшой.', sourceQuote: memoryQuote }],
      importantPassages: [memoryQuote, repetitionQuote],
    },
    materials: makeMaterials(),
  };
}
