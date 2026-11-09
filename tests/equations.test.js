import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import {
  analyzeEquations,
  cropMetrics,
  splitTextAtom,
} from '../src/equations.js'
import { buildPageModel } from '../src/pdf.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs

function atom(index, text, fontName, x, y, width, height = 10) {
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

function syntheticEquationAtoms() {
  return [
    atom(0, 'The matrix of outputs is computed below', 'body', 100, 80, 260),
    atom(1, 'Attention(', 'math', 200, 100, 45),
    atom(2, 'Q, K, V', 'italic', 246, 100, 31),
    atom(3, ') = softmax(', 'math', 278, 100, 55),
    atom(4, 'V', 'italic', 334, 100, 6),
    atom(5, 'QK', 'italic', 335, 93, 16),
    atom(6, 'T', 'script', 352, 89, 5, 7),
    atom(7, '√', 'symbol', 337, 100.5, 8),
    atom(8, 'd', 'italic', 346, 107, 5),
    atom(9, 'k', 'script', 351, 108.5, 4, 7),
    atom(10, '(1)', 'body', 450, 100, 11),
    atom(11, 'The two most commonly used attention functions are additive', 'body', 100, 120, 300),
    atom(12, 'dimension', 'body', 100, 140, 40),
    atom(13, 'd', 'italic', 142, 140, 5),
    atom(14, 'k', 'script', 147, 141.5, 4, 7),
    atom(15, 'and value', 'body', 153, 140, 55),
  ]
}

test('assembles a numbered equation from out-of-order fraction fragments', () => {
  const atoms = syntheticEquationAtoms()
  const analysis = analyzeEquations(atoms, { pageWidth: 612, pageHeight: 792 })
  assert.equal(analysis.equations.length, 1)
  const equation = analysis.equations[0]
  assert.equal(equation.equationNumber, '(1)')
  assert.match(equation.text, /Attention/)
  assert.match(equation.text, /softmax/)
  assert.match(equation.text, /\(1\)/)
  assert.ok(equation.bbox[0] <= 200)
  assert.ok(equation.bbox[2] >= 461)
  assert.ok(equation.bbox[1] <= 89)
  assert.ok(equation.bbox[3] >= 109)
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.ok(equation.sourceItemIds.includes(index), `missing fragment ${index}`)
  }
  assert.ok(analysis.equationAtomIds.has(5))
  assert.ok(analysis.equationAtomIds.has(8))
})

test('keeps inline scripts out of the equation list but marks them as math', () => {
  const atoms = syntheticEquationAtoms()
  const analysis = analyzeEquations(atoms, { pageWidth: 612, pageHeight: 792 })
  assert.ok(analysis.inlineMath.has(13))
  assert.ok(analysis.inlineMath.has(14))
  assert.ok(!analysis.equationAtomIds.has(13))
})

test('does not treat table cells such as O(1) as equation numbers', () => {
  const atoms = [
    atom(0, 'Complexity per Layer', 'body', 120, 100, 120),
    atom(1, 'O(n', 'math', 260, 100, 18),
    atom(2, '2', 'script', 278, 98.5, 4, 7),
    atom(3, ' · d)', 'math', 282, 100, 20),
    atom(4, 'O(1)', 'math', 360, 100, 24),
    atom(5, 'O(n)', 'math', 440, 100, 24),
    atom(6, 'O(1)', 'math', 360, 112, 24),
    atom(7, 'O(n)', 'math', 440, 112, 24),
  ]
  const analysis = analyzeEquations(atoms, { pageWidth: 612, pageHeight: 792 })
  assert.equal(analysis.equations.length, 0)
})

test('manual overrides can remove an automatic equation and add a boxed region', () => {
  const atoms = syntheticEquationAtoms()
  const base = analyzeEquations(atoms, { pageWidth: 612, pageHeight: 792 })
  const removed = analyzeEquations(atoms, {
    pageWidth: 612,
    pageHeight: 792,
    overrides: { removed: [base.equations[0].bbox], added: [] },
  })
  assert.equal(removed.equations.length, 0)

  const manual = analyzeEquations(atoms, {
    pageWidth: 612,
    pageHeight: 792,
    overrides: { removed: [], added: [{ bbox: [196, 84, 465, 112] }] },
  })
  assert.equal(manual.equations.length, 1)
  assert.equal(manual.equations[0].detectionSource, 'manual')
  assert.equal(manual.equations[0].equationNumber, '(1)')
  for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    assert.ok(
      manual.equations[0].sourceItemIds.includes(index),
      `manual box missed fragment ${index}`,
    )
  }
})

test('keeps a two-column equation inside its own column', () => {
  const atoms = []
  let index = 0
  const add = (text, font, x, y, width, height = 10) => {
    atoms.push(atom(index, text, font, x, y, width, height))
    index += 1
  }
  for (let line = 0; line < 5; line += 1) {
    add(`Left column body line number ${line} with enough text`, 'body', 50, 100 + line * 12, 220)
  }
  for (let line = 0; line < 5; line += 1) {
    add(`Right column body line number ${line} with enough text`, 'body', 330, 100 + line * 12, 220)
  }
  // Left-column line shares the formula baseline.
  add('left text on the equation baseline', 'body', 50, 300, 220)
  // Right-column display equation with its number at the column edge.
  add('y', 'math', 380, 300, 8)
  add(' = ', 'math', 390, 300, 14)
  add('f(x)', 'math', 406, 300, 30)
  add('(1)', 'body', 520, 300, 12)

  const analysis = analyzeEquations(atoms, { pageWidth: 612, pageHeight: 792 })
  assert.equal(analysis.columns.length, 2)
  const equation = analysis.equations.find((entry) => entry.equationNumber === '(1)')
  assert.ok(equation, 'right-column equation was not detected')
  assert.ok(equation.bbox[0] >= 330, `bbox leaked into left column: ${equation.bbox[0]}`)
  assert.ok(equation.bbox[2] > 500)
  assert.equal(
    equation.sourceItemIds.some((id) => id < 11),
    false,
    'left-column text was captured by the right-column equation',
  )
})

test('splits a mixed prose/math text item without losing the sentence', () => {
  const mixed = atom(
    20,
    'increased the maximum output length to input length +',
    'body',
    108,
    269.6,
    216.7,
  )
  const parts = splitTextAtom(mixed)
  assert.equal(parts.length, 2)
  assert.equal(parts[0].text, 'increased the maximum output length to input length ')
  assert.equal(parts[1].text, '+')
  assert.ok(parts[0].index !== parts[1].index)
  assert.equal(parts[0].sourceIndex, 20)
  assert.equal(parts[1].sourceIndex, 20)
  assert.ok(Math.abs(parts[0].x - mixed.x) < 1e-9)
  assert.ok(Math.abs(parts[1].endX - mixed.endX) < 1e-9)
  assert.equal(parts.map((part) => part.text).join(''), mixed.text)
})

test('does not expand a formula span across ordinary short words', () => {
  const viewport = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800, scale: 1 }
  const model = buildPageModel(
    library,
    {
      items: [
        {
          str: 'The value of x = y is a scalar.',
          transform: [10, 0, 0, 10, 100, 700],
          width: 210,
          height: 10,
          hasEOL: true,
        },
      ],
    },
    viewport,
    { pageIndex: 0 },
  )
  const paragraph = model.paragraphs[0]
  assert.equal(paragraph.text, 'The value of x = y is a scalar.')
  assert.match(paragraph.translateText, /^The value of ⟦MATH_\d+⟧ is a scalar\.$/)
  assert.deepEqual(
    paragraph.placeholders.map((entry) => entry.text),
    ['x = y'],
  )
})

test('crop sizing respects the pixel budget and device ratio', () => {
  const bbox = [0, 0, 300, 80]
  const metrics = cropMetrics(bbox, { displayWidth: 600, devicePixelRatio: 2 })
  assert.equal(metrics.displayWidth, 600)
  assert.ok(metrics.pixelWidth >= 1000)
  assert.ok(metrics.pixelWidth * metrics.pixelHeight <= 4000000)

  const huge = cropMetrics([0, 0, 1000, 900], {
    displayWidth: 1000,
    devicePixelRatio: 4,
    maxPixels: 100000,
  })
  assert.ok(huge.pixelWidth * huge.pixelHeight <= 100000)
  assert.ok(huge.pixelWidth <= 8192 && huge.pixelHeight <= 8192)
})

async function openFixturePage(pageNumber) {
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
  const page = await document.getPage(pageNumber)
  return { document, page }
}

test('regression: Attention paper equation (1) is one complete block', async () => {
  const { document, page } = await openFixturePage(4)
  try {
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 3 })
    const equation = model.equations.find((entry) => entry.equationNumber === '(1)')
    assert.ok(equation, 'equation (1) was not detected')
    const equationPosition = model.blocks.findIndex(
      (block) => block.id === equation.id,
    )
    assert.ok(equationPosition > 0, 'equation block should sit in reading order')
    assert.ok(
      model.blocks.slice(0, equationPosition).every((block) => block.type === 'paragraph'),
    )
    assert.equal(
      model.paragraphs.length,
      model.blocks.filter((block) => block.type === 'paragraph').length,
    )
    assert.match(equation.text, /Attention/)
    assert.match(equation.text, /softmax/)
    assert.match(equation.text, /\(1\)/)
    assert.ok(equation.bbox[0] < 225, `bbox left ${equation.bbox[0]}`)
    assert.ok(equation.bbox[2] > 500, `bbox right ${equation.bbox[2]}`)
    assert.ok(equation.bbox[1] < 470, `bbox top ${equation.bbox[1]}`)
    assert.ok(equation.bbox[3] > 488, `bbox bottom ${equation.bbox[3]}`)
    assert.equal(equation.latex, null)
    assert.equal(equation.detectionSource, 'automatic')
    assert.ok(
      equation.imageBbox[2] < equation.bbox[2] - 50,
      'crop should exclude the right-aligned number gutter',
    )
    assert.ok(equation.imageBbox[2] > 380)

    const fragments = model.paragraphs.filter(
      (paragraph) =>
        /^(QK|\(1\)|\)|√)/.test(paragraph.text) ||
        paragraph.text.includes('= softmax(') ||
        /^Attention\(/.test(paragraph.text),
    )
    assert.deepEqual(fragments.map((paragraph) => paragraph.text), [])

    const dimension = model.paragraphs.find((paragraph) =>
      paragraph.text.includes('queries and keys of dimension'),
    )
    assert.ok(dimension, 'surrounding paragraph missing')
    assert.ok(dimension.translateText.includes('⟦MATH_'))
    assert.ok(dimension.placeholders.some((entry) => entry.text.includes('d')))
    assert.ok(dimension.placeholders.some((entry) => entry.text.includes('k')))

    // Equation bboxes stay in page points at every zoom; only line and
    // highlight coordinates scale with the viewport.
    const zoomed = buildPageModel(
      library,
      textContent,
      page.getViewport({ scale: 2 }),
      { pageIndex: 3 },
    )
    const zoomedEquation = zoomed.equations.find((entry) => entry.equationNumber === '(1)')
    assert.ok(zoomedEquation)
    for (let index = 0; index < 4; index += 1) {
      assert.ok(Math.abs(zoomedEquation.bbox[index] - equation.bbox[index]) < 0.5)
    }
    const firstLine = zoomed.paragraphs[0].lines[0]
    const firstLineOne = model.paragraphs[0].lines[0]
    assert.ok(Math.abs(firstLine.x - firstLineOne.x * 2) < 0.5)

    const removed = buildPageModel(library, textContent, viewport, {
      pageIndex: 3,
      overrides: { removed: [equation.bbox], added: [] },
    })
    assert.equal(removed.equations.length, 0)
    assert.ok(
      removed.paragraphs.some((paragraph) => paragraph.text.startsWith('Attention(')),
      'removing an equation should return its fragments to the text flow',
    )

    const manual = buildPageModel(library, textContent, viewport, {
      pageIndex: 3,
      overrides: { removed: [], added: [{ bbox: equation.bbox }] },
    })
    assert.equal(manual.equations.length, 1)
    assert.equal(manual.equations[0].detectionSource, 'manual')
    assert.equal(manual.equations[0].equationNumber, '(1)')
  } finally {
    await document.destroy()
  }
})

test('regression: Attention paper equation (2) is complete and the table stays text', async () => {
  const fourth = await openFixturePage(6)
  try {
    const viewport = fourth.page.getViewport({ scale: 1 })
    const textContent = await fourth.page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 5 })
    assert.equal(
      model.equations.some((equation) => equation.text.startsWith('Complexity per Layer')),
      false,
    )
    assert.equal(
      model.equations.some((equation) => equation.equationNumber === '(1)'),
      false,
    )
    assert.ok(model.equations.some((equation) => equation.text.includes('sin(pos')))
  } finally {
    await fourth.document.destroy()
  }

  const thirteenth = await openFixturePage(13)
  try {
    const viewport = thirteenth.page.getViewport({ scale: 1 })
    const textContent = await thirteenth.page.getTextContent({ includeMarkedContent: false })
    // Figure labels are attributed to the figure (see figures.test.js); they
    // must never surface as body paragraphs or as placeholder carriers.
    const { collectFigureRegions } = await import('../src/figures.js')
    const figures = await collectFigureRegions(thirteenth.page, library, viewport)
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 12, figures })
    assert.equal(
      model.paragraphs.some((entry) => entry.text.includes('this spirit')),
      false,
      'a figure label must not become a paragraph',
    )
    assert.equal(model.figures.length, 1)
    assert.equal(model.equations.length, 0)
  } finally {
    await thirteenth.document.destroy()
  }

  const tenth = await openFixturePage(10)
  try {
    const viewport = tenth.page.getViewport({ scale: 1 })
    const textContent = await tenth.page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 9 })
    const paragraph = model.paragraphs.find((entry) =>
      entry.text.includes('increased the maximum output length'),
    )
    assert.ok(paragraph, 'mixed prose/math paragraph missing')
    assert.match(
      paragraph.text,
      /increased the maximum output length to input length \+ 300\./,
    )
    assert.match(
      paragraph.translateText,
      /increased the maximum output length to input length ⟦MATH_\d+⟧ 300\./,
    )
    assert.ok(
      paragraph.placeholders.some((entry) => entry.text === '+'),
      'the operator should still be protected by a placeholder',
    )
    assert.doesNotMatch(paragraph.translateText, /^⟦MATH_\d+⟧/)
  } finally {
    await tenth.document.destroy()
  }

  const fifth = await openFixturePage(5)
  try {
    const viewport = fifth.page.getViewport({ scale: 1 })
    const textContent = await fifth.page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 4 })
    const equation = model.equations.find((entry) => entry.equationNumber === '(2)')
    assert.ok(equation, 'equation (2) was not detected')
    assert.match(equation.text, /FFN/)
    assert.match(equation.text, /max\(0/)
    assert.match(equation.text, /\(2\)/)
    assert.ok(equation.bbox[1] < 570, `bbox top ${equation.bbox[1]}`)
    assert.ok(equation.bbox[3] > 578, `bbox bottom ${equation.bbox[3]}`)
    assert.equal(
      model.paragraphs.some((paragraph) => /^FFN\(/.test(paragraph.text)),
      false,
    )
  } finally {
    await fifth.document.destroy()
  }
})
