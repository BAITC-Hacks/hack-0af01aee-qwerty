import express, { type ErrorRequestHandler } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { materialsSchema } from '../shared/schema.js';
import { MAX_LECTURE_LENGTH, MIN_LECTURE_LENGTH, type GenerationResponse } from '../shared/types.js';
import { ApiError, InvalidGenerationError, publicError } from './errors.js';
import { createOpenAIProvider, createStudyGenerator, DEFAULT_MODEL, type MaterialsGenerator } from './generator.js';
import { verifyMaterialGrounding } from './grounding.js';

export interface AppOptions {
  generator?: MaterialsGenerator;
  configured?: boolean;
  model?: string;
  timeoutMs?: number;
  rateLimit?: number;
  rateWindowMs?: number;
  maxConcurrent?: number;
  staticDir?: string;
}

const requestSchema = z.object({ lecture: z.string().trim().max(MAX_LECTURE_LENGTH) }).strict();

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Deliberately do not trust arbitrary forwarding headers. Set proxy trust only
  // for a known deployment topology if rate limits must distinguish proxy users.
  const key = process.env.OPENAI_API_KEY?.trim() ?? '';
  const configured = options.configured ?? (options.generator ? true : Boolean(key));
  const model = options.model ?? (process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL);
  const generator = options.generator ?? (configured && key
    ? createStudyGenerator(createOpenAIProvider(key, model))
    : undefined);
  const timeoutMs = options.timeoutMs ?? 90_000;
  const rateLimit = options.rateLimit ?? 12;
  const rateWindowMs = options.rateWindowMs ?? 10 * 60_000;
  const maxConcurrent = options.maxConcurrent ?? 3;
  const requests = new Map<string, { count: number; resetsAt: number }>();
  const activeClients = new Set<string>();
  let activeCount = 0;

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '256kb', strict: true }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', configured: configured && Boolean(generator), model });
  });

  app.post('/api/generate', async (req, res, next) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      const tooLong = typeof req.body?.lecture === 'string' && req.body.lecture.trim().length > MAX_LECTURE_LENGTH;
      return next(new ApiError(tooLong ? 413 : 400, tooLong ? 'LECTURE_TOO_LONG' : 'INVALID_INPUT',
        tooLong ? 'Лекция слишком длинная. Максимум — 30 000 символов.' : 'Добавьте текст лекции в поле для ввода.'));
    }
    const lecture = parsed.data.lecture;
    if (!lecture.length) {
      return next(new ApiError(400, 'EMPTY_LECTURE', 'Добавьте текст лекции, чтобы начать.'));
    }
    if (lecture.length < MIN_LECTURE_LENGTH) {
      return next(new ApiError(400, 'LECTURE_TOO_SHORT', 'Текст слишком короткий. Добавьте более полный фрагмент лекции: минимум 200 символов.'));
    }
    if (!configured || !generator) {
      return next(new ApiError(503, 'AI_NOT_CONFIGURED', 'AI ещё не подключён. Добавьте OPENAI_API_KEY в серверный файл .env и перезапустите сервер.'));
    }

    const now = Date.now();
    // Expire entries on traffic rather than retaining a process-level timer.
    for (const [ip, entry] of requests) if (entry.resetsAt <= now) requests.delete(ip);
    const clientId = req.ip || req.socket.remoteAddress || 'unknown';
    const recent = requests.get(clientId) ?? { count: 0, resetsAt: now + rateWindowMs };
    if (recent.count >= rateLimit) {
      res.setHeader('Retry-After', String(Math.ceil((recent.resetsAt - now) / 1000)));
      return next(new ApiError(429, 'RATE_LIMITED', 'Слишком много запросов. Подождите несколько минут и попробуйте снова.'));
    }
    if (activeCount >= maxConcurrent || activeClients.has(clientId)) {
      res.setHeader('Retry-After', '5');
      return next(new ApiError(429, 'SERVER_BUSY', 'Сейчас уже идёт обработка лекции. Дождитесь завершения или попробуйте чуть позже.'));
    }
    recent.count += 1;
    requests.set(clientId, recent);
    // A bounded map protects the anonymous demo service against unbounded IP churn.
    if (requests.size > 10_000) requests.delete(requests.keys().next().value!);
    activeClients.add(clientId);
    activeCount += 1;

    const controller = new AbortController();
    const onClientClose = () => {
      if (!res.writableEnded) controller.abort(new ApiError(499, 'CLIENT_CLOSED', 'Запрос отменён.'));
    };
    req.once('aborted', onClientClose);
    res.once('close', onClientClose);
    const timer = setTimeout(() => controller.abort(new ApiError(504, 'TIMEOUT',
      'Обработка заняла слишком много времени. Попробуйте ещё раз или сократите текст лекции.')), timeoutMs);
    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abortListener, { once: true });
    });

    try {
      const raw = await Promise.race([generator(lecture, controller.signal), aborted]);
      const result = materialsSchema.safeParse(raw);
      if (!result.success) throw new InvalidGenerationError('Invalid material schema.');
      const checkedQuotes = verifyMaterialGrounding(lecture, result.data);
      const response: GenerationResponse = {
        materials: result.data,
        grounding: { verified: true, checkedQuotes },
        metadata: { model, generatedAt: new Date().toISOString() },
      };
      if (!controller.signal.aborted && !res.destroyed) res.json(response);
    } catch (error) {
      if (!res.destroyed) next(publicError(controller.signal.aborted ? controller.signal.reason : error));
    } finally {
      clearTimeout(timer);
      if (abortListener) controller.signal.removeEventListener('abort', abortListener);
      req.off('aborted', onClientClose);
      res.off('close', onClientClose);
      activeClients.delete(clientId);
      activeCount -= 1;
    }
  });

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'Этот API-адрес не найден.')));

  const staticDir = options.staticDir ?? (process.env.NODE_ENV === 'production' ? path.resolve('dist') : undefined);
  if (staticDir && existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (res.headersSent || res.destroyed) return;
    const bodyError = error && typeof error === 'object' && 'type' in error ? error.type : undefined;
    const safe = bodyError === 'entity.too.large'
      ? new ApiError(413, 'BODY_TOO_LARGE', 'Текст слишком большой. Максимум — 30 000 символов.')
      : bodyError === 'entity.parse.failed'
        ? new ApiError(400, 'INVALID_JSON', 'Не удалось прочитать запрос. Обновите страницу и попробуйте снова.')
        : publicError(error);
    res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
  };
  app.use(errorHandler);
  return app;
}
