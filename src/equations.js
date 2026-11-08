/**
 * Display-equation detection, region geometry and crop sizing.
 *
 * Coordinates here are PDF page points in the scale-1 viewport orientation
 * (origin at the top-left, y grows downwards). A point is therefore one PDF
 * unit at scale 1, and a bbox stays valid across zoom levels and sidebar
 * widths. Convert to screen pixels with the page viewport scale.
 *
 * The heuristics deliberately combine several weak signals instead of treating
 * "one letter" or "a short line" as a formula: an equation number near the
 * right edge, math fonts/symbols, sub- and superscripts, and vertical isolation
 * from body lines. Every automatic decision can be overridden by a manual box.
 */

export const MATH_SYMBOL_SOURCE =
  '[=+\\u2212\\u00d7\\u00f7\\u00b1\\u2213\\u2211\\u220f\\u222b\\u222e\\u221a\\u221e\\u2202\\u2207' +
  '\\u2248\\u2243\\u2264\\u2265\\u2260\\u2261\\u223c\\u226a\\u226b\\u2192\\u2190\\u2194\\u21d2\\u21d4' +
  '\\u2208\\u2209\\u220b\\u2282\\u2283\\u2286\\u2287\\u222a\\u2229\\u2200\\u2203\\u22c5\\u00b7' +
  '\\u2218\\u2297\\u2295\\u0394\\u03a9\\u0393\\u039b\\u0398\\u03a3\\u03a6\\u03a8\\u03b1-\\u03c9]'

const MATH_SYMBOL_RE = new RegExp(MATH_SYMBOL_SOURCE, 'u')
const MATH_SYMBOL_RE_GLOBAL = new RegExp(MATH_SYMBOL_SOURCE, 'gu')
const EQUATION_NUMBER_RE = /^[(（]\s*[0-9]{1,3}[a-zA-Z]?\s*[)）]$/
const SECTION_NUMBER_RE = /^[0-9]+(?:\.[0-9]+)+$/
// A relational or structural operator is required before a row is treated as a
// display equation. Table cells such as "O(1)" or "1.0 · 10^20" use math fonts
// and symbols but never carry one of these, which keeps tables out of the
// equation list.
const CORE_EQUATION_RE =
  /[=≈≃≠≤≥<>→←↔⇒⇔∈∉∋⊂⊃⊆⊇∑∏∫∮√∂∇≡∼≪≫]/u
const CJK_RE = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3040-\u30ff\uac00-\ud7af]/
// Common prose words that happen to be short. They are never variables when
// they sit next to an operator inside a mixed prose/math text item.
const PROSE_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'from', 'by', 'for', 'with', 'as', 'and', 'or', 'but',
  'not', 'no', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'you',
  'they', 'he', 'she', 'his', 'her', 'their', 'our', 'has', 'have', 'had',
  'can', 'could', 'should', 'would', 'may', 'might', 'will', 'shall', 'do',
  'does', 'did', 'i', 'if', 'then', 'than', 'so', 'such', 'all', 'any',
  'each', 'other', 'into', 'over', 'under', 'between', 'about', 'after',
  'before', 'when', 'where', 'which', 'while', 'who', 'whom', 'whose', 'why',
  'how', 'both', 'more', 'most', 'some', 'only', 'also', 'very', 'just',
])
const MATH_FUNCTION_RE =
  /^(?:sin|cos|tan|cot|sec|csc|log|ln|exp|max|min|arg|lim|sup|inf|det|dim|rank|tr|diag|softmax|relu|sigmoid)$/u

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function isEquationNumber(text) {
  return EQUATION_NUMBER_RE.test(String(text ?? '').trim())
}

export function countMathSymbols(text) {
  MATH_SYMBOL_RE_GLOBAL.lastIndex = 0
  let count = 0
  for (const _match of String(text ?? '').matchAll(MATH_SYMBOL_RE_GLOBAL)) count += 1
  return count
}

function looksLikeProse(text) {
  return /[A-Za-z\u00c0-\u024f]{3,}\s+[A-Za-z\u00c0-\u024f]{3,}/u.test(text)
}

function isMathToken(text) {
  const value = text
    .replace(/^[([{]+/u, '')
    .replace(/[)\]}]+$/u, '')
    .replace(/[.,;:]+$/u, '')
  if (value === '') return false
  if (PROSE_STOP_WORDS.has(value.toLowerCase())) return false
  if (MATH_SYMBOL_RE.test(value)) return true
  // Single letters can be variables, but longer lowercase words ("of", "is")
  // are prose. Uppercase short runs are kept for matrices such as "AB".
  if (/^[A-Za-z\u0370-\u03ff]$/u.test(value)) return true
  if (/^[\u0370-\u03ff]{1,3}$/u.test(value)) return true
  if (/^\d+(?:[.,]\d+)?$/u.test(value)) return true
  if (/^[A-Za-z][A-Za-z0-9]*\d[A-Za-z0-9]*$/u.test(value)) return true
  if (/^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/u.test(value)) return true
  if (/^[A-Z]{2,3}$/u.test(value)) return true
  if (MATH_FUNCTION_RE.test(value.toLowerCase())) return true
  if (/^[()[\]{},:]+$/u.test(text)) return true
  return false
}

/**
 * Split a PDF text item that mixes prose and math, e.g.
 * "increased the maximum output length to input length +".
 *
 * PDF.js sometimes emits a whole sentence and its trailing operator as one
 * item. Treating the item as math would hide the sentence from translation, so
 * contiguous math tokens (and adjacent variables/numbers/punctuation) become
 * separate sub-atoms. Text and x/width cumulatively preserve the original
 * item, which keeps line reconstruction unchanged.
 */
export function splitTextAtom(atom) {
  const text = String(atom.text ?? '')
  if (text.trim() === '' || !MATH_SYMBOL_RE.test(text)) return [atom]
  const tokens = []
  const tokenPattern = /\S+/gu
  let match
  while ((match = tokenPattern.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    })
  }
  if (tokens.length < 2) return [atom]
  if (!tokens.some((token) => /^[A-Za-z\u00c0-\u024f]{3,}$/u.test(token.text))) {
    return [atom]
  }
  const mathTokens = new Set()
  for (let index = 0; index < tokens.length; index += 1) {
    if (MATH_SYMBOL_RE.test(tokens[index].text)) mathTokens.add(index)
  }
  if (mathTokens.size === 0) return [atom]
  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < tokens.length; index += 1) {
      if (mathTokens.has(index)) continue
      const adjacent = mathTokens.has(index - 1) || mathTokens.has(index + 1)
      if (adjacent && isMathToken(tokens[index].text)) {
        mathTokens.add(index)
        changed = true
      }
    }
  }

  const groups = []
  let group
  let previous = -2
  for (let index = 0; index < tokens.length; index += 1) {
    if (!mathTokens.has(index)) {
      group = undefined
      previous = -2
      continue
    }
    if (group !== undefined && previous === index - 1) {
      group.end = tokens[index].end
    } else {
      group = { start: tokens[index].start, end: tokens[index].end }
      groups.push(group)
    }
    previous = index
  }
  if (groups.length === 0) return [atom]

  const segments = []
  let cursor = 0
  for (const current of groups) {
    if (current.start > cursor) {
      segments.push({ text: text.slice(cursor, current.start), math: false })
    }
    segments.push({ text: text.slice(current.start, current.end), math: true })
    cursor = current.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), math: false })
  }
  if (segments.length < 2) return [atom]

  const originalWidth =
    atom.width > 0 ? atom.width : text.length * Math.max(1, atom.height) * 0.48
  const charWidth = originalWidth / text.length
  let offset = 0
  const sourceIndex = atom.sourceIndex ?? atom.index
  return segments.map((segment, position) => {
    const start = offset
    offset += segment.text.length
    return {
      ...atom,
      index: atom.index + (position + 1) / (segments.length + 1),
      sourceIndex,
      text: segment.text,
      x: atom.x + charWidth * start,
      endX: atom.x + charWidth * offset,
      width: charWidth * (offset - start),
      top: atom.top,
      bottom: atom.bottom,
      height: atom.height,
      fontName: atom.fontName,
    }
  })
}

export function horizontalOverlapRatio(left, right) {
  const width = Math.min(left[2], right[2]) - Math.max(left[0], right[0])
  const smaller = Math.min(left[2] - left[0], right[2] - right[0])
  if (width <= 0 || smaller <= 0) return 0
  return width / smaller
}

export function median(values, fallback) {
  if (!Array.isArray(values) || values.length === 0) return fallback
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)]
}

export function unionBox(boxes) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const box of boxes) {
    if (box === null || box === undefined) continue
    x0 = Math.min(x0, box[0])
    y0 = Math.min(y0, box[1])
    x1 = Math.max(x1, box[2])
    y1 = Math.max(y1, box[3])
  }
  if (!Number.isFinite(x0)) return [0, 0, 0, 0]
  return [x0, y0, x1, y1]
}

export function expandBox(box, padding, pageWidth, pageHeight) {
  const left = Math.max(0, box[0] - padding)
  const top = Math.max(0, box[1] - padding)
  const right = pageWidth === undefined ? box[2] + padding : Math.min(pageWidth, box[2] + padding)
  const bottom = pageHeight === undefined ? box[3] + padding : Math.min(pageHeight, box[3] + padding)
  return [left, top, Math.max(left + 0.5, right), Math.max(top + 0.5, bottom)]
}

export function boxArea(box) {
  return Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1])
}

export function intersectionArea(left, right) {
  const width = Math.max(0, Math.min(left[2], right[2]) - Math.max(left[0], right[0]))
  const height = Math.max(0, Math.min(left[3], right[3]) - Math.max(left[1], right[1]))
  return width * height
}

/** Intersection over the smaller box: robust to a tight manual box inside a large auto box. */
export function overlapRatio(left, right) {
  const area = Math.min(boxArea(left), boxArea(right))
  if (area <= 0) return 0
  return intersectionArea(left, right) / area
}

export function iou(left, right) {
  const intersection = intersectionArea(left, right)
  const union = boxArea(left) + boxArea(right) - intersection
  return union <= 0 ? 0 : intersection / union
}

export function atomBox(atom) {
  return [atom.x, atom.top, atom.endX, atom.bottom]
}

export function dominantFont(atoms) {
  const counts = new Map()
  for (const atom of atoms) {
    const text = atom.text.trim()
    if (text === '') continue
    counts.set(atom.fontName, (counts.get(atom.fontName) ?? 0) + text.length)
  }
  let best = undefined
  let bestCount = -1
  for (const [font, count] of counts) {
    if (count > bestCount) {
      best = font
      bestCount = count
    }
  }
  return best
}

export function bodyFontSize(atoms, fallback = 10) {
  const heights = atoms
    .filter((atom) => atom.text.trim() !== '')
    .map((atom) => atom.height)
    .filter((height) => Number.isFinite(height) && height > 0)
  const medianHeight = median(heights, fallback)
  // Text item heights include sub/superscripts; body text is the tallest mode.
  const tall = heights.filter((height) => height >= medianHeight * 0.85)
  return median(tall, medianHeight)
}

function joinRowText(left, right) {
  if (left === '') return right
  if (right === '') return left
  return `${left} ${right}`
}

function rowText(items, bodySize) {
  let text = ''
  let previous
  for (const atom of items) {
    const value = atom.text.trim()
    if (value === '') continue
    if (previous === undefined) {
      text = value
      previous = atom
      continue
    }
    const gap = atom.x - previous.endX
    const space = gap > Math.max(1.2, Math.max(atom.height, previous.height) * 0.16)
    text = space ? joinRowText(text, value) : `${text}${value}`
    previous = atom
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Group text atoms into visual rows. A row is not split on a wide horizontal
 * gap when the next atom is an equation number, because "… V        (1)" is one
 * formula. Rows still split on backward jumps (column changes) and on wide
 * gaps between ordinary body text, which keeps a two-column page intact.
 */
export function buildTextRows(atoms, options = {}) {
  const bodySize = Number.isFinite(options.bodySize) ? options.bodySize : 10
  const rows = []
  let current

  const flush = () => {
    if (current === undefined) return
    current.text = rowText(current.items, bodySize)
    current.x = Math.min(...current.items.map((atom) => atom.x))
    current.right = Math.max(...current.items.map((atom) => atom.endX))
    current.top = Math.min(...current.items.map((atom) => atom.top))
    current.bottom = Math.max(...current.items.map((atom) => atom.bottom))
    current.height = current.bottom - current.top
    current.order = Math.min(...current.items.map((atom) => atom.index))
    if (current.text !== '') rows.push(current)
    current = undefined
  }

  for (const atom of atoms) {
    if (atom.text.trim() === '') continue
    const sameLine =
      current !== undefined &&
      Math.abs(atom.y - current.baseline) <=
        Math.max(1.2, Math.max(current.height, atom.height) * 0.55)
    const backwards =
      current !== undefined && atom.x < current.x - Math.max(2, bodySize * 2)
    const nextIsNumber = isEquationNumber(atom.text)
    const wideGap =
      current !== undefined && atom.x - current.right > bodySize * 6 && !nextIsNumber
    if (!sameLine || backwards || wideGap) {
      flush()
    }
    if (current === undefined) {
      current = {
        items: [atom],
        x: atom.x,
        right: atom.endX,
        baseline: atom.y,
        top: atom.top,
        bottom: atom.bottom,
        height: atom.height,
        bodyChars: 0,
        totalChars: 0,
      }
    } else {
      current.items.push(atom)
      current.right = Math.max(current.right, atom.endX)
      current.x = Math.min(current.x, atom.x)
      current.top = Math.min(current.top, atom.top)
      current.bottom = Math.max(current.bottom, atom.bottom)
      current.height = current.bottom - current.top
    }
  }
  flush()
  return rows
}

function annotateRows(rows, atoms, bodyFont, bodySize) {
  for (let position = 0; position < rows.length; position += 1) {
    const row = rows[position]
    // Recompute band bounds from the atom positions so sub/superscripts do not
    // inflate the row into the previous or next line.
    row.items.sort((left, right) => left.x - right.x)
    row.text = rowText(row.items, bodySize)
    row.totalChars = row.items.reduce((sum, atom) => sum + atom.text.trim().length, 0)
    row.bodyChars = row.items.reduce(
      (sum, atom) => sum + (atom.fontName === bodyFont ? atom.text.trim().length : 0),
      0,
    )
    row.bodyRatio = row.totalChars === 0 ? 1 : row.bodyChars / row.totalChars
    row.mathSymbols = countMathSymbols(row.text)
    row.scriptCount = row.items.filter(
      (atom) =>
        Math.abs(atom.y - row.baseline) > bodySize * 0.22 &&
        atom.height <= bodySize * 0.96 &&
        atom.text.trim() !== '',
    ).length
    row.equationNumbers = []
    let previous
    for (const atom of row.items) {
      if (isEquationNumber(atom.text)) {
        const gap = previous === undefined ? Infinity : atom.x - previous.endX
        if (gap > bodySize * 1.4 || previous === undefined) row.equationNumbers.push(atom)
      }
      previous = atom
    }
    row.position = position
    for (const atom of row.items) atom.rowPosition = position
  }

  // Nearest vertical neighbours in the same horizontal band. Stream order can
  // interleave a superscript fragment between two body rows, so adjacent array
  // entries are not reliable for "is this line isolated?". Rows that overlap
  // vertically are fragments of one visual line, not neighbours.
  for (const row of rows) {
    let above = Number.POSITIVE_INFINITY
    let below = Number.POSITIVE_INFINITY
    let aboveRow
    let belowRow
    let overlapped = false
    for (const other of rows) {
      if (other === row) continue
      if (horizontalOverlapRatio([row.x, 0, row.right, 0], [other.x, 0, other.right, 0]) < 0.05) {
        continue
      }
      const overlap =
        Math.min(row.bottom, other.bottom) - Math.max(row.top, other.top)
      if (overlap > Math.max(0.6, Math.min(row.height, other.height) * 0.3)) {
        overlapped = true
        continue
      }
      if (other.top < row.top) {
        const gap = row.top - other.bottom
        if (gap < above) {
          above = gap
          aboveRow = other
        }
      } else if (other.top > row.top) {
        const gap = other.top - row.bottom
        if (gap < below) {
          below = gap
          belowRow = other
        }
      }
    }
    row.gapAbove = overlapped ? Number.NEGATIVE_INFINITY : above
    row.gapBelow = overlapped ? Number.NEGATIVE_INFINITY : below
    row.nearestAbove = aboveRow
    row.nearestBelow = belowRow
  }
  return rows
}

/**
 * Detect a two-column body. Full-width titles and abstracts cross the middle,
 * so only a clear gutter with few crossing body rows counts as two columns.
 */
export function detectColumns(rows, pageWidth) {
  const single = [{ index: 0, x0: 0, x1: pageWidth, twoColumn: false }]
  const bodyRows = rows.filter(
    (row) =>
      row.bodyRatio >= 0.5 &&
      row.text.length >= 12 &&
      row.right - row.x > pageWidth * 0.08,
  )
  if (bodyRows.length < 8 || pageWidth <= 0) return single
  const center = pageWidth / 2
  const tolerance = pageWidth * 0.03
  const leftRows = []
  const rightRows = []
  const crossing = []
  for (const row of bodyRows) {
    if (row.right <= center + tolerance) leftRows.push(row)
    else if (row.x >= center - tolerance) rightRows.push(row)
    else crossing.push(row)
  }
  if (
    leftRows.length < 3 ||
    rightRows.length < 3 ||
    crossing.length > Math.max(3, bodyRows.length * 0.25)
  ) {
    return single
  }
  const leftEdge = median(leftRows.map((row) => row.x), 0)
  const leftRight = median(leftRows.map((row) => row.right), center)
  const rightLeft = median(rightRows.map((row) => row.x), center)
  const rightEdge = median(rightRows.map((row) => row.right), pageWidth)
  if (leftRight > center + pageWidth * 0.04 || rightLeft < center - pageWidth * 0.04) {
    return single
  }
  if (rightLeft - leftRight < pageWidth * 0.03) return single
  return [
    { index: 0, x0: leftEdge, x1: leftRight, twoColumn: true },
    { index: 1, x0: rightLeft, x1: rightEdge, twoColumn: true },
  ]
}

function columnForX(x, columns, pageWidth) {
  if (columns.length < 2) return columns[0]
  const gutter = (columns[0].x1 + columns[1].x0) / 2
  return x <= gutter ? columns[0] : columns[1]
}

function rowIsMarker(row) {
  if (SECTION_NUMBER_RE.test(row.text)) return true
  if (/^[0-9]{1,3}$/.test(row.text)) return true
  if (/^[ivxlcdm]{1,7}$/i.test(row.text)) return true
  return row.text.length < 2
}

function bandStats(items, bodyFont, bodySize) {
  const text = rowText(items, bodySize)
  const totalChars = items.reduce((sum, atom) => sum + atom.text.trim().length, 0)
  const bodyChars = items.reduce(
    (sum, atom) => sum + (atom.fontName === bodyFont ? atom.text.trim().length : 0),
    0,
  )
  return {
    text,
    totalChars,
    bodyRatio: totalChars === 0 ? 1 : bodyChars / totalChars,
    mathSymbols: countMathSymbols(text),
    hasMathFont: items.some((atom) => atom.fontName !== bodyFont),
    scriptCount: items.filter((atom) => atom.height < bodySize * 0.85).length,
  }
}

function isMathDominantRow(row) {
  return row.bodyRatio <= 0.45 && (row.mathSymbols >= 1 || row.scriptCount >= 1)
}

/**
 * A row carries an equation number when the number is the rightmost atom of
 * its horizontal band and the band itself is typeset mostly with math fonts or
 * symbols. This avoids treating "(2)" in prose as an equation.
 */
function numberedBand(row, atoms, bodyFont, bodySize, pageWidth, columns) {
  const number = row.equationNumbers[0]
  if (number === undefined) return undefined
  const column = columnForX(number.x, columns, pageWidth)
  if (
    number.x < column.x0 - bodySize * 2 ||
    number.x > column.x1 + bodySize * 3
  ) {
    return undefined
  }
  const rightNeighbour = atoms.find(
    (atom) =>
      atom !== number &&
      atom.text.trim() !== '' &&
      Math.abs(atom.y - number.y) <= bodySize * 0.4 &&
      atom.x >= number.endX - 0.5 &&
      atom.x <= column.x1 + bodySize * 3,
  )
  if (rightNeighbour !== undefined) return undefined
  const leftEdge = Math.max(0, column.x0 - bodySize * 2)
  const band = atoms.filter(
    (atom) =>
      atom !== number &&
      atom.text.trim() !== '' &&
      atom.x >= leftEdge &&
      atom.x < number.x &&
      atom.endX >= column.x0 - bodySize * 2 &&
      Math.abs(atom.y - number.y) <= bodySize * 0.55,
  )
  if (band.length === 0) return undefined
  const stats = bandStats(band, bodyFont, bodySize)
  if (stats.bodyRatio > 0.78) return undefined
  if (!stats.hasMathFont && stats.mathSymbols < 1) return undefined
  if (!CORE_EQUATION_RE.test(stats.text)) return undefined
  // A real equation number is separated from the formula by a visible gutter.
  // Table cells such as "O(1)" put the parentheses right next to the glyph.
  const leftAtoms = band.filter((atom) => atom.endX <= number.x + 0.5)
  const nearestEnd =
    leftAtoms.length === 0 ? number.x : Math.max(...leftAtoms.map((atom) => atom.endX))
  if (number.x - nearestEnd < bodySize * 2.5) return undefined
  return { number, band }
}

function unnumberedCandidate(row, bodySize, pageWidth, columns) {
  if (row.equationNumbers.length > 0) return false
  if (rowIsMarker(row)) return false
  if (row.text.length > 110) return false
  const column = columnForX((row.x + row.right) / 2, columns, pageWidth)
  if (
    row.x < column.x0 - bodySize * 2 ||
    row.right > column.x1 + bodySize * 2
  ) {
    return false
  }
  const widthLimit = Math.min(
    pageWidth * 0.82,
    (column.x1 - column.x0) * 1.02 + bodySize,
  )
  if (row.right - row.x > widthLimit) return false
  if (row.bodyRatio > 0.42) return false
  if (row.mathSymbols < 1 && row.scriptCount < 2) return false
  if (!CORE_EQUATION_RE.test(row.text)) return false
  const limit = bodySize * 0.45
  const isolated = row.gapAbove >= limit && row.gapBelow >= limit
  if (isolated) return true
  const aboveMath = row.nearestAbove !== undefined && isMathDominantRow(row.nearestAbove)
  const belowMath = row.nearestBelow !== undefined && isMathDominantRow(row.nearestBelow)
  return aboveMath || belowMath
}

function growRegion(seed, atoms, assigned, bodySize) {
  const items = seed.slice()
  const used = new Set(seed.map((atom) => atom.index))
  const horizontalPad = bodySize * 0.6
  const verticalPad = bodySize * 0.28
  let box = unionBox(items.map(atomBox))

  for (let guard = 0; guard < atoms.length + 4; guard += 1) {
    let changed = false
    for (const atom of atoms) {
      if (used.has(atom.index) || assigned.has(atom.index)) continue
      if (atom.text.trim() === '') continue
      const horizontal =
        atom.endX >= box[0] - horizontalPad && atom.x <= box[2] + horizontalPad
      const vertical = atom.bottom >= box[1] - verticalPad && atom.top <= box[3] + verticalPad
      if (!horizontal || !vertical) continue
      items.push(atom)
      used.add(atom.index)
      box = unionBox([box, atomBox(atom)])
      changed = true
    }
    if (!changed) break
  }
  return { items, box }
}

function mergeEquationRegions(equations, bodySize) {
  const remaining = equations.slice()
  let merged = true
  while (merged) {
    merged = false
    outer: for (let left = 0; left < remaining.length; left += 1) {
      for (let right = left + 1; right < remaining.length; right += 1) {
        const first = remaining[left]
        const second = remaining[right]
        const verticalGap = Math.max(0, Math.max(first.box[1], second.box[1]) - Math.min(first.box[3], second.box[3]))
        if (verticalGap > bodySize * 0.3) continue
        const horizontal = horizontalOverlapRatio(first.box, second.box)
        if (horizontal < 0.25) continue
        const items = [...first.items, ...second.items]
        const numbers = [...equationNumberUnion(first, second)]
        remaining[left] = {
          items,
          box: unionBox([first.box, second.box]),
          equationNumbers: numbers,
          detectionSource:
            first.detectionSource === 'manual' || second.detectionSource === 'manual'
              ? 'manual'
              : 'automatic',
        }
        remaining.splice(right, 1)
        merged = true
        break outer
      }
    }
  }
  return remaining
}

function* equationNumberUnion(first, second) {
  const seen = new Set()
  for (const atom of [...(first.equationNumbers ?? []), ...(second.equationNumbers ?? [])]) {
    if (seen.has(atom.text)) continue
    seen.add(atom.text)
    yield atom
  }
}

function applyOverrides(equations, atoms, overrides, bodySize, pageWidth) {
  const removed = Array.isArray(overrides?.removed) ? overrides.removed : []
  const added = Array.isArray(overrides?.added) ? overrides.added : []
  let output = equations.filter(
    (equation) =>
      !removed.some((box) => Array.isArray(box) && overlapRatio(box, equation.box) > 0.35),
  )

  for (const entry of added) {
    const raw = entry?.bbox
    if (!Array.isArray(raw) || raw.length !== 4) continue
    const box = [
      Math.min(raw[0], raw[2]),
      Math.min(raw[1], raw[3]),
      Math.max(raw[0], raw[2]),
      Math.max(raw[1], raw[3]),
    ]
    if (box[2] - box[0] < 2 || box[3] - box[1] < 2) continue
    const items = atoms.filter((atom) => {
      if (atom.text.trim() === '') return false
      const atomArea = boxArea(atomBox(atom))
      if (atomArea <= 0) return false
      if (intersectionArea(box, atomBox(atom)) < atomArea * 0.45) return false
      const centerX = (atom.x + atom.endX) / 2
      const centerY = (atom.top + atom.bottom) / 2
      return (
        (centerX >= box[0] && centerX <= box[2] && centerY >= box[1] && centerY <= box[3]) ||
        intersectionArea(box, atomBox(atom)) >= atomArea * 0.45
      )
    })
    if (items.length === 0) continue
    output = output.filter((equation) => overlapRatio(box, equation.box) <= 0.25)
    const numbers = items.filter((atom) => isEquationNumber(atom.text))
    let expanded = unionBox([box, ...items.map(atomBox)])
    if (numbers.length === 0) {
      const centerY = (box[1] + box[3]) / 2
      const nearby = atoms.find(
        (atom) =>
          isEquationNumber(atom.text) &&
          Math.abs((atom.top + atom.bottom) / 2 - centerY) <= Math.max(8, bodySize) &&
          atom.x >= expanded[2] - 2 &&
          atom.x <= expanded[2] + Math.max(60, pageWidth * 0.15),
      )
      if (nearby !== undefined) {
        items.push(nearby)
        numbers.push(nearby)
        expanded = unionBox([expanded, atomBox(nearby)])
      }
    }
    output.push({
      items,
      box: expanded,
      equationNumbers: numbers,
      detectionSource: 'manual',
    })
  }
  return output
}

/**
 * Detect display-equation regions and inline math atoms.
 *
 * Returns `{equations, inlineMath:Set<itemIndex>, rows, bodyFont, bodySize}`.
 * Equation items are excluded from body paragraphs by the caller.
 */
export function analyzeEquations(atoms, options = {}) {
  const bodyFont = options.bodyFont ?? dominantFont(atoms)
  const bodySize = options.bodySize ?? bodyFontSize(atoms)
  const pageWidth = Number.isFinite(options.pageWidth) ? options.pageWidth : 612
  const pageHeight = Number.isFinite(options.pageHeight) ? options.pageHeight : 792
  const overrides = options.overrides ?? {}
  const rows = annotateRows(buildTextRows(atoms, { bodySize }), atoms, bodyFont, bodySize)
  const columns = detectColumns(rows, pageWidth)

  const assigned = new Set()
  const equations = []

  const addRegion = (seed, numbers) => {
    const available = seed.filter((atom) => !assigned.has(atom.index))
    if (available.length === 0) return
    const grown = growRegion(available, atoms, assigned, bodySize)
    const equationItems = grown.items.filter((atom) => atom.text.trim() !== '')
    if (equationItems.length === 0) return
    const numberAtoms = equationItems.filter((atom) => isEquationNumber(atom.text))
    for (const atom of equationItems) assigned.add(atom.index)
    equations.push({
      items: equationItems,
      box: grown.box,
      equationNumbers: numberAtoms.length > 0 ? numberAtoms : numbers,
      detectionSource: 'automatic',
    })
  }

  // Numbered display equations first: the number is a strong anchor, and the
  // band around it can assemble a formula whose fraction fragments arrived in
  // a different stream order from the baseline run.
  for (const row of rows) {
    if (row.equationNumbers.length === 0) continue
    if (row.items.every((atom) => assigned.has(atom.index))) continue
    const anchor = numberedBand(row, atoms, bodyFont, bodySize, pageWidth, columns)
    if (anchor === undefined) continue
    addRegion([...anchor.band, anchor.number], [anchor.number])
  }

  // Unnumbered display lines: math-dominant, short, and either vertically
  // isolated or adjacent to another math-dominant display line.
  for (const row of rows) {
    if (row.equationNumbers.length > 0) continue
    if (!unnumberedCandidate(row, bodySize, pageWidth, columns)) continue
    const available = row.items.filter((atom) => !assigned.has(atom.index))
    if (available.length === 0) continue
    addRegion(available, [])
  }

  const mergedEquations = mergeEquationRegions(equations, bodySize)
  const resolved = applyOverrides(
    mergedEquations,
    atoms,
    overrides,
    bodySize,
    pageWidth,
  ).map((equation, index) => {
    const sorted = [...equation.items].sort((left, right) => left.index - right.index)
    const number = equation.equationNumbers?.[0]?.text ?? null
    const padding = Math.max(1.2, bodySize * 0.18)
    const bbox = expandBox(equation.box, padding, pageWidth, pageHeight)
    // The readable crop excludes a right-aligned equation number with its wide
    // gutter. The number is rendered separately in the block header, while the
    // full bbox still drives highlighting and correction matching.
    const content = sorted.filter((atom) => !isEquationNumber(atom.text))
    const imageBbox =
      content.length === 0
        ? bbox
        : expandBox(unionBox(content.map(atomBox)), padding, pageWidth, pageHeight)
    return {
      items: sorted,
      bbox,
      imageBbox,
      equationNumber: number === null ? null : number,
      detectionSource: equation.detectionSource ?? 'automatic',
      sourceItemIds: [
        ...new Set(
          sorted.map((atom) =>
            Number.isInteger(atom.sourceIndex) ? atom.sourceIndex : atom.index,
          ),
        ),
      ],
      text: equationText(sorted, bodySize),
      order: sorted.length > 0 ? sorted[0].index : index,
    }
  })

  const equationAtomIds = new Set()
  for (const equation of resolved) {
    for (const atom of equation.items) equationAtomIds.add(atom.index)
  }

  return {
    rows,
    columns,
    bodyFont,
    bodySize,
    equations: resolved,
    equationAtomIds,
    inlineMath: findInlineMath(rows, equationAtomIds, bodyFont, bodySize),
  }
}

function equationText(items, bodySize) {
  const ordered = [...items].sort((left, right) => left.index - right.index)
  return rowText(ordered, bodySize)
}

function isInlineMathAtom(atom, bodyFont, bodySize) {
  const text = atom.text.trim()
  if (text === '' || CJK_RE.test(text[0])) return false
  if (PROSE_STOP_WORDS.has(text.toLowerCase())) return false
  // Bare digits are footnote markers, list numbers, or table cells far more
  // often than inline math. Only a raised/lowered digit counts as a script.
  if (/^\d+$/u.test(text)) {
    return atom.fontName !== bodyFont && atom.height < bodySize * 0.9
  }
  if (MATH_SYMBOL_RE.test(text)) {
    // Mixed prose items are split before this point. This guard keeps a
    // future unsplit item from hiding a whole sentence behind a placeholder.
    return !looksLikeProse(text)
  }
  if (atom.fontName !== bodyFont) {
    // A different font alone is weak evidence: figure labels are often set in
    // a smaller font too. Require a variable shape (single letter, Greek,
    // uppercase/digit run, or subscripted name) instead of any short word.
    if (/^[A-Za-z\u0370-\u03ff]$/u.test(text)) return true
    if (
      /^[A-Za-z\u0370-\u03ff0-9]{1,2}$/u.test(text) &&
      /[A-Z0-9\u0370-\u03ff]/u.test(text)
    ) {
      return true
    }
    if (
      atom.height <= bodySize * 0.9 &&
      text.length <= 4 &&
      /^[A-Za-z0-9]*[A-Z0-9][A-Za-z0-9]*$/u.test(text)
    ) {
      return true
    }
    if (
      atom.height <= bodySize * 0.9 &&
      /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/u.test(text)
    ) {
      return true
    }
    return false
  }
  if (atom.height <= bodySize * 0.9) {
    if (/^[A-Za-z\u0370-\u03ff]$/u.test(text)) return true
    if (/^[A-Za-z][A-Za-z0-9]*\d[A-Za-z0-9]*$/u.test(text)) return true
  }
  return false
}

function findInlineMath(rows, equationAtomIds, bodyFont, bodySize) {
  const inline = new Set()
  for (const row of rows) {
    const rowAtoms = row.items.filter(
      (atom) => atom.text.trim() !== '' && !equationAtomIds.has(atom.index),
    )
    if (rowAtoms.length === 0) continue
    // A row that is itself mostly math is a display-equation fragment; leave it
    // out of inline protection so it cannot leak placeholders into prose.
    const bodyChars = rowAtoms.reduce(
      (sum, atom) => sum + (atom.fontName === bodyFont ? atom.text.trim().length : 0),
      0,
    )
    const totalChars = rowAtoms.reduce((sum, atom) => sum + atom.text.trim().length, 0)
    if (totalChars === 0) continue
    const ratio = bodyChars / totalChars
    const adjacentBody =
      (row.nearestAbove !== undefined && row.nearestAbove.bodyRatio >= 0.5) ||
      (row.nearestBelow !== undefined && row.nearestBelow.bodyRatio >= 0.5)
    // Pure-math rows inside prose (a lone radical or superscript fragment) are
    // still inline math. Rows embedded in a table or another math block are
    // left alone so they cannot flood the translation with placeholders.
    if (ratio < 0.5 && !adjacentBody) continue
    for (const atom of rowAtoms) {
      if (isInlineMathAtom(atom, bodyFont, bodySize)) inline.add(atom.index)
    }
  }
  return inline
}

/**
 * Size an independent equation crop. `renderScale` is device pixels per PDF
 * point; `displayWidth` is the CSS width the panel will use.
 */
export function cropMetrics(bbox, options = {}) {
  const width = Math.max(0.5, bbox[2] - bbox[0])
  const height = Math.max(0.5, bbox[3] - bbox[1])
  const requested = Number.isFinite(options.displayWidth) ? options.displayWidth : width * 1.6
  const displayWidth = clamp(requested, 24, 4096)
  const displayScale = displayWidth / width
  const dpr = clamp(Number.isFinite(options.devicePixelRatio) ? options.devicePixelRatio : 1, 1, 4)
  const maxScale = Number.isFinite(options.maxScale) ? options.maxScale : 6
  const maxPixels = Number.isFinite(options.maxPixels) ? options.maxPixels : 4000000
  let renderScale = Math.max(Math.min(displayScale * dpr, maxScale), 0.6)
  const area = width * height
  if (area * renderScale * renderScale > maxPixels) {
    // The memory budget wins over the readability floor.
    renderScale = Math.max(0.05, Math.sqrt(maxPixels / area))
  }
  let pixelWidth = Math.max(1, Math.floor(width * renderScale))
  let pixelHeight = Math.max(1, Math.floor(height * renderScale))
  const longest = Math.max(pixelWidth, pixelHeight)
  if (longest > 8192) {
    const factor = 8192 / longest
    pixelWidth = Math.max(1, Math.floor(pixelWidth * factor))
    pixelHeight = Math.max(1, Math.floor(pixelHeight * factor))
    renderScale *= factor
  }
  return {
    displayWidth,
    displayHeight: (height * displayWidth) / width,
    renderScale,
    pixelWidth,
    pixelHeight,
    maxPixels,
  }
}
