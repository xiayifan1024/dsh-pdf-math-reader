import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import { rotateRegionBox } from '../src/pdf.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs

test('a rotated region maps to finite viewport coordinates', async () => {
  library.GlobalWorkerOptions.workerSrc = new URL(
    '../assets/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  const data = new Uint8Array(
    await readFile(new URL('./fixtures/attention.pdf', import.meta.url)),
  )
  const document = await library.getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise
  try {
    const page = await document.getPage(4)
    assert.equal(page.rotate, 0)
    const box = [100, 100, 300, 400]
    const rotated = rotateRegionBox(page, box, 90)
    assert.equal(rotated.rotation, 90)
    assert.ok(rotated.box.every(Number.isFinite))
    // A 90° turn on a 612 × 792 page swaps the crop dimensions.
    assert.deepEqual(rotated.box, [392, 100, 692, 300])
    for (const turn of [180, 270]) {
      const result = rotateRegionBox(page, box, turn)
      assert.ok(result.box.every(Number.isFinite))
    }
    assert.deepEqual(rotateRegionBox(page, box, 0), {
      box,
      rotation: undefined,
    })
  } finally {
    await document.destroy()
  }
})
