import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeGlossary,
  normalizeTranslations,
  parseTranslationJson,
  splitBatches,
} from '../lib/translation.js'

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
