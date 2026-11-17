import { renderEquationCrop } from '../src/pdf.js'
import { PDFDocument, PDFName, PDFNumber, degrees } from 'pdf-lib'
import * as pdfjs from '../assets/pdf.min.mjs'
import { cropMetrics } from '../src/equations.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fileStem, saveFileName, saveRenderOptions, exportImagePdf, exportOrdinals } from '../src/figure-export.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs
library.GlobalWorkerOptions.workerSrc = new URL('../assets/pdf.worker.min.mjs', import.meta.url).href

test('figure save filename keeps the document, page and number', () => {
  assert.equal(
    saveFileName({
      documentName: 'Attention Is All You Need.pdf',
      pageIndex: 12,
      kind: 'figure',
      number: '3',
    }),
    'Attention-Is-All-You-Need-p13-figure-3.png',
  )
})

test('table and equation save filenames use their own labels', () => {
  assert.equal(
    saveFileName({ documentName: 'paper.pdf', pageIndex: 4, kind: 'table', number: 2 }),
    'paper-p5-table-2.png',
  )
  assert.equal(
    saveFileName({ documentName: 'paper.pdf', pageIndex: 2, kind: 'equation', number: '1a' }),
    'paper-p3-equation-1a.png',
  )
})

test('unnumbered figures omit the number suffix', () => {
  assert.equal(
    saveFileName({ documentName: 'paper.pdf', pageIndex: 0, kind: 'figure', number: null }),
    'paper-p1-figure.png',
  )
})

test('panels that share a caption number get a page-local ordinal', () => {
  assert.equal(
    saveFileName({
      documentName: 'paper.pdf',
      pageIndex: 3,
      kind: 'figure',
      number: '2',
      ordinal: 2,
    }),
    'paper-p4-figure-2-2.png',
  )
  assert.equal(
    saveFileName({
      documentName: 'paper.pdf',
      pageIndex: 3,
      kind: 'figure',
      number: '2',
      ordinal: 0,
    }),
    'paper-p4-figure-2.png',
  )
})

test('document names are sanitized without allowing path separators', () => {
  assert.equal(
    saveFileName({
      documentName: 'C:\\papers\\图 1?.pdf',
      pageIndex: 0,
      kind: 'figure',
      number: '1',
    }),
    'C-papers-图-1-p1-figure-1.png',
  )
  assert.equal(fileStem('...pdf'), 'document')
  assert.equal(fileStem(''), 'document')
})

test('long document names are capped', () => {
  const stem = fileStem(`${'a'.repeat(120)}.pdf`)
  assert.equal(stem.length, 80)
})

test('chosen DPI survives crop sizing and rotation; oversized crops stay bounded', () => {
  for (const dpi of [300, 600]) {
    for (const rotation of [0, 90, 180, 270]) {
      const box = [0, 0, 600, 300]
      const target = rotation % 180 ? [0, 0, 300, 600] : box
      const result = cropMetrics(target, saveRenderOptions(dpi, rotation))
      assert.ok(Math.abs(result.renderScale - dpi / 72) < 1e-9)
      assert.ok(Math.abs(result.pixelWidth - target[2] * dpi / 72) <= 1)
    }
  }
  const box = [0, 0, 3000, 4000]
  const result = cropMetrics(box, saveRenderOptions(600))
  assert.ok(result.pixelWidth * result.pixelHeight <= 32_000_000)
  assert.ok(Math.max(result.pixelWidth, result.pixelHeight) <= 8192)
})

// A 1x1 PNG stands in for the independently rendered crop; no original page
// streams/resources are supplied to the PDF writer.
const cropImage = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' }

test('image-only PDF has no hidden source text and preserves physical size and rotation', async () => {
  for (const unit of [1, 2]) {
    for (const intrinsic of [0, 90, 180, 270]) {
      const source = await PDFDocument.create()
      const page = source.addPage([600, 800])
      page.setCropBox(20, 30, 560, 740)
      page.node.set(PDFName.of('UserUnit'), PDFNumber.of(unit))
      page.setRotation(degrees(intrinsic))
      page.drawText('OUTSIDE CROP SECRET', { x: 30, y: 40, size: 16 })
      const input = await library.getDocument({ data: await source.save(), useSystemFonts: true }).promise
      try {
        const original = await input.getPage(1)
        const viewport = original.getViewport({ scale: 1 })
        const p1 = viewport.convertToViewportPoint(100, 570)
        const p2 = viewport.convertToViewportPoint(300, 650)
        const bbox = [Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1])]
        for (const rotation of [0, 90, 180, 270]) {
          const bytes = await exportImagePdf(cropImage, bbox, rotation)
          const output = await library.getDocument({ data: bytes, useSystemFonts: true }).promise
          try {
            const crop = await output.getPage(1)
            const view = crop.getViewport({ scale: 1 })
            const swap = (intrinsic + rotation) % 180 !== 0
            assert.equal(view.width, (swap ? 80 : 200) * unit)
            assert.equal(view.height, (swap ? 200 : 80) * unit)
            const text = await crop.getTextContent()
            assert.equal(text.items.length, 0)
            const operators = await crop.getOperatorList()
            assert.equal(operators.fnArray.filter(op => op === library.OPS.paintImageXObject).length, 1)
            assert.ok(!operators.fnArray.includes(library.OPS.paintFormXObjectBegin))
          } finally { await output.destroy() }
        }
      } finally { await input.destroy() }
    }
  }
})

test('cancelled PDF creation produces no output', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(exportImagePdf(cropImage, [0, 0, 100, 50], 0, controller.signal), { name: 'AbortError' })
  const during = new AbortController()
  const pending = exportImagePdf(cropImage, [0, 0, 100, 50], 0, during.signal)
  during.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('ordinals follow displayed order and cover equations and sanitized number collisions', () => {
  const blocks = [
    { id: 'p', type: 'paragraph' },
    { id: 'eq-b', type: 'equation' },
    { id: 'f-b', type: 'figure', figureNumber: '2A' },
    { id: 'table', type: 'figure', kind: 'table', tableNumber: '2a' },
    { id: 'eq-a', type: 'equation' },
    { id: 'f-a', type: 'figure', figureNumber: '2a' },
    { id: 'numbered-a', type: 'equation', equationNumber: '1' },
    { id: 'numbered-b', type: 'equation', equationNumber: '1' },
  ]
  const ordinals = exportOrdinals(blocks)
  assert.equal(ordinals.get('eq-b'), 1)
  assert.equal(ordinals.get('eq-a'), 2)
  assert.equal(ordinals.get('f-b'), 1)
  assert.equal(ordinals.get('f-a'), 2)
  assert.equal(ordinals.get('numbered-a'), 1)
  assert.equal(ordinals.get('numbered-b'), 2)
  assert.equal(ordinals.has('table'), false)
  const names = blocks.filter(b => b.type === 'equation').map(b => saveFileName({
    kind: 'equation', number: b.equationNumber, ordinal: ordinals.get(b.id),
  }))
  assert.equal(new Set(names).size, names.length)
})


test('PNG crop cancels the active PDF.js task and never serializes a cancelled image', async (t) => {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  t.after(() => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else delete globalThis.document
  })
  let serialized = false
  let canvas
  globalThis.document = { createElement() {
    canvas = {
      getContext: () => ({ fillRect() {} }),
      toDataURL() { serialized = true; return cropImage.dataUrl },
    }
    return canvas
  } }
  let rejectTask
  let cancelled = false
  const page = {
    getViewport: (options) => options,
    render() { return {
      promise: new Promise((resolve, reject) => { rejectTask = reject }),
      cancel() { cancelled = true; rejectTask(new DOMException('Aborted', 'AbortError')) },
    } },
  }
  const controller = new AbortController()
  const pending = renderEquationCrop(page, [0, 0, 600, 300], saveRenderOptions(600), controller.signal)
  assert.equal(canvas.width, 5000)
  assert.equal(canvas.height, 2500)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(cancelled)
  assert.equal(serialized, false)
  // A pre-cancelled save must not even allocate a canvas or start rendering.
  globalThis.document = { createElement() { throw new Error('Unexpected canvas allocation') } }
  await assert.rejects(renderEquationCrop(page, [0, 0, 600, 300], {}, controller.signal), { name: 'AbortError' })
})

test('small and wide crops request DPI directly, independent of preview CSS width clamps', () => {
  for (const width of [1, 20, 600, 1800]) {
    const options = saveRenderOptions(600)
    const metrics = cropMetrics([0, 0, width, 20], options)
    if (width * 600 / 72 <= 8192) assert.equal(metrics.renderScale, 600 / 72)
    assert.ok(metrics.pixelWidth <= 8192)
  }
})
