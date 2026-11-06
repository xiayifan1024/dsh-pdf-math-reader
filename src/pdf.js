/**
 * PDF.js runtime, text extraction and reading-order heuristics.
 *
 * PDF.js is loaded as an ES module from this plugin's own Host route, so it
 * never installs a global that could collide with the document-preview plugin.
 */

const ASSET_BASE = '/pdf-reader/assets'
let libraryPromise

export function loadPdfJs() {
  if (libraryPromise !== undefined) return libraryPromise
  libraryPromise = (async () => {
    // pdf.mjs still assigns a compatibility global. Save and restore whatever
    // the document-preview plugin installed so two PDF.js majors can coexist.
    const previous = globalThis.pdfjsLib
    let module
    try {
      module = await import(`${ASSET_BASE}/pdf.min.mjs`)
    } finally {
      if (previous === undefined) {
        try {
          delete globalThis.pdfjsLib
        } catch {
          globalThis.pdfjsLib = undefined
        }
      } else {
        globalThis.pdfjsLib = previous
      }
    }
    const library = module.default?.getDocument !== undefined ? module.default : module
    if (typeof library.getDocument !== 'function') {
      throw new Error('PDF.js did not expose getDocument')
    }
    library.GlobalWorkerOptions.workerSrc = `${ASSET_BASE}/pdf.worker.min.mjs`
    return library
  })().catch((error) => {
    libraryPromise = undefined
    throw error
  })
  return libraryPromise
}

export function isPdfFile(file) {
  if (file === null || file === undefined) return false
  if (typeof file.name === 'string' && /\.pdf$/i.test(file.name)) return true
  return file.type === 'application/pdf'
}

export function fileFingerprint(file) {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`
}

/**
 * Open a local PDF. The password callback keeps `getDocument` alive until the
 * user supplies a password or cancels.
 */
export async function openPdf(file, passwordPrompt) {
  const library = await loadPdfJs()
  const data = new Uint8Array(await file.arrayBuffer())
  const loadingTask = library.getDocument({
    data,
    cMapUrl: `${ASSET_BASE}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}/standard_fonts/`,
    isEvalSupported: false,
  })
  loadingTask.onPassword = (updatePassword, reason) => {
    const promptText =
      reason === library.PasswordResponses.INCORRECT_PASSWORD
        ? `${passwordPrompt} (incorrect password, try again)`
        : passwordPrompt
    const password = window.prompt(promptText)
    if (password === null) {
      loadingTask.destroy()
      return
    }
    updatePassword(password)
  }
  return await loadingTask.promise
}

const renderQueues = new WeakMap()

const thumbnailQueue = []
let thumbnailActive = 0

function pumpThumbnailQueue() {
  while (thumbnailActive < 3 && thumbnailQueue.length > 0) {
    const job = thumbnailQueue.shift()
    thumbnailActive += 1
    ;(async () => {
      try {
        if (job.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const base = job.page.getViewport({ scale: 1 })
        const scale = job.width / base.width
        const viewport = job.page.getViewport({ scale })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        job.canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
        job.canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
        const context = job.canvas.getContext('2d', { alpha: false })
        context.setTransform(ratio, 0, 0, ratio, 0, 0)
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, viewport.width, viewport.height)
        const task = job.page.render({ canvasContext: context, viewport })
        const cancel = () => task.cancel()
        if (job.signal !== undefined) {
          if (job.signal.aborted) task.cancel()
          else job.signal.addEventListener('abort', cancel, { once: true })
        }
        try {
          await task.promise
        } finally {
          job.signal?.removeEventListener?.('abort', cancel)
        }
        job.resolve(viewport)
      } catch (error) {
        job.reject(error)
      } finally {
        thumbnailActive -= 1
        pumpThumbnailQueue()
      }
    })()
  }
}

export function renderThumbnail(page, canvas, width, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    thumbnailQueue.push({ page, canvas, width, signal, resolve, reject })
    pumpThumbnailQueue()
  })
}

export function renderPdfPage(page, canvas, scale, signal) {
  const previous = renderQueues.get(canvas) ?? Promise.resolve()
  const job = previous.catch(() => {}).then(async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const viewport = page.getViewport({ scale })
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio))
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio))
    canvas.style.width = `${viewport.width}px`
    canvas.style.height = `${viewport.height}px`
    const context = canvas.getContext('2d', { alpha: false })
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, viewport.width, viewport.height)
    const task = page.render({ canvasContext: context, viewport })
    const cancel = () => task.cancel()
    if (signal !== undefined) {
      if (signal.aborted) task.cancel()
      else signal.addEventListener('abort', cancel, { once: true })
    }
    try {
      await task.promise
    } finally {
      signal?.removeEventListener?.('abort', cancel)
    }
    return viewport
  })
  renderQueues.set(canvas, job)
  return job
}

function isCjk(character) {
  if (character === undefined || character === '') return false
  const code = character.codePointAt(0)
  return (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xff00 && code <= 0xffef) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  )
}

function joinFragments(left, right) {
  if (left === '') return right
  if (right === '') return left
  if (/[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)) return `${left.slice(0, -1)}${right}`
  if (isCjk(left.slice(-1)) || isCjk(right[0])) return left + right
  return `${left} ${right}`
}

function joinLines(left, right) {
  if (left === '') return right
  if (right === '') return left
  if (/[A-Za-z]-$/.test(left) && /^[a-z]/.test(right)) return `${left.slice(0, -1)}${right}`
  if (isCjk(left.slice(-1)) || isCjk(right[0])) return left + right
  return `${left} ${right}`
}

function normalizeLineText(text) {
  return text
    .replace(/\u00ad/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s+([,.;:!?%)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim()
}

/**
 * Reconstruct lines and paragraph-sized segments from PDF.js text items.
 *
 * The content stream generally follows reading order (including columns), so
 * this preserves item order instead of globally sorting by y, which would
 * interleave two-column papers. Lines still split on large horizontal moves and
 * paragraphs split on vertical gaps, indentation, and font-size changes.
 */
export function buildPageModel(library, textContent, viewport) {
  const pageWidth = viewport.width
  const items = Array.isArray(textContent?.items) ? textContent.items : []
  const lines = []
  let current

  const flush = () => {
    if (current === undefined) return
    const text = normalizeLineText(current.text)
    if (text !== '') {
      lines.push({
        text,
        x: current.x,
        top: current.top,
        width: Math.max(1, current.right - current.x),
        height: Math.max(1, current.height),
        baseline: current.baseline,
      })
    }
    current = undefined
  }

  for (const item of items) {
    if (item === null || typeof item !== 'object' || typeof item.str !== 'string') continue
    if (!Array.isArray(item.transform)) continue
    const matrix = library.Util.transform(viewport.transform, item.transform)
    const x = matrix[4]
    const baseline = matrix[5]
    const fontHeight = Math.max(1, Math.hypot(matrix[2], matrix[3]) || (item.height || 10))
    const width = Math.max(1, (item.width || item.str.length * fontHeight * 0.48) * viewport.scale)
    if (!Number.isFinite(x) || !Number.isFinite(baseline)) continue
    if (item.str.trim() === '') {
      if (current !== undefined) {
        current.endX = Math.max(current.endX, x + width)
        if (item.str.length > 0) current.pendingSpace = true
      }
      continue
    }

    const sameLine =
      current !== undefined &&
      Math.abs(baseline - current.baseline) <= Math.max(1.5, Math.min(current.height, fontHeight) * 0.4)
    const backwards = current !== undefined && x < current.x - Math.max(2, fontHeight * 0.8)
    const farGap = current !== undefined && x - current.endX > fontHeight * 5
    if (!sameLine || backwards || farGap) {
      flush()
    }

    if (current === undefined) {
      current = {
        text: item.str,
        x,
        endX: x + width,
        right: x + width,
        baseline,
        top: baseline - fontHeight * 0.82,
        height: fontHeight,
        count: 1,
        pendingSpace: false,
      }
    } else {
      if (current.pendingSpace === true) {
        current.text += ' '
        current.pendingSpace = false
      }
      const gap = x - current.endX
      if (gap > Math.max(1.2, fontHeight * 0.18)) current.text = joinFragments(current.text, item.str)
      else current.text += item.str
      current.endX = x + width
      current.right = Math.max(current.right, x + width)
      current.height = Math.max(current.height, fontHeight)
      current.top = Math.min(current.top, baseline - fontHeight * 0.82)
      current.count += 1
    }
  }
  flush()

  const lineGaps = []
  const lineHeights = []
  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index].top - (lines[index - 1].top + lines[index - 1].height)
    if (gap >= 0 && gap < Math.max(lines[index].height, lines[index - 1].height) * 3) {
      lineGaps.push(gap)
    }
    lineHeights.push(lines[index].height)
  }
  lineGaps.sort((left, right) => left - right)
  lineHeights.sort((left, right) => left - right)
  const medianGap = lineGaps.length > 0 ? lineGaps[Math.floor(lineGaps.length / 2)] : 0
  const typicalHeight = lineHeights.length > 0 ? lineHeights[Math.floor(lineHeights.length / 2)] : 10
  const gapThreshold = Math.max(medianGap * 1.55, typicalHeight * 0.5)

  const paragraphs = []
  for (const line of lines) {
    const previous = paragraphs[paragraphs.length - 1]
    if (previous === undefined) {
      paragraphs.push(createParagraph(line))
      continue
    }
    const gap = line.top - previous.bottom
    const height = Math.max(previous.height, line.height)
    const verticalReset = line.top < previous.top - height * 0.5
    const columnJumpLeft =
      line.x < previous.x - height * 2.2 && previous.right > pageWidth * 0.58
    const columnJumpRight =
      line.x > previous.x + height * 2.2 &&
      line.x > pageWidth * 0.42 &&
      (verticalReset || line.top <= previous.bottom + height * 1.5)
    const indented =
      line.x > previous.x + height * 0.95 && gap > Math.max(0.8, medianGap * 0.45)
    const shortPrevious =
      previous.right < pageWidth * 0.88 &&
      line.x <= previous.x + height * 0.75 &&
      gap > Math.max(1, gapThreshold * 0.55)
    const heading = line.height > previous.height * 1.24 && line.height > 9
    const newParagraph =
      gap > gapThreshold ||
      verticalReset ||
      columnJumpRight ||
      columnJumpLeft ||
      indented ||
      shortPrevious ||
      heading
    if (newParagraph) {
      paragraphs.push(createParagraph(line))
    } else {
      previous.text = joinLines(previous.text, line.text)
      previous.lines.push(line)
      previous.bottom = Math.max(previous.bottom, line.top + line.height)
      previous.right = Math.max(previous.right, line.x + line.width)
      previous.height = Math.max(previous.height, line.height)
    }
  }

  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    paragraph.id = `p${index}`
    paragraph.lines.forEach((line, lineIndex) => {
      line.id = `p${index}-l${lineIndex}`
      line.paragraphId = paragraph.id
    })
    paragraph.text = normalizeLineText(paragraph.text)
  }

  return {
    paragraphs: paragraphs.filter((paragraph) => paragraph.text !== ''),
    lines,
    viewport,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
  }
}

function createParagraph(line) {
  return {
    text: line.text,
    x: line.x,
    top: line.top,
    bottom: line.top + line.height,
    right: line.x + line.width,
    height: line.height,
    lines: [line],
  }
}

export async function extractPageModel(page, scale = 1, identity = undefined) {
  const library = await loadPdfJs()
  const viewport = page.getViewport({ scale })
  const textContent = await page.getTextContent({ includeMarkedContent: false })
  const model = buildPageModel(library, textContent, viewport)
  if (identity !== undefined) {
    model.documentId = identity.documentId
    model.pageIndex = identity.pageIndex
  }
  return model
}

/** Resolve an outline into a flat list with depth and a 0-based page index. */
export async function resolveOutline(document, outline) {
  if (!Array.isArray(outline) || outline.length === 0) return []
  const output = []
  const seen = new Set()

  const pageIndexFor = async (dest) => {
    try {
      let resolved = dest
      if (typeof resolved === 'string') resolved = await document.getDestination(resolved)
      if (!Array.isArray(resolved) || resolved.length === 0) return undefined
      return await document.getPageIndex(resolved[0])
    } catch {
      return undefined
    }
  }

  const walk = async (nodes, depth) => {
    for (const node of nodes) {
      if (output.length >= 400) return
      const title = typeof node?.title === 'string' ? node.title.trim() : ''
      if (title === '') continue
      const key = `${depth}:${title}:${output.length}`
      if (seen.has(key)) continue
      seen.add(key)
      const pageIndex = await pageIndexFor(node.dest)
      output.push({ id: `o${output.length}`, title, depth, pageIndex })
      if (Array.isArray(node.items) && node.items.length > 0 && depth < 8) {
        await walk(node.items, depth + 1)
      }
    }
  }

  await walk(outline, 0)
  return output
}

const normalizeAnchorText = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/**
 * Resolve a saved note anchor against a freshly parsed page.
 *
 * Paragraph ids are parse-order indices, not stable identities. Use an id only
 * when its current text still contains the saved snippet; otherwise search the
 * page by snippet. Returns undefined when neither anchor matches.
 */
export function findParagraphByAnchor(paragraphs, paragraphId, sourceSnippet) {
  const snippet = normalizeAnchorText(sourceSnippet).slice(0, 120)
  const matches = (paragraph) =>
    snippet === '' || normalizeAnchorText(paragraph.text).includes(snippet)
  const byId = paragraphs.find(
    (paragraph) => paragraph.id === paragraphId && matches(paragraph),
  )
  if (byId !== undefined) return byId
  if (snippet === '') return undefined
  return paragraphs.find(matches)
}

export function parseGlossary(text) {
  const entries = []
  const seen = new Set()
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = line.match(/^(.+?)\s*(?:=>|=|＝|\t|：|:)\s*(.+)$/)
    if (match === null) continue
    const source = match[1].trim()
    const target = match[2].trim()
    if (source === '' || target === '') continue
    const key = source.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({ source, target })
    if (entries.length >= 200) break
  }
  return entries
}

export function glossaryKey(entries) {
  return entries.map((entry) => `${entry.source}=${entry.target}`).join('\n')
}

/** Approximate paragraph batches without exceeding the Host limits. */
export function makeBatches(entries, maxCount = 5, maxChars = 3800) {
  const batches = []
  let current = []
  let chars = 0
  for (const entry of entries) {
    const size = entry.text.length
    if (current.length > 0 && (current.length >= maxCount || chars + size > maxChars)) {
      batches.push(current)
      current = []
      chars = 0
    }
    current.push(entry)
    chars += size
  }
  if (current.length > 0) batches.push(current)
  return batches
}
