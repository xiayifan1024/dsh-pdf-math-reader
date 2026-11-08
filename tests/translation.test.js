import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeGlossary,
  normalizeTranslations,
  parseTranslationJson,
  splitBatches,
  translationPrompt,
} from '../lib/translation.js'
import {
  listPlaceholders,
  restorePlaceholders,
  validatePlaceholders,
} from '../lib/placeholders.js'

test('parses one translation per segment', () => {
  assert.deepEqual(parseTranslationJson('{"translations":["甲","乙"]}', 2), ['甲', '乙'])
  assert.deepEqual(parseTranslationJson('["a","b"]', 2), ['a', 'b'])
  assert.deepEqual(parseTranslationJson('```json\n{"translations":["a"]}\n```', 1), ['a'])
})

test('rejects malformed structured output instead of passing raw JSON through', () => {
  assert.equal(parseTranslationJson('{"translations":["one","two"]}', 1), undefined)
  assert.equal(parseTranslationJson('[1, 2]', 2), undefined)
  assert.equal(parseTranslationJson('not json', 2), undefined)
})

test('accepts a plain line fallback only for unstructured text', () => {
  assert.deepEqual(parseTranslationJson('甲\n乙', 2), ['甲', '乙'])
  assert.equal(parseTranslationJson('"one"', 1), undefined)
})

test('normalizes glossary entries and deduplicates by source', () => {
  assert.deepEqual(
    normalizeGlossary([
      { source: 'Transformer', target: 'Transformer' },
      { source: 'transformer', target: '重复' },
      { source: '', target: 'x' },
    ]),
    [{ source: 'Transformer', target: 'Transformer' }],
  )
})

test('splits batches by count and character budget', () => {
  const batches = splitBatches(
    [
      { id: 'a', text: '12345' },
      { id: 'b', text: '12345' },
      { id: 'c', text: '12345' },
    ],
    { maxSegmentsPerRequest: 2, maxCharsPerRequest: 12 },
  )
  assert.deepEqual(
    batches.map((batch) => batch.map((item) => item.id)),
    [['a', 'b'], ['c']],
  )
})

test('normalizes translated values and keeps the source for empty output', () => {
  assert.deepEqual(
    normalizeTranslations(['译文', ''], [
      { id: 'p1', text: 'one' },
      { id: 'p2', text: 'two' },
    ]),
    [
      { id: 'p1', text: '译文' },
      { id: 'p2', text: 'two' },
    ],
  )
})

test('prompt tells the model that formula placeholders are opaque tokens', () => {
  const prompt = translationPrompt(
    'zh-CN',
    'en',
    [],
    [{ text: 'dimension ⟦MATH_001⟧' }],
  )
  assert.match(prompt, /⟦MATH_001⟧/)
  assert.match(prompt, /opaque token/)
  assert.match(prompt, /Never translate, split, merge/)
})

test('accepts a translation that preserves every formula placeholder once', () => {
  const source = 'dimension ⟦MATH_001⟧ and ⟦MATH_002⟧'
  const target = '维度 ⟦MATH_001⟧ 与 ⟦MATH_002⟧'
  assert.deepEqual(validatePlaceholders(source, target), {
    ok: true,
    missing: [],
    duplicated: [],
    unknown: [],
  })
  assert.deepEqual(listPlaceholders(target), ['⟦MATH_001⟧', '⟦MATH_002⟧'])
  assert.equal(
    restorePlaceholders(target, [
      { token: '⟦MATH_001⟧', text: 'd_k' },
      { token: '⟦MATH_002⟧', text: 'd_v' },
    ]),
    '维度 d_k 与 d_v',
  )
})

test('flags missing, duplicated, and unknown placeholders', () => {
  const source = 'value ⟦MATH_001⟧'
  assert.equal(validatePlaceholders(source, '值').reason, 'missing')
  assert.equal(
    validatePlaceholders(source, '值 ⟦MATH_001⟧ ⟦MATH_001⟧').reason,
    'duplicated',
  )
  assert.equal(validatePlaceholders(source, '值 ⟦MATH_002⟧').reason, 'unknown')
  assert.equal(validatePlaceholders(source, '值 ⟦MATH_999⟧').reason, 'unknown')
})

test('marks a translated segment as failed when it drops a placeholder', () => {
  const result = normalizeTranslations(['维度与'], [
    { id: 'p1', text: 'dimension ⟦MATH_001⟧ and ⟦MATH_002⟧' },
  ])
  assert.equal(result[0].error, 'placeholder')
  assert.equal(result[0].id, 'p1')
})

test('keeps a valid placeholder translation as a success', () => {
  const result = normalizeTranslations(['维度 ⟦MATH_001⟧'], [
    { id: 'p1', text: 'dimension ⟦MATH_001⟧' },
  ])
  assert.deepEqual(result, [{ id: 'p1', text: '维度 ⟦MATH_001⟧' }])
})
