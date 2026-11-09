/**
 * Article-level composition for the reading panel.
 *
 * `buildPageModel` reconstructs paragraphs from PDF geometry. On a paper's
 * first page that is deliberately dumb: a two-line title, a byline grid, or a
 * paragraph split by an inline superscript can all become separate paragraphs.
 * This module groups those fragments back into reader-facing blocks:
 *
 *   title -> authors -> abstract -> keywords -> body paragraphs
 *
 * The paragraph model stays untouched so notes, page selection and equation
 * overlays keep their stable ids. The composed blocks only decide how the
 * right-hand reading column renders and what gets sent for translation.
 */

const ABSTRACT_HEADING = /^(?:abstract|summary)(?=\s|[:：—–-]|$)/i
const CHINESE_ABSTRACT_HEADING = /^摘\s*要(?=\s|[:：]|$)/
const KEYWORDS_HEADING =
  /^(?:keywords?|key\s*words?|index\s+terms?|关键词|关键字)(?=\s|[:：—–-]|$)/i
const SECTION_NAMES =
  /^(?:abstract|summary|introduction|background|related\s+work|prior\s+work|method|methods|methodology|approach|architecture|model|models|experiments?|evaluation|results?|analysis|discussion|conclusions?|references|bibliography|acknowledg(?:e)?ments?|appendix|appendices|supplementary|limitations?|future\s+work)$/i
const HEADER_NOTE =
  /^(?:provided\s+proper\s+attribution|copyright\b|©|arxiv:|doi:|preprint\b|under\s+review|published\s+as|licensed\s+under|proceedings\s+of)/i
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/
const MARKS_ONLY = /^[\s∗*†‡§¶#]+(?:\s*[\d,]+)?$/
const ORG =
  /\b(?:universit(?:y|ies)|institute|institution|department|dept\.?|school|college|laborator(?:y|ies)|research|brain|google|microsoft|meta|facebook|amazon|apple|nvidia|openai|deepmind|inc\.?|ltd\.?|corp\.?|gmbh|academy|hospital|centre|center)\b|大学|学院|研究院|研究所|实验室|公司/i

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
  // A word broken across a line keeps its hyphen out of the joined text.
  if (/[‐‑-]$/.test(a) && /^[a-zà-ÿ]/i.test(b)) return `${a.slice(0, -1)}${b}`
  // CJK does not take a space at a line boundary.
  if (/[\u3040-\u30ff\u3400-\u9fff]$/.test(a) || /^[\u3040-\u30ff\u3400-\u9fff]/.test(b)) {
    return `${a}${b}`
  }
  return `${a} ${b}`
}

function unionBox(paragraphs) {
  const boxes = paragraphs.map((paragraph) => paragraph.bbox).filter(Boolean)
  if (boxes.length === 0) return [0, 0, 0, 0]
  return [
    Math.min(...boxes.map((box) => box[0])),
    Math.min(...boxes.map((box) => box[1])),
    Math.max(...boxes.map((box) => box[2])),
    Math.max(...boxes.map((box) => box[3])),
  ]
}

function mergePlaceholders(paragraphs) {
  const seen = new Map()
  for (const paragraph of paragraphs) {
    for (const placeholder of paragraph.placeholders ?? []) {
      if (placeholder?.token) seen.set(placeholder.token, placeholder)
    }
  }
  return [...seen.values()]
}

function splitSentences(value) {
  const text = String(value ?? '')
  const spans = []
  let start = 0
  let index = 0
  while (index < text.length) {
    const char = text[index]
    let boundary = char === '。' || char === '！' || char === '？' || char === '!' || char === '?'
    if (char === '.') {
      const previous = text[index - 1]
      const next = text[index + 1]
      // "28.4" and "e.g." are not sentence ends.
      const decimal = /\d/.test(previous ?? '') && /\d/.test(next ?? '')
      const dotted = /[A-Za-z]/.test(previous ?? '') && next !== undefined && !/\s/.test(next) && next !== '"' && next !== '”'
      boundary = !decimal && !dotted && (next === undefined || /\s/.test(next) || /["'”’)\]]/.test(next))
    }
    if (!boundary) {
      index += 1
      continue
    }
    let end = index + 1
    while (end < text.length && /["'”’)\]]/.test(text[end])) end += 1
    const span = text.slice(start, end).trim()
    if (span !== '') spans.push(span)
    start = end
    index = end
    while (index < text.length && /\s/.test(text[index])) index += 1
    start = index
  }
  if (start < text.length) {
    const span = text.slice(start).trim()
    if (span !== '') spans.push(span)
  }
  return spans
}

/**
 * Split a long abstract into sentence-aligned groups. Both the readable text
 * and the placeholder form are split together, so a formula token can never
 * move to a different group than its sentence.
 */
function groupAbstract(text, translateText, maxChars = 700) {
  const source = splitSentences(text)
  const translatable = splitSentences(translateText)
  if (source.length < 2 || source.length !== translatable.length) {
    return [{ text, translateText }]
  }
  const groups = []
  let current = null
  for (let index = 0; index < source.length; index += 1) {
    const pair = { text: source[index], translateText: translatable[index] }
    if (current === null) {
      current = pair
      continue
    }
    if (current.text.length + pair.text.length + 1 > maxChars) {
      groups.push(current)
      current = pair
    } else {
      current = {
        text: joinText(current.text, pair.text),
        translateText: joinText(current.translateText, pair.translateText),
      }
    }
  }
  if (current !== null) groups.push(current)
  return groups
}

function joinParagraphs(paragraphs, key) {
  let text = ''
  for (const paragraph of paragraphs) text = joinText(text, paragraph[key] ?? paragraph.text)
  return normalize(text)
}

function estimateBodySize(paragraphs) {
  const weights = new Map()
  for (const paragraph of paragraphs) {
    const height = Math.round(paragraph.height * 2) / 2
    if (!Number.isFinite(height) || height <= 0) continue
    weights.set(height, (weights.get(height) ?? 0) + Math.max(1, paragraph.text.length))
  }
  let best = 10
  let score = -1
  for (const [height, weight] of weights) {
    if (weight > score) {
      best = height
      score = weight
    }
  }
  return best
}

function headingLabel(text) {
  const value = normalize(text)
  const split = (heading) => ({
    heading,
    content: value
      .slice(heading.length)
      .replace(/^\s*[:：—–-]\s*/, '')
      .trim(),
  })
  let match = value.match(ABSTRACT_HEADING)
  if (match !== null) return split(match[0])
  match = value.match(CHINESE_ABSTRACT_HEADING)
  if (match !== null) return split(match[0])
  return null
}

function keywordLabel(text) {
  const value = normalize(text)
  const match = value.match(KEYWORDS_HEADING)
  if (match === null) return null
  const rest = value.slice(match[0].length)
  return {
    heading: match[0],
    content: rest.replace(/^\s*[:：—–-]\s*/, '').trim(),
  }
}

function isAbstractHeading(paragraph) {
  if (paragraph === undefined) return false
  return headingLabel(paragraph.text) !== null
}

function isFootnote(paragraph) {
  return /^\s*[∗*†‡§¶#]/.test(paragraph.text ?? '')
}

function looksLikeSectionHeading(text) {
  const value = normalize(text)
  if (/^\d+(?:\.\d+)*[\s.)、]+\S/.test(value)) return true
  return SECTION_NAMES.test(value.replace(/^\d+(?:\.\d+)*[\s.)、]+/, '').replace(/[.:：]$/, ''))
}

function isHeadingParagraph(paragraph, bodySize) {
  const text = normalize(paragraph.text)
  if (text === '' || text.length > 150) return false
  if ((paragraph.lines?.length ?? 1) > 3) return false
  if (headingLabel(text) !== null || keywordLabel(text) !== null) return true
  if (/^\d+(?:\.\d+)*[\s.)、]+\S/.test(text)) return true
  if (SECTION_NAMES.test(text.replace(/^\d+(?:\.\d+)*[\s.)、]+/, '').replace(/[.:：]$/, ''))) {
    return true
  }
  return paragraph.height >= bodySize * 1.16 && /^[\p{Lu}\u4e00-\u9fff]/u.test(text)
}

function looksLikeAffiliation(text) {
  return ORG.test(text)
}

// Name particles such as "van", "de", "von" or "bin" are written in lower case
// in the middle of a name, so they cannot be required to start with a capital.
const NAME_PARTICLES = new Set([
  'al',
  'bin',
  'da',
  'de',
  'del',
  'della',
  'den',
  'der',
  'di',
  'du',
  'el',
  'la',
  'le',
  'ten',
  'ter',
  'van',
  'von',
])
const NAME_SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'])

function looksLikeName(text) {
  const value = normalize(text)
  if (value === '' || value.length > 90) return false
  if (EMAIL.test(value) || looksLikeAffiliation(value)) return false
  if (/[0-9@]/.test(value)) return false
  const words = value.split(' ')
  if (words.length === 0 || words.length > 6) return false
  if (!/^[\p{Lu}\u4e00-\u9fff]/u.test(words[0])) return false
  return words.every((word, index) => {
    const bare = word.replace(/,$/, '')
    return (
      /^[\p{Lu}\u4e00-\u9fff][\p{L}.'’\-]*$/u.test(bare) ||
      (index > 0 &&
        (NAME_PARTICLES.has(bare.toLowerCase()) ||
          NAME_SUFFIXES.has(bare.toLowerCase())))
    )
  })
}

function parseName(text) {
  let value = normalize(text)
  let marks = ''
  const markMatch = value.match(/^(.*?)\s*([∗*†‡§¶#]+)$/)
  if (markMatch !== null && markMatch[1].trim() !== '') {
    value = markMatch[1]
    marks = markMatch[2]
  }
  return { name: normalize(value), marks }
}

function splitRow(row, bodySize) {
  const lines = [...row.lines].sort((left, right) => left.x - right.x)
  const segments = []
  for (const line of lines) {
    const previous = segments[segments.length - 1]
    const gap = previous === undefined ? Infinity : line.x - previous.right
    if (previous !== undefined && gap <= Math.max(6, bodySize * 0.9)) {
      previous.parts.push(line.text)
      previous.right = Math.max(previous.right, line.x + line.width)
      previous.height = Math.max(previous.height, line.height)
    } else {
      segments.push({
        parts: [line.text],
        x: line.x,
        right: line.x + line.width,
        top: line.top,
        height: line.height,
      })
    }
  }
  return segments.map((segment) => {
    const text = normalize(segment.parts.join(' '))
    const parts = segment.parts.map(normalize)
    const marks = []
    const names = []
    for (const part of parts) {
      if (MARKS_ONLY.test(part)) {
        marks.push(part.replace(/[\d,]/g, '').trim())
      } else {
        names.push(part)
      }
    }
    const parsed = parseName(names.join(' '))
    if (parsed.marks !== '') marks.push(parsed.marks)
    return {
      ...segment,
      text,
      name: parsed.name,
      marks: marks.filter((mark) => mark !== '').join(' '),
    }
  })
}

function collectLines(paragraphs, scale) {
  const lines = []
  for (const paragraph of paragraphs) {
    for (const line of paragraph.lines ?? []) {
      const text = normalize(line.text)
      if (text === '') continue
      lines.push({
        text,
        x: line.x / scale,
        top: line.top / scale,
        width: line.width / scale,
        height: line.height / scale,
        paragraphId: paragraph.id,
      })
    }
  }
  return lines
}

function groupRows(lines, bodySize) {
  const sorted = [...lines].sort((left, right) => left.top - right.top || left.x - right.x)
  const rows = []
  const tolerance = Math.max(2.5, bodySize * 0.5)
  for (const line of sorted) {
    const row = rows.find((entry) => Math.abs(entry.top - line.top) <= tolerance)
    if (row === undefined) {
      rows.push({ top: line.top, lines: [line] })
    } else {
      row.lines.push(line)
      row.top = Math.min(row.top, line.top)
    }
  }
  return rows
}

/**
 * Turn the byline region into author entries.
 *
 * The common layout is a grid: one name row, then affiliation and email rows.
 * Rows are split on horizontal gaps, so a four-author row stays four authors
 * instead of becoming one run-on line.
 */
export function detectAuthors(paragraphs, bodySize, scale = 1) {
  const rows = groupRows(collectLines(paragraphs, scale), bodySize)
  const nameRows = []
  const metaRows = []
  let previousTop = null
  for (const row of rows) {
    const segments = splitRow(row, bodySize)
    const names = segments.filter((segment) => looksLikeName(segment.name))
    // An affiliation such as "Bletchley Park" can look like a person's name.
    // The row directly under a name row is therefore treated as metadata even
    // when its words are capitalised; a larger vertical step starts the next
    // author row.
    const startsAuthorRow =
      names.length > 0 &&
      (previousTop === null || row.top - previousTop > bodySize * 1.55)
    if (startsAuthorRow) {
      nameRows.push({
        top: row.top,
        total: names.length,
        // A few PDFs leave two names in one text item. Count them as expected
        // authors so a skipped second name makes the byline incomplete.
        expected: names.reduce(
          (sum, segment) => sum + splitColumnarNames(segment.name).length,
          0,
        ),
        unparsed: Math.max(0, segments.length - names.length),
        authors: names.map((segment) => ({
          name: segment.name,
          marks: segment.marks,
          affiliation: '',
          email: '',
          affiliationId: null,
          center: segment.x + (segment.right - segment.x) / 2,
        })),
      })
    } else {
      // Unrecognised pieces answer to the row directly above them, when there
      // is one. A piece with no row above is a failed name, not metadata.
      metaRows.push({ top: row.top, segments, previousTop })
    }
    previousTop = row.top
  }
  if (nameRows.length === 0) return { authors: [], complete: false }

  // A name-row author counts as understood once an affiliation or e-mail row
  // was attached underneath it.
  const assigned = new Set()
  for (const row of metaRows) {
    // A meta row belongs to the closest name row above it. Falling back to the
    // closest row by distance keeps single-column layouts working too.
    let owner = null
    let distance = Infinity
    for (const candidate of nameRows) {
      const delta = row.top - candidate.top
      if (delta < -bodySize * 0.5) continue
      const score = Math.abs(delta)
      if (score < distance && delta <= bodySize * 4.2) {
        owner = candidate
        distance = score
      }
    }
    if (owner === null) continue
    for (const segment of row.segments) {
      const text = normalize(segment.text)
      if (text === '' || MARKS_ONLY.test(text)) continue
      const target = nearestAuthor(owner.authors, segment)
      if (target === null) continue
      const email = text.split(' ').find((part) => EMAIL.test(part.replace(/[,;]$/, '')))
      if (email !== undefined) {
        if (target.email === '') target.email = email.replace(/[,;]$/, '')
        target.assigned = true
        continue
      }
      if (target.affiliation === '') target.affiliation = text
      // A piece that answers to no row above failed to parse; it must not count
      // as an author whose details were read.
      if (row.previousTop !== null) target.assigned = true
    }
  }
  const authors = nameRows.flatMap((row) => row.authors)
  // A segment that holds two authors on one row ("Ada Lovelace  Jane Smith,
  // Jr.") must not pass as complete just because the second name was never
  // considered. The same applies to a name-like segment that failed to parse.
  const missingNames = nameRows.reduce(
    (sum, row) => sum + Math.max(0, row.expected - row.authors.length),
    0,
  )
  const unparsedSegments = nameRows.reduce((sum, row) => sum + row.unparsed, 0)
  const assignedCount = authors.filter((author) => author.assigned).length
  const unassignedCount = authors.length - assignedCount
  return {
    authors,
    // A byline that could only be read in part is unsafe to replace: the
    // unparsed name would disappear from the reading column and the exports.
    complete:
      unparsedSegments === 0 &&
      unassignedCount + missingNames <= (authors.length > 0 ? 1 : 0),
  }
}

/** Split a segment holding several names ("Ada Lovelace  Jane Smith, Jr."). */
function splitColumnarNames(text) {
  // Preserve the original gap before `normalize` collapses whitespace: a
  // two-space gap is the visual separator between two names in one PDF item.
  const raw = String(text ?? '').trim()
  const parts = raw.split(/\s{2,}/).filter(Boolean)
  if (parts.length > 1 && parts.every((part) => part.split(/\s+/).length <= 6)) {
    return parts.map(normalize)
  }
  const value = normalize(raw)
  if (looksLikeName(value)) return [value]
  return splitNameRun(value)
}

/** Split "Ada Lovelace Ludwig van Beethoven" into individual display names. */
function splitNameRun(text) {
  const words = normalize(text).split(' ')
  if (words.length <= 2) return [normalize(text)]
  const starts = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const particle = NAME_PARTICLES.has(word.toLowerCase()) || /^(?:[A-Z]\.?)$/.test(word)
    if (!particle) starts.push(index)
  }
  if (starts.length < 2) return [normalize(text)]
  const names = []
  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index]
    const finish = starts[index + 1] ?? words.length
    names.push(words.slice(begin, finish).join(' '))
  }
  const prefix = words.slice(0, starts[0]).join(' ')
  if (prefix !== '') names[0] = `${prefix} ${names[0]}`
  return names.filter((name) => name !== '')
}

/** Collect the names on a byline that the structured parser could not read. */
function collectNameRuns(paragraphs, scale) {
  const runs = []
  for (const line of collectLines(paragraphs, scale)) {
    const withoutMarks = line.text.replace(/\s*[∗*†‡§¶#]+\s*/g, ' ').trim()
    if (withoutMarks === '' || MARKS_ONLY.test(line.text) || EMAIL.test(withoutMarks)) continue
    if (looksLikeAffiliation(withoutMarks)) continue
    runs.push({ ...line, nameText: withoutMarks })
  }
  return runs
}

export function parseAuthors(paragraphs, bodySize, scale = 1, pageHeight = 792) {
  // Authors live under the title. A byline region that starts far down the page
  // is body text that happens to look name-like (a figure label, a row of
  // quoted words), so leave it to the paragraph flow.
  // Paragraph line coordinates are stored in PDF points, not in the zoomed
  // viewport space, so they must be brought back to scale 1 before they are
  // compared with `pageHeight` or the unscaled `bodySize`.
  const lines = collectLines(paragraphs, scale)
  if (lines.length === 0) return []
  const firstLine = lines.reduce((top, line) => Math.min(top, line.top), Infinity)
  if (!(firstLine < pageHeight * 0.6)) return []
  // The byline must be built from small visual fragments: name segments,
  // affiliation or e-mail rows. A region whose rows carry long prose lines or
  // very large display text is not a list of people.
  if (lines.some((line) => normalize(line.text).length > 90 || line.height > bodySize * 2)) {
    return []
  }
  const detected = detectAuthors(paragraphs, bodySize, scale)
  if (detected.complete) return detected.authors
  // Some rows may parse while others fail. Keep the parsed authors whose names
  // were found in the residual runs and append every remaining run as an
  // author, so no name is silently dropped.
  const known = detected.authors.filter((author) => author.name !== '')
  const runs = collectNameRuns(paragraphs, scale)
  const used = new Set()
  for (const run of runs) {
    if (known.some((author) => run.nameText.includes(author.name))) used.add(run)
  }
  const residual = runs.filter((run) => !used.has(run))
  const authors = [...known]
  for (const run of residual) {
    // "Jane Smith, Jr." is one author; "Ada Lovelace  Jane Smith, Jr." holds
    // two names separated by the wider visual gap.
    const pieces = looksLikeName(run.nameText)
      ? [run.nameText]
      : splitColumnarNames(run.nameText)
    if (pieces.length === 0) continue
    if (pieces.length === 1 && !looksLikeName(pieces[0])) {
      if (authors.length === 1 && authors[0].affiliation === '') {
        authors[0].affiliation = run.nameText
      }
      continue
    }
    for (const piece of pieces) {
      if (!looksLikeName(piece)) continue
      if (authors.some((author) => author.name === piece)) continue
      const parsed = parseName(piece)
      authors.push({
        name: parsed.name,
        marks: parsed.marks,
        affiliation: '',
        email: '',
        affiliationId: null,
        center: run.x + run.width / 2,
      })
    }
  }
  return authors
}

function nearestAuthor(authors, segment) {
  let best = null
  let bestScore = -Infinity
  const center = segment.x + (segment.right - segment.x) / 2
  for (const author of authors) {
    // Each author keeps the centre of its name segment, which is also the best
    // anchor for the affiliation and e-mail rows underneath.
    const score = -Math.abs(center - (author.center ?? center))
    if (score > bestScore) {
      best = author
      bestScore = score
    }
  }
  return best
}

function findTitle(paragraphs, bodySize, pageWidth, pageHeight) {
  let start = -1
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    const text = normalize(paragraph.text)
    if (text === '') continue
    if (paragraph.top > pageHeight * 0.48) break
    if (paragraph.height < bodySize * 1.16) continue
    if (HEADER_NOTE.test(text)) continue
    if (headingLabel(text) !== null || keywordLabel(text) !== null) continue
    if (looksLikeSectionHeading(text)) continue
    if (text.length < 4) continue
    // A short final line of a license/header note can look like a large-font
    // title. If the paragraph before it is unfinished, this is a continuation,
    // not the paper title.
    const previous = paragraphs[index - 1]
    if (
      previous !== undefined &&
      previous.text.length > 60 &&
      !/[.!?。！？:：;；)\]"”’]$/.test(normalize(previous.text)) &&
      paragraph.top - previous.bottom < bodySize * 2.2
    ) {
      continue
    }
    const centered = Math.abs((paragraph.x + paragraph.right) / 2 - pageWidth / 2) < pageWidth * 0.22
    if (!centered && paragraph.height < bodySize * 1.24) continue
    start = index
    break
  }
  if (start < 0) {
    // Some journals set the title in the body face. The byline underneath is
    // the reliable signal: e-mail addresses and affiliations appear within the
    // first few paragraphs.
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index]
      const text = normalize(paragraph.text)
      if (paragraph.top > pageHeight * 0.35) break
      if (text.length < 4 || text.length > 220) continue
      if (HEADER_NOTE.test(text) || looksLikeSectionHeading(text)) continue
      if (looksLikeAffiliation(text) || /@/.test(text)) continue
      const lookahead = paragraphs.slice(index + 1, index + 5)
      if (
        lookahead.some(
          (candidate) => /@/.test(candidate.text) || looksLikeAffiliation(candidate.text),
        )
      ) {
        start = index
        break
      }
    }
  }
  if (start < 0) return null

  let end = start + 1
  for (; end < paragraphs.length; end += 1) {
    const previous = paragraphs[end - 1]
    const next = paragraphs[end]
    const gap = next.top - previous.bottom
    if (gap > bodySize * 2.4) break
    if (next.height < bodySize * 0.95) break
    // A title set at body size can still be split across lines; a byline in
    // the same size sits farther down and must not be swallowed.
    if (next.height < bodySize * 1.06 && gap > bodySize * 1.5) break
    if (next.text.length > 220) break
    // A byline line is body-size, starts like a name, and is followed by
    // affiliations or e-mail addresses. A subtitle is usually larger than the
    // body and must still merge into the title.
    const titleHeight = Math.max(
      ...paragraphs.slice(start, end).map((entry) => entry.height),
    )
    const bylineAhead = paragraphs
      .slice(end, end + 3)
      .some((entry) => /@/.test(entry.text) || looksLikeAffiliation(entry.text))
    if (
      next.height <= bodySize * 1.06 &&
      next.height <= titleHeight * 0.7 &&
      looksLikeName(next.text) &&
      bylineAhead
    ) {
      break
    }
    if (headingLabel(next.text) !== null || keywordLabel(next.text) !== null) break
    if (HEADER_NOTE.test(next.text)) break
    if (looksLikeAffiliation(next.text) || /@/.test(next.text)) break
  }
  const selected = paragraphs.slice(start, end)
  return {
    paragraphs: selected,
    text: joinParagraphs(selected, 'text'),
    translateText: joinParagraphs(selected, 'translateText'),
    placeholders: mergePlaceholders(selected),
  }
}

function findAbstract(paragraphs, pageHeight) {
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    if (paragraph.top > pageHeight * 0.82) break
    const label = headingLabel(paragraph.text)
    if (label === null) continue
    // When "Abstract:" and the first sentence share a paragraph, that sentence
    // can contain inline formula placeholders. Use its translatable form, not
    // the readable source, so the placeholders survive into the request.
    const translatable = headingLabel(paragraph.translateText ?? paragraph.text)
    return {
      index,
      heading: label.heading,
      inline: label.content,
      inlineTranslate: translatable?.content ?? label.content,
    }
  }
  return null
}

function sectionStop(paragraph, bodySize) {
  if (paragraph === undefined) return true
  if (keywordLabel(paragraph.text) !== null) return true
  if (isFootnote(paragraph)) return true
  if (paragraph.height < bodySize * 0.86) return true
  // Section titles do not have to be set larger than body text. A numbered
  // "1 Introduction" at body size is still a hard stop for the abstract.
  if (looksLikeSectionHeading(paragraph.text)) return true
  return isHeadingParagraph(paragraph, bodySize) && paragraph.height >= bodySize * 1.06
}

function findAbstractBody(paragraphs, abstract, bodySize) {
  const body = []
  if (abstract.inline !== '') body.push({ inline: abstract.inline })
  let previous = paragraphs[abstract.index]
  for (let index = abstract.index + 1; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    if (sectionStop(paragraph, bodySize)) break
    const gap = paragraph.top - (previous?.bottom ?? paragraph.top)
    if (body.length > 0 && gap > bodySize * 2.05) break
    body.push({ paragraph })
    previous = paragraph
  }
  return body
}

function findKeywords(paragraphs, startIndex, bodySize) {
  for (let index = Math.max(0, startIndex); index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    const label = keywordLabel(paragraph.text)
    if (label === null) continue
    // Keywords can contain inline formulas. Translate the placeholder form so
    // the server can validate that the model kept every ⟦MATH_n⟧ token.
    const translatableLabel = keywordLabel(paragraph.translateText ?? paragraph.text)
    const content = [label.content]
    const translateContent = [translatableLabel?.content ?? label.content]
    let previous = paragraph
    for (let next = index + 1; next < paragraphs.length && next <= index + 3; next += 1) {
      const candidate = paragraphs[next]
      if (sectionStop(candidate, bodySize)) break
      if (candidate.top - previous.bottom > bodySize * 1.9) break
      content.push(candidate.text)
      translateContent.push(candidate.translateText ?? candidate.text)
      previous = candidate
    }
    const endIndex =
      previous === paragraph ? index + 1 : paragraphs.indexOf(previous) + 1
    return {
      heading: label.heading,
      text: normalize(content.filter((text) => text !== '').join(' ')),
      translateText: normalize(translateContent.filter((text) => text !== '').join(' ')),
      paragraphs: paragraphs.slice(index, endIndex),
    }
  }
  return null
}

function bylineEnd(paragraphs, title, abstract, bodySize) {
  if (abstract !== null) return abstract.index
  for (let index = title.end; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    if (paragraph.height <= bodySize * 1.08 && paragraph.text.length > 180) return index
    if (isHeadingParagraph(paragraph, bodySize) && paragraph.height >= bodySize * 1.1) return index
  }
  return paragraphs.length
}

function blockId(pageKey, name) {
  return `${pageKey}-${name}`
}

/**
 * Compose a page model into reading blocks plus the translation units those
 * blocks need. Units are paragraph-shaped so the existing translation
 * pipeline (batching, placeholders, caching, retry) works unchanged.
 */
export function composeReading(model) {
  const paragraphs = Array.isArray(model?.paragraphs) ? model.paragraphs : []
  const bodySize = model?.bodySize ?? estimateBodySize(paragraphs)
  const scale = Number.isFinite(model?.viewport?.scale) && model.viewport.scale > 0
    ? model.viewport.scale
    : 1
  // Paragraph coordinates are stored in unscaled PDF points, while the
  // viewport (and therefore `pageWidth`/`pageHeight`) is scaled for display.
  const pageWidth = (model?.viewport?.width ?? 612) / scale
  const pageHeight = (model?.viewport?.height ?? 792) / scale
  const pageIndex = Number.isInteger(model?.pageIndex) ? model.pageIndex : 0
  const pageKey = `page${pageIndex + 1}`
  const composed = []
  const consumed = new Set()
  // Licence blocks and arXiv stamps sit above the title in the PDF but are not
  // part of the article. Keep them out of the reading column and save the
  // translation budget for actual content.
  const suppressed = new Set()
  if (pageIndex === 0) {
    for (const paragraph of paragraphs) {
      if (HEADER_NOTE.test(normalize(paragraph.text))) suppressed.add(paragraph.id)
    }
  }

  if (pageIndex === 0 && paragraphs.length > 0) {
    const title = findTitle(paragraphs, bodySize, pageWidth, pageHeight)
    const abstract = findAbstract(paragraphs, pageHeight)
    if (title !== null) {
      title.end = paragraphs.indexOf(title.paragraphs[title.paragraphs.length - 1]) + 1
      const titleBlock = {
        id: blockId(pageKey, 'title'),
        type: 'title',
        role: 'title',
        text: title.text,
        translateText: title.translateText,
        placeholders: title.placeholders,
        translationId: blockId(pageKey, 'title'),
        paragraphIds: title.paragraphs.map((paragraph) => paragraph.id),
        paragraphId: title.paragraphs[0].id,
        bbox: unionBox(title.paragraphs),
        order: Math.min(...title.paragraphs.map((paragraph) => paragraph.order ?? 0)),
      }
      composed.push(titleBlock)
      for (const paragraph of title.paragraphs) consumed.add(paragraph.id)

      const end = bylineEnd(paragraphs, title, abstract, bodySize)
      const bylineParagraphs = paragraphs.slice(title.end, end)
      // The parser also recovers names it could not read structurally, so a
      // partly understood byline never loses an author.
      const authors = parseAuthors(bylineParagraphs, bodySize, scale, pageHeight)
      if (authors.length > 0) {
        const affiliations = []
        const byText = new Map()
        for (const author of authors) {
          const text = normalize(author.affiliation)
          if (text === '') continue
          let id = byText.get(text.toLowerCase())
          if (id === undefined) {
            id = blockId(pageKey, `affiliation${affiliations.length + 1}`)
            byText.set(text.toLowerCase(), id)
            affiliations.push({ id, text })
          }
          author.affiliationId = id
        }
        const authorsBlock = {
          id: blockId(pageKey, 'authors'),
          type: 'authors',
          role: 'authors',
          authors,
          affiliations,
          text: authors
            .map((author) => [author.name, author.affiliation, author.email].filter(Boolean).join(' '))
            .join(' · '),
          paragraphIds: bylineParagraphs.map((paragraph) => paragraph.id),
          paragraphId: bylineParagraphs[0]?.id,
          bbox: unionBox(bylineParagraphs),
          order: Math.min(...bylineParagraphs.map((paragraph) => paragraph.order ?? 0)),
        }
        composed.push(authorsBlock)
        for (const paragraph of bylineParagraphs) consumed.add(paragraph.id)
      }

      if (abstract !== null) {
        const body = findAbstractBody(paragraphs, abstract, bodySize)
        const bodyParagraphs = body.map((entry) => entry.paragraph).filter(Boolean)
        const text = normalize(
          [abstract.inline, ...bodyParagraphs.map((paragraph) => paragraph.text)].join(' '),
        )
        const translateText = normalize(
          [
            abstract.inlineTranslate,
            ...bodyParagraphs.map((paragraph) => paragraph.translateText ?? paragraph.text),
          ]
            .filter(Boolean)
            .join(' '),
        )
        if (text !== '') {
          const abstractParagraphs = [paragraphs[abstract.index], ...bodyParagraphs]
          const placeholders = mergePlaceholders(abstractParagraphs)
          const parts = groupAbstract(text, translateText)
          for (let index = 0; index < parts.length; index += 1) {
            const part = parts[index]
            const id = `${blockId(pageKey, 'abstract')}${index + 1}`
            composed.push({
              id,
              type: 'abstract',
              role: 'abstract',
              heading: abstract.heading,
              showLabel: index === 0,
              partIndex: index,
              text: part.text,
              translateText: part.translateText,
              placeholders,
              translationId: id,
              paragraphIds: abstractParagraphs.map((paragraph) => paragraph.id),
              paragraphId: paragraphs[abstract.index].id,
              bbox: unionBox(abstractParagraphs),
              order: Math.min(...abstractParagraphs.map((paragraph) => paragraph.order ?? 0)),
            })
          }
          for (const paragraph of abstractParagraphs) consumed.add(paragraph.id)
        }

        const keywordStart = abstract.index + 1 + bodyParagraphs.length
        const keywords = findKeywords(paragraphs, keywordStart, bodySize)
        if (keywords !== null && keywords.text !== '') {
          composed.push({
            id: blockId(pageKey, 'keywords'),
            type: 'keywords',
            role: 'keywords',
            heading: keywords.heading,
            text: keywords.text,
            translateText: keywords.translateText,
            placeholders: mergePlaceholders(keywords.paragraphs),
            translationId: blockId(pageKey, 'keywords'),
            paragraphIds: keywords.paragraphs.map((paragraph) => paragraph.id),
            paragraphId: keywords.paragraphs[0].id,
            bbox: unionBox(keywords.paragraphs),
            order: Math.min(...keywords.paragraphs.map((paragraph) => paragraph.order ?? 0)),
          })
          for (const paragraph of keywords.paragraphs) consumed.add(paragraph.id)
        }
      }
    }
  }

  const frontBlocks = [...composed].sort((left, right) => left.order - right.order)
  const blocks = []
  let inserted = false
  for (const block of model?.blocks ?? []) {
    if (block.type === 'paragraph' && suppressed.has(block.paragraphId)) continue
    if (block.type === 'paragraph' && consumed.has(block.paragraphId)) {
      if (!inserted) {
        blocks.push(...frontBlocks)
        inserted = true
      }
      continue
    }
    if (block.type === 'paragraph' && block.paragraph !== undefined) {
      const role = isHeadingParagraph(block.paragraph, bodySize) ? 'heading' : 'paragraph'
      blocks.push({
        ...block,
        role,
        translationId: block.paragraph.id,
      })
    } else {
      blocks.push(block)
    }
  }
  if (!inserted && frontBlocks.length > 0) blocks.push(...frontBlocks)

  const units = []
  for (const block of blocks) {
    if (block.type === 'authors') {
      for (const affiliation of block.affiliations ?? []) {
        units.push({
          id: affiliation.id,
          text: affiliation.text,
          translateText: affiliation.text,
          placeholders: [],
          block,
          kind: 'affiliation',
        })
      }
      continue
    }
    if (block.translationId !== undefined && block.type !== 'authors') {
      if (block.type === 'paragraph' || block.type === 'heading') {
        const paragraph = block.paragraph
        units.push({
          id: block.translationId,
          text: paragraph.text,
          translateText: paragraph.translateText || paragraph.text,
          placeholders: paragraph.placeholders ?? [],
          block,
          kind: 'paragraph',
        })
      } else {
        units.push({
          id: block.translationId,
          text: block.text,
          translateText: block.translateText ?? block.text,
          placeholders: block.placeholders ?? [],
          block,
          kind: block.type,
        })
      }
    }
  }

  return { blocks, units, bodySize, frontMatter: composed }
}

export { groupAbstract, isHeadingParagraph, joinText, looksLikeName, splitSentences }
