/**
 * Canvas-queue behaviour, exercised with a stub canvas and page.
 *
 * The two invariants here are the ones a browser cannot verify cheaply: a slow
 * snapshot must not hold back the page that is already painted, and the next page
 * must be able to start drawing while the previous snapshot is still copying.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  drawPdfRaster,
  pdfPixelRatio,
  renderPdfPage,
  supportsRasterSnapshot,
} from '../src/pdf.js'

function fakeCanvas() {
  const context = {
    setTransform() {},
    fillRect() {},
    drawImage() {},
  }
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: () => context,
  }
}

function fakePage(onRender) {
  return {
    getViewport: ({ scale }) => ({
      width: 100 * scale,
      height: 200 * scale,
      scale,
    }),
    render() {
      onRender?.()
      return { promise: Promise.resolve(), cancel() {} }
    },
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function stubEnvironment(t) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousBitmap = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap')
  globalThis.window = { devicePixelRatio: 2 }
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window
    else Object.defineProperty(globalThis, 'window', previousWindow)
    if (previousBitmap === undefined) delete globalThis.createImageBitmap
    else Object.defineProperty(globalThis, 'createImageBitmap', previousBitmap)
  })
}

test('a slow snapshot does not delay the page becoming ready', async (t) => {
  stubEnvironment(t)
  const copy = deferred()
  globalThis.createImageBitmap = () => copy.promise

  const canvas = fakeCanvas()
  const result = await renderPdfPage(fakePage(), canvas, 1, undefined, { snapshot: true })
  // The render task resolved even though the copy is still in flight.
  assert.equal(result.viewport.width, 100)
  let copied = false
  result.snapshot.then(() => {
    copied = true
  })
  await tick()
  assert.equal(copied, false)

  copy.resolve({ width: 100, height: 200 })
  const bitmap = await result.snapshot
  assert.equal(bitmap.width, 100)
})

test('the next page starts drawing while the previous snapshot is copying', async (t) => {
  stubEnvironment(t)
  const copy = deferred()
  globalThis.createImageBitmap = () => copy.promise

  const order = []
  const canvas = fakeCanvas()
  const first = await renderPdfPage(fakePage(() => order.push('render-a')), canvas, 1, undefined, {
    snapshot: true,
  })
  order.push('a-ready')
  await renderPdfPage(fakePage(() => order.push('render-b')), canvas, 1, undefined, {})
  // Page B rendered although page A's copy has not resolved.
  assert.deepEqual(order, ['render-a', 'a-ready', 'render-b'])

  let copied = false
  first.snapshot.then(() => {
    copied = true
  })
  await tick()
  assert.equal(copied, false)
  copy.resolve({ width: 100, height: 200 })
  await first.snapshot
})

test('a snapshot is only started when the caller asks for one', async (t) => {
  stubEnvironment(t)
  let calls = 0
  globalThis.createImageBitmap = () => {
    calls += 1
    return Promise.resolve({ width: 1, height: 1 })
  }
  const result = await renderPdfPage(fakePage(), fakeCanvas(), 1, undefined)
  assert.equal(result.snapshot, null)
  assert.equal(calls, 0)
})

test('a failing snapshot resolves to null instead of rejecting the page', async (t) => {
  stubEnvironment(t)
  globalThis.createImageBitmap = () => Promise.reject(new Error('no readback'))
  const result = await renderPdfPage(fakePage(), fakeCanvas(), 1, undefined, { snapshot: true })
  assert.equal(await result.snapshot, null)
})

test('raster painting uses the bitmap pixels and the target CSS size', async (t) => {
  stubEnvironment(t)
  const canvas = fakeCanvas()
  await drawPdfRaster(canvas, { width: 800, height: 1000 }, 400, 500)
  assert.equal(canvas.width, 800)
  assert.equal(canvas.height, 1000)
  assert.equal(canvas.style.width, '400px')
  assert.equal(canvas.style.height, '500px')
})

test('the device pixel ratio is capped for every raster', (t) => {
  stubEnvironment(t)
  assert.equal(pdfPixelRatio(), 2)
  globalThis.window.devicePixelRatio = 1.25
  assert.equal(pdfPixelRatio(), 1.25)
  globalThis.window.devicePixelRatio = 4
  assert.equal(pdfPixelRatio(), 2)
})

test('snapshot support follows the platform capability', (t) => {
  stubEnvironment(t)
  globalThis.createImageBitmap = () => Promise.resolve(null)
  assert.equal(supportsRasterSnapshot(), true)
  delete globalThis.createImageBitmap
  assert.equal(supportsRasterSnapshot(), false)
})
