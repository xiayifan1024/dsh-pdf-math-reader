/**
 * Keyword search over extracted PDF text.
 *
 * Search runs on the same scale-1 atoms the reader builds for hit-testing, so a
 * hit maps back to page points without a second coordinate system. The text
 * index tolerates the way PDF.js splits words across text items: fragments that
 * visually touch are joined, while real gaps become spaces.
 */

export const MAX_HITS_PER_PAGE = 40
export const MAX_HITS_TOTAL = 300

const SNIPPET_BEFORE = 42
const SNIPPET_AFTER = 58
const MIN_GAP_SPACE = 0.8

/**
 * Split a query into unique, lower-cased keywords.
 *
 * Every keyword must occur on a page for that page to count as a hit, which
 * makes "attention head" find pages containing both words in any order.
 */
export function splitSearchTerms(query) {
  const seen = new Set()
  const terms = []
  for (const raw of String(query ?? '').toLowerCase().split(/\s+/)) {
    if (raw === '' || seen.has(raw)) continue
    seen.add(raw)
    terms.push(raw)
  }
  return terms
}

/** Whether two atoms sit on the same visual line. */
function sameLine(previous, atom) {
  return Math.abs(atom.y - previous.y) <= Math.max(1.5, atom.height * 0.4)
}

/** Whether two atoms need a separating space in the plain-text index. */
function needsSpace(previous, atom) {
  if (previous === undefined || previous === null) return false
  // Measure the horizontal distance between the two boxes rather than assuming
  // a left-to-right order: RTL runs place the next atom to the left, where a
  // directional subtraction would always be negative.
  const gap =
    Math.max(atom.x, previous.x) -
    Math.min(atom.x + atom.width, previous.x + previous.width)
  if (!sameLine(previous, atom)) return true
  return gap > Math.max(MIN_GAP_SPACE, Math.min(atom.height, previous.height) * 0.14)
}

const HYPHENATED_END = /[\p{L}][-\u2010\u2011\u00ad]$/u
const LETTER_START = /^\p{L}/u
const HYPHEN_CHARS = /[-\u2010\u2011\u00ad]/
const HYPHEN_OPTIONAL = '([-\\u2010\\u2011\\u00ad]?)'
const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(value) {
  return String(value).replace(REGEXP_SPECIAL, '\\$&')
}

/**
 * Build a pattern where a query hyphen may be present or omitted.
 *
 * A line-end hyphen is removed from the index, so `sequence-aligned` must also
 * match the indexed `sequencealigned`; on a line where the compound keeps its
 * hyphen, the same pattern still matches the original spelling.
 */
function optionalHyphenPattern(needle) {
  if (!HYPHEN_CHARS.test(needle)) return null
  const withoutHyphens = needle.replace(/[-\u2010\u2011\u00ad]/g, '')
  if (withoutHyphens === '') return null
  return escapeRegExp(needle).replace(/[-\u2010\u2011\u00ad]/g, HYPHEN_OPTIONAL)
}

/**
 * Whether a line-end hyphen should be removed when building the search index.
 *
 * `multi-` at the end of one line and `plicative` at the start of the next are
 * one word in the document; keeping the hyphen or adding a space would make the
 * full word unsearchable.
 */
function joinsHyphenatedLine(atom, next) {
  if (atom === undefined || next === undefined) return false
  if (typeof atom.text !== 'string' || typeof next.text !== 'string') return false
  if (sameLine(atom, next)) return false
  return HYPHENATED_END.test(atom.text) && LETTER_START.test(next.text)
}

/**
 * Build the searchable text of one page plus the atom ranges behind it.
 *
 * `spans[i].start`/`.end` index into `text`; `spans[i].atom` is the source text
 * item, so a matched range can be turned back into page rectangles. A hyphen
 * removed at a line break shortens only the span's text range: the source atom
 * keeps its glyph, so a full-word hit still highlights both lines.
 * `removedHyphens` records the source offsets where that removal happened so a
 * query may omit a hyphen only at a real line break.
 */
export function buildSearchText(atoms) {
  const items = []
  for (const atom of atoms ?? []) {
    if (atom === null || typeof atom !== 'object') continue
    if (typeof atom.text !== 'string' || atom.text === '') continue
    items.push(atom)
  }
  let text = ''
  const spans = []
  const removedHyphens = []
  let previous = null
  let continuedFromPrevious = false
  for (let index = 0; index < items.length; index += 1) {
    const atom = items[index]
    const next = items[index + 1]
    const joinsNext = joinsHyphenatedLine(atom, next)
    const piece = joinsNext ? atom.text.slice(0, -1) : atom.text
    if (text !== '' && !continuedFromPrevious && needsSpace(previous, atom)) text += ' '
    const start = text.length
    text += piece
    spans.push({ start, end: text.length, atom })
    if (joinsNext) removedHyphens.push(text.length)
    previous = atom
    continuedFromPrevious = joinsNext
  }
  return { text, spans, removedHyphens }
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
  const merged = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && range.start < last.end) {
      if (range.end > last.end) last.end = range.end
    } else {
      merged.push({ start: range.start, end: range.end })
    }
  }
  return merged
}

/**
 * Locate every occurrence of each keyword.
 *
 * A multi-keyword query is first treated as one phrase; when the exact phrase
 * is present those occurrences are the hits, so "vision transformer" counts a
 * phrase once instead of counting its two words separately. When the phrase is
 * absent, every keyword must still occur for the page to match.
 */
export function findMatchRanges(text, query, options = {}) {
  const terms = splitSearchTerms(query)
  const empty = { terms, ranges: [] }
  if (terms.length === 0 || typeof text !== 'string' || text === '') return empty
  const removedHyphens =
    options.removedHyphens instanceof Set
      ? options.removedHyphens
      : new Set(options.removedHyphens ?? [])
  const haystack = text.toLowerCase()
  // Lowercasing can expand a character (İ → i + combining dot). Translate
  // folded UTF-16 offsets back to the source before building snippets or boxes.
  const sourceOffsets = []
  if (haystack.length !== text.length) {
    let offset = 0
    for (const char of text) {
      for (let i = 0; i < char.toLowerCase().length; i++) sourceOffsets.push(offset)
      offset += char.length
    }
  }
  const sourceBoundary = (foldedIndex) => {
    if (sourceOffsets.length === 0) return foldedIndex
    return foldedIndex < sourceOffsets.length ? sourceOffsets[foldedIndex] : text.length
  }
  const occurrences = (needle) => collectOccurrences(
    haystack,
    needle,
    removedHyphens,
    sourceBoundary,
  ).map((range) => {
    if (sourceOffsets.length === 0) return range
    const last = sourceOffsets[range.end - 1]
    return { start: sourceOffsets[range.start], end: last + (text.codePointAt(last) > 0xffff ? 2 : 1) }
  })
  if (terms.length > 1) {
    const phrase = terms.join(' ')
    const phraseRanges = occurrences(phrase)
    if (phraseRanges.length > 0) return { terms, ranges: mergeRanges(phraseRanges) }
  }
  const collected = []
  for (const term of terms) {
    const positions = occurrences(term)
    if (positions.length === 0) return empty
    for (const position of positions) collected.push(position)
  }
  return { terms, ranges: mergeRanges(collected) }
}

function hyphenOmissionsAreRemoved(match, needle, removedHyphens, sourceBoundary) {
  let consumed = 0
  let capture = 1
  for (const char of needle) {
    if (HYPHEN_CHARS.test(char)) {
      const present = Boolean(match[capture])
      capture += 1
      if (present) {
        consumed += char.length
        continue
      }
      const boundary = match.index + consumed
      if (!removedHyphens.has(sourceBoundary(boundary))) return false
    } else {
      consumed += char.length
    }
  }
  return true
}

function collectOccurrences(haystack, needle, removedHyphens, sourceBoundary) {
  const optionalHyphen = optionalHyphenPattern(needle)
  if (optionalHyphen !== null) {
    const pattern = new RegExp(optionalHyphen, 'g')
    const positions = []
    let match
    while ((match = pattern.exec(haystack)) !== null) {
      if (match[0].length === 0) {
        pattern.lastIndex += 1
        continue
      }
      if (hyphenOmissionsAreRemoved(match, needle, removedHyphens, sourceBoundary)) {
        positions.push({ start: match.index, end: match.index + match[0].length })
        continue
      }
      // This candidate was rejected because it omitted a hyphen somewhere that
      // the document did not remove. Resume one character after its start so an
      // exact match beginning inside the rejected span is not skipped.
      pattern.lastIndex = match.index + 1
    }
    return positions
  }
  const positions = []
  let from = 0
  while (from <= haystack.length - needle.length) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    positions.push({ start: at, end: at + needle.length })
    from = at + Math.max(1, needle.length)
  }
  return positions
}

/** A compact context window around one match, split for highlighted rendering. */
export function makeSnippet(text, range) {
  const from = Math.max(0, range.start - SNIPPET_BEFORE)
  const to = Math.min(text.length, range.end + SNIPPET_AFTER)
  const before = text.slice(from, range.start).replace(/\s+/g, ' ')
  const match = text.slice(range.start, range.end).replace(/\s+/g, ' ')
  const after = text.slice(range.end, to).replace(/\s+/g, ' ')
  return {
    before: `${from > 0 ? '…' : ''}${before}`,
    match,
    after: `${after}${to < text.length ? '…' : ''}`,
  }
}

/**
 * Turn one span/range overlap into a page-point box.
 */
function spanBox(span, range) {
  if (span === null || span === undefined) return null
  if (span.end <= range.start || span.start >= range.end) return null
  if (!(span.end > span.start)) return null
  const atom = span.atom
  if (atom === null || typeof atom !== 'object') return null
  const x = Number(atom.x)
  const width = Number(atom.width)
  const top = Number(atom.top)
  const height = Number(atom.height)
  if (!Number.isFinite(x) || !Number.isFinite(top) || !(height > 0)) return null
  if (!Number.isFinite(width) || width <= 0) return null
  // PDF.js provides item widths, so interpolate the substring inside the item.
  const unit = width / (span.end - span.start)
  const start = Math.max(range.start, span.start) - span.start
  const end = Math.min(range.end, span.end) - span.start
  const rtl = atom.dir === 'rtl'
  const left = rtl ? width - end * unit : start * unit
  const right = rtl ? width - start * unit : end * unit
  return {
    baseline: Number.isFinite(atom.y) ? atom.y : top + height,
    x: x + left,
    right: x + right,
    top,
    bottom: top + height,
    height,
  }
}

/** Merge overlapping boxes on one baseline into the rectangles drawn on page. */
function groupBoxes(boxes) {
  if (boxes.length === 0) return []
  boxes.sort((left, right) => left.baseline - right.baseline || left.x - right.x)
  const groups = []
  for (const box of boxes) {
    const last = groups[groups.length - 1]
    const tolerance = Math.max(1.5, Math.max(box.height, last?.height ?? 0) * 0.45)
    const adjacent = last !== undefined && box.x - last.right <= Math.max(6, box.height * 2)
    if (last !== undefined && adjacent && Math.abs(box.baseline - last.baseline) <= tolerance) {
      last.x = Math.min(last.x, box.x)
      last.right = Math.max(last.right, box.right)
      last.top = Math.min(last.top, box.top)
      last.bottom = Math.max(last.bottom, box.bottom)
      last.height = Math.max(last.height, box.height)
    } else {
      groups.push({ ...box })
    }
  }
  return groups
    .map((group) => ({
      x: group.x,
      top: group.top,
      width: Math.max(0, group.right - group.x),
      height: Math.max(0, group.bottom - group.top),
    }))
    .filter((rect) => rect.width > 0 && rect.height > 0)
}

/**
 * Turn one matched range into page-point rectangles.
 *
 * Overlapping atoms are grouped by baseline so a hit can wrap onto a second
 * line and still highlight as separate boxes instead of one tall block.
 */
export function rangeRects(spans, range) {
  const boxes = []
  for (const span of spans ?? []) {
    const box = spanBox(span, range)
    if (box !== null) boxes.push(box)
  }
  return groupBoxes(boxes)
}

/**
 * Build rectangles for every hit in one pass over the sorted text spans.
 *
 * Ranges and spans are both ordered by character offset. Advancing a shared
 * range cursor per span avoids rescanning the whole page for every hit, which
 * matters when a stop word produces hundreds or thousands of highlights.
 */
function rangeRectsForRanges(spans, ranges) {
  const boxesByRange = ranges.map(() => [])
  if (boxesByRange.length === 0) return boxesByRange
  let rangeIndex = 0
  for (const span of spans ?? []) {
    while (rangeIndex < ranges.length && ranges[rangeIndex].end <= span.start) {
      rangeIndex += 1
    }
    for (
      let index = rangeIndex;
      index < ranges.length && ranges[index].start < span.end;
      index += 1
    ) {
      if (ranges[index].end <= span.start) continue
      const box = spanBox(span, ranges[index])
      if (box !== null) boxesByRange[index].push(box)
    }
  }
  return boxesByRange.map((boxes) => groupBoxes(boxes))
}

/**
 * Search one page.
 *
 * `count` is the number of merged matches on the page while `hits` keeps at most
 * `options.limit` of them with snippets, so a stop word on a long page cannot
 * blow up the result list. `highlightRects` keeps one rectangle list per match
 * for page highlighting, independent of the result-list limit.
 */
export function searchAtoms(atoms, query, options = {}) {
  const textIndex = buildSearchText(atoms)
  const { terms, ranges } = findMatchRanges(textIndex.text, query, {
    removedHyphens: textIndex.removedHyphens,
  })
  const limit =
    Number.isInteger(options.limit) && options.limit > 0
      ? options.limit
      : MAX_HITS_PER_PAGE
  // Keep every rectangle for page highlighting: the result list is capped, but
  // a page with more hits than the list limit must still light up completely.
  const highlightRects = rangeRectsForRanges(textIndex.spans, ranges)
  const hits = ranges.slice(0, limit).map((range, hitIndex) => ({
    snippet: makeSnippet(textIndex.text, range),
    rects: highlightRects[hitIndex],
  }))
  return { terms, count: ranges.length, hits, highlightRects }
}

/** Scan pages in order, preserving partial results when text extraction fails. */
export async function scanSearchPages({ pageCount, query, readAtoms, signal, onProgress }) {
  const pages = []
  let total = 0
  let failedPages = 0
  let done = 0
  while (done < pageCount && total < MAX_HITS_TOTAL) {
    if (signal.aborted) return null
    let atoms
    try {
      atoms = await readAtoms(done)
    } catch (error) {
      if (signal.aborted) return null
      console.warn(`pdf-math-reader: search failed on page ${done + 1}`, error)
      failedPages++
    }
    if (signal.aborted) return null
    const found = atoms && searchAtoms(atoms, query)
    if (found?.count > 0) {
      pages.push({
        pageIndex: done,
        count: found.count,
        hits: found.hits,
        highlightRects: found.highlightRects,
      })
      total += found.count
    }
    done++
    if (found?.count > 0 || done % 4 === 0) {
      onProgress?.({ pages: [...pages], total, done, failedPages })
    }
  }
  return { pages, total, done, failedPages, truncated: done < pageCount,
    status: failedPages > 0 && failedPages === pageCount ? 'error' : 'done' }
}

/** Preserve the current horizontal position when the match fits in view. */
export function searchScrollLeft(current, viewportWidth, left, width) {
  if (left >= current && left + width <= current + viewportWidth) return current
  return Math.max(0, left + (width - viewportWidth) / 2)
}
