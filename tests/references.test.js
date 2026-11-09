import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as pdfjs from '../assets/pdf.min.mjs'
import {
  extractReferences,
  pageLines,
  parseReferenceEntries,
  referenceHeading,
  referenceScanPages,
} from '../src/references.js'

const library = pdfjs.default?.getDocument ? pdfjs.default : pdfjs

async function openFixture() {
  library.GlobalWorkerOptions.workerSrc = new URL(
    '../assets/pdf.worker.min.mjs',
    import.meta.url,
  ).href
  const data = new Uint8Array(
    await readFile(new URL('./fixtures/attention.pdf', import.meta.url)),
  )
  return await library.getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
  }).promise
}

test('recognises a references heading merged with the first entry', () => {
  assert.deepEqual(referenceHeading('References [1] Jimmy Lei Ba. Layer normalization.'), {
    heading: 'References',
    rest: '[1] Jimmy Lei Ba. Layer normalization.',
  })
  assert.deepEqual(referenceHeading('7 References [1] First paper.'), {
    heading: 'References',
    rest: '[1] First paper.',
  })
  assert.deepEqual(referenceHeading('7. 参考文献 [1] 第一篇'), {
    heading: '参考文献',
    rest: '[1] 第一篇',
  })
  assert.equal(referenceHeading('References and notes'), null)
})

test('splits numbered references and appends continuation paragraphs', () => {
  const pages = [
    {
      pageIndex: 9,
      paragraphs: [
        { id: 'p0', text: 'References [1] First paper. 2016.', top: 100, lines: [{ top: 100 }] },
        { id: 'p1', text: '[2] Second paper.', top: 130, lines: [{ top: 130 }] },
        { id: 'p2', text: 'continued on the next line.', top: 145, lines: [{ top: 145 }] },
      ],
    },
    {
      pageIndex: 10,
      paragraphs: [
        { id: 'p3', text: '[3] Third paper.', top: 80, lines: [{ top: 80 }] },
        { id: 'p4', text: 'page continuation.', top: 95, lines: [{ top: 95 }] },
      ],
    },
  ]
  const entries = parseReferenceEntries(pages, 9, '[1] First paper. 2016.', 0)
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.text, entry.pageIndex]),
    [
      ['1', 'First paper. 2016.', 9],
      ['2', 'Second paper. continued on the next line.', 9],
      ['3', 'Third paper. page continuation.', 10],
    ],
  )
})

test('short year tail does not end the numbered list', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          {
            id: 'heading',
            text: 'References [1] First paper.',
            top: 80,
            lines: [{ top: 80, x: 108, width: 396, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 10,
        paragraphs: [
          {
            id: 'year',
            text: '2020.',
            top: 50,
            lines: [{ top: 50, x: 130, width: 24, height: 10 }],
          },
          {
            id: 'second',
            text: '[2] Second paper.',
            top: 70,
            lines: [{ top: 70, x: 108, width: 396, height: 10 }],
          },
        ],
      },
    ],
    9,
    '[1] First paper.',
    0,
  )
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.text]),
    [
      ['1', 'First paper. 2020.'],
      ['2', 'Second paper.'],
    ],
  )
})

test('a page header does not drop a new entry continuation', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          {
            id: 'heading',
            text: 'References [1] First paper.',
            top: 80,
            lines: [{ top: 80, x: 108, width: 396, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 10,
        paragraphs: [
          {
            id: 'header',
            text: 'Journal of Examples 10 (2020)',
            top: 40,
            lines: [{ top: 40, x: 200, width: 200, height: 9, column: 0 }],
          },
          {
            id: 'second',
            text: '[2] Second paper author line.',
            top: 80,
            lines: [{ top: 80, x: 108, width: 396, height: 10, column: 0 }],
          },
          {
            id: 'second-title',
            text: 'Second paper title line.',
            top: 92,
            lines: [{ top: 92, x: 130, width: 360, height: 10, column: 0 }],
          },
        ],
      },
    ],
    9,
    '[1] First paper.',
    0,
  )
  assert.equal(entries.length, 2)
  assert.equal(entries[1].text, 'Second paper author line. Second paper title line.')
})

test('author-year references merge continuations across pages', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          { id: 'heading', text: 'References', top: 60, lines: [{ top: 60, x: 100 }] },
          {
            id: 'first',
            text: 'Smith, J. (2020). A title that',
            top: 80,
            lines: [{ top: 80, x: 100, width: 300, height: 10 }],
          },
          {
            id: 'cont',
            text: 'continues on the next line.',
            top: 92,
            lines: [{ top: 92, x: 120, width: 280, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 10,
        paragraphs: [
          {
            id: 'page2',
            text: 'and on the next page.',
            top: 50,
            lines: [{ top: 50, x: 120, width: 280, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 11,
        paragraphs: [
          {
            id: 'second',
            text: 'Doe, A. (2019). Second paper.',
            top: 50,
            lines: [{ top: 50, x: 100, width: 300, height: 10 }],
          },
          {
            id: 'second-cont',
            text: 'Second paper tail.',
            top: 62,
            lines: [{ top: 62, x: 120, width: 280, height: 10 }],
          },
        ],
      },
    ],
    9,
    '',
    0,
  )
  assert.equal(entries.length, 2)
  assert.match(entries[0].text, /A title that continues on the next line\. and on the next page\./)
  assert.match(entries[1].text, /^Doe, A\. \(2019\)\. Second paper\. Second paper tail\.$/)
})

test('two-column author-year entries reset at the column change', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          { id: 'heading', text: 'References', top: 60, lines: [{ top: 60, x: 100, column: 0 }] },
          {
            id: 'left',
            text: 'Smith, J. (2020). Left paper.',
            top: 80,
            lines: [{ top: 80, x: 100, width: 180, height: 10, column: 0 }],
          },
          {
            id: 'left-cont',
            text: 'Left continuation.',
            top: 92,
            lines: [{ top: 92, x: 120, width: 160, height: 10, column: 0 }],
          },
          {
            id: 'right',
            text: 'Jones, A. (2021). Right paper.',
            top: 80,
            lines: [{ top: 80, x: 320, width: 180, height: 10, column: 1 }],
          },
          {
            id: 'right-cont',
            text: 'Right continuation.',
            top: 92,
            lines: [{ top: 92, x: 340, width: 160, height: 10, column: 1 }],
          },
        ],
      },
    ],
    9,
    '',
    0,
  )
  assert.equal(entries.length, 2)
  assert.match(entries[0].text, /^Smith, J\. \(2020\)\. Left paper\. Left continuation\.$/)
  assert.match(entries[1].text, /^Jones, A\. \(2021\)\. Right paper\. Right continuation\.$/)
})

test('starts at the heading line and ignores text above it', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          { id: 'prior', text: '1. Prior result', top: 50, lines: [{ top: 50 }] },
          { id: 'heading', text: 'References [1] First paper.', top: 80, lines: [{ top: 80 }] },
          { id: 'second', text: '[2] Second paper.', top: 110, lines: [{ top: 110 }] },
        ],
      },
    ],
    9,
    '[1] First paper.',
    1,
  )
  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.text]),
    [
      ['1', 'First paper.'],
      ['2', 'Second paper.'],
    ],
  )
})

test('keeps a last entry that continues on the following page', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          {
            id: 'heading',
            text: 'References [1] First paper begins',
            top: 80,
            lines: [{ top: 80, x: 108, width: 396, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 10,
        paragraphs: [
          {
            id: 'tail',
            text: 'and continues here.',
            top: 50,
            lines: [{ top: 50, x: 130, width: 374, height: 10 }],
          },
          {
            id: 'journal',
            text: 'Journal, 2020.',
            top: 62,
            lines: [{ top: 62, x: 130, width: 300, height: 10 }],
          },
        ],
      },
    ],
    9,
    '[1] First paper begins',
    0,
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, 'First paper begins and continues here. Journal, 2020.')
})

test('stops before an appendix that follows the last entry', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          {
            id: 'heading',
            text: 'References [1] First paper begins',
            top: 80,
            lines: [{ top: 80, x: 108, width: 396, height: 10 }],
          },
        ],
      },
      {
        pageIndex: 10,
        paragraphs: [
          {
            id: 'tail',
            text: 'and continues here.',
            top: 50,
            lines: [{ top: 50, x: 130, width: 374, height: 10 }],
          },
          { id: 'appendix', text: 'Appendix A', top: 80, lines: [{ top: 80 }] },
          { id: 'body', text: 'Appendix body text.', top: 95, lines: [{ top: 95 }] },
        ],
      },
    ],
    9,
    '[1] First paper begins',
    0,
  )
  assert.equal(entries.length, 1)
  assert.equal(entries[0].text, 'First paper begins and continues here.')
  assert.doesNotMatch(entries[0].text, /Appendix/)
})

test('a reference title starting with Supplementary is not a section boundary', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          { id: 'heading', text: 'References [1] First paper.', top: 80, lines: [{ top: 80 }] },
          {
            id: 'supp',
            text: 'Supplementary motor area function.',
            top: 95,
            lines: [{ top: 95 }],
          },
          { id: 'second', text: '[2] Second paper.', top: 120, lines: [{ top: 120 }] },
        ],
      },
    ],
    9,
    '[1] First paper.',
    0,
  )
  assert.equal(entries.length, 2)
  assert.match(entries[0].text, /Supplementary motor area function\.$/)
  assert.equal(entries[1].label, '2')
})

test('Chinese appendix titles terminate the reference list', () => {
  const entries = parseReferenceEntries(
    [
      {
        pageIndex: 9,
        paragraphs: [
          { id: 'heading', text: '参考文献 [1] 第一篇', top: 80, lines: [{ top: 80 }] },
          { id: 'appendix', text: '附录 A', top: 100, lines: [{ top: 100 }] },
          { id: 'body', text: '附录正文', top: 115, lines: [{ top: 115 }] },
        ],
      },
    ],
    9,
    '[1] 第一篇',
    0,
  )
  assert.equal(entries.length, 1)
  assert.doesNotMatch(entries[0].text, /附录/)
})

test('long documents scan backwards from the last page', () => {
  const pages = referenceScanPages(300, [])
  assert.equal(pages.length, 60)
  assert.equal(pages[0], 299)
  assert.ok(pages.includes(290))
  assert.deepEqual(referenceScanPages(30, [{ title: 'References', pageIndex: 12 }]), [12])
})

test('reads the left column before the right column', () => {
  const atoms = []
  for (let row = 0; row < 10; row += 1) {
    const top = 80 + row * 28
    atoms.push(
      { text: `[${row + 1}]`, x: 100, top, width: 14, height: 10 },
      { text: `Left ${row + 1}`, x: 118, top, width: 120, height: 10 },
      { text: `[${row + 20}]`, x: 313, top: top + 1, width: 18, height: 10 },
      { text: `Right ${row + 1}`, x: 335, top: top + 1, width: 130, height: 10 },
    )
  }
  const lines = pageLines(atoms, 612)
  assert.equal(lines[0].text, '[1] Left 1')
  assert.equal(lines[9].text, '[10] Left 10')
  assert.equal(lines[10].text, '[20] Right 1')
  assert.equal(lines[19].text, '[29] Right 10')
})

test('repeated References headers keep the first page of the list', async () => {
  const item = (text, x, y, width, height = 10) => ({
    str: text,
    transform: [height, 0, 0, height, x, 800 - y],
    width,
    height,
    fontName: 'body',
  })
  const pages = [
    {
      items: [
        item('References', 100, 80, 90),
        item('[1] First paper.', 100, 100, 120),
        item('First continuation.', 120, 112, 140),
      ],
    },
    {
      items: [
        item('References', 100, 60, 90),
        item('[2] Second paper.', 100, 80, 140),
      ],
    },
  ]
  const fakePdf = {
    numPages: 2,
    async getPage(index) {
      return {
        getViewport: () => ({ width: 612, height: 800, scale: 1, transform: [1, 0, 0, -1, 0, 800] }),
        async getTextContent() {
          return { items: pages[index - 1].items }
        },
      }
    },
  }
  const result = await extractReferences(fakePdf, null, { library })
  assert.ok(result)
  assert.deepEqual(
    result.entries.map((entry) => entry.label),
    ['1', '2'],
  )
})

test('author-year lists continue across pages', async () => {
  const item = (text, x, y, width, height = 10) => ({
    str: text,
    transform: [height, 0, 0, height, x, 800 - y],
    width,
    height,
    fontName: 'body',
  })
  const pages = [
    {
      items: [
        item('References', 100, 60, 90),
        item('Smith, J. (2020). A title that', 100, 80, 220),
        item('continues on the next line.', 120, 92, 220),
      ],
    },
    {
      items: [item('and on the next page.', 120, 50, 220)],
    },
    {
      items: [item('Doe, A. (2019). Second paper.', 100, 50, 240)],
    },
  ]
  const fakePdf = {
    numPages: 3,
    async getPage(index) {
      return {
        getViewport: () => ({ width: 612, height: 800, scale: 1, transform: [1, 0, 0, -1, 0, 800] }),
        async getTextContent() {
          return { items: pages[index - 1].items }
        },
      }
    },
  }
  const result = await extractReferences(fakePdf, null, { library })
  assert.ok(result)
  assert.equal(result.entries.length, 2)
  assert.match(
    result.entries[0].text,
    /A title that continues on the next line\. and on the next page\.$/,
  )
  assert.match(result.entries[1].text, /^Doe, A\. \(2019\)\. Second paper\.$/)
})

test('extracts the Attention reference list from the fixture', async () => {
  const document = await openFixture()
  try {
    const result = await extractReferences(document, null, { library })
    assert.ok(result, 'reference section missing')
    assert.equal(result.heading, 'References')
    assert.equal(result.pageIndex, 9)
    assert.ok(result.entries.length >= 40, `expected 40 entries, got ${result.entries.length}`)
    assert.equal(result.entries[0].label, '1')
    assert.match(result.entries[0].text, /^Jimmy Lei Ba/)
    const last = result.entries[result.entries.length - 1]
    assert.equal(last.label, '40')
    assert.match(last.text, /^Muhua Zhu/)
    assert.match(last.text, /ACL, August 2013\.$/)
    assert.doesNotMatch(last.text, /Input-Input|Attention Visualizations/)
  } finally {
    await document.destroy()
  }
})
