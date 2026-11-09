/**
 * Reference-list extraction for the left rail.
 *
 * Reference lists are often set in two columns, and `buildPageModel`'s reading
 * order can merge the columns or drop one of them. This module therefore works
 * on visual lines: it finds a vertical gutter, reads the left column and then
 * the right column, and splits entries on their "[12]" / "12." markers.
 */

import { buildAtoms, loadPdfJs } from './pdf.js'

const REFERENCE_TITLE =
  /^(?:references|bibliography|works\s+cited|参考文献|引用文献)$/i
const REFERENCE_HEADING =
  /^(references|bibliography|works\s+cited|参考文献|引用文献)(?=\s|[:：]|$)/i
const SECTION_NUMBER = /^\d+(?:\.\d+)*[.)、]?\s+/
const ENTRY_START = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})[.)])\s+/
const PAGE_NUMBER = /^\d{1,3}$/
const MAX_ENTRIES = 300
const MAX_SCAN_PAGES = 60

function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function joinText(left, right) {
  const a = normalize(left)
  const b = normalize(right)
  if (a === '') return b
  if (b === '') return a
  if (/[‐‑-]$/.test(a) && /^[a-zà-ÿ]/i.test(b)) return `${a.slice(0, -1)}${b}`
  return `${a} ${b}`
}

function headingBody(text) {
  const value = normalize(text)
  const match = value.match(SECTION_NUMBER)
  return match === null ? value : value.slice(match[0].length)
}

export function referenceHeading(text) {
  const body = headingBody(text)
  const match = body.match(REFERENCE_HEADING)
  if (match === null) return null
  const rest = normalize(body.slice(match[0].length)).replace(/^[:：]\s*/, '')
  // "References and Notes" is a different section title; a reference list's
  // remainder starts with its first entry (a number or bracket).
  if (rest !== '' && !/^(?:\[|\d|[:：])/.test(rest)) return null
  return { heading: match[1], rest }
}

function isSectionBoundary(text) {
  const value = normalize(text)
  if (value === '' || value.length > 80) return false
  // Appendix-style headings may legitimately end with a period ("Appendix A.").
  if (/^(?:appendix(?:\s+[A-Z0-9])?|appendices?)\s*(?:[:：.。]\s*.*)?$/i.test(value)) {
    return true
  }
  if (
    /^(?:acknowledg(?:e)?ments?|author\s+contributions|funding|conflicts?\s+of\s+interest)\s*[:.：]?\s*$/i.test(
      value,
    )
  ) {
    return true
  }
  if (
    /^(?:附录|附\s*录)(?:\s*[A-Z0-9一二三四五六七八九十])?\s*[:：.]?\s*$/u.test(value)
  ) {
    return true
  }
  // A reference title may start with "Supplementary ..." (for example
  // "Supplementary motor area function."); a sentence-like line is not a
  // section boundary.
  if (/[.!?。！？]$/.test(value)) return false
  if (value.split(/\s+/).length > 8) return false
  if (/^(?:supplementary|additional\s+results)\b/i.test(value)) return true
  if (/^[A-Z](?:\.\d+)?\s+(?:appendix|additional\s+results|supplementary)\b/i.test(value)) {
    return true
  }
  return /^(?:figure|table|fig\.)\s*\d/i.test(value)
}

function looksLikeAuthorYearStart(text) {
  const value = normalize(text)
  if (!/^[\p{Lu}\u4e00-\u9fff]/u.test(value)) return false
  return /(?:\((?:19|20)\d{2}[a-z]?\)|(?:19|20)\d{2}[a-z]?[.,])/.test(
    value.slice(0, 180),
  )
}

function detectReferenceStyle(paragraphs, startIndex) {
  for (let index = startIndex; index < paragraphs.length; index += 1) {
    const text = normalize(paragraphs[index].text)
    if (text === '' || PAGE_NUMBER.test(text)) continue
    if (referenceHeading(text) !== null) continue
    if (entryStart(text) !== null) return 'numbered'
    if (looksLikeAuthorYearStart(text)) return 'unnumbered'
    return 'numbered'
  }
  return 'numbered'
}

function entryStart(text) {
  const match = text.match(ENTRY_START)
  if (match === null) return null
  return {
    label: match[1] ?? match[2] ?? '',
    text: text.slice(match[0].length).trim(),
  }
}

/**
 * A continuation page must look like the same reference block: similar glyph
 * size, a matching left edge and a reasonably wide text line. A figure page
 * with large labels or a short heading does not qualify.
 */
function isContinuationLine(paragraph, current) {
  const line = paragraph.lines?.[0]
  if (line === undefined) return false
  const currentHeight = current.height || line.height || 10
  const currentX = Number.isFinite(current.x) ? current.x : line.x
  const currentWidth = current.width || line.width || 0
  const heightOk =
    line.height >= currentHeight * 0.65 && line.height <= currentHeight * 1.45
  const xOk = line.x >= currentX - 3 && line.x <= currentX + Math.max(30, currentHeight * 5)
  const widthOk = line.width >= Math.min(160, Math.max(60, currentWidth * 0.35))
  // A year, page range or DOI tail can legitimately be a very short line.
  const tailLike =
    /^(?:\d{4}[a-z]?[.,;]?|pp?\.\s*\d|pages?\s|vol\.\s|no\.\s|doi|https?:)/i.test(
      normalize(paragraph.text),
    )
  return heightOk && xOk && (widthOk || tailLike)
}

function outlinePages(outline) {
  if (!Array.isArray(outline)) return []
  return outline
    .filter(
      (entry) =>
        Number.isInteger(entry?.pageIndex) &&
        REFERENCE_TITLE.test(headingBody(entry.title)),
    )
    .map((entry) => entry.pageIndex)
}

/**
 * Page indexes worth checking for a reference heading. An outline page is
 * exact; without one, start at the last page and walk backwards within the
 * scan budget so long documents still cover their final references.
 */
export function referenceScanPages(numPages, outline) {
  const fromOutline = outlinePages(outline)
  if (fromOutline.length > 0) return fromOutline
  return Array.from(
    { length: Math.min(numPages, MAX_SCAN_PAGES) },
    (_, index) => numPages - 1 - index,
  )
}

/**
 * Find the vertical gutter between two text columns. Full-width lines (a page
 * title) are ignored when measuring the gap, otherwise their atoms would close
 * the gutter.
 */
function roughRows(atoms) {
  const rows = []
  for (const atom of [...atoms].sort((left, right) => left.top - right.top)) {
    let row = null
    for (let index = rows.length - 1; index >= Math.max(0, rows.length - 4); index -= 1) {
      if (Math.abs(rows[index].top - atom.top) <= 4) {
        row = rows[index]
        break
      }
    }
    if (row === null) rows.push({ top: atom.top, atoms: [atom] })
    else {
      row.atoms.push(atom)
      row.top = Math.max(row.top, atom.top)
    }
  }
  return rows
}

function columnSplit(atoms, pageWidth) {
  const rows = roughRows(atoms.filter((atom) => atom.text.trim() !== ''))
  if (rows.length < 6) return null
  let centralRows = 0
  for (const row of rows) {
    const sorted = [...row.atoms].sort((left, right) => left.x - right.x)
    let best = null
    for (let index = 1; index < sorted.length; index += 1) {
      const gap = sorted[index].x - (sorted[index - 1].x + sorted[index - 1].width)
      if (best === null || gap > best.gap) {
        best = { gap, mid: (sorted[index].x + sorted[index - 1].x + sorted[index - 1].width) / 2 }
      }
    }
    if (best !== null && best.gap >= 4 && best.mid > pageWidth * 0.35 && best.mid < pageWidth * 0.65) {
      centralRows += 1
    }
  }
  // A single-column page has no persistent gutter in the middle; two-column
  // pages show the same central gap on most of their rows.
  if (centralRows < Math.max(4, rows.length * 0.3)) return null

  // The gutter's left edge is the reliable split: the first atom of the right
  // column may start only a few points after the last atom of the left one.
  const intervals = atoms
    .filter(
      (atom) =>
        atom.text.trim() !== '' &&
        atom.width <= pageWidth * 0.5 &&
        atom.x >= pageWidth * 0.15 &&
        atom.x <= pageWidth * 0.85,
    )
    .map((atom) => [atom.x, atom.x + atom.width])
    .sort((left, right) => left[0] - right[0])
  const merged = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last !== undefined && interval[0] <= last[1] + 1.5) {
      last[1] = Math.max(last[1], interval[1])
    } else {
      merged.push([...interval])
    }
  }
  let best = null
  for (let index = 1; index < merged.length; index += 1) {
    const from = merged[index - 1][1]
    const to = merged[index][0]
    const gap = to - from
    const mid = (from + to) / 2
    if (gap < 4 || mid < pageWidth * 0.35 || mid > pageWidth * 0.65) continue
    if (best === null || gap > best.gap) best = { gap, split: (from + to) / 2 }
  }
  return best?.split ?? pageWidth / 2
}

function buildLines(atoms) {
  const sorted = atoms
    .filter((atom) => atom.text.trim() !== '')
    .sort((left, right) => left.top - right.top || left.x - right.x)
  const rows = []
  for (const atom of sorted) {
    let row = null
    for (let index = rows.length - 1; index >= Math.max(0, rows.length - 3); index -= 1) {
      if (Math.abs(rows[index].top - atom.top) <= Math.max(2, atom.height * 0.45)) {
        row = rows[index]
        break
      }
    }
    if (row === null) {
      rows.push({ top: atom.top, atoms: [atom] })
    } else {
      row.atoms.push(atom)
      row.top = Math.max(row.top, atom.top)
    }
  }
  return rows
    .map((row) => {
      const lineAtoms = [...row.atoms].sort((left, right) => left.x - right.x)
      let text = ''
      let endX = lineAtoms[0].x
      let height = 1
      for (const atom of lineAtoms) {
        const gap = atom.x - endX
        if (text !== '' && gap > Math.max(1, atom.height * 0.18)) text += ' '
        text += atom.text
        endX = Math.max(endX, atom.x + atom.width)
        height = Math.max(height, atom.height)
      }
      return {
        text: normalize(text),
        x: lineAtoms[0].x,
        top: Math.min(...lineAtoms.map((atom) => atom.top)),
        width: Math.max(1, endX - lineAtoms[0].x),
        height,
      }
    })
    .filter((line) => line.text !== '')
    .sort((left, right) => left.top - right.top || left.x - right.x)
}

/** Turn one page's atoms into lines in left-column-then-right-column order. */
export function pageLines(atoms, pageWidth) {
  const split = columnSplit(atoms, pageWidth)
  if (split === null) return buildLines(atoms).map((line) => ({ ...line, column: 0 }))
  const left = buildLines(atoms.filter((atom) => atom.x < split)).map((line) => ({
    ...line,
    column: 0,
  }))
  const right = buildLines(atoms.filter((atom) => atom.x >= split)).map((line) => ({
    ...line,
    column: 1,
  }))
  return [...left, ...right]
}

async function pageLinesFor(pdf, library, pageIndex, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const page = await pdf.getPage(pageIndex + 1)
  const viewport = page.getViewport({ scale: 1 })
  const textContent = await page.getTextContent({ includeMarkedContent: false })
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const lines = pageLines(buildAtoms(library, textContent, viewport), viewport.width)
  return {
    pageIndex,
    paragraphs: lines.map((line, index) => ({
      id: `page${pageIndex + 1}-line${index}`,
      text: line.text,
      top: line.top,
      lines: [line],
    })),
  }
}

function pushEntry(entries, current) {
  const text = normalize(current.text)
  if (text === '' || PAGE_NUMBER.test(text)) return
  if (entries.length >= MAX_ENTRIES) return
  entries.push({
    id: `reference-${current.pageIndex}-${entries.length + 1}`,
    label: current.label,
    text,
    pageIndex: current.pageIndex,
    anchorTop: current.anchorTop,
    paragraphId: current.paragraphId,
  })
}

function parseUnnumbered(pages, headingPage, firstRest, startIndex) {
  const entries = []
  let current = null
  let stopped = false

  const create = (paragraph, pageIndex, text) => {
    const line = paragraph.lines?.[0]
    return {
      label: '',
      text,
      pageIndex,
      lastPage: pageIndex,
      x: line?.x,
      width: line?.width,
      height: line?.height,
      column: line?.column,
      anchorTop: line?.top ?? paragraph.top,
      paragraphId: paragraph.id,
    }
  }

  for (const page of pages) {
    if (stopped) break
    const paragraphs = Array.isArray(page.paragraphs) ? page.paragraphs : []
    const begin = page.pageIndex === headingPage ? startIndex : 0
    for (let index = begin; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      const text =
        page.pageIndex === headingPage && index === startIndex
          ? firstRest
          : normalize(paragraph.text)
      if (text === '' || PAGE_NUMBER.test(text)) continue
      if (referenceHeading(text) !== null) continue
      if (isSectionBoundary(text)) {
        if (current !== null) pushEntry(entries, current)
        current = null
        stopped = true
        break
      }
      if (current === null) {
        current = create(paragraph, page.pageIndex, text)
        continue
      }
      const line = paragraph.lines?.[0]
      const columnChanged =
        Number.isInteger(line?.column) &&
        Number.isInteger(current.column) &&
        line.column !== current.column
      const indented =
        Number.isFinite(line?.x) &&
        Number.isFinite(current.x) &&
        line.x > current.x + 8
      const startsNew =
        columnChanged ||
        (!indented &&
          (looksLikeAuthorYearStart(text) ||
            (page.pageIndex > current.lastPage && /[.!?。！？]$/.test(current.text))))
      if (startsNew) {
        pushEntry(entries, current)
        current = create(paragraph, page.pageIndex, text)
        continue
      }
      current.lastPage = page.pageIndex
      current.text = joinText(current.text, text)
    }
  }
  if (current !== null) pushEntry(entries, current)
  return entries
}

/**
 * Split references from visual lines. Exported separately so the parser can be
 * tested without PDF.js.
 */
export function parseReferenceEntries(pages, headingPage, firstRest, startIndex, style) {
  const headingPageModel = pages.find((page) => page.pageIndex === headingPage)
  const resolvedStyle =
    style ??
    detectReferenceStyle(headingPageModel?.paragraphs ?? [], startIndex)
  if (resolvedStyle === 'unnumbered') {
    return parseUnnumbered(pages, headingPage, firstRest, startIndex)
  }

  const entries = []
  let current = null
  let numbered = false
  let stopped = false

  for (const page of pages) {
    if (stopped) break
    const paragraphs = Array.isArray(page.paragraphs) ? page.paragraphs : []
    // Only the heading page starts at the heading line. Later pages start at
    // their first line so a continuation of the last entry is kept.
    const begin = page.pageIndex === headingPage ? startIndex : 0
    // The first unnumbered line of a new page decides whether the whole page
    // continues the previous entry. A figure page may coincidentally contain a
    // later line with matching width; it must not be appended.
    let pageContinuation = null
    for (let index = begin; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      let text =
        page.pageIndex === headingPage && index === startIndex
          ? firstRest
          : normalize(paragraph.text)
      if (text === '' || PAGE_NUMBER.test(text)) continue
      if (referenceHeading(text) !== null) continue
      if (isSectionBoundary(text)) {
        if (current !== null) pushEntry(entries, current)
        current = null
        stopped = true
        break
      }
      const start = entryStart(text)
      if (start !== null) {
        numbered = true
        if (current !== null) pushEntry(entries, current)
        // A header line may have marked this page as non-continuation. Once a
        // real [n] entry starts, its following lines are same-page
        // continuations and must be appended again.
        pageContinuation = null
        const line = paragraph.lines?.[0]
        current = {
          label: start.label,
          text: start.text,
          pageIndex: page.pageIndex,
          lastPage: page.pageIndex,
          x: line?.x,
          width: line?.width,
          height: line?.height,
          anchorTop: line?.top ?? paragraph.top,
          paragraphId: paragraph.id,
        }
        continue
      }
      if (current !== null) {
        if (page.pageIndex !== current.lastPage && pageContinuation === null) {
          pageContinuation = isContinuationLine(paragraph, current)
        }
        if (page.pageIndex !== current.lastPage && pageContinuation === false) {
          // A short tail ("2020.") belongs to the previous entry, but a figure
          // page or another section must not be appended. Keep scanning for
          // the next numbered entry instead of ending the list here.
          continue
        }
        current.lastPage = page.pageIndex
        current.text = joinText(current.text, text)
        continue
      }
      // Unnumbered author-year lists: every visual line is one reference.
      if (!numbered && (page.pageIndex > headingPage || index > startIndex)) {
        if (entries.length >= MAX_ENTRIES) break
        entries.push({
          id: `reference-${page.pageIndex}-${entries.length + 1}`,
          label: '',
          text,
          pageIndex: page.pageIndex,
          anchorTop: paragraph.lines?.[0]?.top ?? paragraph.top,
          paragraphId: paragraph.id,
        })
      }
    }
  }
  if (current !== null) pushEntry(entries, current)
  return entries
}

async function readFollowingPages(pdf, library, start, end, signal, style = 'numbered') {
  const pages = []
  for (let pageIndex = start; pageIndex <= end; pageIndex += 1) {
    if (signal?.aborted) break
    const model = await pageLinesFor(pdf, library, pageIndex, signal)
    const first = model.paragraphs.find(
      (paragraph) =>
        normalize(paragraph.text) !== '' && !PAGE_NUMBER.test(normalize(paragraph.text)),
    )
    if (first === undefined || isSectionBoundary(first.text)) break
    if (style === 'unnumbered') {
      // Author-year lists have no numbering to delimit pages; keep reading
      // until a page starts with the next section.
      pages.push(model)
      continue
    }
    const hasNumbered = model.paragraphs.some(
      (paragraph) => entryStart(normalize(paragraph.text)) !== null,
    )
    if (hasNumbered) {
      pages.push(model)
      continue
    }
    // A page without a new number may still carry the tail of the last entry.
    // Include it once, but never include an appendix page that starts with a
    // clear next-section title.
    pages.push(model)
    break
  }
  return pages
}

/**
 * Find a reference heading from the outline hint or by scanning the latter
 * part of the document, then collect entries until the next section.
 */
export async function extractReferences(pdf, outline, options = {}) {
  if (pdf === undefined || pdf === null) return null
  const signal = options.signal
  // Browser callers let the module load PDF.js from the Host asset route;
  // Node tests inject the already-imported library.
  const library = options.library ?? (await loadPdfJs())
  const numPages = Number.isInteger(pdf.numPages) ? pdf.numPages : 0
  if (numPages === 0) return null
  const scanned = referenceScanPages(numPages, outline)

  // Without an outline, search backwards from the last page so a long document's
  // final pages are always covered by the scan budget. A repeated "References"
  // header on later pages must not win: sort candidates by page and use the
  // earliest heading of a contiguous list.
  const candidates = []
  for (const pageIndex of scanned) {
    if (signal?.aborted) return null
    const model = await pageLinesFor(pdf, library, pageIndex, signal)
    for (let index = 0; index < model.paragraphs.length; index += 1) {
      const heading = referenceHeading(model.paragraphs[index].text)
      if (heading !== null) candidates.push({ pageIndex, index, heading, model })
    }
  }
  candidates.sort(
    (left, right) => left.pageIndex - right.pageIndex || left.index - right.index,
  )
  for (const candidate of candidates) {
    if (signal?.aborted) return null
    const style = detectReferenceStyle(candidate.model.paragraphs, candidate.index)
    const following = await readFollowingPages(
      pdf,
      library,
      candidate.pageIndex + 1,
      Math.min(numPages - 1, candidate.pageIndex + MAX_SCAN_PAGES),
      signal,
      style,
    )
    const entries = parseReferenceEntries(
      [candidate.model, ...following],
      candidate.pageIndex,
      candidate.heading.rest,
      candidate.index,
      style,
    )
    if (entries.length > 0) {
      return {
        heading: candidate.heading.heading,
        pageIndex: candidate.pageIndex,
        entries,
      }
    }
  }
  return null
}
