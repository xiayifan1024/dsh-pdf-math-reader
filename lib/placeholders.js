/**
 * Placeholder tokens isolate inline math from translation.
 *
 * The server validates every returned segment against the tokens found in the
 * source. A missing, duplicated, or unknown marker is a translation failure,
 * never a silently accepted paragraph.
 */

export const PLACEHOLDER_TOKEN_RE = /⟦MATH_\d{1,4}⟧/
export const PLACEHOLDER_TOKEN_RE_GLOBAL = /⟦MATH_\d{1,4}⟧/g
export const PLACEHOLDER_ANY_RE = /⟦[^⟧]{0,40}⟧/g

export function mathToken(index) {
  return `⟦MATH_${String(index).padStart(3, '0')}⟧`
}

/** Unique tokens in first-appearance order. */
export function listPlaceholders(text) {
  const value = String(text ?? '')
  const found = []
  const seen = new Set()
  PLACEHOLDER_TOKEN_RE_GLOBAL.lastIndex = 0
  for (const match of value.matchAll(PLACEHOLDER_TOKEN_RE_GLOBAL)) {
    if (seen.has(match[0])) continue
    seen.add(match[0])
    found.push(match[0])
  }
  return found
}

export function placeholderCounts(text) {
  const counts = new Map()
  const value = String(text ?? '')
  PLACEHOLDER_TOKEN_RE_GLOBAL.lastIndex = 0
  for (const match of value.matchAll(PLACEHOLDER_TOKEN_RE_GLOBAL)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
  }
  return counts
}

export function restorePlaceholders(text, placeholders) {
  let value = String(text ?? '')
  for (const entry of Array.isArray(placeholders) ? placeholders : []) {
    if (entry === null || typeof entry !== 'object') continue
    if (typeof entry.token !== 'string' || typeof entry.text !== 'string') continue
    value = value.split(entry.token).join(entry.text)
  }
  return value
}

/**
 * Validate one translated segment. `sourceText` is what was sent to the model;
 * `translatedText` is what came back.
 */
export function validatePlaceholders(sourceText, translatedText) {
  const source = String(sourceText ?? '')
  const translated = String(translatedText ?? '')
  const expected = listPlaceholders(source)
  const counts = placeholderCounts(translated)
  const found = [...counts.keys()]

  const unknownMarkers = []
  PLACEHOLDER_ANY_RE.lastIndex = 0
  for (const match of translated.matchAll(PLACEHOLDER_ANY_RE)) {
    if (!expected.includes(match[0])) unknownMarkers.push(match[0])
  }

  const missing = expected.filter((token) => !counts.has(token))
  const duplicated = expected.filter((token) => (counts.get(token) ?? 0) > 1)
  const unknown = [
    ...new Set([
      ...found.filter((token) => !expected.includes(token)),
      ...unknownMarkers,
    ]),
  ]

  // An invented or renumbered marker is the strongest signal that the model
  // edited a formula token, so report it before a coincidental missing token.
  if (unknown.length > 0) {
    return { ok: false, reason: 'unknown', missing, duplicated, unknown }
  }
  if (duplicated.length > 0) {
    return { ok: false, reason: 'duplicated', missing, duplicated, unknown }
  }
  if (missing.length > 0) {
    return { ok: false, reason: 'missing', missing, duplicated, unknown }
  }
  return { ok: true, missing: [], duplicated: [], unknown: [] }
}
