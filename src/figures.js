/**
 * Figure-region detection and in-figure text attribution.
 *
 * A figure is recognised from the page's own drawing operations, not from its
 * text: raster image XObjects and dense vector artwork (charts, heat maps,
 * diagrams) give a reliable "this area is artwork" signal that a text-only
 * heuristic cannot. Text atoms sitting inside that artwork are labels, not body
 * copy, so they must not become paragraphs or display equations.
 *
 * Coordinates follow the same convention as `equations.js`: page points in the
 * scale-1 viewport orientation (origin top-left, y grows downwards). The
 * operator list works in PDF user space (origin bottom-left), so every box is
 * converted through the page viewport once, which also keeps rotated pages
 * correct.
 */

import {
  atomBox,
  boxArea,
  buildTextRows,
  intersectionArea,
  overlapRatio,
  unionBox,
} from './equations.js'

export const FIGURE_CAPTION_RE = /^(?:figure|fig\.)\s*([0-9]{1,3}[a-z]?)\b/i

/** A path smaller than this in both directions is a rule, not artwork. */
const SOLID_MIN_SIDE = 2

const DEFAULT_LIMITS = {
  // A page with an enormous operator list is usually generated artwork; skip
  // rather than freeze the reader while classifying it.
  maxOperators: 180000,
  // Image regions smaller than this are logos, bullets or inline icons.
  minImageAreaRatio: 0.002,
  minImageSide: 18,
  // Vector regions need enough paths, enough two-dimensional shapes and a
  // real page footprint. Tables consist of thin rules only and fail here.
  minVectorAreaRatio: 0.02,
  minVectorPaths: 5,
  minVectorSolid: 3,
  minVectorWidth: 40,
  minVectorHeight: 24,
  clusterGap: 5,
}

function multiply(left, right) {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function transformPoint(matrix, x, y) {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]]
}

/** Normalise a rectangle given in PDF user space into viewport points. */
function viewportBox(viewport, x0, y0, x1, y1) {
  const left = Math.min(x0, x1)
  const right = Math.max(x0, x1)
  const bottom = Math.min(y0, y1)
  const top = Math.max(y0, y1)
  const corners = [
    [left, bottom],
    [right, bottom],
    [left, top],
    [right, top],
  ]
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const [x, y] of corners) {
    const point =
      typeof viewport?.convertToViewportPoint === 'function'
        ? viewport.convertToViewportPoint(x, y)
        : [x, (viewport?.height ?? 792) - y]
    minX = Math.min(minX, point[0])
    minY = Math.min(minY, point[1])
    maxX = Math.max(maxX, point[0])
    maxY = Math.max(maxY, point[1])
  }
  return [minX, minY, maxX, maxY]
}

function pathBoundingBox(args) {
  const minMax = Array.isArray(args?.[2]) ? args[2] : null
  if (minMax !== null && minMax.length === 4 && minMax.every(Number.isFinite)) {
    return [
      Math.min(minMax[0], minMax[2]),
      Math.min(minMax[1], minMax[3]),
      Math.max(minMax[0], minMax[2]),
      Math.max(minMax[1], minMax[3]),
    ]
  }
  const coords = Array.isArray(args?.[1]) ? args[1] : null
  if (coords === null || coords.length < 4) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let index = 0; index + 1 < coords.length; index += 2) {
    const x = coords[index]
    const y = coords[index + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  if (!Number.isFinite(minX)) return null
  return [minX, minY, maxX, maxY]
}

/**
 * Extract the boxes of raster images and vector paths from a page operator
 * list. Returns `{images, paths}` in viewport coordinates.
 */
export function artworkFromOperatorList(library, operatorList, viewport, limits = {}) {
  const ops = library?.OPS ?? {}
  const images = []
  const paths = []
  const fnArray = operatorList?.fnArray
  const argsArray = operatorList?.argsArray
  if (!Array.isArray(fnArray) || !Array.isArray(argsArray)) return { images, paths }
  const pageWidth = Number.isFinite(viewport?.width) ? viewport.width : 612
  const pageHeight = Number.isFinite(viewport?.height) ? viewport.height : 792
  const guardWidth = pageWidth * 4
  const guardHeight = pageHeight * 4
  const imageOps = new Set(
    [
      ops.paintImageXObject,
      ops.paintJpegXObject,
      ops.paintImageMaskXObject,
      ops.paintSolidColorImageMask,
      ops.paintInlineImageXObject,
    ].filter((value) => Number.isInteger(value)),
  )

  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  const push = () => {
    if (stack.length < 256) stack.push(ctm)
  }

  const boxFromUnitSquare = () => {
    const corners = [
      transformPoint(ctm, 0, 0),
      transformPoint(ctm, 1, 0),
      transformPoint(ctm, 0, 1),
      transformPoint(ctm, 1, 1),
    ]
    const xs = corners.map((point) => point[0])
    const ys = corners.map((point) => point[1])
    const box = viewportBox(viewport, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
    return validBox(box)
  }

  const validBox = (box) => {
    if (!box.every(Number.isFinite)) return null
    if (box[2] - box[0] <= 0.5 || box[3] - box[1] <= 0.5) return null
    if (
      box[0] < -guardWidth ||
      box[2] > pageWidth + guardWidth ||
      box[1] < -guardHeight ||
      box[3] > pageHeight + guardHeight
    ) {
      return null
    }
    return box
  }

  for (let index = 0; index < fnArray.length; index += 1) {
    const fn = fnArray[index]
    const args = argsArray[index]
    if (fn === ops.save) {
      push()
    } else if (fn === ops.restore) {
      ctm = stack.pop() ?? ctm
    } else if (fn === ops.transform) {
      if (Array.isArray(args) && args.length === 6 && args.every(Number.isFinite)) {
        ctm = multiply(ctm, args)
      }
    } else if (fn === ops.paintFormXObjectBegin) {
      push()
      const matrix = args?.[0]
      if (Array.isArray(matrix) && matrix.length === 6 && matrix.every(Number.isFinite)) {
        ctm = multiply(ctm, matrix)
      }
    } else if (fn === ops.paintFormXObjectEnd) {
      ctm = stack.pop() ?? ctm
    } else if (imageOps.has(fn)) {
      const box = boxFromUnitSquare()
      if (box !== null) images.push(box)
    } else if (fn === ops.constructPath) {
      const pdfBox = pathBoundingBox(args)
      if (pdfBox === null) continue
      const corners = [
        transformPoint(ctm, pdfBox[0], pdfBox[1]),
        transformPoint(ctm, pdfBox[2], pdfBox[1]),
        transformPoint(ctm, pdfBox[0], pdfBox[3]),
        transformPoint(ctm, pdfBox[2], pdfBox[3]),
      ]
      const xs = corners.map((point) => point[0])
      const ys = corners.map((point) => point[1])
      const box = validBox(
        viewportBox(viewport, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)),
      )
      if (box !== null) paths.push(box)
    }
  }

  return { images, paths }
}

/**
 * Single-linkage clustering of artwork boxes. Two boxes belong together when
 * their axis-aligned gap on both axes is at most `gap`.
 *
 * The sweep keeps only boxes whose vertical extent can still touch the current
 * row, which is what makes a heat map with a thousand cells cheap: a cell is
 * compared with its own row band, not with every other box on the page.
 */
export function clusterArtworkBoxes(boxes, options = {}) {
  const gap = Number.isFinite(options.gap) ? Math.max(0, options.gap) : DEFAULT_LIMITS.clusterGap
  const items = (Array.isArray(boxes) ? boxes : []).filter(
    (box) =>
      Array.isArray(box) &&
      box.length === 4 &&
      box.every(Number.isFinite) &&
      box[2] > box[0] &&
      box[3] > box[1],
  )
  if (items.length === 0) return []
  const parent = items.map((_, index) => index)
  const find = (index) => {
    let root = index
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]]
      root = parent[root]
    }
    return root
  }
  const union = (left, right) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
  }

  const order = items.map((_, index) => index).sort((left, right) => items[left][1] - items[right][1])
  let active = []
  for (const index of order) {
    const box = items[index]
    const minBottom = box[1] - gap
    // Drop boxes that end above this row: they cannot touch this box or any
    // later one because the sweep only moves downwards.
    let write = 0
    for (const other of active) {
      if (items[other][3] >= minBottom) {
        active[write] = other
        write += 1
      }
    }
    active.length = write
    for (const other of active) {
      const peer = items[other]
      const dx = Math.max(0, Math.max(box[0], peer[0]) - Math.min(box[2], peer[2]))
      if (dx <= gap) union(other, index)
    }
    active.push(index)
  }

  const groups = new Map()
  for (let index = 0; index < items.length; index += 1) {
    const root = find(index)
    const group = groups.get(root)
    if (group === undefined) groups.set(root, [index])
    else group.push(index)
  }

  const clusters = []
  for (const indexes of groups.values()) {
    const members = indexes.map((index) => items[index])
    const box = unionBox(members)
    const ink = members.reduce((sum, member) => sum + boxArea(member), 0)
    clusters.push({
      bbox: box,
      count: members.length,
      solidCount: members.filter(
        (member) =>
          member[2] - member[0] >= SOLID_MIN_SIDE && member[3] - member[1] >= SOLID_MIN_SIDE,
      ).length,
      ink,
      boxes: members,
    })
  }
  clusters.sort((left, right) => boxArea(right.bbox) - boxArea(left.bbox))
  return clusters
}

/**
 * Vertical and horizontal rules that span most of a cluster mean a table
 * grid, not a chart. Filled cells alone (a striped table) are still possible,
 * so the rule must dominate the cluster's path count.
 */
function looksLikeTableRuling(cluster) {
  const [x0, y0, x1, y1] = cluster.bbox
  const width = x1 - x0
  const height = y1 - y0
  if (width <= 0 || height <= 0) return false
  let horizontal = 0
  let vertical = 0
  for (const box of cluster.boxes) {
    const boxWidth = box[2] - box[0]
    const boxHeight = box[3] - box[1]
    if (boxHeight <= SOLID_MIN_SIDE && boxWidth >= width * 0.5) horizontal += 1
    else if (boxWidth <= SOLID_MIN_SIDE && boxHeight >= height * 0.5) vertical += 1
  }
  if (horizontal < 3 || vertical < 3) return false
  return cluster.solidCount < Math.max(3, cluster.count * 0.3)
}

function regionFromBox(box, source, extra = {}) {
  return {
    bbox: [box[0], box[1], box[2], box[3]],
    source,
    ...extra,
  }
}

function mergeRegions(regions) {
  const remaining = [...regions].sort((left, right) => boxArea(right.bbox) - boxArea(left.bbox))
  let merged = true
  while (merged) {
    merged = false
    outer: for (let left = 0; left < remaining.length; left += 1) {
      for (let right = left + 1; right < remaining.length; right += 1) {
        const first = remaining[left]
        const second = remaining[right]
        const dx = Math.max(
          0,
          Math.max(first.bbox[0], second.bbox[0]) - Math.min(first.bbox[2], second.bbox[2]),
        )
        const dy = Math.max(
          0,
          Math.max(first.bbox[1], second.bbox[1]) - Math.min(first.bbox[3], second.bbox[3]),
        )
        const overlapping = overlapRatio(first.bbox, second.bbox) >= 0.5
        if (!overlapping && (dx > 2 || dy > 2)) continue
        // The crop must cover the whole merged artwork. Vector regions carry
        // no image box, so unioning image boxes alone would cut off a vector
        // panel next to a bitmap one; the merged bbox is the complete overlap.
        const bbox = unionBox([first.bbox, second.bbox])
        const hasImage = first.imageBox !== undefined || second.imageBox !== undefined
        remaining[left] = {
          bbox,
          source: first.source === second.source ? first.source : 'mixed',
          imageBox: hasImage ? [...bbox] : undefined,
          pathCount: (first.pathCount ?? 0) + (second.pathCount ?? 0),
        }
        remaining.splice(right, 1)
        merged = true
        break outer
      }
    }
  }
  return remaining
}

/**
 * Turn raw artwork measurements into figure regions.
 *
 * `artwork` is `{images, paths}` as produced by `artworkFromOperatorList`.
 */
export function detectFigureRegions(artwork, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options }
  const pageWidth = Number.isFinite(options.pageWidth) ? options.pageWidth : 612
  const pageHeight = Number.isFinite(options.pageHeight) ? options.pageHeight : 792
  const pageArea = Math.max(1, pageWidth * pageHeight)
  const images = Array.isArray(artwork?.images) ? artwork.images : []
  const paths = Array.isArray(artwork?.paths) ? artwork.paths : []

  const imageRegions = []
  for (const box of images) {
    const width = box[2] - box[0]
    const height = box[3] - box[1]
    if (width < limits.minImageSide || height < limits.minImageSide) continue
    if (boxArea(box) < pageArea * limits.minImageAreaRatio) continue
    // A scan is the whole page, not a figure; leave it to the "no text" state.
    if (boxArea(box) > pageArea * 0.9) continue
    imageRegions.push(regionFromBox(box, 'image', { imageBox: [...box] }))
  }

  const vectorRegions = []
  for (const cluster of clusterArtworkBoxes(paths, { gap: limits.clusterGap })) {
    const [x0, y0, x1, y1] = cluster.bbox
    const width = x1 - x0
    const height = y1 - y0
    const area = width * height
    if (width < limits.minVectorWidth || height < limits.minVectorHeight) continue
    if (area < pageArea * limits.minVectorAreaRatio) continue
    if (area > pageArea * 0.85) continue
    if (cluster.count < limits.minVectorPaths) continue
    if (cluster.solidCount < limits.minVectorSolid) continue
    if (looksLikeTableRuling(cluster)) continue
    vectorRegions.push(
      regionFromBox(cluster.bbox, 'vector', { pathCount: cluster.count }),
    )
  }

  return mergeRegions([...imageRegions, ...vectorRegions]).sort(
    (left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0],
  )
}

function captionInfo(text) {
  const match = String(text ?? '').trim().match(FIGURE_CAPTION_RE)
  if (match === null) return null
  return { number: match[1], text: String(text).trim() }
}

/**
 * Attach text atoms to the artwork that contains them and group them into
 * label lines.
 *
 * Attribution works on visual rows, not single atoms: a row whose text mostly
 * falls inside a figure (a chart's tick labels, a diagram's header) belongs to
 * the figure even when its last token spills a few points past the artwork
 * edge. Rows outside the figure keep flowing into paragraphs.
 *
 * Returns `{figures, atomIds}`. Each figure keeps its artwork box, the union
 * box of artwork and labels, the label lines and the nearest caption below.
 */
export function assignFigureLabels(atoms, regions, options = {}) {
  const bodySize = Number.isFinite(options.bodySize) ? options.bodySize : 10
  const row = Number.isFinite(options.rowThreshold) ? options.rowThreshold : 0.6
  const marginX =
    Number.isFinite(options.marginX) ? options.marginX : Math.max(4, bodySize * 1.6)
  const marginY =
    Number.isFinite(options.marginY) ? options.marginY : Math.max(3, bodySize * 1.4)
  const atomIds = new Set()
  const figures = []
  const list = Array.isArray(atoms) ? atoms : []
  const areas = (Array.isArray(regions) ? regions : []).filter(
    (region) => Array.isArray(region?.bbox) && region.bbox.length === 4,
  )

  if (areas.length === 0) return { figures, atomIds }

  const rows = buildTextRows(list, { bodySize })
  const owners = areas.map(() => [])
  for (const textRow of rows) {
    const items = textRow.items.filter(
      (atom) => atom !== null && typeof atom === 'object' && String(atom.text ?? '').trim() !== '',
    )
    if (items.length === 0) continue
    // A caption is prose that names the figure; it must stay translatable.
    if (captionInfo(textRow.text) !== null) continue
    let best = -1
    let bestRatio = 0
    for (let index = 0; index < areas.length; index += 1) {
      const region = areas[index].bbox
      const left = region[0] - marginX
      const right = region[2] + marginX
      let inside = 0
      for (const atom of items) {
        const box = atomBox(atom)
        const centerX = (box[0] + box[2]) / 2
        const centerY = (box[1] + box[3]) / 2
        const coverage = intersectionArea(box, [left, region[1], right, region[3]]) / boxArea(box)
        const centerInside =
          centerX >= left && centerX <= right && centerY >= region[1] && centerY <= region[3]
        // A figure title sits a line above its own artwork. Horizontal overlap
        // plus a small vertical gap is enough; requiring box intersection would
        // demand a margin as tall as the text itself.
        const verticalGap = Math.max(
          0,
          region[1] - box[3],
          box[1] - region[3],
        )
        const horizontalOverlap =
          Math.min(box[2], right) - Math.max(box[0], left)
        const alignedAboveOrBelow =
          verticalGap <= marginY && horizontalOverlap >= (box[2] - box[0]) * 0.5
        if (coverage >= 0.5 || centerInside || alignedAboveOrBelow) {
          inside += 1
        }
      }
      const ratio = inside / items.length
      if (ratio > bestRatio) {
        bestRatio = ratio
        best = index
      }
    }
    if (best >= 0 && bestRatio >= row) owners[best].push(...items)
  }

  for (let index = 0; index < areas.length; index += 1) {
    const region = areas[index]
    const labels = labelLines(owners[index], bodySize)
    const kept = labels.filter((line) => captionInfo(line.text) === null)
    const bbox = unionBox([region.bbox, ...kept.map((line) => line.bbox)])
    const caption = findCaption(rows, bbox)
    figures.push({
      bbox,
      imageBbox: region.imageBox ?? region.bbox,
      source: region.source ?? 'vector',
      labels: kept,
      caption,
      number: caption?.number ?? null,
      labelCount: kept.length,
    })
    for (const line of kept) {
      for (const atom of line.atoms) atomIds.add(atom.index)
    }
  }

  return { figures, atomIds }
}

function labelLines(atoms, bodySize) {
  const sorted = [...atoms].sort((left, right) => left.y - right.y || left.x - right.x)
  const lines = []
  let current
  const flush = () => {
    if (current === undefined) return
    const items = [...current.items].sort((left, right) => left.x - right.x)
    let text = ''
    let previous
    for (const atom of items) {
      const value = atom.text.replace(/\s+/g, ' ').trim()
      if (value === '') continue
      if (previous === undefined) {
        text = value
      } else {
        const gap = atom.x - previous.endX
        text = gap > Math.max(1.2, Math.max(atom.height, previous.height) * 0.18)
          ? `${text} ${value}`
          : `${text}${value}`
      }
      previous = atom
    }
    if (text !== '') {
      lines.push({ text, bbox: unionBox(items.map(atomBox)), atoms: items })
    }
    current = undefined
  }
  for (const atom of sorted) {
    const tolerance = Math.max(1.5, Math.min(atom.height, bodySize) * 0.4)
    if (current === undefined || Math.abs(atom.y - current.baseline) > tolerance) {
      flush()
      current = { baseline: atom.y, items: [atom] }
    } else {
      current.items.push(atom)
    }
  }
  flush()
  return lines.sort((left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0])
}

function findCaption(rows, figureBox) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const candidates = []
  for (const row of rows) {
    // Captions sit below the artwork, but a generous vector box can include the
    // caption itself, so accept rows inside the box as well. 60pt below also
    // reaches a caption shared by two side-by-side panels.
    if (row.bottom < figureBox[1] - 2) continue
    if (row.top > figureBox[3] + 60) continue
    const overlap = Math.min(row.right, figureBox[2]) - Math.max(row.x, figureBox[0])
    if (overlap <= 0) continue
    const info = captionInfo(row.text)
    if (info === null) continue
    candidates.push({
      distance: Math.abs(row.top - figureBox[3]),
      number: info.number,
      text: info.text,
      bbox: [row.x, row.top, row.right, row.bottom],
    })
  }
  if (candidates.length === 0) return null
  candidates.sort((left, right) => left.distance - right.distance)
  const { number, text, bbox } = candidates[0]
  return { number, text, bbox }
}

/**
 * Collect figure regions for one page. The operator list is the only source
 * that knows where the page's artwork is, so a failure here degrades to "no
 * figures" and never blocks reading.
 */
export async function collectFigureRegions(page, library, viewport, options = {}) {
  if (typeof page?.getOperatorList !== 'function') return []
  let operatorList
  try {
    operatorList = await page.getOperatorList()
  } catch {
    return []
  }
  if (!Array.isArray(operatorList?.fnArray)) return []
  const limits = { ...DEFAULT_LIMITS, ...options }
  if (operatorList.fnArray.length > limits.maxOperators) return []
  // Figure boxes must stay in scale-1 page points like equation boxes, so the
  // region is measured against a scale-1 viewport even when the caller is
  // parsing a zoomed viewport.
  const base =
    typeof page.getViewport === 'function'
      ? page.getViewport({ scale: 1 })
      : viewport
  const artwork = artworkFromOperatorList(library, operatorList, base, limits)
  return detectFigureRegions(artwork, {
    ...limits,
    pageWidth: base?.width ?? 612,
    pageHeight: base?.height ?? 792,
  })
}
