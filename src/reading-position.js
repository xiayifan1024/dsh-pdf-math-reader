/**
 * Per-document reading positions.
 *
 * Opening the same PDF again should return to the page it was left on. The
 * fingerprint is the one the reader uses for notes, so renaming or replacing a
 * file starts a fresh position instead of jumping into an unrelated page.
 */

export const READING_POSITION_KEY = 'pdf-math-reader.positions.v1'
export const READING_POSITION_LIMIT = 120

function defaultStorage() {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** Keep only well-formed entries, newest first, under the document limit. */
export function sanitizeReadingPositions(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = []
  for (const [fingerprint, entry] of Object.entries(value)) {
    if (fingerprint === '' || entry === null || typeof entry !== 'object') continue
    const pageIndex = Number(entry.pageIndex)
    if (!Number.isInteger(pageIndex) || pageIndex < 0) continue
    const updatedAt = Number(entry.updatedAt)
    entries.push([
      fingerprint,
      { pageIndex, updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? updatedAt : 0 },
    ])
  }
  entries.sort((left, right) => right[1].updatedAt - left[1].updatedAt)
  return Object.fromEntries(entries.slice(0, READING_POSITION_LIMIT))
}

export function loadReadingPositions(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(READING_POSITION_KEY)
    if (raw === null || raw === undefined) return {}
    return sanitizeReadingPositions(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function saveReadingPositions(positions, storage = defaultStorage()) {
  try {
    storage?.setItem(READING_POSITION_KEY, JSON.stringify(positions))
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
}

// Serialize shared-map mutations across tabs where the Web Locks API is available.
async function changePositions(change) {
  try {
    const locks = typeof window === 'undefined' ? undefined : window.navigator?.locks
    if (locks) return await locks.request(READING_POSITION_KEY, change)
  } catch {
    // Some embedded readers cannot acquire an origin lock.
  }
  return change()
}

export function updateReadingPosition(fingerprint, pageIndex, storage = defaultStorage()) {
  return changePositions(() => {
    const positions = loadReadingPositions(storage)
    const next = rememberReadingPosition(positions, fingerprint, pageIndex)
    if (next !== positions) saveReadingPositions(next, storage)
  })
}

/** Forget every remembered position. Returns whether storage really removed it. */
export function clearReadingPositions(storage = defaultStorage()) {
  return changePositions(() => {
    if (storage === undefined || storage === null) return false
    try {
      storage.removeItem(READING_POSITION_KEY)
      return true
    } catch {
      // Local storage can be unavailable or write-protected.
      return false
    }
  })
}

/**
 * The page to restore for one document, or null when there is nothing usable.
 *
 * A position past the end of a shortened file is ignored rather than clamped:
 * opening at page 0 is safer than landing on a page that no longer exists.
 */
export function readingPositionFor(positions, fingerprint, pageCount) {
  if (typeof fingerprint !== 'string' || fingerprint === '') return null
  if (!Number.isInteger(pageCount) || pageCount <= 0) return null
  const entry = positions?.[fingerprint]
  if (entry === null || entry === undefined || !Number.isInteger(entry.pageIndex)) return null
  if (entry.pageIndex < 0 || entry.pageIndex >= pageCount) return null
  return entry.pageIndex
}

/**
 * Record the page currently being read.
 *
 * The same object is returned when the page did not change, so callers can skip
 * a redundant write. Old documents are evicted by `updatedAt` once the limit is
 * reached.
 */
export function rememberReadingPosition(positions, fingerprint, pageIndex, now = Date.now()) {
  if (typeof fingerprint !== 'string' || fingerprint === '') return positions ?? {}
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return positions ?? {}
  const current = positions?.[fingerprint]
  if (current !== undefined && current.pageIndex === pageIndex) return positions
  const next = {
    ...(positions ?? {}),
    [fingerprint]: { pageIndex, updatedAt: now },
  }
  const entries = Object.entries(next)
  if (entries.length <= READING_POSITION_LIMIT) return next
  entries.sort((left, right) => (right[1]?.updatedAt ?? 0) - (left[1]?.updatedAt ?? 0))
  return Object.fromEntries(entries.slice(0, READING_POSITION_LIMIT))
}

/** Drop one document's position without touching the others. */
export function forgetReadingPosition(positions, fingerprint) {
  if (positions === null || typeof positions !== 'object') return {}
  if (!Object.hasOwn(positions, fingerprint)) return positions
  const next = { ...positions }
  delete next[fingerprint]
  return next
}
