/**
 * Per-document page caches.
 *
 * The viewer, translation, chat and export all read the same page model, so no
 * entry point can hold a second copy of one page. Models are built at scale 1 and
 * are therefore independent of zoom, sidebar width and device pixel ratio; only
 * the raster cache depends on those, and only it is measured in bytes.
 *
 * Eviction is explicit for every kind of entry: models, text items, figure
 * regions and rasters each have their own bound, so a long document cannot pin
 * every page in memory while a short one keeps its rasters.
 */

export const MODEL_CACHE_PAGES = 12
export const TEXT_CACHE_PAGES = 12
// Three rasters cover "previous, current, next" while the byte budget keeps a
// figure-heavy paper from pinning tens of megabytes of ImageBitmaps.
export const RASTER_CACHE_PAGES = 3
export const RASTER_CACHE_BYTES = 48 * 1024 * 1024

/** The caches every opened document owns. */
export function createPageCaches() {
  return {
    pageCache: new Map(),
    textCache: new Map(),
    figureCache: new Map(),
    bitmapCache: new Map(),
    // In-flight extraction, so a page prefetch and a foreground visit share one
    // request instead of starting the same work twice on the same worker.
    textTasks: new Map(),
    figureTasks: new Map(),
  }
}

function shareTask(store, key, factory) {
  if (store === undefined) return Promise.resolve().then(factory)
  const pending = store.get(key)
  if (pending !== undefined) return pending
  const task = Promise.resolve().then(factory)
  store.set(key, task)
  // A failed extraction must be retryable, so the slot is cleared either way.
  const clear = () => {
    if (store.get(key) === task) store.delete(key)
  }
  task.then(clear, clear)
  return task
}

export function shareTextTask(meta, pageIndex, factory) {
  return shareTask(meta?.textTasks, pageIndex, factory)
}

export function shareFigureTask(meta, pageIndex, factory) {
  return shareTask(meta?.figureTasks, pageIndex, factory)
}

function readCached(map, key) {
  const value = map?.get(key)
  if (value === undefined) return undefined
  // Re-insert so Map insertion order doubles as the LRU order.
  map.delete(key)
  map.set(key, value)
  return value
}

function writeCached(map, key, value, limit) {
  if (map === undefined) return value
  map.delete(key)
  map.set(key, value)
  while (map.size > limit) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
  return value
}

export function readModel(meta, pageIndex) {
  return readCached(meta?.pageCache, pageIndex)
}

export function writeModel(meta, pageIndex, model) {
  return writeCached(meta?.pageCache, pageIndex, model, MODEL_CACHE_PAGES)
}

export function invalidateModel(meta, pageIndex) {
  meta?.pageCache?.delete(pageIndex)
}

export function readText(meta, pageIndex) {
  return readCached(meta?.textCache, pageIndex)
}

export function writeText(meta, pageIndex, textContent) {
  return writeCached(meta?.textCache, pageIndex, textContent, TEXT_CACHE_PAGES)
}

export function readFigures(meta, pageIndex) {
  return readCached(meta?.figureCache, pageIndex)
}

export function writeFigures(meta, pageIndex, regions) {
  return writeCached(meta?.figureCache, pageIndex, regions, MODEL_CACHE_PAGES)
}

/** Release one raster's pixels; closing a closed bitmap must stay harmless. */
export function releaseRaster(entry) {
  try {
    entry?.bitmap?.close?.()
  } catch {
    // A released or already closed bitmap must not break paging.
  }
}

function rasterBytes(store) {
  let bytes = 0
  for (const entry of store.values()) bytes += entry.bytes
  return bytes
}

export function readRaster(meta, pageIndex) {
  return readCached(meta?.bitmapCache, pageIndex)
}

/**
 * Whether a prefetched page is still worth writing.
 *
 * Reading forward is the primary path, so read-ahead exists for the page in front
 * of the reader and for the page just arrived at. Once the reader has moved
 * elsewhere, storing that raster would evict a page they are more likely to need
 * next turn.
 */
export function lookaheadIsUseful(targetPage, currentPage) {
  return targetPage === currentPage || targetPage === currentPage + 1
}

/**
 * Whether a raster of this pixel size can be stored at all.
 *
 * Callers check this *before* rendering, so a page that is too large for the
 * budget is not drawn once for the cache and once more for the reader.
 */
export function rasterFitsBudget(pixelWidth, pixelHeight) {
  if (!(pixelWidth > 0) || !(pixelHeight > 0)) return false
  return pixelWidth * pixelHeight * 4 <= RASTER_CACHE_BYTES
}

/**
 * Store one page raster under the count and byte budgets.
 *
 * Two rules keep the cache useful:
 *
 * - an oversized raster is rejected *before* anything is evicted, because dropping
 *   every cached page to then discard the newcomer leaves the reader with none;
 * - a raster from an older capture of the same page (`version`) is rejected after
 *   the render it belongs to was superseded, so a fast 1 → 2 → 1 cannot replace a
 *   fresh raster with a stale one.
 *
 * Entries without a `version` are accepted in write order.
 */
export function writeRaster(meta, pageIndex, entry) {
  const store = meta?.bitmapCache
  if (store === undefined) return undefined
  const sized = {
    ...entry,
    bytes: entry.bytes ?? (entry.bitmap?.width ?? 0) * (entry.bitmap?.height ?? 0) * 4,
  }
  const previous = store.get(pageIndex)
  if (
    previous !== undefined &&
    previous.version !== undefined &&
    sized.version !== undefined &&
    previous.version > sized.version
  ) {
    releaseRaster(sized)
    return previous
  }
  if (sized.bytes > RASTER_CACHE_BYTES) {
    // Keep what is already cached: this page stays on screen but does not fit.
    releaseRaster(sized)
    return previous
  }
  if (previous !== undefined && previous !== sized) releaseRaster(previous)
  store.delete(pageIndex)
  store.set(pageIndex, sized)
  while (store.size > RASTER_CACHE_PAGES) {
    const oldest = store.keys().next().value
    if (oldest === undefined || oldest === pageIndex) break
    releaseRaster(store.get(oldest))
    store.delete(oldest)
  }
  while (store.size > 1 && rasterBytes(store) > RASTER_CACHE_BYTES) {
    const oldest = store.keys().next().value
    if (oldest === undefined || oldest === pageIndex) break
    releaseRaster(store.get(oldest))
    store.delete(oldest)
  }
  return sized
}

/** Drop every cached page of one document, releasing raster pixels. */
export function disposeCaches(meta) {
  if (meta === null || meta === undefined) return
  const store = meta.bitmapCache
  if (store !== undefined) {
    for (const entry of store.values()) releaseRaster(entry)
    store.clear()
  }
  meta.pageCache?.clear?.()
  meta.textCache?.clear?.()
  meta.figureCache?.clear?.()
  meta.textTasks?.clear?.()
  meta.figureTasks?.clear?.()
}
