import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_HITS_PER_PAGE,
  scanSearchPages,
  searchScrollLeft,
  buildSearchText,
  findMatchRanges,
  makeSnippet,
  rangeRects,
  searchAtoms,
  splitSearchTerms,
} from '../src/search.js'

/** One scale-1 text atom, shaped like `buildAtoms` output. */
function atom(text, x, y, width, height = 10) {
  return { text, x, y, width, height, top: y - height * 0.82, bottom: y + height * 0.18 }
}

test('search text joins touching fragments and separates real gaps', () => {
  const index = buildSearchText([
    atom('Hel', 100, 700, 20),
    atom('lo', 120, 700, 10),
    atom('world', 150, 700, 30),
    atom('next line', 100, 680, 50),
  ])
  assert.equal(index.text, 'Hello world next line')
  assert.deepEqual(
    index.spans.map((span) => index.text.slice(span.start, span.end)),
    ['Hel', 'lo', 'world', 'next line'],
  )
  assert.equal(index.spans[1].start, 3)
})

test('RTL fragments get a space only when their boxes are separated', () => {
  const touching = buildSearchText([
    atom('שלום', 200, 700, 50),
    atom('עולם', 150, 700, 50),
  ])
  assert.equal(touching.text, 'שלוםעולם')

  const separated = buildSearchText([
    atom('שלום', 200, 700, 50),
    atom('עולם', 80, 700, 50),
  ])
  assert.equal(separated.text, 'שלום עולם')
  assert.equal(findMatchRanges(separated.text, 'שלום עולם').ranges.length, 1)
})

test('a hyphenated query matches both line-break and same-line forms', () => {
  const joined = buildSearchText([
    atom('sequence-', 100, 700, 50),
    atom('aligned', 100, 680, 50),
  ])
  const sameLine = buildSearchText([
    atom('sequence-', 100, 700, 50),
    atom('aligned', 150, 700, 50),
  ])
  assert.equal(joined.text, 'sequencealigned')
  assert.deepEqual(joined.removedHyphens, [8])
  assert.equal(sameLine.text, 'sequence-aligned')
  assert.equal(
    findMatchRanges(joined.text, 'sequence-aligned', {
      removedHyphens: joined.removedHyphens,
    }).ranges.length,
    1,
  )
  assert.equal(findMatchRanges(sameLine.text, 'sequence-aligned').ranges.length, 1)

  const result = searchAtoms(
    [atom('sequence-', 100, 700, 50), atom('aligned', 100, 680, 50)],
    'sequence-aligned',
  )
  assert.equal(result.count, 1)
  assert.equal(result.highlightRects[0].length, 2)
})

test('a negative number sign is not treated as an optional hyphen', () => {
  const text = 'x = 1 or x = -1'
  assert.deepEqual(findMatchRanges(text, '-1').ranges, [{ start: 13, end: 15 }])

  const result = searchAtoms([atom(text, 0, 10, 120)], '-1')
  assert.equal(result.count, 1)
  assert.equal(result.hits[0].snippet.match, '-1')
  assert.equal(result.highlightRects.length, 1)
})

test('only hyphens removed at a line break may be omitted', () => {
  const atoms = [
    atom('state-', 100, 700, 32),
    atom('of-the-art', 100, 680, 70),
  ]
  const index = buildSearchText(atoms)
  assert.equal(index.text, 'stateof-the-art')
  assert.deepEqual(index.removedHyphens, [5])

  const result = searchAtoms(atoms, 'state-of-the-art')
  assert.equal(result.count, 1)
  assert.equal(result.highlightRects[0].length, 2)
  assert.equal(findMatchRanges(index.text, 'state-of-the-art', {
    removedHyphens: index.removedHyphens,
  }).ranges.length, 1)
})

test('many single-character hits keep every highlight rectangle', () => {
  const atoms = Array.from({ length: 2000 }, (_, index) =>
    atom('x', index * 2, 700, 1),
  )
  const result = searchAtoms(atoms, 'x')
  assert.equal(result.count, 2000)
  assert.equal(result.highlightRects.length, 2000)
  assert.ok(result.highlightRects[1999].length > 0)
})

test('a rejected hyphen candidate does not hide a later exact match', () => {
  const text = 'ATAT-AT'
  assert.deepEqual(findMatchRanges(text, 'AT-AT').ranges, [{ start: 2, end: 7 }])

  const result = searchAtoms([atom(text, 0, 10, 80)], 'AT-AT')
  assert.equal(result.count, 1)
  assert.equal(result.hits[0].snippet.match, 'AT-AT')
  assert.equal(result.highlightRects.length, 1)
})

test('a line-end hyphen joins the full word and keeps both source lines', () => {
  const atoms = [atom('multi-', 100, 700, 32), atom('plicative', 100, 680, 60)]
  const index = buildSearchText(atoms)
  assert.equal(index.text, 'multiplicative')
  assert.equal(index.spans.length, 2)

  const sameLine = buildSearchText([
    atom('multi-', 100, 700, 32),
    atom('plicative', 132, 700, 60),
  ])
  assert.equal(sameLine.text, 'multi-plicative')

  const result = searchAtoms(atoms, 'multiplicative')
  assert.equal(result.count, 1)
  assert.equal(result.highlightRects.length, 1)
  assert.equal(result.highlightRects[0].length, 2)
  assert.equal(result.hits[0].snippet.match, 'multiplicative')
})

test('splitSearchTerms lower-cases, de-duplicates and keeps every keyword', () => {
  assert.deepEqual(splitSearchTerms('  Attention   attention  HEAD '), ['attention', 'head'])
  assert.deepEqual(splitSearchTerms(''), [])
  const many = Array.from({ length: 20 }, (_, index) => `w${index}`).join(' ')
  assert.equal(splitSearchTerms(many).length, 20)
  assert.deepEqual(findMatchRanges(many, many + " missing").ranges, [])
})

test('findMatchRanges is case-insensitive and merges overlapping keywords', () => {
  const text = 'Vision Transformer and vision transformer variants'
  const { ranges, terms } = findMatchRanges(text, 'vision transformer')
  assert.deepEqual(terms, ['vision', 'transformer'])
  // Four occurrences collapse into two merged ranges, one per phrase.
  assert.equal(ranges.length, 2)
  assert.equal(text.slice(ranges[0].start, ranges[0].end), 'Vision Transformer')
  assert.equal(text.slice(ranges[1].start, ranges[1].end), 'vision transformer')
})

test('a page must contain every keyword to produce a hit', () => {
  const onlyOne = findMatchRanges('attention only', 'attention head')
  assert.equal(onlyOne.ranges.length, 0)
  const both = findMatchRanges('head and attention', 'attention head')
  assert.equal(both.ranges.length, 2)
})

test('makeSnippet keeps the match and marks truncated edges', () => {
  const text = `${'prefix '.repeat(12)}needle${' suffix'.repeat(12)}`
  const { ranges } = findMatchRanges(text, 'needle')
  const snippet = makeSnippet(text, ranges[0])
  assert.equal(snippet.match, 'needle')
  assert.ok(snippet.before.startsWith('…'))
  assert.ok(snippet.after.endsWith('…'))
  assert.ok(snippet.before.length <= 50)
})

test('rangeRects groups atoms by baseline and keeps line breaks apart', () => {
  const index = buildSearchText([
    atom('graph', 100, 700, 20),
    atom('ics', 120, 700, 10),
    atom('graphics', 100, 680, 40),
  ])
  const { ranges } = findMatchRanges(index.text, 'graphics')
  const rects = rangeRects(index.spans, ranges[0])
  assert.equal(rects.length, 1)
  assert.equal(rects[0].x, 100)
  assert.equal(rects[0].width, 30)

  const wrapped = buildSearchText([
    atom('second', 100, 700, 30),
    atom('line', 100, 680, 18),
  ])
  const hit = findMatchRanges(wrapped.text, 'line')
  const wrappedRects = rangeRects(wrapped.spans, hit.ranges[0])
  assert.equal(wrappedRects.length, 1)
  assert.ok(wrappedRects[0].top < 680)
})

test('searchAtoms caps stored hits but keeps every highlight rectangle', () => {
  const atoms = []
  for (let index = 0; index < MAX_HITS_PER_PAGE + 5; index += 1) {
    atoms.push(atom('hit', 100 + index * 30, 700, 24))
  }
  const result = searchAtoms(atoms, 'hit')
  assert.equal(result.count, MAX_HITS_PER_PAGE + 5)
  assert.equal(result.hits.length, MAX_HITS_PER_PAGE)
  assert.equal(result.highlightRects.length, result.count)
  assert.ok(result.highlightRects[result.count - 1].length > 0)
  assert.equal(result.hits[0].snippet.match, 'hit')
  assert.ok(result.hits[0].rects.length > 0)

  const limited = searchAtoms(atoms, 'hit', { limit: 2 })
  assert.equal(limited.count, MAX_HITS_PER_PAGE + 5)
  assert.equal(limited.hits.length, 2)
  assert.equal(limited.highlightRects.length, limited.count)
})

test('an empty query never matches', () => {
  const result = searchAtoms([atom('anything', 0, 100, 40)], '   ')
  assert.equal(result.count, 0)
  assert.deepEqual(result.hits, [])
})

test('adjacent matches remain distinct and overlapping terms still merge', () => {
  assert.deepEqual(findMatchRanges('banana', 'na').ranges, [{ start: 2, end: 4 }, { start: 4, end: 6 }])
  assert.deepEqual(findMatchRanges('banana', 'banana ana').ranges, [{ start: 0, end: 6 }])
})

test('repeated matches within one text item occupy distinct rectangles', () => {
  const item = atom('loss and loss', 100, 50, 130)
  const rects = searchAtoms([item], 'loss').hits.map(hit => hit.rects[0])
  assert.deepEqual(rects.map(rect => [rect.x, rect.width]), [[100, 40], [190, 40]])
  const rtl = searchAtoms([{ ...item, dir: 'rtl' }], 'loss').hits
  assert.deepEqual(rtl.map(hit => hit.rects[0].x), [190, 100])
})

test('case expansion preserves original snippet and rectangle offsets', () => {
  const item = atom('İ model', 0, 10, 70)
  const [hit] = searchAtoms([item], 'model').hits
  assert.equal(hit.snippet.match, 'model')
  assert.equal(hit.rects[0].x, 20)
  assert.equal(searchAtoms([item], 'i').hits[0].snippet.match, 'İ')
})

test('scanning distinguishes unreadable pages from pages with no matches', async () => {
  async function scan(texts) {
    return scanSearchPages({
      pageCount: texts.length, query: 'hit', signal: new AbortController().signal,
      readAtoms: async index => {
        if (texts[index] === null) throw new Error('unreadable')
        return [atom(texts[index], 0, 10, 100)]
      },
    })
  }
  const partial = await scan([null, 'hit', 'empty'])
  assert.equal(partial.status, 'done')
  assert.equal(partial.failedPages, 1)
  assert.equal(partial.pages[0].pageIndex, 1)
  assert.equal(partial.total, 1)
  assert.equal((await scan([null, null])).status, 'error')
  assert.equal((await scan(['empty'])).failedPages, 0)
})

test('horizontal search jumps preserve visible hits and reveal off-screen hits', () => {
  assert.equal(searchScrollLeft(200, 300, 350, 40), 200)
  assert.equal(searchScrollLeft(200, 300, 600, 40), 470)
  assert.equal(searchScrollLeft(200, 300, 10, 40), 0)
})
