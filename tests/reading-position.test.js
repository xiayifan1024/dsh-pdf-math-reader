import assert from 'node:assert/strict'
import test from 'node:test'
import {
  READING_POSITION_KEY,
  READING_POSITION_LIMIT,
  clearReadingPositions,
  forgetReadingPosition,
  loadReadingPositions,
  readingPositionFor,
  rememberReadingPosition,
  sanitizeReadingPositions,
  saveReadingPositions,
  updateReadingPosition,
} from '../src/reading-position.js'

/** In-memory stand-in for `window.localStorage`. */
function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    dump: () => Object.fromEntries(values),
  }
}

const fingerprint = 'paper.pdf:1024:1700000000000'

test('a position round-trips through storage', () => {
  const storage = memoryStorage()
  const positions = rememberReadingPosition({}, fingerprint, 7, 1000)
  saveReadingPositions(positions, storage)
  assert.ok(Object.hasOwn(storage.dump(), READING_POSITION_KEY))
  assert.deepEqual(loadReadingPositions(storage), {
    [fingerprint]: { pageIndex: 7, updatedAt: 1000 },
  })
})

test('saving uses the documented key and reading tolerates bad JSON', () => {
  const storage = memoryStorage({ [READING_POSITION_KEY]: '{not json' })
  assert.deepEqual(loadReadingPositions(storage), {})
  saveReadingPositions({ [fingerprint]: { pageIndex: 2, updatedAt: 5 } }, storage)
  assert.deepEqual(loadReadingPositions(storage), {
    [fingerprint]: { pageIndex: 2, updatedAt: 5 },
  })
})

test('sanitize drops malformed entries and keeps newest first', () => {
  const cleaned = sanitizeReadingPositions({
    a: { pageIndex: 3, updatedAt: 10 },
    b: { pageIndex: -1, updatedAt: 20 },
    c: { pageIndex: '4', updatedAt: 30 },
    d: null,
    e: { pageIndex: 1, updatedAt: 5 },
    '': { pageIndex: 0, updatedAt: 99 },
  })
  assert.deepEqual(Object.keys(cleaned), ['c', 'a', 'e'])
  assert.equal(cleaned.c.pageIndex, 4)
})

test('readingPositionFor rejects positions outside the document', () => {
  const positions = { [fingerprint]: { pageIndex: 7, updatedAt: 1 } }
  assert.equal(readingPositionFor(positions, fingerprint, 10), 7)
  assert.equal(readingPositionFor(positions, fingerprint, 7), null)
  assert.equal(readingPositionFor(positions, 'other.pdf:1:1', 10), null)
  assert.equal(readingPositionFor(positions, fingerprint, 0), null)
  assert.equal(readingPositionFor({}, fingerprint, 10), null)
})

test('remembering the same page keeps the object identity', () => {
  const first = rememberReadingPosition({}, fingerprint, 4, 100)
  assert.equal(rememberReadingPosition(first, fingerprint, 4, 200), first)
  const second = rememberReadingPosition(first, fingerprint, 5, 200)
  assert.notEqual(second, first)
  assert.equal(second[fingerprint].pageIndex, 5)
  assert.equal(second[fingerprint].updatedAt, 200)
})

test('the oldest documents are evicted past the limit', () => {
  let positions = {}
  for (let index = 0; index <= READING_POSITION_LIMIT; index += 1) {
    positions = rememberReadingPosition(positions, `doc-${index}`, 1, index + 1)
  }
  assert.equal(Object.keys(positions).length, READING_POSITION_LIMIT)
  assert.equal(Object.hasOwn(positions, 'doc-0'), false)
  assert.equal(Object.hasOwn(positions, `doc-${READING_POSITION_LIMIT}`), true)
})

test('one document can be forgotten and all positions cleared', async () => {
  const positions = { a: { pageIndex: 1, updatedAt: 1 }, b: { pageIndex: 2, updatedAt: 2 } }
  const withoutB = forgetReadingPosition(positions, 'b')
  assert.deepEqual(Object.keys(withoutB), ['a'])
  assert.equal(forgetReadingPosition(positions, 'missing'), positions)
  const storage = memoryStorage()
  saveReadingPositions(positions, storage)
  assert.equal(await clearReadingPositions(storage), true)
  assert.deepEqual(loadReadingPositions(storage), {})
})

test('clearing reports failure when storage cannot remove the record', async () => {
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {
      throw new Error('storage denied')
    },
  }
  assert.equal(await clearReadingPositions(storage), false)
  assert.equal(await clearReadingPositions(null), false)
})

test('interleaved readers preserve other documents and respect cleared history', async () => {
  const storage = memoryStorage()
  await updateReadingPosition('A', 2, storage)
  await updateReadingPosition('B', 3, storage)
  await updateReadingPosition('A', 5, storage)
  const reopened = loadReadingPositions(storage)
  assert.equal(readingPositionFor(reopened, 'A', 10), 5)
  assert.equal(readingPositionFor(reopened, 'B', 10), 3)
  await clearReadingPositions(storage)
  await updateReadingPosition('B', 4, storage)
  assert.deepEqual(Object.keys(loadReadingPositions(storage)), ['B'])
})
