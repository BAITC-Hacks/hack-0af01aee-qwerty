export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class InvalidGenerationError extends Error {
  constructor(public readonly feedback: string, public readonly groundingFailed = false) {
    super('The generated response failed validation.');
    this.name = 'InvalidGenerationError';
  }
}

export function publicError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof InvalidGenerationError) {
    return error.groundingFailed
      ? new ApiError(502, 'GROUNDING_FAILED', 'Не удалось подтвердить цитаты по лекции. Материалы не показаны. Попробуйте ещё раз.')
      : new ApiError(502, 'INVALID_AI_RESPONSE', 'AI вернул некорректные материалы. Попробуйте обработать лекцию ещё раз.');
  }
  const name = error instanceof Error ? error.name : '';
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError') {
    return new ApiError(504, 'TIMEOUT', 'Обработка заняла слишком много времени. Попробуйте ещё раз или сократите текст лекции.');
  }
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  if (status === 401 || status === 403) {
    return new ApiError(503, 'AI_CONFIGURATION_ERROR', 'Не удалось подключиться к AI. Проверьте API-ключ и доступ к модели на сервере.');
  }
  if (status === 429) {
    return new ApiError(503, 'AI_BUSY', 'AI-сервис временно недоступен: достигнут лимит запросов или бюджета. Попробуйте позже.');
  }
  return new ApiError(502, 'AI_ERROR', 'Не удалось обработать лекцию. Попробуйте ещё раз.');
}
