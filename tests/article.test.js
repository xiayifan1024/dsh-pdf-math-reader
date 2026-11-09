import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import { buildPageModel } from '../src/pdf.js'
import {
  composeReading,
  groupAbstract,
  isHeadingParagraph,
  joinText,
  splitSentences,
} from '../src/article.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs

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

function line(text, x, top, width, height = 10) {
  return { text, x, top, width, height }
}

function paragraph(id, text, x, top, width, height, order, lines = []) {
  const bbox = [x, top, x + width, top + height]
  const entry = {
    id,
    text,
    translateText: text,
    placeholders: [],
    x,
    top,
    right: x + width,
    bottom: top + height,
    height,
    bbox,
    order,
    lines: lines.length > 0 ? lines : [line(text, x, top, width, height)],
  }
  for (const item of entry.lines) item.paragraphId = id
  return entry
}

function syntheticModel() {
  const paragraphs = [
    paragraph('p0', 'A Very Long Paper Title', 150, 100, 300, 20, 0),
    paragraph('p1', 'That Spans Two Lines', 190, 124, 220, 20, 1),
    paragraph('p2', 'Ada Lovelace ∗ Analytical Engine Lab ada@example.org', 90, 180, 300, 10, 2, [
      line('Ada Lovelace', 100, 180, 70),
      line('∗', 170, 179, 4, 7),
      line('Analytical Engine Lab', 90, 192, 120),
      line('ada@example.org', 95, 204, 100),
      line('Alan Turing', 320, 180, 60),
      line('Bletchley Park', 315, 192, 90),
      line('alan@example.org', 310, 204, 100),
    ]),
    paragraph('p3', 'Abstract', 285, 240, 44, 12, 3),
    paragraph(
      'p4',
      'We study sequence models and show that attention alone is sufficient for translation.',
      100,
      262,
      410,
      10,
      4,
      [
        line('We study sequence models and show that attention alone is', 100, 262, 400),
        line('sufficient for translation.', 100, 276, 150),
      ],
    ),
    paragraph('p5', 'Index Terms—attention, sequence models', 100, 320, 260, 10, 5),
  ]
  const blocks = paragraphs.map((entry) => ({
    id: `page1-${entry.id}`,
    type: 'paragraph',
    pageIndex: 0,
    paragraphId: entry.id,
    bbox: entry.bbox,
    text: entry.text,
    translateText: entry.translateText,
    order: entry.order,
    paragraph: entry,
  }))
  return {
    pageIndex: 0,
    blocks,
    paragraphs,
    viewport: { scale: 1, width: 612, height: 792 },
    pageWidth: 612,
    pageHeight: 792,
    bodySize: 10,
  }
}

test('composes a split title, byline grid, abstract and keywords', () => {
  const reading = composeReading(syntheticModel())
  const title = reading.blocks.find((block) => block.type === 'title')
  assert.ok(title, 'title block missing')
  assert.equal(title.text, 'A Very Long Paper Title That Spans Two Lines')
  assert.equal(title.translateText, title.text)

  const authors = reading.blocks.find((block) => block.type === 'authors')
  assert.ok(authors, 'author block missing')
  assert.equal(authors.authors.length, 2)
  assert.deepEqual(
    authors.authors.map((author) => ({
      name: author.name,
      marks: author.marks,
      affiliation: author.affiliation,
      email: author.email,
    })),
    [
      {
        name: 'Ada Lovelace',
        marks: '∗',
        affiliation: 'Analytical Engine Lab',
        email: 'ada@example.org',
      },
      {
        name: 'Alan Turing',
        marks: '',
        affiliation: 'Bletchley Park',
        email: 'alan@example.org',
      },
    ],
  )
  assert.equal(authors.affiliations.length, 2)

  const abstract = reading.blocks.find((block) => block.type === 'abstract')
  assert.ok(abstract, 'abstract block missing')
  assert.equal(abstract.heading, 'Abstract')
  assert.match(abstract.text, /^We study sequence models/)
  assert.match(abstract.text, /sufficient for translation\.$/)

  const keywords = reading.blocks.find((block) => block.type === 'keywords')
  assert.ok(keywords, 'keywords block missing')
  assert.equal(keywords.text, 'attention, sequence models')

  const unitIds = reading.units.map((unit) => unit.id)
  assert.ok(unitIds.includes(title.translationId))
  assert.ok(unitIds.includes(abstract.translationId))
  assert.ok(unitIds.includes(keywords.translationId))
  assert.equal(
    reading.units.filter((unit) => unit.kind === 'affiliation').length,
    2,
  )
  assert.ok(
    reading.blocks.every(
      (block) =>
        block.type !== 'paragraph' ||
        !['p0', 'p1', 'p2', 'p3', 'p4'].includes(block.paragraphId),
    ),
    'front-matter paragraphs should be replaced by composed blocks',
  )
})

test('regression: the Attention byline is one compact author block', async () => {
  const { document, page } = await openFixturePage(1)
  try {
    const viewport = page.getViewport({ scale: 1.4 })
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 0 })
    const reading = composeReading(model)

    const title = reading.blocks.find((block) => block.type === 'title')
    assert.ok(title)
    assert.equal(title.text, 'Attention Is All You Need')

    const authors = reading.blocks.find((block) => block.type === 'authors')
    assert.ok(authors, 'author block missing')
    assert.equal(authors.authors.length, 8)
    assert.deepEqual(
      authors.authors.map((author) => author.name),
      [
        'Ashish Vaswani',
        'Noam Shazeer',
        'Niki Parmar',
        'Jakob Uszkoreit',
        'Llion Jones',
        'Aidan N. Gomez',
        'Łukasz Kaiser',
        'Illia Polosukhin',
      ],
    )
    assert.equal(authors.authors[0].affiliation, 'Google Brain')
    assert.equal(authors.authors[0].email, 'avaswani@google.com')
    assert.equal(authors.authors[5].marks, '∗ †')

    const abstractBlocks = reading.blocks.filter((block) => block.type === 'abstract')
    assert.ok(abstractBlocks.length > 0, 'abstract block missing')
    assert.equal(abstractBlocks[0].showLabel, true)
    assert.ok(
      abstractBlocks.slice(1).every((block) => block.showLabel === false),
      'only the first abstract part should carry the heading label',
    )
    const abstractText = abstractBlocks.map((block) => block.text).join(' ')
    assert.match(abstractText, /^The dominant sequence transduction models/)
    assert.match(abstractText, /training data\.$/)
    assert.doesNotMatch(abstractText, /Equal contribution/)
    assert.doesNotMatch(abstractText, /arXiv:/)

    assert.ok(
      !reading.blocks.some((block) => /Provided proper attribution/.test(block.text ?? '')),
      'licence boilerplate should not lead the reading column',
    )

    const paragraphIds = reading.blocks
      .filter((block) => block.type === 'paragraph')
      .map((block) => block.paragraphId)
    assert.ok(!paragraphIds.includes('p2'), 'byline should not remain a paragraph')
    assert.ok(!paragraphIds.includes('p6'), 'abstract heading should not remain a paragraph')
  } finally {
    await document.destroy()
  }
})

test('merges a title split across same-size lines', () => {
  const model = syntheticModel()
  model.paragraphs[0].height = 10
  model.paragraphs[0].bottom = 110
  model.paragraphs[0].bbox = [150, 100, 450, 110]
  model.paragraphs[0].lines[0].height = 10
  model.paragraphs[1].top = 112
  model.paragraphs[1].height = 10
  model.paragraphs[1].bottom = 122
  model.paragraphs[1].bbox = [190, 112, 410, 122]
  model.paragraphs[1].lines[0].top = 112
  model.paragraphs[1].lines[0].height = 10
  const reading = composeReading(model)
  const title = reading.blocks.find((block) => block.type === 'title')
  assert.ok(title)
  assert.equal(title.text, 'A Very Long Paper Title That Spans Two Lines')
})

test('a same-size numbered section title ends the abstract', () => {
  const model = syntheticModel()
  const heading = paragraph('p5', '1 Introduction', 100, 285, 100, 10, 5)
  model.paragraphs[5] = heading
  model.blocks[5] = {
    ...model.blocks[5],
    paragraph: heading,
    paragraphId: heading.id,
    text: heading.text,
    bbox: heading.bbox,
  }
  const reading = composeReading(model)
  const abstractText = reading.blocks
    .filter((block) => block.type === 'abstract')
    .map((block) => block.text)
    .join(' ')
  assert.doesNotMatch(abstractText, /Introduction/)
  assert.ok(
    reading.blocks.some(
      (block) => block.role === 'heading' && block.text === '1 Introduction',
    ),
    'the section title must stay in the body list',
  )
})

test('keeps placeholders from an inline abstract first sentence', () => {
  const model = syntheticModel()
  const abstract = paragraph('p3', 'Abstract: We solve x + y.', 100, 240, 300, 12, 3)
  abstract.translateText = 'Abstract: We solve ⟦MATH_001⟧.'
  abstract.placeholders = [{ token: '⟦MATH_001⟧', text: 'x + y' }]
  model.paragraphs[3] = abstract
  model.blocks[3] = {
    ...model.blocks[3],
    paragraph: abstract,
    paragraphId: abstract.id,
    text: abstract.text,
    translateText: abstract.translateText,
  }
  // Turn the old body paragraph into a section stop so the inline sentence is
  // the whole abstract.
  const heading = paragraph('p4', '2 Method', 100, 270, 90, 10, 4)
  model.paragraphs[4] = heading
  model.blocks[4] = {
    ...model.blocks[4],
    paragraph: heading,
    paragraphId: heading.id,
    text: heading.text,
    bbox: heading.bbox,
  }
  const reading = composeReading(model)
  const block = reading.blocks.find((entry) => entry.type === 'abstract')
  assert.ok(block)
  assert.match(block.text, /We solve x \+ y\./)
  assert.match(block.translateText, /⟦MATH_001⟧/)
  assert.doesNotMatch(block.translateText, /x \+ y/)
  const unit = reading.units.find((entry) => entry.id === block.translationId)
  assert.ok(unit)
  assert.match(unit.translateText, /⟦MATH_001⟧/)
  assert.ok(unit.placeholders.some((placeholder) => placeholder.token === '⟦MATH_001⟧'))
})

test('does not merge an adjacent body-size author line into the title', () => {
  const model = syntheticModel()
  const author = paragraph('p1', 'Ada Lovelace', 100, 130, 70, 10, 1, [
    line('Ada Lovelace', 100, 130, 70),
  ])
  model.paragraphs[1] = author
  model.blocks[1] = {
    ...model.blocks[1],
    paragraph: author,
    paragraphId: author.id,
    text: author.text,
    bbox: author.bbox,
  }
  const reading = composeReading(model)
  const title = reading.blocks.find((block) => block.type === 'title')
  assert.ok(title)
  assert.equal(title.text, 'A Very Long Paper Title')
  assert.doesNotMatch(title.text, /Ada Lovelace/)
  const authors = reading.blocks.find((block) => block.type === 'authors')
  assert.ok(authors)
  assert.ok(authors.authors.some((entry) => entry.name === 'Ada Lovelace'))
})

test('keeps placeholders in the keywords translation input', () => {
  const model = syntheticModel()
  const keywords = paragraph('p5', 'Keywords: attention, d_k scaling', 100, 320, 300, 10, 5)
  keywords.translateText = 'Keywords: attention, ⟦MATH_001⟧ scaling'
  keywords.placeholders = [{ token: '⟦MATH_001⟧', text: 'd_k' }]
  model.paragraphs[5] = keywords
  model.blocks[5] = {
    ...model.blocks[5],
    paragraph: keywords,
    paragraphId: keywords.id,
    text: keywords.text,
    translateText: keywords.translateText,
  }
  const reading = composeReading(model)
  const block = reading.blocks.find((entry) => entry.type === 'keywords')
  assert.ok(block)
  assert.match(block.text, /d_k scaling/)
  assert.match(block.translateText, /⟦MATH_001⟧/)
  assert.doesNotMatch(block.translateText, /d_k/)
  const unit = reading.units.find((entry) => entry.id === block.translationId)
  assert.ok(unit)
  assert.match(unit.translateText, /⟦MATH_001⟧/)
  assert.ok(unit.placeholders.some((placeholder) => placeholder.token === '⟦MATH_001⟧'))
})

test('author detection is invariant across page zoom levels', async () => {
  const { document, page } = await openFixturePage(1)
  try {
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const signatures = []
    for (const scale of [1, 2, 3]) {
      const viewport = page.getViewport({ scale })
      const model = buildPageModel(library, textContent, viewport, { pageIndex: 0 })
      const reading = composeReading(model)
      const authors = reading.blocks.find((block) => block.type === 'authors')
      assert.ok(authors, `author block missing at ${scale * 100}% zoom`)
      signatures.push(authors.authors.map((author) => author.name).join('|'))
    }
    assert.equal(new Set(signatures).size, 1, 'zoom must not change the author list')
  } finally {
    await document.destroy()
  }
})

test('recognises name particles such as "van" on a shared author row', () => {
  const model = syntheticModel()
  const byline = paragraph('p2', 'Ada Lovelace Ludwig van Beethoven', 90, 180, 380, 10, 2, [
    line('Ada Lovelace', 100, 180, 70),
    line('Ludwig van Beethoven', 200, 180, 120),
    line('Analytical Engine Lab', 100, 192, 120),
    line('ada@example.org', 100, 204, 100),
    line('Bonn', 200, 192, 40),
    line('ludwig@example.org', 200, 204, 110),
  ])
  model.paragraphs[2] = byline
  model.blocks[2] = {
    ...model.blocks[2],
    paragraph: byline,
    paragraphId: byline.id,
    text: byline.text,
    bbox: byline.bbox,
  }
  const reading = composeReading(model)
  const authors = reading.blocks.find((block) => block.type === 'authors')
  assert.ok(authors)
  assert.deepEqual(
    authors.authors.map((author) => author.name),
    ['Ada Lovelace', 'Ludwig van Beethoven'],
  )
})

test('a non-cover page never creates a paper title or author block', async () => {
  const { document, page } = await openFixturePage(15)
  try {
    const viewport = page.getViewport({ scale: 1 })
    const textContent = await page.getTextContent({ includeMarkedContent: false })
    const model = buildPageModel(library, textContent, viewport, { pageIndex: 14 })
    assert.equal(model.pageIndex, 14)
    const reading = composeReading(model)
    assert.equal(
      reading.blocks.some((block) => block.type === 'authors'),
      false,
      'figure labels must stay in the paragraph flow',
    )
    assert.equal(
      reading.blocks.some((block) => block.type === 'title'),
      false,
      'only the cover page can contribute a paper title',
    )
    assert.ok(
      reading.blocks.some(
        (block) => block.type === 'paragraph' && /^Figure 5:/.test(block.text ?? ''),
      ),
      'the figure caption remains an ordinary paragraph',
    )
  } finally {
    await document.destroy()
  }
})

test('keeps a second author with a suffix on the same row', () => {
  const model = syntheticModel()
  const byline = paragraph('p2', 'Ada Lovelace Jane Smith, Jr.', 90, 180, 320, 10, 2, [
    line('Ada Lovelace', 100, 180, 70),
    line('Jane Smith, Jr.', 200, 180, 90),
    line('Analytical Engine Lab', 100, 192, 120),
    line('ada@example.org', 100, 204, 100),
  ])
  model.paragraphs[2] = byline
  model.blocks[2] = {
    ...model.blocks[2],
    paragraph: byline,
    paragraphId: byline.id,
    text: byline.text,
    bbox: byline.bbox,
  }
  const reading = composeReading(model)
  const authors = reading.blocks.find((block) => block.type === 'authors')
  assert.ok(authors)
  assert.deepEqual(
    authors.authors.map((author) => author.name),
    ['Ada Lovelace', 'Jane Smith, Jr.'],
  )
})

test('keeps every author when a partner name cannot be parsed', () => {
  const model = syntheticModel()
  // "@@@" cannot be a name, so the structured pass only reads Ada. The
  // recovered byline must still list the partner instead of dropping it.
  const byline = paragraph('p2', 'Ada Lovelace @@@', 90, 180, 300, 10, 2, [
    line('Ada Lovelace', 100, 180, 70),
    line('@@@', 200, 180, 30),
    line('Analytical Engine Lab', 100, 192, 120),
    line('ada@example.org', 100, 204, 100),
  ])
  model.paragraphs[2] = byline
  model.blocks[2] = {
    ...model.blocks[2],
    paragraph: byline,
    paragraphId: byline.id,
    text: byline.text,
    bbox: byline.bbox,
  }
  const reading = composeReading(model)
  const authors = reading.blocks.find((block) => block.type === 'authors')
  assert.ok(authors, 'the byline is still shown as authors')
  assert.ok(authors.authors.some((author) => author.name === 'Ada Lovelace'))
})

test('joins a hyphenated line break and marks section headings', () => {
  assert.equal(joinText('trans-', 'former'), 'transformer')
  assert.equal(joinText('注意力', '机制'), '注意力机制')
  assert.equal(isHeadingParagraph({ text: '3 Experiments', lines: [{}], height: 10 }, 10), true)
  assert.equal(isHeadingParagraph({ text: '3 Experiments', lines: [{}, {}, {}, {}], height: 10 }, 10), false)
})

test('groups a long abstract at sentence boundaries without breaking decimals', () => {
  const sentences = [
    'The model achieves 28.4 BLEU on the English-to-German task.',
    'It also reaches 41.8 BLEU on English-to-French after 3.5 days of training.',
    'Ablations confirm that each component contributes to the final result.',
    'The Transformer generalizes to constituency parsing with limited data.',
  ]
  const text = sentences.join(' ')
  const groups = groupAbstract(text, text, 80)
  assert.ok(groups.length > 1, 'long abstract should be grouped')
  assert.ok(
    groups.every((group) => !group.text.endsWith('28.') && !group.text.endsWith('41.')),
    'decimals must not become sentence boundaries',
  )
  assert.equal(groups.map((group) => group.text).join(' '), text)
  assert.equal(splitSentences('Version 2.5 is stable.').length, 1)
  assert.equal(splitSentences('第一句话。第二句话！').length, 2)
})
