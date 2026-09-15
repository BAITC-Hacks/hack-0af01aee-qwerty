import assert from 'node:assert/strict';
import test from 'node:test';
import { zodTextFormat } from 'openai/helpers/zod';
import { generationResponseSchema, materialsSchema } from '../../shared/schema.js';
import { ApiError, InvalidGenerationError } from '../errors.js';
import { aiEnvelopeSchema, createStudyGenerator, type ProviderRequest } from '../generator.js';
import { materialQuotes, normalizeSource, verifyMaterialGrounding } from '../grounding.js';
import { lecture, makeEnvelope, makeMaterials, memoryQuote } from './fixtures.js';

test('SDK converts the exact AI schema to strict JSON schema', () => {
  const format = zodTextFormat(aiEnvelopeSchema, 'study_materials');
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.equal(format.schema.type, 'object');
  assert.equal(format.schema.additionalProperties, false);
});

test('grounding accepts normalized whitespace, unicode width and case', () => {
  assert.equal(normalizeSource('  Ａ\n B  '), 'a b');
  const materials = makeMaterials();
  materials.summary.overview.sourceQuote = memoryQuote.toUpperCase().replaceAll(' ', '\n  ');
  assert.equal(verifyMaterialGrounding(lecture, materials), 11);
});

test('every displayed source location is checked, including overview and conclusion', async (t) => {
  const quotes = materialQuotes(makeMaterials());
  assert.equal(quotes.length, 11);
  for (const { path } of quotes) {
    await t.test(path, () => {
      const materials = makeMaterials();
      const keys = path.split('.');
      let target: any = materials;
      for (const key of keys.slice(0, -1)) target = target[key];
      target[keys.at(-1)!] = 'Это выдуманная цитата, которой нет в исходной лекции.';
      assert.throws(() => verifyMaterialGrounding(lecture, materials), InvalidGenerationError);
    });
  }
});

test('schema rejects out-of-bounds answers, duplicated options and IDs', () => {
  for (const mutate of [
    (m: ReturnType<typeof makeMaterials>) => { m.quiz[0].correctAnswer = 4; },
    (m: ReturnType<typeof makeMaterials>) => { m.quiz[0].options[1] = m.quiz[0].options[0].toUpperCase(); },
    (m: ReturnType<typeof makeMaterials>) => { m.quiz[1].id = m.quiz[0].id; },
    (m: ReturnType<typeof makeMaterials>) => { m.flashcards[1].id = m.flashcards[0].id; },
    (m: ReturnType<typeof makeMaterials>) => { m.quiz[0].options.pop(); },
  ]) {
    const materials = makeMaterials();
    mutate(materials);
    assert.equal(materialsSchema.safeParse(materials).success, false);
  }
});

test('client response schema requires a verified server result', () => {
  const response = { materials: makeMaterials(), grounding: { verified: true, checkedQuotes: 11 }, metadata: { model: 'test-model', generatedAt: new Date().toISOString() } };
  assert.equal(generationResponseSchema.safeParse(response).success, true);
  assert.equal(generationResponseSchema.safeParse({ ...response, grounding: { verified: false, checkedQuotes: 0 } }).success, false);
});

test('coherent generated envelope is validated and returned', async () => {
  const generate = createStudyGenerator(async (request) => {
    assert.equal(request.lecture, lecture);
    return { text: JSON.stringify(makeEnvelope()), status: 'completed' };
  });
  assert.deepEqual(await generate(lecture, new AbortController().signal), makeMaterials());
});

test('malformed JSON is repaired once with the same lecture', async () => {
  const requests: ProviderRequest[] = [];
  const generate = createStudyGenerator(async (request) => {
    requests.push(request);
    return { text: requests.length === 1 ? '{broken' : JSON.stringify(makeEnvelope()) };
  });
  await generate(lecture, new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].lecture, lecture);
  assert.match(requests[1].repairFeedback!, /Invalid JSON/);
});

test('persistent malformed output is rejected after exactly two calls', async () => {
  let calls = 0;
  const generate = createStudyGenerator(async () => { calls += 1; return { text: '{broken' }; });
  await assert.rejects(generate(lecture, new AbortController().signal), InvalidGenerationError);
  assert.equal(calls, 2);
});

test('analysis quotes must exist in the lecture too', async () => {
  const envelope = makeEnvelope();
  envelope.analysis.facts[0].sourceQuote = 'Такого фрагмента в данной лекции нет.';
  const generate = createStudyGenerator(async () => ({ text: JSON.stringify(envelope) }));
  await assert.rejects(generate(lecture, new AbortController().signal), (error) => error instanceof InvalidGenerationError && error.groundingFailed);
});

test('a refusal is shown as a safe error and is never retried', async () => {
  let calls = 0;
  const generate = createStudyGenerator(async () => { calls += 1; return { text: '', refused: true }; });
  await assert.rejects(generate(lecture, new AbortController().signal), (error) => error instanceof ApiError && error.code === 'AI_REFUSAL');
  assert.equal(calls, 1);
});

test('insufficient lecture content is rejected without fabricated materials', async () => {
  const envelope = { ...makeEnvelope(), analysis: { ...makeEnvelope().analysis, suitable: false }, materials: null };
  const generate = createStudyGenerator(async () => ({ text: JSON.stringify(envelope) }));
  await assert.rejects(generate(lecture, new AbortController().signal), (error) => error instanceof ApiError && error.code === 'INSUFFICIENT_CONTENT');
});

test('incomplete output is retried, cancellation prevents any provider request', async () => {
  let calls = 0;
  const generate = createStudyGenerator(async () => {
    calls += 1;
    return { text: JSON.stringify(makeEnvelope()), status: calls === 1 ? 'incomplete' : 'completed' };
  });
  await generate(lecture, new AbortController().signal);
  assert.equal(calls, 2);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(generate(lecture, controller.signal));
  assert.equal(calls, 2);
});
