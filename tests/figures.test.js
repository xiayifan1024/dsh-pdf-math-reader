import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import {
  assignFigureLabels,
  clusterArtworkBoxes,
  detectFigureRegions,
} from '../src/figures.js'
import { buildPageModel } from '../src/pdf.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs
const VIEWPORT = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800, scale: 1 }

function item(text, x, y, width, fontName = 'body', height = 10) {
  return {
    str: text,
    transform: [height, 0, 0, height, x, 800 - y],
    width,
    height,
    fontName,
  }
}

function atom(index, text, x, y, width, fontName = 'body', height = 10) {
  return {
    index,
    text,
    fontName,
    x,
    y,
    endX: x + width,
    width,
    height,
    top: y - height * 0.82,
    bottom: y + height * 0.18,
  }
}

test('clusters artwork boxes that are closer than the merge gap', () => {
  // The two boxes are 0.5pt apart; single-linkage must merge them into one
  // region even though they are separate drawing operations.
  const clusters = clusterArtworkBoxes(
    [
      [0, 0, 9.8, 10],
      [10.3, 0, 20, 10],
    ],
    { gap: 5 },
  )
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].count, 2)
})

test('merged side-by-side panels keep the full crop box', () => {
  const artwork = {
    images: [
      [100, 100, 200, 200],
      [200, 100, 300, 200],
    ],
    paths: [],
  }
  const regions = detectFigureRegions(artwork, { pageWidth: 612, pageHeight: 792 })
  assert.equal(regions.length, 1)
  assert.deepEqual(regions[0].bbox, [100, 100, 300, 200])
  assert.deepEqual(regions[0].imageBox, [100, 100, 300, 200])
})

test('mixed bitmap and vector panels keep the full crop box', () => {
  // Left half is a bitmap, right half is a panel drawn with vector paths. The
  // paths overlap the bitmap edge so they merge into one figure region.
  const cells = []
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      const x0 = 190 + column * 20
      const y0 = 100 + row * 20
      cells.push([x0, y0, x0 + 19, y0 + 19])
    }
  }
  const artwork = {
    images: [[100, 100, 200, 300]],
    paths: cells,
  }
  const regions = detectFigureRegions(artwork, { pageWidth: 612, pageHeight: 792 })
  const mixed = regions.find((region) => region.source === 'mixed')
  assert.ok(mixed, 'bitmap and vector panels should merge into one figure')
  assert.equal(mixed.bbox[0], 100)
  assert.equal(mixed.bbox[2], 389)
  // The crop uses the complete merged artwork box, not just the bitmap half.
  assert.deepEqual(mixed.imageBox, mixed.bbox)
})

test('keeps table rulings out of the figure list', () => {
  const rules = []
  for (let index = 0; index < 5; index += 1) {
    rules.push([100, 100 + index * 20, 400, 100.5 + index * 20])
    rules.push([100 + index * 60, 100, 100.5 + index * 60, 180])
  }
  const artwork = { images: [], paths: rules }
  assert.deepEqual(detectFigureRegions(artwork, { pageWidth: 612, pageHeight: 792 }), [])

  // A filled heat map with the same footprint is a figure.
  const cells = []
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 10; column += 1) {
      cells.push([100 + column * 20, 100 + row * 20, 118 + column * 20, 118 + row * 20])
    }
  }
  const regions = detectFigureRegions(
    { images: [], paths: cells },
    { pageWidth: 612, pageHeight: 792 },
  )
  assert.equal(regions.length, 1)
  assert.equal(regions[0].source, 'vector')
  assert.ok(regions[0].bbox[2] - regions[0].bbox[0] >= 190)
})

test('ignores tiny images such as logos and full-page scans', () => {
  const regions = detectFigureRegions(
    {
      images: [
        [10, 10, 24, 24],
        [0, 0, 612, 792],
        [180, 60, 430, 300],
      ],
      paths: [],
    },
    { pageWidth: 612, pageHeight: 792 },
  )
  assert.equal(regions.length, 1)
  assert.deepEqual(regions[0].bbox.map((value) => Math.round(value)), [180, 60, 430, 300])
})

test('attaches labels to a figure but leaves its caption in the text flow', () => {
  const atoms = [
    atom(0, 'Body paragraph above the figure.', 100, 60, 260),
    atom(1, 'Input', 120, 140, 40),
    atom(2, '→', 180, 140, 10, 'symbol'),
    atom(3, 'Output', 220, 140, 50),
    atom(4, 'Figure 1: Overview.', 120, 220, 160),
  ]
  const { figures, atomIds } = assignFigureLabels(
    atoms,
    [{ bbox: [100, 100, 300, 200], source: 'vector' }],
    { bodySize: 10 },
  )
  assert.equal(figures.length, 1)
  assert.equal(figures[0].labels.length, 1)
  assert.match(figures[0].labels[0].text, /Input/)
  assert.match(figures[0].labels[0].text, /Output/)
  assert.equal(figures[0].number, '1')
  assert.equal(atomIds.has(0), false, 'body text must stay in the text flow')
  assert.equal(atomIds.has(4), false, 'caption must stay in the text flow')
})

test('a figure label with arrows does not become a display equation', () => {
  const textContent = {
    items: [
      item('The encoder maps the input sequence to a representation.', 100, 60, 320),
      item('Input', 120, 140, 40),
      item('→', 180, 140, 10, 'symbol'),
      item('Output', 220, 140, 50),
      item('Figure 1: Overview.', 120, 220, 150),
      item('The decoder then produces the output sequence.', 100, 260, 300),
    ],
  }
  const regions = [{ bbox: [100, 100, 320, 205], source: 'vector' }]
  const model = buildPageModel(library, textContent, VIEWPORT, { pageIndex: 0, figures: regions })

  assert.equal(model.figures.length, 1)
  assert.equal(model.equations.length, 0)
  assert.deepEqual(
    model.paragraphs.filter((paragraph) => paragraph.text.includes('→')),
    [],
    'figure labels must not leak into paragraphs',
  )
  assert.ok(
    model.paragraphs.some((paragraph) => paragraph.text.startsWith('Figure 1:')),
    'the caption must still be translated as a paragraph',
  )
  assert.ok(model.paragraphs.some((paragraph) => paragraph.text.includes('encoder maps')))
  assert.match(model.figures[0].text, /Input/)
  assert.match(model.figures[0].text, /Output/)
  // The figure block keeps the artwork and its labels in one box.
  assert.ok(model.figures[0].bbox[1] <= 140)
  assert.ok(model.figures[0].bbox[3] >= 158)
})

test('removing a figure returns its labels to the text flow', () => {
  const textContent = {
    items: [
      item('Input', 120, 140, 40),
      item('→', 180, 140, 10, 'symbol'),
      item('Output', 220, 140, 50),
      item('Body paragraph below.', 100, 260, 200),
    ],
  }
  const regions = [{ bbox: [100, 100, 320, 205], source: 'vector' }]
  const model = buildPageModel(library, textContent, VIEWPORT, {
    pageIndex: 0,
    figures: regions,
    overrides: { added: [], removed: [], figures: [regions[0].bbox] },
  })
  assert.equal(model.figures.length, 0)
  assert.equal(model.figureRegions.length, 0)
  // The raw detection result survives so the removal can be undone later.
  assert.equal(model.figureRegionsRaw.length, 1)
  assert.deepEqual(model.figureRegionsRaw[0].bbox, regions[0].bbox)
  const restored = buildPageModel(library, textContent, VIEWPORT, {
    pageIndex: 0,
    figures: model.figureRegionsRaw,
  })
  assert.equal(restored.figures.length, 1)
  assert.ok(model.paragraphs.some((paragraph) => paragraph.text.includes('Input')))
  assert.ok(model.paragraphs.some((paragraph) => paragraph.text.includes('Output')))
})

test('regression: figure labels on the Attention paper become one figure block', async () => {
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
    const page = await document.getPage(13)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const { collectFigureRegions } = await import('../src/figures.js')
    const figures = await collectFigureRegions(page, library, viewport)
    assert.equal(figures.length, 1)
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 12, figures })

    assert.equal(model.figures.length, 1)
    const figure = model.figures[0]
    assert.equal(figure.figureNumber, '3')
    assert.ok(figure.labelCount >= 8, `only ${figure.labelCount} labels were attached`)
    assert.ok(figure.labels.some((line) => line.text.includes('majority')))
    assert.ok(figure.labels.some((line) => line.text.includes('EOS')))
    assert.deepEqual(
      model.paragraphs.filter((paragraph) => paragraph.text === 'majority'),
      [],
      'a single label must not become its own paragraph',
    )
    assert.ok(
      model.paragraphs.some((paragraph) => paragraph.text.startsWith('Figure 3:')),
      'the caption must remain a translatable paragraph',
    )
    assert.equal(model.equations.length, 0)
  } finally {
    await document.destroy()
  }
})

test('regression: the Attention architecture figure keeps its caption number', async () => {
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
    const page = await document.getPage(3)
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const { collectFigureRegions } = await import('../src/figures.js')
    const figures = await collectFigureRegions(page, library, viewport)
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 2, figures })

    assert.equal(model.figures.length, 1)
    assert.equal(model.figures[0].figureNumber, '1')
    assert.equal(model.figures[0].labelCount, 0)
    // The raster figure is drawn where the artwork is, not where its caption is.
    assert.ok(model.figures[0].bbox[1] < 200)
    assert.ok(model.figures[0].bbox[3] < 400)
    assert.equal(model.equations.length, 0)
  } finally {
    await document.destroy()
  }
})
