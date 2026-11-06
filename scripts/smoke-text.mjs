import assert from 'node:assert/strict'
import * as pdfjs from '../assets/pdf.min.mjs'
import { buildPageModel, findParagraphByAnchor } from '../src/pdf.js'
const viewport = { transform: [1, 0, 0, -1, 0, 800], width: 600, height: 800, scale: 1 }
const model = buildPageModel(pdfjs, {
  items: [
    { str: 'Hel', transform: [10, 0, 0, 10, 100, 700], width: 20, height: 10, hasEOL: false },
    { str: 'lo', transform: [10, 0, 0, 10, 120, 700], width: 10, height: 10, hasEOL: false },
  ],
}, viewport)
assert.equal(model.lines[0].text, 'Hello')

const twoColumn = buildPageModel(
  pdfjs,
  {
    items: [
      { str: 'Left column first line', transform: [10, 0, 0, 10, 50, 700], width: 180, height: 10, hasEOL: true },
      { str: 'Left column second line', transform: [10, 0, 0, 10, 50, 680], width: 180, height: 10, hasEOL: true },
      { str: 'Right column starts higher', transform: [10, 0, 0, 10, 320, 400], width: 200, height: 10, hasEOL: true },
    ],
  },
  viewport,
)
assert.ok(twoColumn.paragraphs.length >= 2)
assert.match(twoColumn.paragraphs[twoColumn.paragraphs.length - 1].text, /^Right column/)
console.log('two-column reset test passed')

const shifted = [
  { id: 'p1', text: 'Completely unrelated paragraph.' },
  { id: 'p2', text: 'The saved sentence appears in this paragraph.' },
]
assert.equal(
  findParagraphByAnchor(shifted, 'p1', 'saved sentence appears').id,
  'p2',
)
assert.equal(findParagraphByAnchor(shifted, 'p1', 'not present at all'), undefined)
console.log('note anchor re-resolution test passed')
console.log('adjacent fragment test passed')
