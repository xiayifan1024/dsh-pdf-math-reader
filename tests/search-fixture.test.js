import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import { buildAtoms } from '../src/pdf.js'
import { MAX_HITS_PER_PAGE, scanSearchPages, searchAtoms } from '../src/search.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs
library.GlobalWorkerOptions.workerSrc = new URL(
  '../assets/pdf.worker.min.mjs',
  import.meta.url,
).href

async function openFixture() {
  const data = new Uint8Array(
    await readFile(new URL('./fixtures/attention.pdf', import.meta.url)),
  )
  return await library.getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise
}

async function pageAtoms(document, pageNumber) {
  const page = await document.getPage(pageNumber)
  const content = await page.getTextContent({ includeMarkedContent: false })
  return buildAtoms(library, content, page.getViewport({ scale: 1 }))
}

test('the Attention fixture searches line-end hyphenation and highlights every hit', async () => {
  const document = await openFixture()
  const hyphenated = searchAtoms(await pageAtoms(document, 4), 'multiplicative')
  assert.equal(hyphenated.count, 1)
  assert.equal(hyphenated.highlightRects.length, 1)
  assert.equal(hyphenated.highlightRects[0].length, 2)
  assert.equal(hyphenated.hits[0].snippet.match, 'multiplicative')

  const compoundAtoms = await pageAtoms(document, 2)
  const compound = searchAtoms(compoundAtoms, 'sequence-aligned')
  assert.equal(compound.count, 2)
  assert.deepEqual(compound.highlightRects.map((rects) => rects.length), [2, 2])
  assert.equal(searchAtoms(compoundAtoms, 'sequencealigned').count, 2)

  const positionWise = searchAtoms(await pageAtoms(document, 3), 'position-wise')
  assert.equal(positionWise.count, 1)
  assert.equal(positionWise.highlightRects[0].length, 2)

  const commonAtoms = await pageAtoms(document, 5)
  const commonWord = searchAtoms(commonAtoms, 'the')
  assert.ok(commonWord.count > MAX_HITS_PER_PAGE)
  assert.equal(commonWord.hits.length, MAX_HITS_PER_PAGE)
  assert.equal(commonWord.highlightRects.length, commonWord.count)
  assert.ok(commonWord.highlightRects[commonWord.count - 1].length > 0)

  const scanned = await scanSearchPages({
    pageCount: 1,
    query: 'the',
    signal: new AbortController().signal,
    readAtoms: async () => commonAtoms,
  })
  assert.equal(scanned.pages[0].highlightRects.length, scanned.pages[0].count)
  await document.destroy()
})
