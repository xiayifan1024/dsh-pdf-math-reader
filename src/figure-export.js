/**
 * Helpers for saving figure/table/equation crops as PNG or image-only PDF.
 *
 * Saved images are re-rendered at 300 or 600 dpi, independently of previews.
 * PDF exports embed only the rendered crop, never original page streams.
 * The filename carries the document, page and figure/table number,
 * so a downloads folder with several papers stays searchable.
 */

import { PDFDocument } from 'pdf-lib'
import { dataUrlToBytes } from './zip.js'

const MAX_STEM_LENGTH = 80
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]+/g

/** A safe, readable stem for a document name (`paper.pdf` -> `paper`). */
export function fileStem(documentName) {
  const raw = String(documentName ?? '')
    .replace(/\.pdf$/i, '')
    .replace(INVALID_FILENAME_CHARS, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-. ]+|[-. ]+$/g, '')
  if (raw === '') return 'document'
  if (raw.length <= MAX_STEM_LENGTH) return raw
  return raw.slice(0, MAX_STEM_LENGTH).replace(/[-. ]+$/g, '') || 'document'
}

function saveNumber(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .slice(0, 16)
}

/** `paper-p13-figure-3.png`, `paper-p5-table-2.png`, `paper-p3-equation-1.png`. */
export function saveFileName({
  documentName,
  pageIndex,
  kind = 'figure',
  number = null,
  ordinal = 0,
}) {
  const page = Math.max(0, Math.trunc(Number(pageIndex) || 0)) + 1
  const label =
    kind === 'table' ? 'table' : kind === 'equation' ? 'equation' : 'figure'
  const suffix = saveNumber(number)
  // Two panels sometimes share one caption ("Figure 2"); the page-local ordinal
  // keeps the second save from landing on the same filename as the first.
  const instance = Number.isInteger(ordinal) && ordinal > 0 ? `-${ordinal}` : ''
  const numberPart = suffix === '' ? '' : `-${suffix}`
  return `${fileStem(documentName)}-p${page}-${label}${numberPart}${instance}.png`
}

/**
 * Resolution is independent of reader zoom and screen density. The crop
 * renderer still applies its pixel budget and 8192-pixel side limit.
 */
export function saveRenderOptions(dpi = 300, rotation = 0) {
  return {
    renderScale: (dpi === 600 ? 600 : 300) / 72,
    maxPixels: 32_000_000,
    maxScale: 600 / 72,
    rotation,
  }
}

/** PDF.js has already decrypted and rendered this crop. No source PDF bytes
 * or out-of-crop content enter the new PDF. Sizes are physical PDF points:
 * canonical viewport boxes already include the source UserUnit scaling.
 */
export async function exportImagePdf(image, bbox, rotation = 0, signal) {
  signal?.throwIfAborted()
  const output = await PDFDocument.create()
  const embedded = await output.embedPng(dataUrlToBytes(image.dataUrl))
  signal?.throwIfAborted()
  const width = bbox[2] - bbox[0]
  const height = bbox[3] - bbox[1]
  const quarterTurn = Math.abs(rotation % 180) === 90
  const size = quarterTurn ? [height, width] : [width, height]
  const crop = output.addPage(size)
  // The pixels have already been rotated by the crop renderer.
  crop.drawImage(embedded, { width: size[0], height: size[1] })
  const bytes = await output.save()
  signal?.throwIfAborted()
  return bytes
}

/** Names and numbering follow the blocks actually displayed, including
 * unnumbered equations and numbers that collide after filename sanitizing.
 */
export function exportOrdinals(blocks) {
  const groups = new Map()
  for (const block of blocks) {
    if (block.type !== 'figure' && block.type !== 'equation') continue
    const kind = block.type === 'equation' ? 'equation' : block.kind === 'table' ? 'table' : 'figure'
    const number = kind === 'equation' ? block.equationNumber : kind === 'table' ? block.tableNumber : block.figureNumber
    const key = saveFileName({ kind, number })
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(block.id)
  }
  const ordinals = new Map()
  for (const ids of groups.values()) {
    if (ids.length > 1) ids.forEach((id, index) => ordinals.set(id, index + 1))
  }
  return ordinals
}
