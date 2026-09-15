export interface SourceText {
  text: string;
  sourceQuote: string;
}

export interface StudyMaterials {
  lectureTitle: string;
  summary: {
    overview: SourceText;
    sections: {
      title: string;
      content: string;
      concepts: string[];
      sourceQuote: string;
    }[];
    definitions: {
      term: string;
      definition: string;
      sourceQuote: string;
    }[];
    conclusion: SourceText;
  };
  keyPoints: { point: string; sourceQuote: string }[];
  quiz: {
    id: string;
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
    sourceQuote: string;
  }[];
  flashcards: {
    id: string;
    front: string;
    back: string;
    sourceQuote: string;
  }[];
}

export interface GenerationResponse {
  materials: StudyMaterials;
  grounding: { verified: true; checkedQuotes: number };
  metadata: { model: string; generatedAt: string };
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}

export interface HealthResponse {
  status: 'ok';
  configured: boolean;
  model: string;
}

export const MIN_LECTURE_LENGTH = 200;
export const MAX_LECTURE_LENGTH = 30_000;
