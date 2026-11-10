import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MODEL_CACHE_PAGES,
  RASTER_CACHE_BYTES,
  RASTER_CACHE_PAGES,
  createPageCaches,
  disposeCaches,
  invalidateModel,
  lookaheadIsUseful,
  rasterFitsBudget,
  readFigures,
  readModel,
  readRaster,
  readText,
  shareFigureTask,
  shareTextTask,
  writeFigures,
  writeModel,
  writeRaster,
  writeText,
} from '../src/cache.js'

const documentStub = () => ({ name: 'paper.pdf', ...createPageCaches() })

/** Minimal ImageBitmap stand-in: `bytes` and `closed` are all the cache needs. */
function bitmap(width, height) {
  return {
    width,
    height,
    closed: false,
    close() {
      this.closed = true
    },
  }
}

const raster = (width = 100, height = 100) => ({ bitmap: bitmap(width, height) })

test('a model is cached once per page and re-read without rebuilding', () => {
  const doc = documentStub()
  const model = { pageIndex: 3, blocks: [] }
  writeModel(doc, 3, model)
  assert.equal(readModel(doc, 3), model)
  assert.equal(readModel(doc, 4), undefined)
})

test('models are evicted least-recently-used and bounded per document', () => {
  const doc = documentStub()
  for (let page = 0; page < MODEL_CACHE_PAGES; page += 1) {
    writeModel(doc, page, { pageIndex: page })
  }
  assert.equal(doc.pageCache.size, MODEL_CACHE_PAGES)
  // Touching page 0 makes page 1 the oldest entry.
  readModel(doc, 0)
  writeModel(doc, MODEL_CACHE_PAGES, { pageIndex: MODEL_CACHE_PAGES })
  assert.equal(doc.pageCache.size, MODEL_CACHE_PAGES)
  assert.equal(readModel(doc, 1), undefined)
  assert.notEqual(readModel(doc, 0), undefined)
})

test('text and figure caches use their own bounds', () => {
  const doc = documentStub()
  writeText(doc, 0, { items: [] })
  writeFigures(doc, 0, [{ bbox: [0, 0, 1, 1] }])
  assert.deepEqual(readText(doc, 0), { items: [] })
  assert.deepEqual(readFigures(doc, 0), [{ bbox: [0, 0, 1, 1] }])
  assert.equal(doc.textCache.size, 1)
  assert.equal(doc.figureCache.size, 1)
})

test('a correction drops the model but keeps text, figures and the raster', () => {
  const doc = documentStub()
  writeText(doc, 5, { items: [{ str: 'x' }] })
  writeFigures(doc, 5, [{ bbox: [0, 0, 10, 10] }])
  writeRaster(doc, 5, raster())
  writeModel(doc, 5, { pageIndex: 5 })
  invalidateModel(doc, 5)
  assert.equal(readModel(doc, 5), undefined)
  assert.notEqual(readText(doc, 5), undefined)
  assert.notEqual(readFigures(doc, 5), undefined)
  assert.notEqual(readRaster(doc, 5), undefined)
})

test('rasters evict by page count and close released pixels', () => {
  const doc = documentStub()
  const rasters = []
  for (let page = 0; page < RASTER_CACHE_PAGES + 1; page += 1) {
    const entry = raster()
    rasters.push(entry)
    writeRaster(doc, page, entry)
  }
  assert.equal(doc.bitmapCache.size, RASTER_CACHE_PAGES)
  assert.equal(rasters[0].bitmap.closed, true)
  assert.equal(rasters[1].bitmap.closed, false)
})

test('rasters also evict by byte budget, oldest first', () => {
  const doc = documentStub()
  // Each raster is a quarter of the budget, so five of them must collapse to
  // fewer than four entries even though the page cap would allow three.
  const side = Math.sqrt(RASTER_CACHE_BYTES / 4 / 4)
  for (let page = 0; page < 5; page += 1) {
    writeRaster(doc, page, raster(side, side))
  }
  let bytes = 0
  for (const entry of doc.bitmapCache.values()) bytes += entry.bytes
  assert.ok(bytes <= RASTER_CACHE_BYTES)
  assert.ok(doc.bitmapCache.has(4))
})

test('a single oversized page is displayed but never cached', () => {
  const doc = documentStub()
  const side = Math.sqrt(RASTER_CACHE_BYTES)
  const entry = raster(side * 2, side * 2)
  writeRaster(doc, 0, entry)
  assert.equal(doc.bitmapCache.size, 0)
  assert.equal(entry.bitmap.closed, true)
})

test('an oversized raster keeps the pages that are already cached', () => {
  const doc = documentStub()
  const first = raster()
  const second = raster()
  writeRaster(doc, 0, first)
  writeRaster(doc, 1, second)
  const side = Math.sqrt(RASTER_CACHE_BYTES)
  const oversized = raster(side * 2, side * 2)
  writeRaster(doc, 2, oversized)
  // The newcomer is rejected before anything is evicted, so the cached pages the
  // reader can still turn back to survive.
  assert.equal(oversized.bitmap.closed, true)
  assert.equal(doc.bitmapCache.size, 2)
  assert.equal(doc.bitmapCache.has(0), true)
  assert.equal(doc.bitmapCache.has(1), true)
  assert.equal(first.bitmap.closed, false)
  assert.equal(second.bitmap.closed, false)
})

test('a stale capture cannot replace a newer raster of the same page', () => {
  const doc = documentStub()
  const newer = { ...raster(), version: 2 }
  writeRaster(doc, 0, newer)
  const stale = { ...raster(), version: 1 }
  writeRaster(doc, 0, stale)
  assert.equal(stale.bitmap.closed, true)
  assert.equal(doc.bitmapCache.get(0).version, 2)
  assert.equal(doc.bitmapCache.get(0).bitmap, newer.bitmap)
  assert.equal(newer.bitmap.closed, false)
})

test('a late snapshot of the page just left is still cached on 1 → 2 → 1', () => {
  const doc = documentStub()
  // Page 1 is on screen and snapshotted.
  writeRaster(doc, 0, { ...raster(), version: 1 })
  // The reader turns to page 2 before page 1's snapshot resolves; that snapshot
  // arrives after the turn and must be kept for the way back.
  writeRaster(doc, 1, { ...raster(), version: 3 })
  writeRaster(doc, 0, { ...raster(), version: 2 })
  assert.notEqual(readRaster(doc, 0), undefined)
  assert.notEqual(readRaster(doc, 1), undefined)
  assert.equal(doc.bitmapCache.size, 2)
})

test('rewriting a page releases the raster it replaces', () => {
  const doc = documentStub()
  const first = raster()
  writeRaster(doc, 2, first)
  const second = raster()
  writeRaster(doc, 2, second)
  assert.equal(first.bitmap.closed, true)
  assert.equal(second.bitmap.closed, false)
  assert.equal(doc.bitmapCache.size, 1)
})

test('disposing a document closes every raster and empties every cache', () => {
  const doc = documentStub()
  const entries = [raster(), raster(), raster()]
  entries.forEach((entry, page) => writeRaster(doc, page, entry))
  writeModel(doc, 0, { pageIndex: 0 })
  writeText(doc, 0, { items: [] })
  writeFigures(doc, 0, [])
  disposeCaches(doc)
  for (const entry of entries) assert.equal(entry.bitmap.closed, true)
  assert.equal(doc.bitmapCache.size, 0)
  assert.equal(doc.pageCache.size, 0)
  assert.equal(doc.textCache.size, 0)
  assert.equal(doc.figureCache.size, 0)
})

test('disposing without a document is harmless', () => {
  assert.doesNotThrow(() => disposeCaches(null))
  assert.doesNotThrow(() => disposeCaches(undefined))
})

test('the budget check rejects the rasters that could never be stored', () => {
  const side = Math.sqrt(RASTER_CACHE_BYTES / 4)
  assert.equal(rasterFitsBudget(side - 1, side - 1), true)
  assert.equal(rasterFitsBudget(side + 1, side + 1), false)
  assert.equal(rasterFitsBudget(612, 792), true)
  assert.equal(rasterFitsBudget(0, 100), false)
  assert.equal(rasterFitsBudget(100, -1), false)
  assert.equal(rasterFitsBudget(Number.NaN, 100), false)
})

test('read-ahead only serves the page in front of the reader', () => {
  assert.equal(lookaheadIsUseful(3, 2), true)
  // The reader turned onto the prefetched page: keeping it is still useful.
  assert.equal(lookaheadIsUseful(3, 3), true)
  assert.equal(lookaheadIsUseful(3, 1), false)
  assert.equal(lookaheadIsUseful(3, 4), false)
  assert.equal(lookaheadIsUseful(3, 10), false)
})

test('read-ahead deliberately keeps the next page over the page left behind', () => {
  const doc = documentStub()
  // Each page takes ~40% of the budget: two fit, three do not.
  const side = Math.sqrt(RASTER_CACHE_BYTES / 2.5 / 4)
  const first = raster(side, side)
  const second = raster(side, side)
  writeRaster(doc, 0, first)
  writeRaster(doc, 1, second)
  assert.equal(doc.bitmapCache.size, 2)

  // Prefetching the next page is allowed to evict the older one: reading forward
  // is the primary path, so the page in front wins over the page left behind.
  const prefetched = raster(side, side)
  writeRaster(doc, 2, prefetched)
  assert.equal(doc.bitmapCache.has(0), false)
  assert.equal(doc.bitmapCache.has(1), true)
  assert.equal(doc.bitmapCache.has(2), true)
  assert.equal(first.bitmap.closed, true)
  assert.equal(second.bitmap.closed, false)
  assert.equal(prefetched.bitmap.closed, false)
})

test('a prefetch and a foreground visit share one text extraction', async () => {
  const doc = documentStub()
  let calls = 0
  const factory = () => {
    calls += 1
    return new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 5))
  }
  const [first, second] = await Promise.all([
    shareTextTask(doc, 3, factory),
    shareTextTask(doc, 3, factory),
  ])
  assert.equal(calls, 1)
  assert.equal(first, second)
  // The slot clears once settled, so a later visit starts a fresh extraction.
  await shareTextTask(doc, 3, factory)
  assert.equal(calls, 2)
})

test('a failed extraction clears its slot so the next visit retries', async () => {
  const doc = documentStub()
  let calls = 0
  const failure = () => {
    calls += 1
    return Promise.reject(new Error('extraction failed'))
  }
  await assert.rejects(shareTextTask(doc, 1, failure))
  await assert.rejects(shareTextTask(doc, 1, failure))
  assert.equal(calls, 2)
})

test('text and figure extraction are shared independently per page', async () => {
  const doc = documentStub()
  let textCalls = 0
  let figureCalls = 0
  const text = () => {
    textCalls += 1
    return Promise.resolve({ items: [] })
  }
  const figures = () => {
    figureCalls += 1
    return Promise.resolve([])
  }
  await Promise.all([
    shareTextTask(doc, 2, text),
    shareFigureTask(doc, 2, figures),
    shareTextTask(doc, 4, text),
    shareFigureTask(doc, 4, figures),
  ])
  assert.equal(textCalls, 2)
  assert.equal(figureCalls, 2)
})

test('disposing a document also drops pending task slots', async () => {
  const doc = documentStub()
  const pending = shareTextTask(doc, 0, () => new Promise(() => {}))
  assert.equal(doc.textTasks.size, 1)
  disposeCaches(doc)
  assert.equal(doc.textTasks.size, 0)
  // The unending task is not awaited; silence its rejection path for the runner.
  void pending.catch(() => {})
})
