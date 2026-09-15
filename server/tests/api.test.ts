import assert from 'node:assert/strict';
import { createServer, request as httpRequest, type Server } from 'node:http';
import test from 'node:test';
import { createApp, type AppOptions } from '../app.js';
import { createStudyGenerator } from '../generator.js';
import { lecture, makeEnvelope, makeMaterials } from './fixtures.js';

async function withApi(options: AppOptions, run: (url: string, server: Server) => Promise<void>) {
  const server = createServer(createApp(options));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  try {
    await run(`http://127.0.0.1:${address.port}`, server);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const post = (url: string, body: unknown) => fetch(`${url}/api/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('health exposes configuration without secrets', async () => {
  await withApi({ configured: false, model: 'test-model' }, async (url) => {
    const response = await fetch(`${url}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', configured: false, model: 'test-model' });
    const generation = await post(url, { lecture });
    assert.equal(generation.status, 503);
    assert.equal((await generation.json()).error.code, 'AI_NOT_CONFIGURED');
  });
});

test('HTTP input validation handles empty, short, oversized and malformed requests', async () => {
  let calls = 0;
  await withApi({ generator: async () => { calls += 1; return makeMaterials(); } }, async (url) => {
    for (const [body, expected, code] of [
      [{ lecture: '  ' }, 400, 'EMPTY_LECTURE'],
      [{ lecture: 'Короткая лекция' }, 400, 'LECTURE_TOO_SHORT'],
      [{ lecture: 'a'.repeat(30_001) }, 413, 'LECTURE_TOO_LONG'],
      [{ lecture: 123 }, 400, 'INVALID_INPUT'],
      [{ lecture, unexpected: true }, 400, 'INVALID_INPUT'],
    ] as const) {
      const response = await post(url, body);
      assert.equal(response.status, expected);
      assert.equal((await response.json()).error.code, code);
    }
    const malformed = await fetch(`${url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{no-json' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
    const large = await post(url, { lecture: 'a'.repeat(300_000) });
    assert.equal(large.status, 413);
    assert.equal(calls, 0);
  });
});

test('valid lecture goes through provider, schema and all grounding checks', async () => {
  const generator = createStudyGenerator(async ({ lecture: received }) => {
    assert.equal(received, lecture);
    return { text: JSON.stringify(makeEnvelope()), status: 'completed' };
  });
  await withApi({ generator, model: 'test-model' }, async (url) => {
    const response = await post(url, { lecture });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result.materials, makeMaterials());
    assert.deepEqual(result.grounding, { verified: true, checkedQuotes: 11 });
    assert.equal(result.metadata.model, 'test-model');
    assert.ok(Number.isFinite(Date.parse(result.metadata.generatedAt)));
  });
});

test('valid material shape with an invented quote never reaches the user', async () => {
  const materials = makeMaterials();
  materials.keyPoints[0].sourceQuote = 'SECRET_FORGED_QUOTE is absent from the lecture.';
  await withApi({ generator: async () => materials }, async (url) => {
    const response = await post(url, { lecture });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.equal(JSON.parse(body).error.code, 'GROUNDING_FAILED');
    assert.doesNotMatch(body, /SECRET_FORGED_QUOTE/);
    assert.doesNotMatch(body, /materials/);
  });
});

test('malformed provider output and upstream errors return safe JSON errors', async () => {
  await withApi({ generator: createStudyGenerator(async () => ({ text: '{invalid' })) }, async (url) => {
    const response = await post(url, { lecture });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'INVALID_AI_RESPONSE');
  });
  await withApi({ generator: async () => { throw new Error('SECRET_PROVIDER_DETAILS sk-EXAMPLE'); } }, async (url) => {
    const response = await post(url, { lecture });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.doesNotMatch(body, /SECRET_PROVIDER_DETAILS|sk-EXAMPLE|stack/);
    assert.equal(JSON.parse(body).error.code, 'AI_ERROR');
  });
});

test('timeout aborts upstream and releases concurrency for a new request', async () => {
  let calls = 0;
  let aborted = false;
  await withApi({ timeoutMs: 30, generator: async (_lecture, signal) => {
    calls += 1;
    if (calls === 2) return makeMaterials();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      aborted = true;
      reject(signal.reason);
    }, { once: true }));
  } }, async (url) => {
    const response = await post(url, { lecture });
    assert.equal(response.status, 504);
    assert.equal((await response.json()).error.code, 'TIMEOUT');
    assert.equal(aborted, true);
    assert.equal((await post(url, { lecture })).status, 200);
  });
});

test('per-client rate limits return Retry-After', async () => {
  await withApi({ rateLimit: 1, generator: async () => makeMaterials() }, async (url) => {
    assert.equal((await post(url, { lecture })).status, 200);
    const limited = await post(url, { lecture });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  });
});

test('simultaneous requests are bounded', async () => {
  let release!: (materials: ReturnType<typeof makeMaterials>) => void;
  let started!: () => void;
  const isStarted = new Promise<void>((resolve) => { started = resolve; });
  await withApi({ generator: async () => {
    started();
    return new Promise((resolve) => { release = resolve; });
  } }, async (url) => {
    const first = post(url, { lecture });
    await isStarted;
    const second = await post(url, { lecture });
    assert.equal(second.status, 429);
    assert.equal((await second.json()).error.code, 'SERVER_BUSY');
    release(makeMaterials());
    assert.equal((await first).status, 200);
  });
});

test('disconnecting a client cancels its upstream generation', async () => {
  let started!: () => void;
  let cancelled!: () => void;
  const isStarted = new Promise<void>((resolve) => { started = resolve; });
  const isCancelled = new Promise<void>((resolve) => { cancelled = resolve; });
  await withApi({ generator: async (_lecture, signal) => {
    started();
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      cancelled();
      reject(signal.reason);
    }, { once: true }));
  } }, async (url) => {
    const request = httpRequest(`${url}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    request.on('error', () => {});
    request.end(JSON.stringify({ lecture }));
    await isStarted;
    request.destroy();
    await Promise.race([isCancelled, new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Upstream was not cancelled')), 1_000).unref())]);
  });
});
