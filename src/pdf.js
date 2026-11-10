/**
 * PDF.js runtime, text extraction and reading-order heuristics.
 *
 * PDF.js is loaded as an ES module from this plugin's own Host route, so it
 * never installs a global that could collide with the document-preview plugin.
 */

import {
  analyzeEquations,
  bodyFontSize,
  cropMetrics,
  dominantFont,
  overlapRatio,
  splitTextAtom,
  unionBox,
} from './equations.js'
import {
  assignFigureLabels,
  collectFigureRegions,
  detectFigureRegions,
} from './figures.js'
import { mathToken } from '../lib/placeholders.js'

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

/** Device pixel ratio used for every page raster; cached rasters key on it. */
export function pdfPixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

/**
 * Serialize every write to one canvas.
 *
 * Page renders, cached-raster blits and preview blits all share this queue, so a
 * fast 1 → 2 → 1 cannot let an older render overwrite the page that was restored
 * after it started.
 */
function enqueueCanvas(canvas, task) {
  const previous = renderQueues.get(canvas) ?? Promise.resolve()
  const job = previous.catch(() => {}).then(task)
  renderQueues.set(canvas, job)
  return job
}

/** Whether the browser can turn a canvas into an ImageBitmap at all. */
export function supportsRasterSnapshot() {
  return typeof createImageBitmap === 'function'
}

/**
 * Render one page into `canvas` and, when asked, start a snapshot of it.
 *
 * The copy is *started* inside the queued task that painted the page, so it can
 * only ever copy this page's pixels, but the task and its caller do not wait for
 * it: the page becomes ready and the next page may start rendering while the
 * browser finishes the copy. Callers await `snapshot` only when writing the cache.
 */
export function renderPdfPage(page, canvas, scale, signal, options = {}) {
  return enqueueCanvas(canvas, async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const viewport = page.getViewport({ scale })
    const ratio = pdfPixelRatio()
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
    return {
      viewport,
      snapshot: options.snapshot === true ? copyCanvas(canvas) : null,
    }
  })
}

/** Copy a canvas into an ImageBitmap, or null when the browser cannot. */
async function copyCanvas(canvas) {
  if (typeof createImageBitmap !== 'function') return null
  try {
    return await createImageBitmap(canvas)
  } catch {
    return null
  }
}

/**
 * Paint a cached raster onto the page canvas.
 *
 * The raster's own pixels decide the canvas buffer, while `width`/`height` are the
 * target viewport's CSS size: a raster captured at another scale is stretched to
 * the page box while it serves as a preview, and a matching one is already exact.
 */
export function drawPdfRaster(canvas, image, width, height, signal) {
  return enqueueCanvas(canvas, async () => {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const pixelWidth = Math.max(1, Math.round(image.width))
    const pixelHeight = Math.max(1, Math.round(image.height))
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const context = canvas.getContext('2d', { alpha: false })
    if (context === null) throw new Error('Canvas 2D context is unavailable')
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(image, 0, 0)
    return { width, height }
  })
}

/**
 * Render an equation region from an independently rendered page canvas.
 *
 * The crop never depends on the reader's visible canvas or current zoom. It is
 * sized from the requested display width and device pixel ratio, then clamped
 * by a pixel budget so a very large region cannot exhaust browser memory.
 */
export async function renderEquationCrop(page, bbox, options = {}, signal) {
  const metrics = cropMetrics(bbox, options)
  const canvas = document.createElement('canvas')
  canvas.width = metrics.pixelWidth
  canvas.height = metrics.pixelHeight
  const context = canvas.getContext('2d', { alpha: false })
  if (context === null) throw new Error('Canvas 2D context is unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  // Shift the viewport by the crop origin. The offset is in device pixels and
  // therefore also correct for rotated pages.
  const viewport = page.getViewport({
    scale: metrics.renderScale,
    offsetX: -bbox[0] * metrics.renderScale,
    offsetY: -bbox[1] * metrics.renderScale,
  })
  const task = page.render({ canvasContext: context, viewport })
  const cancel = () => task.cancel()
  if (signal !== undefined) {
    if (signal.aborted) {
      task.cancel()
      throw new DOMException('Aborted', 'AbortError')
    }
    signal.addEventListener('abort', cancel, { once: true })
  }
  try {
    await task.promise
  } finally {
    signal?.removeEventListener?.('abort', cancel)
  }
  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: metrics.displayWidth,
    height: metrics.displayHeight,
    pixelWidth: metrics.pixelWidth,
    pixelHeight: metrics.pixelHeight,
    renderScale: metrics.renderScale,
  }
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
 * Convert PDF.js text items into page-point atoms (scale-1 viewport space).
 * Empty items are kept so whitespace still influences word spacing.
 */
export function buildAtoms(library, textContent, viewport) {
  const scale = Number.isFinite(viewport?.scale) && viewport.scale > 0 ? viewport.scale : 1
  const items = Array.isArray(textContent?.items) ? textContent.items : []
  const atoms = []
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (item === null || typeof item !== 'object' || typeof item.str !== 'string') continue
    if (!Array.isArray(item.transform)) continue
    const matrix = library.Util.transform(viewport.transform, item.transform)
    const x = matrix[4] / scale
    const baseline = matrix[5] / scale
    const fontHeight =
      Math.max(1, Math.hypot(matrix[2], matrix[3]) || (item.height || 10)) / scale
    if (!Number.isFinite(x) || !Number.isFinite(baseline)) continue
    const width = Math.max(
      0,
      item.width || (item.str.trim() === '' ? 0 : item.str.length * fontHeight * 0.48),
    )
    atoms.push({
      index,
      sourceIndex: index,
      dir: item.dir,
      text: item.str,
      x,
      y: baseline,
      endX: x + width,
      width,
      height: fontHeight,
      top: baseline - fontHeight * 0.82,
      bottom: baseline + fontHeight * 0.18,
      fontName: typeof item.fontName === 'string' ? item.fontName : '',
    })
  }
  return atoms
}

/**
 * Reconstruct lines and paragraph-sized segments from PDF.js text items.
 *
 * Display-equation regions are detected first and removed from the text flow,
 * so their fragments never become paragraphs. Remaining lines are rebuilt in
 * content-stream order (which follows columns), split on large horizontal moves
 * and vertical gaps, and grouped into paragraphs.
 *
 * Inline math inside body lines is replaced by a unique placeholder in
 * `translateText` while `text` keeps the readable source. Placeholders are
 * restored after translation.
 */
export function buildPageModel(library, textContent, viewport, options = {}) {
  const scale = Number.isFinite(viewport?.scale) && viewport.scale > 0 ? viewport.scale : 1
  const pageWidth = (viewport?.width ?? 612) / scale
  const pageHeight = (viewport?.height ?? 792) / scale
  const pageIndex = Number.isInteger(options.pageIndex) ? options.pageIndex : 0
  const atoms = buildAtoms(library, textContent, viewport).flatMap(splitTextAtom)
  // Figure labels must leave the text flow before equation detection, otherwise
  // an annotation such as "Input → Output" is classified as a display formula.
  const bodyFont = options.bodyFont ?? dominantFont(atoms)
  const bodySize = options.bodySize ?? bodyFontSize(atoms)
  const resolvedFigures = resolveFigureRegions(options, pageWidth, pageHeight)
  const figureRegions = resolvedFigures.regions
  const figureInfo = assignFigureLabels(atoms, figureRegions, { bodySize })
  const contentAtoms = atoms.filter((atom) => !figureInfo.atomIds.has(atom.index))
  const analysis = analyzeEquations(contentAtoms, {
    pageWidth,
    pageHeight,
    bodyFont,
    bodySize,
    overrides: options.overrides,
  })
  const excluded = analysis.equationAtomIds
  const inlineMath = analysis.inlineMath
  const lines = []
  let current
  let tokenCount = 0

  const flushMath = (line) => {
    const run = line.mathRun
    if (run === null) return
    line.mathRun = null
    const mathText = run.text.replace(/\s+/g, ' ').trim()
    if (mathText === '') return
    const token = mathToken((tokenCount += 1))
    if (line.text === '') line.text = mathText
    else if (run.separated) line.text = joinFragments(line.text, mathText)
    else line.text += mathText
    if (line.translateText === '') line.translateText = token
    else if (run.separated) line.translateText = joinFragments(line.translateText, token)
    else line.translateText += token
    line.placeholders.push({ token, text: mathText })
  }

  const appendMath = (atom) => {
    const line = current
    if (line.mathRun === null) {
      const separated =
        line.pendingSpace ||
        (line.text !== '' && atom.x - line.endX > Math.max(1.2, atom.height * 0.18))
      line.mathRun = { text: atom.text, last: atom, separated, pendingSpace: false }
    } else {
      const gap = atom.x - line.mathRun.last.endX
      const space =
        line.mathRun.pendingSpace ||
        gap > Math.max(1.2, Math.max(atom.height, line.mathRun.last.height) * 0.18)
      line.mathRun.text += space ? ` ${atom.text}` : atom.text
      line.mathRun.last = atom
      line.mathRun.pendingSpace = false
    }
    line.pendingSpace = false
    line.endX = atom.endX
    line.right = Math.max(line.right, atom.endX)
    line.height = Math.max(line.height, atom.height)
    line.top = Math.min(line.top, atom.top)
    line.count += 1
  }

  const appendText = (atom) => {
    const line = current
    if (line.mathRun !== null) flushMath(line)
    if (line.pendingSpace) {
      line.text += ' '
      line.translateText += ' '
      line.pendingSpace = false
    }
    const gap = atom.x - line.endX
    const join = gap > Math.max(1.2, atom.height * 0.18)
    if (line.text === '') {
      line.text = atom.text
      line.translateText = atom.text
    } else if (join) {
      line.text = joinFragments(line.text, atom.text)
      line.translateText = joinFragments(line.translateText, atom.text)
    } else {
      line.text += atom.text
      line.translateText += atom.text
    }
    line.endX = atom.endX
    line.right = Math.max(line.right, atom.endX)
    line.height = Math.max(line.height, atom.height)
    line.top = Math.min(line.top, atom.top)
    line.count += 1
  }

  const flushLine = () => {
    if (current === undefined) return
    if (current.mathRun !== null) flushMath(current)
    const text = normalizeLineText(current.text)
    const translateText = normalizeLineText(current.translateText)
    if (text !== '') {
      lines.push({
        text,
        translateText,
        placeholders: current.placeholders,
        x: current.x,
        top: current.top,
        width: Math.max(1, current.right - current.x),
        height: Math.max(1, current.height),
        baseline: current.baseline,
        order: current.order,
      })
    }
    current = undefined
  }

  for (const atom of contentAtoms) {
    if (excluded.has(atom.index)) continue
    if (atom.text.trim() === '') {
      if (current !== undefined) {
        current.endX = Math.max(current.endX, atom.endX)
        if (atom.text.length > 0) {
          current.pendingSpace = true
          if (current.mathRun !== null) current.mathRun.pendingSpace = true
        }
      }
      continue
    }

    const fontHeight = atom.height
    const sameLine =
      current !== undefined &&
      Math.abs(atom.y - current.baseline) <=
        Math.max(1.5, Math.min(current.height, fontHeight) * 0.4)
    const backwards = current !== undefined && atom.x < current.x - Math.max(2, fontHeight * 0.8)
    const farGap = current !== undefined && atom.x - current.endX > fontHeight * 5
    // Inline radicals and superscripts sit above the baseline. Keep them on
    // the surrounding text line when they are horizontally attached, so an
    // inline formula cannot become its own paragraph.
    const inlineContinuation =
      current !== undefined &&
      !backwards &&
      inlineMath.has(atom.index) &&
      atom.x >= current.x &&
      atom.x - current.endX <= fontHeight * 2 &&
      Math.abs(atom.y - current.baseline) <= fontHeight * 1.05
    if ((!sameLine || backwards || farGap) && !inlineContinuation) flushLine()

    if (current === undefined) {
      current = {
        text: '',
        translateText: '',
        placeholders: [],
        x: atom.x,
        endX: atom.endX,
        right: atom.endX,
        baseline: atom.y,
        top: atom.top,
        height: fontHeight,
        count: 0,
        pendingSpace: false,
        mathRun: null,
        order: atom.index,
      }
    }
    if (inlineMath.has(atom.index)) appendMath(atom)
    else appendText(atom)
  }
  flushLine()

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
    const proseBreak = /[.!?。！？:：;；)\]"”’]$/.test(previous.text.trim())
    const columnJumpRight =
      line.x > previous.x + height * 2.2 &&
      line.x > pageWidth * 0.42 &&
      proseBreak &&
      (verticalReset || line.top <= previous.bottom + height * 1.5)
    const indented =
      line.x > previous.x + height * 0.95 && gap > Math.max(0.8, medianGap * 0.45)
    const shortPrevious =
      previous.right < pageWidth * 0.88 &&
      line.x <= previous.x + height * 0.75 &&
      gap > Math.max(1, gapThreshold * 0.55)
    const heading = line.height > previous.height * 1.24 && line.height > 9
    // A line break in the middle of a sentence is not a paragraph break, even
    // when the previous line is short or the next line is indented. This is
    // common in license notes, abstracts and two-column body text.
    const sentenceContinuation =
      !verticalReset &&
      !columnJumpRight &&
      !columnJumpLeft &&
      !heading &&
      gap <= Math.max(gapThreshold * 1.35, height * 1.5) &&
      !/[.!?。！？:：;；)\]"”’]$/.test(previous.text.trim()) &&
      /^[a-zà-ÿ0-9(（\[]/.test(line.text)
    const newParagraph =
      !sentenceContinuation &&
      (gap > gapThreshold ||
        verticalReset ||
        columnJumpRight ||
        columnJumpLeft ||
        indented ||
        shortPrevious ||
        heading)
    if (newParagraph) {
      paragraphs.push(createParagraph(line))
    } else {
      previous.text = joinLines(previous.text, line.text)
      previous.translateText = joinLines(previous.translateText, line.translateText)
      previous.placeholders.push(...line.placeholders)
      previous.lines.push(line)
      previous.bottom = Math.max(previous.bottom, line.top + line.height)
      previous.right = Math.max(previous.right, line.x + line.width)
      previous.height = Math.max(previous.height, line.height)
    }
  }

  const paragraphBlocks = []
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    paragraph.id = `p${index}`
    paragraph.order = Math.min(...paragraph.lines.map((line) => line.order))
    paragraph.bbox = unionBox(
      paragraph.lines.map((line) => [line.x, line.top, line.x + line.width, line.top + line.height]),
    )
    paragraph.translateText = normalizeLineText(paragraph.translateText)
    paragraph.text = normalizeLineText(paragraph.text)
    paragraph.lines.forEach((line, lineIndex) => {
      line.id = `p${index}-l${lineIndex}`
      line.paragraphId = paragraph.id
    })
    if (paragraph.text !== '') paragraphBlocks.push(paragraph)
  }

  for (const paragraph of paragraphBlocks) {
    for (const line of paragraph.lines) {
      line.x *= scale
      line.top *= scale
      line.width *= scale
      line.height *= scale
      line.baseline *= scale
    }
  }

  const pageKey = `page${pageIndex + 1}`
  const blocks = paragraphBlocks.map((paragraph, index) => ({
    id: `${pageKey}-p${index}`,
    type: 'paragraph',
    pageIndex,
    paragraphId: paragraph.id,
    bbox: paragraph.bbox,
    text: paragraph.text,
    translateText: paragraph.translateText,
    order: paragraph.order,
    paragraph,
  }))
  for (let index = 0; index < analysis.equations.length; index += 1) {
    const equation = analysis.equations[index]
    blocks.push({
      id: `${pageKey}-equation${index + 1}`,
      type: 'equation',
      pageIndex,
      bbox: equation.bbox,
      imageBbox: equation.imageBbox,
      equationNumber: equation.equationNumber,
      sourceItemIds: equation.sourceItemIds,
      latex: null,
      detectionSource: equation.detectionSource,
      text: equation.text,
      order: equation.order,
    })
  }
  // A figure keeps its artwork and its labels together. `order` follows the
  // first label; an image without labels is placed just before the text that
  // follows it in the content stream, which is normally its caption.
  const figureBlocks = []
  const maxAtomOrder = atoms.reduce(
    (max, atom) => (Number.isFinite(atom.index) ? Math.max(max, atom.index) : max),
    0,
  )
  for (let index = 0; index < figureInfo.figures.length; index += 1) {
    const figure = figureInfo.figures[index]
    const labelAtoms = figure.labels.flatMap((line) => line.atoms)
    const fallbackOrder = () => {
      const below = atoms.find(
        (atom) => atom.text.trim() !== '' && atom.top > figure.bbox[3] - 0.5,
      )
      return below === undefined ? maxAtomOrder + 0.5 : below.index - 0.5
    }
    const order =
      labelAtoms.length > 0
        ? Math.min(...labelAtoms.map((atom) => atom.index))
        : fallbackOrder()
    figureBlocks.push({
      id: `${pageKey}-figure${index + 1}`,
      type: 'figure',
      pageIndex,
      bbox: figure.bbox,
      imageBbox: figure.imageBbox,
      figureNumber: figure.number,
      caption: figure.caption?.text ?? null,
      captionBbox: figure.caption?.bbox ?? null,
      labels: figure.labels.map((line) => ({ text: line.text, bbox: line.bbox })),
      labelCount: figure.labels.length,
      source: figure.source,
      detectionSource: 'automatic',
      text: figure.labels.map((line) => line.text).join(' ') || figure.caption?.text || '',
      order,
    })
  }
  blocks.push(...figureBlocks)
  blocks.sort(
    (left, right) =>
      left.order - right.order ||
      (left.type === 'equation' || left.type === 'figure' ? -1 : 1),
  )
  let equationIndex = 0
  let figureIndex = 0
  for (const block of blocks) {
    if (block.type === 'equation') {
      equationIndex += 1
      block.id = `${pageKey}-equation${equationIndex}`
    } else if (block.type === 'figure') {
      figureIndex += 1
      block.id = `${pageKey}-figure${figureIndex}`
    }
  }

  return {
    blocks,
    paragraphs: paragraphBlocks,
    lines: paragraphBlocks.flatMap((paragraph) => paragraph.lines),
    equations: blocks.filter((block) => block.type === 'equation'),
    figures: blocks.filter((block) => block.type === 'figure'),
    figureRegions,
    // The unfiltered detection result, so callers can cache it and re-apply
    // "not a figure" corrections on later visits without losing the region.
    figureRegionsRaw: resolvedFigures.raw,
    atoms,
    viewport,
    bodySize,
    bodyFont,
    pageIndex,
    pageWidth: viewport.width,
    pageHeight: viewport.height,
  }
}

/**
 * Resolve the figure boxes for a page.
 *
 * Callers normally pass `figures` measured from the page operator list by
 * `collectFigureRegions`. `artwork` is accepted for callers that already have
 * the raw image/path boxes, and `overrides.figures` removes a false positive.
 */
function resolveFigureRegions(options, pageWidth, pageHeight) {
  const raw = options.figures ?? options.figureRegions
  let regions = Array.isArray(raw) ? raw.filter((region) => Array.isArray(region?.bbox)) : []
  if (regions.length === 0 && options.artwork !== undefined) {
    regions = detectFigureRegions(options.artwork, { pageWidth, pageHeight })
  }
  const detected = regions
  const removed = Array.isArray(options.overrides?.figures) ? options.overrides.figures : []
  const filtered =
    removed.length === 0
      ? detected
      : detected.filter(
          (region) =>
            !removed.some((box) => Array.isArray(box) && overlapRatio(box, region.bbox) > 0.3),
        )
  return { regions: filtered, raw: detected }
}

function createParagraph(line) {
  return {
    text: line.text,
    translateText: line.translateText,
    placeholders: [...line.placeholders],
    x: line.x,
    top: line.top,
    bottom: line.top + line.height,
    right: line.x + line.width,
    height: line.height,
    lines: [line],
  }
}

export async function extractPageModel(page, scale = 1, identity = undefined, options = {}) {
  const library = await loadPdfJs()
  const viewport = page.getViewport({ scale })
  const textContent = await page.getTextContent({ includeMarkedContent: false })
  let figures = options.figures
  if (figures === undefined && options.detectFigures !== false) {
    figures = await collectFigureRegions(page, library, viewport, options.figureOptions)
  }
  const model = buildPageModel(library, textContent, viewport, {
    ...options,
    figures,
    pageIndex: identity?.pageIndex ?? options.pageIndex ?? 0,
  })
  if (identity !== undefined) {
    model.documentId = identity.documentId
    model.pageIndex = identity.pageIndex
  } else if (Number.isInteger(options.pageIndex)) {
    model.pageIndex = options.pageIndex
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
