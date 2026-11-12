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

export const FIGURE_CAPTION_RE = /^(?:figure|fig\.|图)\s*([0-9]{1,3}[a-z]?)\b/i
export const TABLE_CAPTION_RE = /^(?:table|tab\.|表)\s*([0-9]{1,3}[a-z]?)\b/i

/**
 * Captions of both kinds stay translatable paragraphs, so attribution must
 * recognise either one before a row can become a label.
 */
function captionOf(text) {
  const value = String(text ?? '').trim()
  const table = value.match(TABLE_CAPTION_RE)
  if (table !== null) return { kind: 'table', number: table[1], text: value }
  const figure = value.match(FIGURE_CAPTION_RE)
  if (figure !== null) return { kind: 'figure', number: figure[1], text: value }
  return null
}

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
 *
 * The result is a classification signal, not a rejection: a ruled table is
 * still a useful crop, it just has to be labelled and grown as a table.
 */
function tableRuleStats(cluster) {
  const [x0, y0, x1, y1] = cluster.bbox
  const width = x1 - x0
  const height = y1 - y0
  if (width <= 0 || height <= 0) return { horizontal: 0, vertical: 0, gridLike: false }
  let horizontal = 0
  let vertical = 0
  for (const box of cluster.boxes) {
    const boxWidth = box[2] - box[0]
    const boxHeight = box[3] - box[1]
    if (boxHeight <= SOLID_MIN_SIDE && boxWidth >= width * 0.5) horizontal += 1
    else if (boxWidth <= SOLID_MIN_SIDE && boxHeight >= height * 0.5) vertical += 1
  }
  const ruled = horizontal >= 3 && vertical >= 3
  return {
    horizontal,
    vertical,
    gridLike: ruled && cluster.solidCount < Math.max(3, cluster.count * 0.3),
  }
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
        const overlapping = first.ruleOnly === true || second.ruleOnly === true
          ? first.ruleOnly === true && second.ruleOnly === true
          : true
        if (!overlapping) continue
        const overlappingBox = overlapRatio(first.bbox, second.bbox) >= 0.5
        if (!overlappingBox && (dx > 2 || dy > 2)) continue
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
          tableCandidate: first.tableCandidate === true || second.tableCandidate === true,
          ruleOnly: first.ruleOnly === true && second.ruleOnly === true,
          horizontalRules:
            (first.horizontalRules ?? 0) + (second.horizontalRules ?? 0),
          verticalRules: (first.verticalRules ?? 0) + (second.verticalRules ?? 0),
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
 * Booktabs tables have no vertical rules, so their horizontal rules never
 * cluster (each rule is a thin, isolated path). Group rules that share a
 * horizontal span and sit close enough vertically into a table candidate.
 */
function wideRuleTableCandidates(paths, pageWidth, pageHeight) {
  const rules = paths.filter(
    (box) => box[3] - box[1] <= SOLID_MIN_SIDE && box[2] - box[0] >= pageWidth * 0.3,
  )
  if (rules.length < 3) return []
  rules.sort((left, right) => left[1] - right[1])
  const groups = []
  for (const rule of rules) {
    let target
    for (const group of groups) {
      const overlap = Math.min(group.bbox[2], rule[2]) - Math.max(group.bbox[0], rule[0])
      const width = Math.min(group.bbox[2] - group.bbox[0], rule[2] - rule[0])
      if (overlap < width * 0.6) continue
      if (rule[1] - group.bbox[3] > pageHeight * 0.32) continue
      target = group
      break
    }
    if (target === undefined) {
      groups.push({ bbox: [...rule], count: 1 })
    } else {
      target.bbox = unionBox([target.bbox, rule])
      target.count += 1
    }
  }
  return groups
    .filter((group) => group.count >= 3 && group.bbox[3] - group.bbox[1] >= 30)
    .map((group) =>
      regionFromBox(group.bbox, 'vector', {
        pathCount: group.count,
        tableCandidate: true,
        ruleOnly: true,
        horizontalRules: group.count,
        verticalRules: 0,
      }),
    )
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
    const rules = tableRuleStats(cluster)
    // Only a ruled grid is a table by itself. A chart can also draw many
    // horizontal gridlines, so horizontal rules alone must not turn artwork
    // into a table; captions handle those cases.
    const tableCandidate = rules.gridLike
    if (tableCandidate) {
      if (cluster.count < 3) continue
    } else {
      if (cluster.count < limits.minVectorPaths) continue
      if (cluster.solidCount < limits.minVectorSolid) continue
    }
    vectorRegions.push(
      regionFromBox(cluster.bbox, 'vector', {
        pathCount: cluster.count,
        tableCandidate,
        horizontalRules: rules.horizontal,
        verticalRules: rules.vertical,
      }),
    )
  }

  const ruleTables = wideRuleTableCandidates(paths, pageWidth, pageHeight).filter(
    (candidate) =>
      !vectorRegions.some(
        (region) =>
          region.tableCandidate === true && overlapRatio(region.bbox, candidate.bbox) > 0.5,
      ),
  )
  return mergeRegions([...imageRegions, ...vectorRegions, ...ruleTables]).sort(
    (left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0],
  )
}

/**
 * Caption first lines plus their wrapped continuation lines, which must stay
 * in the translatable text flow and never become figure labels.
 */
function captionRowsOf(rows, bodySize) {
  const ordered = [...rows].sort((left, right) => left.top - right.top)
  const set = new Set()
  for (let index = 0; index < ordered.length; index += 1) {
    if (captionOf(ordered[index].text) === null) continue
    set.add(ordered[index])
    let previous = ordered[index]
    for (let next = index + 1; next < ordered.length; next += 1) {
      const row = ordered[next]
      const gap = row.top - previous.bottom
      if (gap < -1 || gap > bodySize * 1.4) break
      if (captionOf(row.text) !== null) {
        set.add(row)
        previous = row
        continue
      }
      if (/[.!?。！？:：]$/.test(previous.text.trim())) break
      set.add(row)
      previous = row
    }
  }
  return set
}

function rowBox(row) {
  return [row.x, row.top, row.right, row.bottom]
}

function rowHorizontalOverlap(box, row) {
  const overlap = Math.min(box[2], row.right) - Math.max(box[0], row.x)
  return overlap / Math.max(1, row.right - row.x)
}

/**
 * A row belongs to a table when it has the cell structure of one: several
 * wide inter-column gaps, or one wide gap plus numeric content. Body prose has
 * ordinary word spaces and is rejected, which is what stops growth at the
 * paragraph after a table.
 */
function isTableRow(row, bodySize) {
  const items = Array.isArray(row?.items)
    ? row.items.filter(
        (atom) => atom !== null && typeof atom === 'object' && String(atom.text ?? '').trim() !== '',
      )
    : []
  if (items.length === 0) return false
  const text = String(row.text ?? '')
  if (text.length > 240) return false
  const gapFloor = Math.max(7, bodySize * 1.1)
  let wideGaps = 0
  for (let index = 1; index < items.length; index += 1) {
    if (items[index].x - items[index - 1].endX >= gapFloor) wideGaps += 1
  }
  if (wideGaps >= 2) return true
  return wideGaps >= 1 && /[0-9]/.test(text)
}

function findCaptionRow(rows, box, regex, maxDistance = 70) {
  const candidates = []
  for (const row of rows) {
    const overlap = Math.min(row.right, box[2]) - Math.max(row.x, box[0])
    if (overlap <= 0) continue
    const distance = captionDistance(box, [row.x, row.top, row.right, row.bottom])
    if (distance > maxDistance) continue
    const match = String(row.text ?? '').trim().match(regex)
    if (match === null) continue
    candidates.push({
      distance,
      number: match[1],
      text: String(row.text).trim(),
      bbox: [row.x, row.top, row.right, row.bottom],
      kind: regex === TABLE_CAPTION_RE ? 'table' : 'figure',
    })
  }
  if (candidates.length === 0) return null
  candidates.sort((left, right) => left.distance - right.distance)
  const { number, text, bbox, kind } = candidates[0]
  return { number, text, bbox, kind }
}

function captionDistance(box, captionBox) {
  return Math.max(0, captionBox[1] - box[3], box[1] - captionBox[3])
}

/**
 * Grow a table crop over the text rows that belong to it.
 *
 * Artwork is often only the coloured header (or the ruled body), so the text
 * rows below are the only evidence of where the table ends. Growth is
 * conservative: a row must look like a table row, sit within a normal row gap,
 * overlap the current box and not belong to another detected region.
 */
function growTableBox(rows, region, options = {}) {
  const bodySize = Number.isFinite(options.bodySize) ? options.bodySize : 10
  const pageWidth = Number.isFinite(options.pageWidth) ? options.pageWidth : 612
  const pageHeight = Number.isFinite(options.pageHeight) ? options.pageHeight : 792
  const barriers = Array.isArray(options.barriers) ? options.barriers : []
  const box = [...region.bbox]
  const maxGap = Math.max(6, bodySize * 2.6)
  const limit = Math.min(pageHeight, region.bbox[1] + Math.max(180, pageHeight * 0.7))
  let guard = 0
  while (guard < 400) {
    guard += 1
    let next
    for (const row of rows) {
      if (row.top < box[3] - 0.8) continue
      if (row.top - box[3] > maxGap) continue
      if (rowHorizontalOverlap(box, row) < 0.45) continue
      if (captionOf(row.text) !== null) continue
      if (next === undefined || row.top < next.top) next = row
    }
    if (next === undefined) break
    if (next.bottom > limit) break
    if (!isTableRow(next, bodySize)) break
    const candidate = rowBox(next)
    if (barriers.some((barrier) => overlapRatio(candidate, barrier) > 0.3)) break
    box[0] = Math.max(0, Math.min(box[0], next.x - 1))
    box[1] = Math.max(0, Math.min(box[1], next.top - 1))
    box[2] = Math.min(pageWidth, Math.max(box[2], next.right + 1))
    box[3] = Math.max(box[3], next.bottom + 1)
  }
  return box
}

/**
 * Rebuild visual rows from atoms by baseline, ignoring content-stream order.
 * Table cells are often emitted column by column, so `buildTextRows` (which
 * follows stream order) fragments a table row into several pieces.
 */
function visualRowsFromAtoms(atoms, bodySize) {
  const list = (Array.isArray(atoms) ? atoms : []).filter(
    (atom) =>
      atom !== null &&
      typeof atom === 'object' &&
      typeof atom.text === 'string' &&
      atom.text.trim() !== '' &&
      Number.isFinite(atom.x) &&
      Number.isFinite(atom.y),
  )
  const tolerance = Math.max(1.4, bodySize * 0.45)
  const rows = []
  for (const atom of [...list].sort((left, right) => left.y - right.y)) {
    let row = rows[rows.length - 1]
    if (row === undefined || Math.abs(row.baseline - atom.y) > tolerance) {
      row = { baseline: atom.y, items: [] }
      rows.push(row)
    }
    row.items.push(atom)
  }
  for (const row of rows) {
    row.items.sort((left, right) => left.x - right.x)
    let text = ''
    let previous
    for (const atom of row.items) {
      const value = atom.text.replace(/\s+/g, ' ').trim()
      if (value === '') continue
      if (previous === undefined) {
        text = value
      } else {
        const gap = atom.x - previous.endX
        text =
          gap > Math.max(1.2, Math.max(atom.height, previous.height) * 0.18)
            ? `${text} ${value}`
            : `${text}${value}`
      }
      previous = atom
    }
    row.text = text
    row.x = Math.min(...row.items.map((atom) => atom.x))
    row.right = Math.max(...row.items.map((atom) => atom.endX))
    row.top = Math.min(...row.items.map((atom) => atom.top))
    row.bottom = Math.max(...row.items.map((atom) => atom.bottom))
    row.height = Math.max(1, row.bottom - row.top)
  }
  return rows.filter((row) => row.text !== '')
}

/**
 * Find tables that have no artwork at all: a "Table N" caption followed by
 * several rows of aligned cells. Text-only tables are common in papers and are
 * invisible to the operator-list detector, so they are discovered from their
 * text rows.
 */
function detectTextTables(rows, options = {}) {
  const bodySize = Number.isFinite(options.bodySize) ? options.bodySize : 10
  const pageWidth = Number.isFinite(options.pageWidth) ? options.pageWidth : 612
  const maxGap = Math.max(6, bodySize * 2.6)
  const ordered = [...rows].sort((left, right) => left.top - right.top)
  const tables = []

  const collect = (captionIndex, direction) => {
    const captionRow = ordered[captionIndex]
    const candidates = ordered.filter((row, index) => {
      if (index === captionIndex) return false
      return direction > 0 ? row.top >= captionRow.bottom - 1 : row.bottom <= captionRow.top + 1
    })
    if (direction < 0) candidates.reverse()
    const run = []
    const pendingHeaders = []
    let tabular = 0
    let cursor = direction > 0 ? captionRow.bottom : captionRow.top
    let runBox = rowBox(captionRow)
    for (const row of candidates) {
      const gap = direction > 0 ? row.top - cursor : cursor - row.bottom
      if (gap < -1) continue
      const limit = run.length === 0 ? Math.max(bodySize * 10, 48) : maxGap
      if (gap > limit) break
      if (captionOf(row.text) !== null) break
      if (row.height > bodySize * 1.6) break
      if (!isTableRow(row, bodySize)) {
        if (run.length === 0 && gap <= bodySize * 2.5) {
          pendingHeaders.push(row)
          cursor = direction > 0 ? row.bottom : row.top
          continue
        }
        if (run.length === 0 && row.text.length <= 160 && !/[.!?。！？]$/.test(row.text.trim())) {
          pendingHeaders.push(row)
          cursor = direction > 0 ? row.bottom : row.top
          continue
        }
        if (run.length > 0 && row.text.length <= 40) {
          // A wrapped header cell ("Operations" below "Sequential") or a
          // superscript fragment belongs to the crop but is not a row.
          runBox = unionBox([runBox, rowBox(row)])
          run.push(row)
          cursor = direction > 0 ? row.bottom : row.top
          continue
        }
        break
      }
      if (run.length > 0 && rowHorizontalOverlap(runBox, row) < 0.5 && gap > bodySize * 0.5) break
      if (run.length === 0) runBox = rowBox(row)
      else runBox = unionBox([runBox, rowBox(row)])
      run.push(row)
      tabular += 1
      cursor = direction > 0 ? row.bottom : row.top
    }
    if (tabular >= 3) {
      for (const header of pendingHeaders) {
        const hasColumnGap = header.items.some(
          (item, index) =>
            index > 0 && item.x - header.items[index - 1].endX >= Math.max(7, bodySize * 1.1),
        )
        if (hasColumnGap && rowHorizontalOverlap(runBox, header) >= 0.5) {
          run.push(header)
        }
      }
    }
    return { run, tabular }
  }

  for (let index = 0; index < ordered.length; index += 1) {
    const caption = ordered[index].text.trim().match(TABLE_CAPTION_RE)
    if (caption === null) continue
    const below = collect(index, 1)
    const above = collect(index, -1)
    const pick = below.tabular >= above.tabular ? below : above
    const run = pick.run
    if (pick.tabular < 3) continue
    if (run.length === 0) continue
    const box = unionBox(run.map(rowBox))
    if (box[2] - box[0] < pageWidth * 0.22) continue
    if (!run.some((row) => /[0-9]/.test(row.text))) continue
    // At least two columns must be shared by several rows.
    const columnKeys = new Map()
    for (const row of run) {
      const seen = new Set()
      for (const atom of row.items) {
        const key = Math.round(atom.x / Math.max(4, bodySize * 1.5))
        if (seen.has(key)) continue
        seen.add(key)
        columnKeys.set(key, (columnKeys.get(key) ?? 0) + 1)
      }
    }
    const sharedColumns = [...columnKeys.values()].filter((count) => count >= 2).length
    if (sharedColumns < 2) continue
    const padded = [
      Math.max(0, box[0] - 2),
      Math.max(0, box[1] - 2),
      Math.min(pageWidth, box[2] + 2),
      box[3] + 2,
    ]
    tables.push({
      bbox: padded,
      imageBox: padded,
      source: 'text',
      tableCandidate: true,
      kind: 'table',
      caption: {
        kind: 'table',
        number: caption[1],
        text: ordered[index].text.trim(),
        bbox: [ordered[index].x, ordered[index].top, ordered[index].right, ordered[index].bottom],
      },
    })
  }
  return tables
}

/**
 * Decide whether each detected region is a figure or a table, and expand table
 * regions over their text body.
 *
 * A ruled grid is already a table signal. A coloured header with no rules is
 * not, but its "Table N" caption identifies it; that is the case where the old
 * classifier produced a header-only figure.
 */
export function classifyRegions(atoms, regions, options = {}) {
  const bodySize = Number.isFinite(options.bodySize) ? options.bodySize : 10
  const pageWidth = Number.isFinite(options.pageWidth) ? options.pageWidth : 612
  const pageHeight = Number.isFinite(options.pageHeight) ? options.pageHeight : 792
  const rows = buildTextRows(Array.isArray(atoms) ? atoms : [], { bodySize })
  const visualRows = visualRowsFromAtoms(atoms, bodySize)
  const list = (Array.isArray(regions) ? regions : []).filter(
    (region) => Array.isArray(region?.bbox) && region.bbox.length === 4,
  )
  // Text-only tables have no artwork region at all. Add them, and mark an
  // overlapping artwork region as a table instead of producing two cards.
  const removed = Array.isArray(options.removed) ? options.removed : []
  for (const found of detectTextTables(visualRows, { bodySize, pageWidth, pageHeight })) {
    // "Not a figure" also has to suppress a text-only table, which is
    // discovered from text and therefore never passed through the removal
    // filter for artwork regions.
    if (removed.some((box) => overlapRatio(box, found.bbox) > 0.3)) continue
    const existing = list.find(
      (region) =>
        overlapRatio(region.bbox, found.bbox) > 0.5 ||
        (region.source === 'manual' &&
          (overlapRatio(region.bbox, found.bbox) > 0.3 ||
            (Array.isArray(region.replaces) && overlapRatio(region.replaces, found.bbox) > 0.3))),
    )
    if (existing !== undefined) {
      if (existing.source === 'manual') continue
      existing.tableCandidate = true
      if (existing.caption === undefined) existing.caption = found.caption
      continue
    }
    list.push(found)
  }
  const boxes = list.map((region) => region.bbox)
  const classified = list
    .map((region, index) => {
      const figureCaption = findCaptionRow(rows, region.bbox, FIGURE_CAPTION_RE)
      const tableCaption = findCaptionRow(rows, region.bbox, TABLE_CAPTION_RE)
      const tableish =
        region.tableCandidate === true ||
        region.kind === 'table' ||
        (tableCaption !== null &&
          (figureCaption === null ||
            captionDistance(region.bbox, tableCaption.bbox) <
              captionDistance(region.bbox, figureCaption.bbox)))
      if (!tableish) {
        return {
          ...region,
          kind: 'figure',
          caption: region.caption ?? figureCaption,
        }
      }
      const caption = tableCaption ?? region.caption ?? null
      // Horizontal rules are also how bar charts draw gridlines. Without a
      // caption, a rules-only region is only a table when its own text rows
      // have table structure; otherwise drop it instead of mislabelling a
      // chart.
      if (region.ruleOnly === true && caption === null) {
        const tabularRows = visualRows.filter(
          (row) =>
            row.top >= region.bbox[1] - 2 &&
            row.bottom <= region.bbox[3] + 2 &&
            rowHorizontalOverlap(region.bbox, row) >= 0.35 &&
            isTableRow(row, bodySize),
        ).length
        if (tabularRows < 3) return null
      }
      const fixed = region.source === 'manual' || region.source === 'text'
      const expanded = fixed
        ? region.bbox
        : growTableBox(visualRows, region, {
            bodySize,
            pageWidth,
            pageHeight,
            barriers: boxes.filter((_, other) => other !== index),
          })
      return {
        ...region,
        bbox: expanded,
        imageBox: fixed ? region.imageBox ?? expanded : expanded,
        kind: 'table',
        caption,
      }
    })
    .filter((region) => region !== null)
  // A coloured header plus a separately detected rule table describe the same
  // table. Keep the larger table and drop a figure that is only its artwork.
  const tables = classified.filter((region) => region.kind === 'table')
  const keptTables = tables.filter(
    (table) =>
      !tables.some(
        (other) =>
          other !== table &&
          overlapRatio(other.bbox, table.bbox) > 0.8 &&
          boxArea(other.bbox) > boxArea(table.bbox),
      ),
  )
  const figures = classified
    .filter((region) => region.kind !== 'table')
    .filter(
      (figure) =>
        !keptTables.some(
          (table) =>
            overlapRatio(table.bbox, figure.bbox) > 0.5 &&
            boxArea(table.bbox) > boxArea(figure.bbox),
        ),
    )
  return [...keptTables, ...figures].sort(
    (left, right) => left.bbox[1] - right.bbox[1] || left.bbox[0] - right.bbox[0],
  )
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
  const captionRows = captionRowsOf(rows, bodySize)
  const owners = areas.map(() => [])
  for (const textRow of rows) {
    const items = textRow.items.filter(
      (atom) => atom !== null && typeof atom === 'object' && String(atom.text ?? '').trim() !== '',
    )
    if (items.length === 0) continue
    // A caption is prose that names the figure or table; it must stay
    // translatable.
    if (captionRows.has(textRow) || captionOf(textRow.text) !== null) continue
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
    const kind = region.kind === 'table' ? 'table' : 'figure'
    const labels = labelLines(owners[index], bodySize)
    const kept = labels.filter((line) => captionOf(line.text) === null)
    const bbox = unionBox([region.bbox, ...kept.map((line) => line.bbox)])
    const caption =
      region.caption ??
      findCaption(rows, bbox, kind === 'table' ? TABLE_CAPTION_RE : FIGURE_CAPTION_RE)
    figures.push({
      bbox,
      imageBbox: region.imageBox ?? region.bbox,
      source: region.source ?? 'vector',
      manualId: region.manualId ?? null,
      kind,
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

function findCaption(rows, figureBox, regex = FIGURE_CAPTION_RE) {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const candidates = []
  for (const row of rows) {
    // Captions usually sit below the artwork, but a generous vector box can
    // include the caption itself, and some journals place it above. 70pt in
    // either direction also reaches a caption shared by two side-by-side
    // panels.
    const distance = captionDistance(figureBox, [row.x, row.top, row.right, row.bottom])
    if (distance > 70) continue
    const overlap = Math.min(row.right, figureBox[2]) - Math.max(row.x, figureBox[0])
    if (overlap <= 0) continue
    const info = String(row.text ?? '').trim().match(regex)
    if (info === null) continue
    candidates.push({
      distance,
      number: info[1],
      text: String(row.text).trim(),
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
