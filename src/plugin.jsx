import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  chatWithPaper,
  fetchHealth,
  fetchModels,
  listSkills,
  loadSkill,
  saveNotes,
  translateSegments,
} from './api'
import { Icon } from './icons'
import {
  buildPageModel,
  drawPdfRaster,
  fileFingerprint,
  findParagraphByAnchor,
  glossaryKey,
  isPdfFile,
  loadPdfJs,
  makeBatches,
  openPdf,
  parseGlossary,
  pdfPixelRatio,
  renderEquationCrop,
  renderPdfPage,
  renderThumbnail,
  resolveOutline,
  supportsRasterSnapshot,
} from './pdf'
import { overlapRatio } from './equations'
import { composeReading } from './article'
import { collectFigureRegions } from './figures'
import {
  createPageCaches,
  disposeCaches,
  invalidateModel,
  lookaheadIsUseful,
  readFigures,
  readModel,
  readRaster,
  readText,
  rasterFitsBudget,
  releaseRaster,
  shareFigureTask,
  shareTextTask,
  writeFigures,
  writeModel,
  writeRaster,
  writeText,
} from './cache'
import { extractReferences } from './references'
import { restorePlaceholders } from '../lib/placeholders.js'
import { createZip, dataUrlToBytes } from './zip'
import { en, translate, zh } from './locales'
import { CSS } from './styles'

const SETTINGS_KEY = 'pdf-math-reader.settings.v1'
const NOTES_KEY = 'pdf-math-reader.notes.v1'
const EQUATIONS_KEY = 'pdf-math-reader.equations.v1'
const PANEL_ID = 'pdf-math-reader'
const EMPTY_OVERRIDES = { added: [], removed: [], figures: [] }
// Sidebar tile: a small raster served by the Host under /pdf-reader/assets/.
const PANEL_ICON = '/pdf-reader/assets/icon-128.png'

const LANGUAGES = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
  { id: 'de', label: 'Deutsch' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'ru', label: 'Русский' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function isAbort(error) {
  return (
    error?.name === 'AbortError' ||
    error?.name === 'RenderingCancelledException' ||
    error?.name === 'AbortException' ||
    error?.code === 'TRANSLATION_ABORTED' ||
    error?.code === 'ABORT_ERR'
  )
}

/** Display scale for a page of `baseWidth` points. */
function pageDisplayScale(baseWidth, viewerWidth, zoomMode, zoom) {
  if (!(baseWidth > 0)) return 1
  if (zoomMode === 'fit') return clamp(Math.max(260, viewerWidth - 56) / baseWidth, 0.4, 3)
  return clamp(zoom, 0.35, 4)
}

/** Untransformed page size of a canonical (scale-1) model. */
function modelBaseSize(model) {
  const width = Number.isFinite(model?.pageWidth) ? model.pageWidth : model?.viewport?.width
  const height = Number.isFinite(model?.pageHeight) ? model.pageHeight : model?.viewport?.height
  return {
    width: Number.isFinite(width) && width > 0 ? width : 612,
    height: Number.isFinite(height) && height > 0 ? height : 792,
  }
}

/**
 * Run `callback` in an idle slot. The timeout keeps a busy tab from starving
 * read-ahead, and the returned function cancels a pending slot.
 */
function scheduleIdle(callback, timeoutMs = 1500) {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout: timeoutMs })
    return () => window.cancelIdleCallback?.(id)
  }
  const id = window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 250)
  return () => window.clearTimeout(id)
}

/** Raw text items for one page, shared by the viewer, chat and export. */
async function pageTextContent(meta, pageIndex, page) {
  const cached = readText(meta, pageIndex)
  if (cached !== undefined) return cached
  // A page prefetch and a foreground visit share one request, so turning onto a
  // page being prefetched does not extract its text twice on the same worker.
  const textContent = await shareTextTask(meta, pageIndex, () =>
    page.getTextContent({ includeMarkedContent: false }),
  )
  return writeText(meta, pageIndex, textContent)
}

/** Figure regions survive model invalidation: corrections never move artwork. */
async function pageFigureRegions(meta, pageIndex, page, library, baseViewport) {
  const cached = readFigures(meta, pageIndex)
  if (cached !== undefined) return cached
  let regions = []
  try {
    regions = await shareFigureTask(meta, pageIndex, () =>
      collectFigureRegions(page, library, baseViewport),
    )
  } catch (error) {
    console.warn('pdf-math-reader: figure detection failed', error)
    regions = []
  }
  return writeFigures(meta, pageIndex, regions)
}

function loadNotes() {
  try {
    const raw = window.localStorage?.getItem(NOTES_KEY)
    if (raw === null || raw === undefined) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (note) =>
          note !== null &&
          typeof note === 'object' &&
          typeof note.id === 'string' &&
          typeof note.doc === 'string' &&
          Number.isInteger(note.pageIndex) &&
          typeof note.paragraphId === 'string' &&
          typeof note.text === 'string',
      )
      .slice(-500)
  } catch {
    return []
  }
}

function newNoteId() {
  try {
    return window.crypto.randomUUID()
  } catch {
    return `note-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

function normalizeModelSelection(value) {
  if (value === null || typeof value !== 'object') return null
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  if (provider === '' || model === '') return null
  const reasoningEffort =
    typeof value.reasoningEffort === 'string' ? value.reasoningEffort.trim() : ''
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

function loadSettings() {
  const fallback = {
    targetLanguage: 'zh-CN',
    glossaryText: '',
    saveDir: '',
    railWidth: 218,
    translationWidth: 390,
    viewMode: 'bilingual',
    readingFontSize: 16,
    translationSelection: null,
    chatSelection: null,
  }
  try {
    const raw = window.localStorage?.getItem(SETTINGS_KEY)
    if (raw === null || raw === undefined) return fallback
    const parsed = JSON.parse(raw)
    const width = (value, low, high, normal) => {
      const number = Number(value)
      return Number.isFinite(number) ? Math.min(high, Math.max(low, Math.round(number))) : normal
    }
    return {
      targetLanguage:
        typeof parsed?.targetLanguage === 'string' && parsed.targetLanguage !== ''
          ? parsed.targetLanguage
          : fallback.targetLanguage,
      glossaryText: typeof parsed?.glossaryText === 'string' ? parsed.glossaryText : '',
      saveDir: typeof parsed?.saveDir === 'string' ? parsed.saveDir : '',
      railWidth: width(parsed?.railWidth, 160, 380, fallback.railWidth),
      translationWidth: width(parsed?.translationWidth, 300, 640, fallback.translationWidth),
      viewMode: ['bilingual', 'translation', 'source'].includes(parsed?.viewMode)
        ? parsed.viewMode
        : fallback.viewMode,
      readingFontSize: width(parsed?.readingFontSize, 13, 22, fallback.readingFontSize),
      translationSelection: normalizeModelSelection(parsed?.translationSelection),
      chatSelection: normalizeModelSelection(parsed?.chatSelection),
    }
  } catch {
    return fallback
  }
}

function normalizeBox(value) {
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = value.map((entry) => Number(entry))
  if (!numbers.every((entry) => Number.isFinite(entry))) return null
  const box = [
    Math.min(numbers[0], numbers[2]),
    Math.min(numbers[1], numbers[3]),
    Math.max(numbers[0], numbers[2]),
    Math.max(numbers[1], numbers[3]),
  ]
  if (box[2] - box[0] < 1 || box[3] - box[1] < 1) return null
  return box
}

/** Equation and figure corrections persist per document fingerprint and page. */
function loadEquationOverrides() {
  try {
    const raw = window.localStorage?.getItem(EQUATIONS_KEY)
    if (raw === null || raw === undefined) return {}
    const parsed = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return {}
    const output = {}
    for (const [fingerprint, pages] of Object.entries(parsed)) {
      if (pages === null || typeof pages !== 'object') continue
      const pageMap = {}
      for (const [pageIndex, entry] of Object.entries(pages)) {
        const index = Number(pageIndex)
        if (!Number.isInteger(index) || index < 0) continue
        const added = Array.isArray(entry?.added)
          ? entry.added
              .map((item) => normalizeBox(item?.bbox))
              .filter((box) => box !== null)
              .map((box) => ({ bbox: box }))
              .slice(0, 200)
          : []
        const removed = Array.isArray(entry?.removed)
          ? entry.removed.map(normalizeBox).filter((box) => box !== null).slice(0, 200)
          : []
        const figures = Array.isArray(entry?.figures)
          ? entry.figures.map(normalizeBox).filter((box) => box !== null).slice(0, 200)
          : []
        if (added.length === 0 && removed.length === 0 && figures.length === 0) continue
        pageMap[index] = { added, removed, figures }
      }
      if (Object.keys(pageMap).length > 0) output[fingerprint] = pageMap
    }
    return output
  } catch {
    return {}
  }
}

function pageOverridesFor(all, fingerprint, pageIndex) {
  if (fingerprint === '' || fingerprint === undefined) return EMPTY_OVERRIDES
  const entry = all?.[fingerprint]?.[pageIndex]
  if (entry === null || entry === undefined) return EMPTY_OVERRIDES
  return {
    added: Array.isArray(entry.added) ? entry.added : [],
    removed: Array.isArray(entry.removed) ? entry.removed : [],
    figures: Array.isArray(entry.figures) ? entry.figures : [],
  }
}

function baseName(name) {
  return String(name).replace(/\.pdf$/i, '') || 'document'
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1500)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function useT(t) {
  return useCallback((key, values) => translate(t, key, values), [t])
}

function EmptyState({ tt, onPick, error, opening }) {
  return (
    <div className="pmr-empty">
      <div className="pmr-empty-card">
        <div className="pmr-empty-icon">
          {opening ? <span className="pmr-spinner" /> : <Icon name="book" size={30} />}
        </div>
        <h1>{opening ? tt('empty.opening') : tt('empty.title')}</h1>
        <p>{opening ? tt('empty.desc') : tt('empty.desc')}</p>
        {!opening && (
          <>
            {error !== '' && (
              <div className="pmr-inline-error" role="alert">
                <Icon name="alert" size={14} />
                <span>{error}</span>
              </div>
            )}
            <div className="pmr-empty-actions">
              <button type="button" className="pmr-btn pmr-btn-primary" onClick={onPick}>
                <Icon name="folder" size={16} />
                {tt('empty.open')}
              </button>
            </div>
            <div className="pmr-drop-hint">{tt('empty.drop')}</div>
            <div className="pmr-features">
              <div className="pmr-feature">
                <div className="pmr-feature-title">
                  <Icon name="sparkle" size={14} />
                  {tt('empty.feature.formula')}
                </div>
                <div className="pmr-feature-desc">{tt('empty.feature.formula.desc')}</div>
              </div>
              <div className="pmr-feature">
                <div className="pmr-feature-title">
                  <Icon name="languages" size={14} />
                  {tt('empty.feature.bilingual')}
                </div>
                <div className="pmr-feature-desc">{tt('empty.feature.bilingual.desc')}</div>
              </div>
              <div className="pmr-feature">
                <div className="pmr-feature-title">
                  <Icon name="list" size={14} />
                  {tt('empty.feature.full')}
                </div>
                <div className="pmr-feature-desc">{tt('empty.feature.full.desc')}</div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SettingsPanel({ tt, settings, onChange, onClose, onClearCache, health }) {
  const [draft, setDraft] = useState(settings.glossaryText)
  useEffect(() => setDraft(settings.glossaryText), [settings.glossaryText])
  const commitGlossary = () => onChange({ glossaryText: draft })
  const modelText =
    health?.status === 'ready' || health?.status === 'unavailable'
      ? `${health.provider ?? '—'} · ${health.model ?? '—'}`
      : tt('status.loading')
  return (
    <div className="pmr-settings" role="dialog" aria-label={tt('settings.title')}>
      <h2>{tt('settings.title')}</h2>
      <div className="pmr-field">
        <label className="pmr-label" htmlFor="pmr-target">
          {tt('settings.target')}
        </label>
        <select
          id="pmr-target"
          className="pmr-select"
          style={{ width: '100%', maxWidth: '100%', height: 32 }}
          value={settings.targetLanguage}
          onChange={(event) => onChange({ targetLanguage: event.target.value })}
        >
          {LANGUAGES.map((language) => (
            <option key={language.id} value={language.id}>
              {language.label}
            </option>
          ))}
        </select>
      </div>
      <div className="pmr-field">
        <label className="pmr-label" htmlFor="pmr-glossary">
          {tt('settings.glossary')}
        </label>
        <textarea
          id="pmr-glossary"
          className="pmr-textarea"
          value={draft}
          placeholder={tt('settings.glossaryPlaceholder')}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitGlossary}
        />
        <div className="pmr-help">{tt('settings.glossaryHint')}</div>
      </div>
      <div className="pmr-field">
        <label className="pmr-label" htmlFor="pmr-save-dir">
          {tt('settings.saveDir')}
        </label>
        <input
          id="pmr-save-dir"
          className="pmr-input"
          style={{ width: '100%', textAlign: 'left' }}
          value={settings.saveDir}
          placeholder={health?.defaultNotesDir ?? tt('settings.saveDirDefault')}
          onChange={(event) => onChange({ saveDir: event.target.value })}
        />
        <div className="pmr-help">
          {tt('settings.saveDirHint')}
          {health?.defaultNotesDir ? ` ${health.defaultNotesDir}` : ''}
        </div>
      </div>
      <div className="pmr-field">
        <span className="pmr-label">{tt('settings.model')}</span>
        <div className="pmr-model-row">
          <span
            className={`pmr-status-dot ${
              health?.status === 'ready'
                ? 'is-ok'
                : health?.status === 'error' || health?.status === 'unavailable'
                  ? 'is-error'
                  : 'is-busy'
            }`}
          />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{modelText}</span>
        </div>
        <div className="pmr-help">{tt('settings.modelHint')}</div>
      </div>
      <div className="pmr-settings-footer">
        <span>{tt('settings.saved')}</span>
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <button type="button" className="pmr-btn pmr-btn-ghost" onClick={onClearCache}>
            {tt('action.clear')}
          </button>
          <button type="button" className="pmr-btn pmr-btn-primary" onClick={onClose}>
            {tt('common.confirm')}
          </button>
        </span>
      </div>
      <div className="pmr-help" style={{ marginTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)', paddingTop: 9 }}>
        {tt('settings.about')}
        <br />
        {tt('settings.source')}
      </div>
    </div>
  )
}

function SelectionCard({ tt, selection, result, onTranslate, onCopy, onClose }) {
  return (
    <div className="pmr-selection">
      <div className="pmr-selection-head">
        <Icon name="quote" size={13} />
        <span>{tt('selection.title')}</span>
        <button
          type="button"
          className="pmr-iconbtn"
          style={{ width: 22, height: 22, marginLeft: 'auto' }}
          onClick={onClose}
          aria-label={tt('common.cancel')}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
      <div className="pmr-selection-src">{selection}</div>
      {result?.status === 'loading' && (
        <div className="pmr-selection-tr" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="pmr-spinner" />
          {tt('selection.translating')}
        </div>
      )}
      {result?.status === 'done' && (
        <div className="pmr-selection-tr">{result.text}</div>
      )}
      {result?.status === 'error' && (
        <div className="pmr-selection-tr pmr-seg-err">{result.error || tt('selection.failed')}</div>
      )}
      <div className="pmr-selection-actions">
        {result?.status === 'done' && (
          <button type="button" className="pmr-btn pmr-btn-ghost" onClick={() => onCopy(result.text)}>
            <Icon name="copy" size={12} />
            {tt('action.copy')}
          </button>
        )}
        {result?.status !== 'done' && (
          <button
            type="button"
            className="pmr-btn pmr-btn-primary"
            onClick={onTranslate}
            disabled={result?.status === 'loading'}
          >
            {result?.status === 'loading' ? <span className="pmr-spinner" /> : <Icon name="languages" size={13} />}
            {tt('action.translateSelection')}
          </button>
        )}
        {result?.status === 'error' && (
          <button type="button" className="pmr-btn pmr-btn-ghost" onClick={onTranslate}>
            {tt('action.retry')}
          </button>
        )}
      </div>
    </div>
  )
}

const THUMBNAIL_CACHE = new Map()

function rememberThumbnail(key, url) {
  if (THUMBNAIL_CACHE.size >= 320) {
    const oldest = THUMBNAIL_CACHE.keys().next().value
    if (oldest !== undefined) THUMBNAIL_CACHE.delete(oldest)
  }
  THUMBNAIL_CACHE.set(key, url)
}

function PageThumbnail({ pdf, pageNumber, label, active, width, cacheKey, onClick }) {
  const holderRef = useRef(null)
  const canvasRef = useRef(null)
  const [src, setSrc] = useState(() => THUMBNAIL_CACHE.get(cacheKey) ?? null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setSrc(THUMBNAIL_CACHE.get(cacheKey) ?? null)
    setFailed(false)
    setVisible(false)
  }, [cacheKey])

  useEffect(() => {
    const element = holderRef.current
    if (element === null || typeof IntersectionObserver !== 'function') {
      setVisible(true)
      return undefined
    }
    const root = element.closest('.pmr-rail-scroll')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { root, rootMargin: '260px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (src !== null || !visible) return undefined
    let cancelled = false
    const controller = new AbortController()
    ;(async () => {
      try {
        const page = await pdf.getPage(pageNumber)
        const canvas = canvasRef.current
        if (canvas === null) return
        await renderThumbnail(page, canvas, width, controller.signal)
        if (cancelled) return
        const url = canvas.toDataURL('image/jpeg', 0.82)
        rememberThumbnail(cacheKey, url)
        setSrc(url)
      } catch (error) {
        if (!cancelled && !isAbort(error)) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [cacheKey, pageNumber, pdf, src, visible, width])

  return (
    <button
      ref={holderRef}
      type="button"
      className={`pmr-thumb ${active ? 'is-active' : ''}`}
      onClick={onClick}
      aria-label={label}
    >
      <span className="pmr-thumb-page">
        {src !== null ? (
          <img className="pmr-thumb-img" src={src} alt="" />
        ) : (
          <canvas ref={canvasRef} className="pmr-thumb-canvas" aria-hidden="true" />
        )}
        {src === null && failed && <span className="pmr-thumb-failed">!</span>}
        {src === null && !failed && (
          <span className="pmr-thumb-loading">
            <span className="pmr-spinner" />
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  )
}

function TranslationBlock({ tt, translation, status, error, onRetry, className }) {
  if (error) {
    return (
      <div className="pmr-seg-err">
        <span>{error}</span>
        {onRetry !== undefined && (
          <button
            type="button"
            className="pmr-seg-retry"
            onClick={(event) => {
              event.stopPropagation()
              onRetry()
            }}
          >
            {tt('action.retry')}
          </button>
        )}
      </div>
    )
  }
  if (translation?.text) return <div className={className}>{translation.text}</div>
  if (status === 'loading') {
    return (
      <>
        <div className="pmr-seg-skeleton" />
        <div className="pmr-seg-skeleton short" />
      </>
    )
  }
  // A page-level failure already has a banner at the top of the column; do not
  // repeat it under every title, author row and paragraph.
  if (status === 'error') return null
  return <div className={`${className} is-placeholder`}>{tt('panel.waiting')}</div>
}

/** Author line for exports: keep the original affiliation and add its translation. */
function exportAuthorLine(author, pageTranslation) {
  const translated = author.affiliationId
    ? pageTranslation?.[author.affiliationId]?.text
    : undefined
  const showTranslation =
    typeof translated === 'string' &&
    translated.trim() !== '' &&
    translated !== author.affiliation
  const affiliation = showTranslation
    ? `${author.affiliation} / ${translated}`
    : author.affiliation
  return [
    `${author.name}${author.marks ? ` ${author.marks}` : ''}`,
    affiliation,
    author.email,
  ]
    .filter(Boolean)
    .join(' · ')
}

function CopyButton({ tt, text, label, onCopy, className = 'pmr-block-copy' }) {
  if (onCopy === undefined || text === undefined || text === '') return null
  return (
    <button
      type="button"
      className={className}
      title={label ?? tt('action.copy')}
      aria-label={label ?? tt('action.copy')}
      onClick={(event) => {
        event.stopPropagation()
        onCopy(text)
      }}
    >
      <Icon name="copy" size={11} />
    </button>
  )
}

function BlockShell({
  active,
  onClick,
  className,
  children,
  onCopy,
  copyText,
  copyLabel,
  tt,
}) {
  return (
    <div
      className={`${className} ${active ? 'is-active' : ''}`}
      onClick={(event) => {
        // Dragging to select text should not also toggle the paragraph focus.
        if ((window.getSelection()?.toString().trim() ?? '') !== '') return
        onClick(event)
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <CopyButton tt={tt} text={copyText} label={copyLabel} onCopy={onCopy} />
      {children}
    </div>
  )
}

function ModelControls({ tt, catalog, value, onChange, disabled = false, fallback }) {
  const models = Array.isArray(catalog.models) ? catalog.models : []
  const selectionId = (provider, model) =>
    `${encodeURIComponent(provider)}|${encodeURIComponent(model)}`
  const selectedKey = value === null ? '' : selectionId(value.provider, value.model)
  const lookup =
    value ??
    (fallback?.provider && fallback?.model
      ? { provider: fallback.provider, model: fallback.model }
      : undefined)
  const current = models.find(
    (entry) => entry.provider === lookup?.provider && entry.id === lookup?.model,
  )
  const providers = Array.isArray(catalog.providers) ? catalog.providers : []
  const groups = new Map()
  for (const entry of models) {
    if (!groups.has(entry.provider)) groups.set(entry.provider, [])
    groups.get(entry.provider).push(entry)
  }
  const providerName = (id) => providers.find((entry) => entry.id === id)?.name ?? id
  const efforts = Array.isArray(current?.reasoning?.efforts)
    ? current.reasoning.efforts
    : []
  return (
    <div className="pmr-modelbar">
      <label className="pmr-model-field">
        <span>{tt('model.label')}</span>
        <select
          className="pmr-model-select"
          value={selectedKey}
          disabled={disabled || catalog.status === 'loading'}
          aria-label={tt('model.label')}
          title={catalog.status === 'error' ? catalog.error : tt('model.hint')}
          onChange={(event) => {
            const nextKey = event.target.value
            if (nextKey === '') {
              onChange(null)
              return
            }
            const [provider, model] = nextKey
              .split('|')
              .map((part) => decodeURIComponent(part))
            onChange({ provider, model })
          }}
        >
          <option value="">{tt('model.default')}</option>
          {[...groups.entries()].map(([provider, entries]) => (
            <optgroup key={provider} label={providerName(provider)}>
              {entries.map((entry) => (
                <option
                  key={`${entry.provider}:${entry.id}`}
                  value={selectionId(entry.provider, entry.id)}
                >
                  {entry.name || entry.id}
                </option>
              ))}
            </optgroup>
          ))}
          {value !== null && current === undefined && (
            <option value={selectedKey}>{`${value.provider}/${value.model}`}</option>
          )}
        </select>
      </label>
      {efforts.length > 0 && (
        <label className="pmr-model-field is-reasoning">
          <span>{tt('model.reasoning')}</span>
          <select
            className="pmr-model-select"
            value={value?.reasoningEffort ?? ''}
            disabled={disabled}
            aria-label={tt('model.reasoning')}
            onChange={(event) => {
              const provider = value?.provider ?? fallback?.provider
              const model = value?.model ?? fallback?.model
              if (!provider || !model) return
              const effort = event.target.value
              onChange({
                provider,
                model,
                ...(effort === '' ? {} : { reasoningEffort: effort }),
              })
            }}
          >
            <option value="">{tt('model.reasoningDefault')}</option>
            {efforts.map((effort) => (
              <option key={effort.id} value={effort.id}>
                {effort.name || effort.id}
              </option>
            ))}
          </select>
        </label>
      )}
      {catalog.status === 'loading' && (
        <span className="pmr-model-state">{tt('model.loading')}</span>
      )}
    </div>
  )
}

function TitleBlock({
  tt,
  block,
  translation,
  status,
  mode,
  active,
  error,
  onRetry,
  onClick,
  onCopy,
}) {
  const copyValue = mode === 'source' ? block.text : translation?.text || block.text
  return (
    <BlockShell
      className="pmr-title-block"
      active={active}
      onClick={onClick}
      tt={tt}
      onCopy={onCopy}
      copyText={copyValue}
      copyLabel={
        mode !== 'source' && translation?.text
          ? tt('action.copyTranslation')
          : tt('action.copySource')
      }
    >
      {mode !== 'translation' && <div className="pmr-title-src">{block.text}</div>}
      {mode !== 'source' && (
        <TranslationBlock
          tt={tt}
          translation={translation}
          status={status}
          error={error}
          onRetry={onRetry}
          className="pmr-title-tr"
        />
      )}
    </BlockShell>
  )
}

function AuthorBlock({ tt, block, mode, active, onClick, pageTranslation, onCopy }) {
  const copyValue = block.authors
    .map((author) =>
      [
        `${author.name}${author.marks ? ` ${author.marks}` : ''}`,
        author.affiliation,
        author.email,
      ]
        .filter(Boolean)
        .join(' · '),
    )
    .join('\n')
  return (
    <BlockShell
      className="pmr-author-block"
      active={active}
      onClick={onClick}
      tt={tt}
      onCopy={onCopy}
      copyText={copyValue}
      copyLabel={tt('action.copyAuthors')}
    >
      <div className="pmr-article-head">
        <span className="pmr-article-label">{tt('reading.authors')}</span>
        <span className="pmr-article-orig">
          {tt('reading.authorCount', { count: block.authors.length })}
        </span>
      </div>
      <div className="pmr-author-grid">
        {block.authors.map((author, index) => {
          const translated = author.affiliationId
            ? pageTranslation[author.affiliationId]?.text
            : undefined
          const affiliation =
            mode === 'translation' && translated ? translated : author.affiliation
          return (
            <div className="pmr-author" key={`${author.name}-${index}`}>
              <div className="pmr-author-name">
                {author.name}
                {author.marks !== '' && <sup className="pmr-author-marks">{author.marks}</sup>}
              </div>
              {(affiliation !== '' || author.email !== '') && (
                <div className="pmr-author-meta">
                  {affiliation !== '' && (
                    <span
                      className="pmr-author-aff"
                      title={
                        mode === 'bilingual' && translated && translated !== affiliation
                          ? translated
                          : undefined
                      }
                    >
                      {affiliation}
                    </span>
                  )}
                  {author.email !== '' && (
                    <a
                      className="pmr-author-email"
                      href={`mailto:${author.email}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      {author.email}
                    </a>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </BlockShell>
  )
}

function AbstractBlock({
  tt,
  block,
  translation,
  status,
  mode,
  active,
  error,
  onRetry,
  onClick,
  onCopy,
}) {
  const label = tt('reading.abstract')
  const copyValue = mode === 'source' ? block.text : translation?.text || block.text
  return (
    <BlockShell
      className={`pmr-article-block pmr-abstract ${
        block.partIndex > 0 ? 'is-continuation' : ''
      }`}
      active={active}
      onClick={onClick}
      tt={tt}
      onCopy={onCopy}
      copyText={copyValue}
      copyLabel={
        mode !== 'source' && translation?.text
          ? tt('action.copyTranslation')
          : tt('action.copySource')
      }
    >
      {block.showLabel !== false && (
        <div className="pmr-article-head">
          <span className="pmr-article-label">{label}</span>
          {block.heading !== '' && block.heading.toLowerCase() !== label.toLowerCase() && (
            <span className="pmr-article-orig">{block.heading}</span>
          )}
        </div>
      )}
      {mode !== 'translation' && <div className="pmr-abstract-src">{block.text}</div>}
      {mode !== 'source' && (
        <TranslationBlock
          tt={tt}
          translation={translation}
          status={status}
          error={error}
          onRetry={onRetry}
          className="pmr-abstract-tr"
        />
      )}
    </BlockShell>
  )
}

function KeywordsBlock({
  tt,
  block,
  translation,
  status,
  mode,
  active,
  error,
  onRetry,
  onClick,
  onCopy,
}) {
  const label = tt('reading.keywords')
  const copyValue = mode === 'source' ? block.text : translation?.text || block.text
  return (
    <BlockShell
      className="pmr-article-block pmr-keywords"
      active={active}
      onClick={onClick}
      tt={tt}
      onCopy={onCopy}
      copyText={copyValue}
      copyLabel={
        mode !== 'source' && translation?.text
          ? tt('action.copyTranslation')
          : tt('action.copySource')
      }
    >
      <div className="pmr-article-head">
        <span className="pmr-article-label">{label}</span>
        {block.heading !== '' && block.heading.toLowerCase() !== label.toLowerCase() && (
          <span className="pmr-article-orig">{block.heading}</span>
        )}
      </div>
      {mode !== 'translation' && <div className="pmr-keywords-src">{block.text}</div>}
      {mode !== 'source' && (
        <TranslationBlock
          tt={tt}
          translation={translation}
          status={status}
          error={error}
          onRetry={onRetry}
          className="pmr-keywords-tr"
        />
      )}
    </BlockShell>
  )
}

function SegmentCard({
  tt,
  block,
  translation,
  status,
  mode,
  active,
  error,
  onRetry,
  onClick,
  onCopy,
}) {
  const paragraph = block.paragraph
  const copyValue =
    mode === 'source' ? paragraph.text : translation?.text || paragraph.text
  return (
    <BlockShell
      className={`pmr-seg-card ${block.role === 'heading' ? 'is-heading' : ''}`}
      active={active}
      onClick={onClick}
      tt={tt}
      onCopy={onCopy}
      copyText={copyValue}
      copyLabel={
        mode !== 'source' && translation?.text
          ? tt('action.copyTranslation')
          : tt('action.copySource')
      }
    >
      {mode !== 'translation' && <div className="pmr-seg-src">{paragraph.text}</div>}
      {mode !== 'source' && (
        <TranslationBlock
          tt={tt}
          translation={translation}
          status={status}
          error={error}
          onRetry={onRetry}
          className="pmr-seg-tr"
        />
      )}
    </BlockShell>
  )
}

/**
 * Render a cropped page region (equation or figure) once and cache the data
 * URL for the lifetime of the document. The crop is independent of the visible
 * canvas, so it stays sharp at any zoom.
 */
function useCropImage({ pdf, pageIndex, cache, cacheKey, cropBbox, displayWidth, cacheVersion }) {
  const [image, setImage] = useState({ status: 'loading' })
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)

  useEffect(() => {
    let cancelled = false
    let promise = cache.current.get(cacheKey)
    if (promise === undefined) {
      promise = (async () => {
        const page = await pdf.getPage(pageIndex + 1)
        return await renderEquationCrop(page, cropBbox, {
          displayWidth,
          devicePixelRatio: dpr,
          maxPixels: 3200000,
          maxScale: 5,
        })
      })()
      cache.current.set(cacheKey, promise)
      promise.catch(() => cache.current.delete(cacheKey))
    }
    setImage({ status: 'loading' })
    promise
      .then((result) => {
        if (!cancelled) setImage({ status: 'ready', ...result })
      })
      .catch((error) => {
        if (!cancelled && !isAbort(error)) {
          setImage({ status: 'error', message: error?.message ?? String(error) })
        }
      })
    return () => {
      cancelled = true
    }
  }, [cache, cacheKey, cropBbox, displayWidth, dpr, pageIndex, pdf, cacheVersion])

  return image
}

function EquationBlock({
  tt,
  equation,
  pdf,
  fingerprint,
  pageIndex,
  cache,
  cacheVersion,
  active,
  onLocate,
  onRemove,
  onCopy,
}) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const cropBbox = equation.imageBbox ?? equation.bbox
  const bboxWidth = Math.max(1, cropBbox[2] - cropBbox[0])
  const displayWidth = Math.min(760, Math.max(140, bboxWidth * 1.7))
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const cacheKey = [
    fingerprint,
    pageIndex,
    equation.id,
    cropBbox.map((value) => Math.round(value * 10) / 10).join(','),
    Math.round(displayWidth),
    dpr,
  ].join(':')
  const image = useCropImage({
    pdf,
    pageIndex,
    cache,
    cacheKey,
    cropBbox,
    displayWidth,
    cacheVersion,
  })

  useEffect(() => {
    if (!zoomOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setZoomOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomOpen])

  const label =
    equation.equationNumber === null || equation.equationNumber === undefined
      ? tt('equation.unnumbered')
      : tt('equation.numbered', { number: equation.equationNumber })

  return (
    <section
      className={`pmr-eq-card ${active ? 'is-active' : ''}`}
      aria-label={label}
    >
      <header className="pmr-eq-head">
        <span className="pmr-eq-label">{label}</span>
        <span className={`pmr-eq-badge ${equation.detectionSource === 'manual' ? 'is-manual' : ''}`}>
          {equation.detectionSource === 'manual' ? tt('equation.manual') : tt('equation.auto')}
        </span>
        <div className="pmr-eq-actions">
          {typeof equation.latex === 'string' && equation.latex !== '' && (
            <button
              type="button"
              onClick={() => onCopy(`$$\n${equation.latex}\n$$`)}
              title={tt('equation.copyLatex')}
              aria-label={tt('equation.copyLatex')}
            >
              <Icon name="copy" size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onLocate(equation)}
            title={tt('equation.locate')}
            aria-label={tt('equation.locate')}
          >
            <Icon name="search" size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            title={tt('equation.zoom')}
            aria-label={tt('equation.zoom')}
            disabled={image.status !== 'ready'}
          >
            <Icon name="expand" size={12} />
          </button>
          <button
            type="button"
            className="pmr-eq-remove"
            onClick={() => onRemove(equation)}
            title={tt('equation.remove')}
            aria-label={tt('equation.remove')}
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      </header>

      <div
        className="pmr-eq-scroll"
        role="button"
        tabIndex={0}
        onClick={() => onLocate(equation)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onLocate(equation)
          }
        }}
      >
        {image.status === 'ready' ? (
          <img
            className="pmr-eq-image"
            src={image.dataUrl}
            width={image.width}
            height={image.height}
            alt={equation.text}
            draggable={false}
          />
        ) : image.status === 'error' ? (
          <div className="pmr-eq-fallback">{equation.text}</div>
        ) : (
          <div className="pmr-eq-loading">
            <span className="pmr-spinner" />
            {tt('equation.rendering')}
          </div>
        )}
      </div>

      <footer className="pmr-eq-foot">
        <span>{tt('equation.hint')}</span>
      </footer>

      {zoomOpen && image.status === 'ready' && (
        <div className="pmr-eq-modal" role="dialog" aria-label={label} onClick={() => setZoomOpen(false)}>
          <div className="pmr-eq-modal-body" onClick={(event) => event.stopPropagation()}>
            <div className="pmr-eq-modal-head">
              <span>{label}</span>
              <button
                type="button"
                className="pmr-iconbtn"
                onClick={() => setZoomOpen(false)}
                aria-label={tt('action.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="pmr-eq-modal-scroll">
              <img
                src={image.dataUrl}
                alt={equation.text}
                style={{ width: Math.min(1800, Math.round(image.width * 2.2)), maxWidth: 'none' }}
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * A figure block keeps the artwork and its inner labels together.
 *
 * The labels stay in the page's text layer (so selecting text still works) but
 * are not paragraphs: they belong to this figure, are not translated one by
 * one, and are not mistaken for display equations.
 */
function FigureBlock({
  tt,
  figure,
  pdf,
  fingerprint,
  pageIndex,
  cache,
  cacheVersion,
  active,
  onLocate,
  onRemove,
  onCopy,
}) {
  const [zoomOpen, setZoomOpen] = useState(false)
  const cropBbox = figure.imageBbox ?? figure.bbox
  const bboxWidth = Math.max(1, cropBbox[2] - cropBbox[0])
  const displayWidth = Math.min(760, Math.max(160, bboxWidth * 1.7))
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const cacheKey = [
    fingerprint,
    pageIndex,
    figure.id,
    cropBbox.map((value) => Math.round(value * 10) / 10).join(','),
    Math.round(displayWidth),
    dpr,
  ].join(':')
  const image = useCropImage({
    pdf,
    pageIndex,
    cache,
    cacheKey,
    cropBbox,
    displayWidth,
    cacheVersion,
  })

  useEffect(() => {
    if (!zoomOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setZoomOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [zoomOpen])

  const label =
    figure.figureNumber === null || figure.figureNumber === undefined
      ? tt('figure.unnumbered')
      : tt('figure.numbered', { number: figure.figureNumber })
  const labels = Array.isArray(figure.labels) ? figure.labels : []
  const labelText = labels.map((line) => line.text).join('\n')

  return (
    <section className={`pmr-eq-card pmr-fig-card ${active ? 'is-active' : ''}`} aria-label={label}>
      <header className="pmr-eq-head">
        <span className="pmr-eq-label">{label}</span>
        <span className="pmr-eq-badge">{tt('figure.auto')}</span>
        <div className="pmr-eq-actions">
          {labelText !== '' && (
            <button
              type="button"
              onClick={() => onCopy(labelText)}
              title={tt('figure.copyLabels')}
              aria-label={tt('figure.copyLabels')}
            >
              <Icon name="copy" size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => onLocate(figure)}
            title={tt('figure.locate')}
            aria-label={tt('figure.locate')}
          >
            <Icon name="search" size={12} />
          </button>
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            title={tt('figure.zoom')}
            aria-label={tt('figure.zoom')}
            disabled={image.status !== 'ready'}
          >
            <Icon name="expand" size={12} />
          </button>
          <button
            type="button"
            className="pmr-eq-remove"
            onClick={() => onRemove(figure)}
            title={tt('figure.notFigure')}
            aria-label={tt('figure.notFigure')}
          >
            <Icon name="close" size={11} />
          </button>
        </div>
      </header>

      <div
        className="pmr-eq-scroll"
        role="button"
        tabIndex={0}
        onClick={() => onLocate(figure)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onLocate(figure)
          }
        }}
      >
        {image.status === 'ready' ? (
          <img
            className="pmr-eq-image"
            src={image.dataUrl}
            width={image.width}
            height={image.height}
            alt={figure.caption ?? label}
            draggable={false}
          />
        ) : image.status === 'error' ? (
          <div className="pmr-eq-fallback">{tt('figure.renderFailed')}</div>
        ) : (
          <div className="pmr-eq-loading">
            <span className="pmr-spinner" />
            {tt('figure.rendering')}
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <details className="pmr-fig-labels">
          <summary>{tt('figure.labels', { count: labels.length })}</summary>
          <p className="pmr-fig-note">{tt('figure.labelsHint')}</p>
          <div className="pmr-fig-label-list">
            {labels.map((line, index) => (
              <span key={`${figure.id}-label-${index}`} className="pmr-fig-label">
                {line.text}
              </span>
            ))}
          </div>
        </details>
      )}

      {zoomOpen && image.status === 'ready' && (
        <div className="pmr-eq-modal" role="dialog" aria-label={label} onClick={() => setZoomOpen(false)}>
          <div className="pmr-eq-modal-body" onClick={(event) => event.stopPropagation()}>
            <div className="pmr-eq-modal-head">
              <span>{label}</span>
              <button
                type="button"
                className="pmr-iconbtn"
                onClick={() => setZoomOpen(false)}
                aria-label={tt('action.close')}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="pmr-eq-modal-scroll">
              <img
                src={image.dataUrl}
                alt={figure.caption ?? label}
                style={{ width: Math.min(1800, Math.round(image.width * 2.2)), maxWidth: 'none' }}
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

class ReaderErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('pdf-math-reader: reader panel crashed', error, info)
  }

  render() {
    if (this.state.error !== null) {
      const message = String(this.state.error?.stack ?? this.state.error?.message ?? this.state.error)
      return (
        <div
          style={{
            minHeight: 420,
            display: 'grid',
            placeItems: 'center',
            padding: 28,
            background: 'var(--dsw-alias-bg-base)',
            color: 'var(--dsw-alias-label-primary)',
          }}
        >
          <div style={{ maxWidth: 620, width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650 }}>
              <Icon name="alert" size={18} />
              {translate(this.props.t, 'error.render')}
            </div>
            <pre
              style={{
                marginTop: 12,
                padding: 12,
                maxHeight: 240,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                lineHeight: 1.5,
                borderRadius: 8,
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-layer-1)',
              }}
            >
              {message.slice(0, 4000)}
            </pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="pmr-btn pmr-btn-primary"
                onClick={() => this.setState({ error: null })}
              >
                {translate(this.props.t, 'action.retry')}
              </button>
              <button type="button" className="pmr-btn pmr-btn-ghost" onClick={() => window.location.reload()}>
                {translate(this.props.t, 'action.open')}
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function PdfReaderPanel(props) {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <ReaderErrorBoundary t={props.t}>
        <PdfReaderPage {...props} />
      </ReaderErrorBoundary>
    </>
  )
}

export function PdfReaderPage({ t }) {
  const tt = useT(t)
  const [settings, setSettings] = useState(loadSettings)
  const [health, setHealth] = useState({ status: 'loading' })
  const translationSelectionKey =
    settings.translationSelection === null
      ? null
      : `${settings.translationSelection.provider}/${settings.translationSelection.model}/${
          settings.translationSelection.reasoningEffort ?? ''
        }`
  const [catalog, setCatalog] = useState({
    status: 'loading',
    providers: [],
    models: [],
    warnings: [],
  })
  const [doc, setDoc] = useState(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageModel, setPageModel] = useState(null)
  const [pageSize, setPageSize] = useState(null)
  const [pageScale, setPageScale] = useState(1)
  const [renderState, setRenderState] = useState('idle')
  const [renderError, setRenderError] = useState('')
  const [renderNonce, setRenderNonce] = useState(0)
  const [viewerWidth, setViewerWidth] = useState(860)
  const [zoomMode, setZoomMode] = useState('fit')
  const [zoom, setZoom] = useState(1.2)
  const [railTab, setRailTab] = useState('outline')
  const [references, setReferences] = useState({
    status: 'idle',
    heading: '',
    pageIndex: null,
    entries: [],
  })
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [rightTab, setRightTab] = useState('translation')
  const [viewMode, setViewMode] = useState(settings.viewMode)
  const [activeParagraph, setActiveParagraph] = useState(null)
  const [selection, setSelection] = useState('')
  const [selectionResult, setSelectionResult] = useState(null)
  const [translations, setTranslations] = useState({})
  const [pageTranslationState, setPageTranslationState] = useState({})
  const [busyPages, setBusyPages] = useState({})
  const [notes, setNotes] = useState(loadNotes)
  const [noteText, setNoteText] = useState('')
  const [focusRequest, setFocusRequest] = useState(null)
  const [returnTarget, setReturnTarget] = useState(null)
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatScope, setChatScope] = useState('page')
  const [chatBusy, setChatBusy] = useState(false)
  const [chatStatus, setChatStatus] = useState('')
  const [chatError, setChatError] = useState('')
  const [skill, setSkill] = useState(null)
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [skillList, setSkillList] = useState([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillError, setSkillError] = useState('')
  const [progress, setProgress] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [resizing, setResizing] = useState(false)
  const [toast, setToast] = useState(null)
  const [equationOverrides, setEquationOverrides] = useState(loadEquationOverrides)
  const [modelRevision, setModelRevision] = useState(0)
  const [activeEquation, setActiveEquation] = useState(null)
  const [equationSelectMode, setEquationSelectMode] = useState(false)
  const [equationRect, setEquationRect] = useState(null)
  const [translationErrors, setTranslationErrors] = useState({})

  const fileInputRef = useRef(null)
  const viewerRef = useRef(null)
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const textLayerTaskRef = useRef(null)
  const docRef = useRef(null)
  // Kept in a ref so a raster snapshot taken after an await can prove the viewer
  // has not moved to another page in the meantime.
  const pageIndexRef = useRef(0)
  pageIndexRef.current = pageIndex
  const pageModelRef = useRef(null)
  pageModelRef.current = pageModel
  // Read-ahead state: at most one pending idle slot and one in-flight prefetch.
  const prefetchRef = useRef({ generation: 0, controller: null, stop: null })
  // Monotonic capture order for rasters, so an older snapshot of the same page
  // cannot replace a newer one after a fast page turn.
  const rasterSeqRef = useRef(0)
  const translationCacheRef = useRef(new Map())
  const translationAbortRef = useRef(null)
  const translationEpochRef = useRef(0)
  const selectionAbortRef = useRef(null)
  const chatAbortRef = useRef(null)
  const chatContextCacheRef = useRef(new Map())
  const chatScrollRef = useRef(null)
  const chatEndRef = useRef(null)
  const skillFileRef = useRef(null)
  const toastTimerRef = useRef(null)
  const dragDepthRef = useRef(0)
  const wheelLockRef = useRef(0)
  const openTaskRef = useRef(0)
  const pendingFocusRef = useRef(null)
  const pendingScrollRef = useRef(null)
  const focusRequestIdRef = useRef(0)
  const equationOverridesRef = useRef(equationOverrides)
  equationOverridesRef.current = equationOverrides
  const equationImageCacheRef = useRef(new Map())
  const equationDragRef = useRef(null)
  const ttRef = useRef(tt)
  ttRef.current = tt

  const glossary = useMemo(() => parseGlossary(settings.glossaryText), [settings.glossaryText])
  const glossaryKeyValue = useMemo(() => glossaryKey(glossary), [glossary])
  const pageCount = doc?.numPages ?? 0
  const paragraphs = pageModel?.paragraphs ?? []
  const blocks = pageModel?.blocks ?? []
  const equations = useMemo(() => blocks.filter((block) => block.type === 'equation'), [blocks])
  const figures = useMemo(() => blocks.filter((block) => block.type === 'figure'), [blocks])
  const reading = useMemo(
    () => (pageModel === null ? { blocks: [], units: [] } : composeReading(pageModel)),
    [pageModel],
  )
  const readingBlocks = reading.blocks
  const readingUnits = reading.units
  const unitById = useMemo(
    () => new Map(readingUnits.map((unit) => [unit.id, unit])),
    [readingUnits],
  )
  const pageTranslation = translations[pageIndex] ?? {}
  const pageStatus = pageTranslationState[pageIndex]?.status ?? 'idle'
  const pageError = pageTranslationState[pageIndex]?.error ?? ''
  const pageBusy = Boolean(busyPages[pageIndex]) || Boolean(progress?.running)
  const hasPageTranslation = readingUnits.some((unit) => Boolean(pageTranslation[unit.id]?.text))
  const waitingForTranslation =
    viewMode !== 'source' &&
    readingUnits.length > 0 &&
    !hasPageTranslation &&
    pageStatus !== 'loading' &&
    pageStatus !== 'error'
  // Canonical models are built at scale 1, so every page-point value (line boxes,
  // equation and figure bboxes) is multiplied by the current display scale here.
  const currentScale = pageScale
  const activeLines = pageModel?.paragraphs.find((paragraph) => paragraph.id === activeParagraph)?.lines ?? []
  const docFingerprint = doc?.fingerprint ?? ''
  const pageOverrides = useMemo(
    () => pageOverridesFor(equationOverrides, docFingerprint, pageIndex),
    [docFingerprint, equationOverrides, pageIndex],
  )
  const hasPageOverrides =
    pageOverrides.added.length > 0 ||
    pageOverrides.removed.length > 0 ||
    pageOverrides.figures.length > 0
  // Equations and figures share the highlight/active state; only their bbox
  // and card differ.
  const activeOverlayBlock = blocks.find((block) => block.id === activeEquation)
  const docNotes = useMemo(
    () => notes.filter((note) => note.doc === docFingerprint),
    [docFingerprint, notes],
  )
  const currentParagraph =
    activeParagraph === null
      ? undefined
      : pageModel?.paragraphs.find((paragraph) => paragraph.id === activeParagraph)
  const existingNote =
    currentParagraph === undefined
      ? undefined
      : docNotes.find(
          (note) =>
            note.pageIndex === pageIndex && note.paragraphId === currentParagraph.id,
        )
  const noteLines = useMemo(() => {
    if (pageModel === null) return []
    const ids = new Set(
      docNotes
        .filter((note) => note.pageIndex === pageIndex)
        .map((note) => note.paragraphId),
    )
    return pageModel.paragraphs
      .filter((paragraph) => ids.has(paragraph.id))
      .flatMap((paragraph) => paragraph.lines)
  }, [docNotes, pageIndex, pageModel])
  const textLayerKey = [
    doc?.fingerprint ?? 'none',
    pageIndex,
    zoomMode,
    Math.round(zoom * 100),
    Math.round(viewerWidth),
    renderNonce,
  ].join(':')

  const notify = useCallback((message, kind = 'info') => {
    window.clearTimeout(toastTimerRef.current)
    setToast({ message, kind, id: Date.now() })
    toastTimerRef.current = window.setTimeout(
      () => setToast(null),
      kind === 'error' ? 8000 : 4200,
    )
  }, [])

  const clearTextSelection = useCallback(() => {
    const selected = window.getSelection()
    if (selected !== null && selected.rangeCount > 0) selected.removeAllRanges()
  }, [])

  useEffect(() => {
    try {
      window.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // Local storage can be unavailable in hardened browser contexts.
    }
  }, [settings])

  useEffect(() => {
    try {
      window.localStorage?.setItem(NOTES_KEY, JSON.stringify(notes.slice(-500)))
    } catch {
      // Notes remain available for this session when persistence is unavailable.
    }
  }, [notes])

  useEffect(() => {
    try {
      window.localStorage?.setItem(EQUATIONS_KEY, JSON.stringify(equationOverrides))
    } catch {
      // Equation corrections remain available for this session.
    }
  }, [equationOverrides])

  useEffect(() => {
    setNoteText(existingNote?.text ?? '')
  }, [existingNote])

  useEffect(() => {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setChatMessages([])
    setChatInput('')
    setChatError('')
    setChatBusy(false)
    setChatStatus('')
    chatContextCacheRef.current.clear()
  }, [docFingerprint])

  useEffect(() => {
    if (doc === null) {
      setReferences({ status: 'idle', heading: '', pageIndex: null, entries: [] })
      return undefined
    }
    const controller = new AbortController()
    setReferences({ status: 'loading', heading: '', pageIndex: null, entries: [] })
    extractReferences(doc.pdf, doc.outline, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return
        setReferences({
          status: 'ready',
          heading: result?.heading ?? '',
          pageIndex: result?.pageIndex ?? null,
          entries: Array.isArray(result?.entries) ? result.entries : [],
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        console.warn('pdf-math-reader: reference extraction failed', error)
        setReferences({ status: 'error', heading: '', pageIndex: null, entries: [] })
      })
    return () => controller.abort()
  }, [doc])

  useEffect(() => {
    if (railTab === 'references' && references.entries.length === 0) {
      setRailTab('outline')
    }
  }, [railTab, references.entries.length])

  useEffect(() => {
    const controller = new AbortController()
    fetchHealth(controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return
        setHealth({
          status: payload.llm === true ? 'ready' : 'unavailable',
          provider: payload.provider,
          model: payload.model,
          reasoningEffort: payload.reasoningEffort,
          providers: payload.providers,
          defaultNotesDir: payload.defaultNotesDir,
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setHealth({ status: 'error', message: error?.message ?? String(error) })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchModels(controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return
        setCatalog({
          status: 'ready',
          providers: Array.isArray(payload.providers) ? payload.providers : [],
          models: Array.isArray(payload.models) ? payload.models : [],
          warnings: Array.isArray(payload.warnings) ? payload.warnings : [],
        })
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        setCatalog({
          status: 'error',
          providers: [],
          models: [],
          warnings: [],
          error: error?.message ?? String(error),
        })
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!doc) return
    const element = viewerRef.current
    if (element === null) return
    const update = () => setViewerWidth(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [doc, leftOpen, rightOpen])

  useEffect(() => {
    if (!doc) return
    const pending = pendingFocusRef.current
    if (
      pending !== null &&
      (pending.documentId !== doc.fingerprint || pending.pageIndex !== pageIndex)
    ) {
      pendingFocusRef.current = null
    }
    // `pageModel` and `pageSize` are decided by the render effect, which swaps a
    // cached page in synchronously instead of blanking the column first.
    setRenderError('')
    setActiveParagraph(null)
    setActiveEquation(null)
    setEquationSelectMode(false)
    setEquationRect(null)
    setSelection('')
    setSelectionResult(null)
    textLayerTaskRef.current?.cancel()
    textLayerTaskRef.current = null
    textLayerRef.current?.replaceChildren()
  }, [doc, pageIndex])

  useEffect(() => {
    setPageDraft(String(pageIndex + 1))
    viewerRef.current?.scrollTo({ top: 0, behavior: 'auto' })
  }, [pageIndex])

  useEffect(() => {
    if (!doc) return undefined
    const meta = doc
    let cancelled = false
    const controller = new AbortController()

    // Resolve the cache hit before any await: a page that is already parsed swaps
    // in immediately, while `renderState` stays 'loading' until the target page's
    // pixels are on screen. Highlights are gated on 'ready' for the same reason —
    // a new page's boxes must never sit on top of the previous page's raster.
    const cachedModel = readModel(meta, pageIndex)
    const shownModel = pageModelRef.current
    const samePage =
      shownModel !== null &&
      shownModel !== undefined &&
      shownModel.documentId === meta.fingerprint &&
      shownModel.pageIndex === pageIndex
    if (cachedModel === undefined) {
      // Rebuilding the page already on screen (a correction, a zoom) keeps its
      // raster and column; a page turn clears the previous page's content.
      if (!samePage) {
        setPageModel(null)
        setPageSize(null)
        setRenderState('loading')
      }
    } else {
      const base = modelBaseSize(cachedModel)
      const scale = pageDisplayScale(base.width, viewerWidth, zoomMode, zoom)
      setPageModel(cachedModel)
      setPageSize({ width: base.width * scale, height: base.height * scale })
      setPageScale(scale)
      if (!samePage) setRenderState('loading')
    }
    setRenderError('')

    const paintTextLayer = async (library, textContent, viewport) => {
      const container = textLayerRef.current
      if (container === null || typeof library.TextLayer !== 'function') return
      try {
        container.replaceChildren()
        // PDF.js TextLayer positions glyphs with
        // calc(var(--scale-factor) * <unscaled-pdf-unit>). Without this
        // variable, font sizes collapse and selection boxes drift away
        // from the visible glyphs.
        container.style.setProperty('--scale-factor', String(viewport.scale))
        container.style.setProperty('--scale-round-x', '1px')
        container.style.setProperty('--scale-round-y', '1px')
        const textLayer = new library.TextLayer({
          textContentSource: textContent,
          container,
          viewport,
        })
        textLayerTaskRef.current = textLayer
        await textLayer.render()
        if (textLayerTaskRef.current === textLayer) textLayerTaskRef.current = null
        if (cancelled) {
          textLayer.cancel()
          container.replaceChildren()
        }
      } catch (error) {
        if (!cancelled && !isAbort(error)) {
          console.warn('pdf-math-reader: text layer failed', error)
        }
      }
    }

    /**
     * Write an in-flight snapshot to the cache once the browser finishes copying.
     *
     * The copy was started from this page's own queued render, so a page the
     * reader has already left still belongs in the cache: that is exactly the
     * raster the next visit needs. Only a different document invalidates it, and
     * the version keeps an older capture from replacing a newer one.
     */
    const rememberRaster = (snapshot, scale, ratio, version) => {
      if (snapshot === null || snapshot === undefined) return
      snapshot
        .then((bitmap) => {
          if (bitmap === null || bitmap === undefined) return
          if (docRef.current !== meta) {
            releaseRaster({ bitmap })
            return
          }
          writeRaster(meta, pageIndex, {
            bitmap,
            bytes: bitmap.width * bitmap.height * 4,
            ratio,
            scale,
            version,
          })
        })
        .catch(() => {
          // Losing a snapshot only costs the next visit a re-render.
        })
    }

    const run = async () => {
      try {
        const library = await loadPdfJs()
        if (cancelled) return
        const page = await meta.pdf.getPage(pageIndex + 1)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const scale = pageDisplayScale(base.width, viewerWidth, zoomMode, zoom)
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (canvas === null) return
        setPageSize({ width: viewport.width, height: viewport.height })
        setPageScale(scale)

        const ratio = pdfPixelRatio()
        const version = (rasterSeqRef.current += 1)
        // A raster that cannot be cached is not worth one snapshot copy: the
        // reader still renders it, it just never enters the cache.
        const snapshotWanted =
          supportsRasterSnapshot() &&
          rasterFitsBudget(
            Math.floor(viewport.width * ratio),
            Math.floor(viewport.height * ratio),
          )
        const cachedRaster = readRaster(meta, pageIndex)
        const exactRaster =
          cachedRaster !== undefined &&
          Math.abs(cachedRaster.scale - scale) < 1e-3 &&
          cachedRaster.ratio === ratio

        let painted = 'none'
        if (cachedRaster !== undefined) {
          try {
            await drawPdfRaster(
              canvas,
              cachedRaster.bitmap,
              viewport.width,
              viewport.height,
              controller.signal,
            )
            if (cancelled) return
            setRenderState('ready')
            painted = exactRaster ? 'exact' : 'preview'
          } catch (error) {
            if (cancelled || controller.signal.aborted || isAbort(error)) return
            // A released or unreadable raster degrades to a normal render.
            console.warn('pdf-math-reader: cached raster failed', error)
          }
        }
        if (painted !== 'exact') {
          if (painted === 'preview') {
            // Replace the stretched preview in one blit, so the page does not
            // flash white between the two rasters. The snapshot comes from the
            // offscreen canvas, whose pixels nothing else can touch.
            const offscreen = document.createElement('canvas')
            const result = await renderPdfPage(page, offscreen, scale, controller.signal, {
              snapshot: snapshotWanted,
            })
            // Cache the page before any cancellation check: the pixels are this
            // page's, and a page the reader just left is exactly what the next
            // visit (backwards) wants to find.
            rememberRaster(result.snapshot, scale, ratio, version)
            if (cancelled) return
            await drawPdfRaster(
              canvas,
              offscreen,
              viewport.width,
              viewport.height,
              controller.signal,
            )
          } else {
            const result = await renderPdfPage(page, canvas, scale, controller.signal, {
              snapshot: snapshotWanted,
            })
            rememberRaster(result.snapshot, scale, ratio, version)
          }
          if (cancelled) return
          // The page must be readable even when text extraction or the text layer
          // fails; those are separate, non-fatal steps below.
          setRenderState('ready')
        }

        if (cachedModel === undefined) {
          // Figure detection and text extraction share one worker; running them
          // together halves the wait before the reading model exists.
          const figuresPromise = pageFigureRegions(meta, pageIndex, page, library, base)
          let textContent
          try {
            textContent = await pageTextContent(meta, pageIndex, page)
          } catch (error) {
            // A page with unreadable text still has to be readable as a picture.
            console.warn('pdf-math-reader: text extraction failed', error)
            textContent = undefined
          }
          if (cancelled) return
          // Start the selection layer without waiting for it: on a text-dense page
          // it creates hundreds of nodes, and the reading column must not queue
          // behind DOM work it does not depend on.
          if (textContent !== undefined) void paintTextLayer(library, textContent, viewport)
          const figures = await figuresPromise
          if (cancelled) return
          const model = buildPageModel(
            library,
            textContent ?? { items: [] },
            base,
            {
              pageIndex,
              figures,
              overrides: pageOverridesFor(
                equationOverridesRef.current,
                meta.fingerprint,
                pageIndex,
              ),
            },
          )
          if (cancelled) return
          if (docRef.current !== meta) return
          model.documentId = meta.fingerprint
          model.pageIndex = pageIndex
          // A model built from a failed extraction must not be cached: the next
          // visit would hit it and keep an empty reading column even though text
          // extraction may succeed then. A page that legitimately has zero text
          // items still caches, because its extraction succeeded.
          if (textContent !== undefined) writeModel(meta, pageIndex, model)
          // The parse is valid for the page even if the reader has moved on, but it
          // must not be painted as another page's content.
          if (pageIndexRef.current === pageIndex) setPageModel(model)
        } else {
          let textContent
          try {
            textContent = await pageTextContent(meta, pageIndex, page)
          } catch (error) {
            console.warn('pdf-math-reader: text extraction failed', error)
            textContent = undefined
          }
          if (cancelled || textContent === undefined) return
          void paintTextLayer(library, textContent, viewport)
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted || isAbort(error)) return
        setRenderError(error?.message ?? ttRef.current('error.render'))
        setRenderState('error')
      }
    }

    run()
    return () => {
      cancelled = true
      controller.abort()
      textLayerTaskRef.current?.cancel()
      textLayerTaskRef.current = null
    }
  }, [doc, modelRevision, pageIndex, zoomMode, zoom, viewerWidth, renderNonce])

  const cancelPrefetch = useCallback(() => {
    const state = prefetchRef.current
    state.generation += 1
    state.stop?.()
    state.stop = null
    state.controller?.abort()
    state.controller = null
  }, [])

  /**
   * Read ahead one page: build its canonical model and snapshot its raster while
   * the reader is idle, so turning forward is a blit instead of a parse plus a
   * rasterization.
   *
   * The work is cancellable and always runs after the visible page is ready — a
   * page turn aborts it, and its results are discarded unless the document and
   * page are still the ones that asked for them.
   */
  const prefetchPage = useCallback(
    async (targetPage, controller) => {
      const meta = docRef.current
      if (meta === null || targetPage < 0 || targetPage >= meta.numPages) return
      // Forward reading is the priority: read-ahead is only for the page directly
      // in front. If the reader already moved on, skip the work entirely instead
      // of spending it on a page they will not turn to next.
      if (targetPage !== pageIndexRef.current + 1) return
      const stale = () => controller.signal.aborted || docRef.current !== meta
      const library = await loadPdfJs()
      if (stale()) return
      const page = await meta.pdf.getPage(targetPage + 1)
      if (stale()) return
      const base = page.getViewport({ scale: 1 })
      const scale = pageDisplayScale(base.width, viewerWidth, zoomMode, zoom)

      if (readModel(meta, targetPage) === undefined) {
        const [textContent, figures] = await Promise.all([
          pageTextContent(meta, targetPage, page),
          pageFigureRegions(meta, targetPage, page, library, base),
        ])
        if (stale()) return
        const model = buildPageModel(library, textContent, base, {
          pageIndex: targetPage,
          figures,
          overrides: pageOverridesFor(
            equationOverridesRef.current,
            meta.fingerprint,
            targetPage,
          ),
        })
        if (stale()) return
        model.documentId = meta.fingerprint
        model.pageIndex = targetPage
        writeModel(meta, targetPage, model)
      }

      const ratio = pdfPixelRatio()
      const cached = readRaster(meta, targetPage)
      if (
        cached !== undefined &&
        Math.abs(cached.scale - scale) < 1e-3 &&
        cached.ratio === ratio
      ) {
        return
      }
      // Decide before allocating: a page too large for the raster budget is drawn
      // once for the reader, never once more for a cache that would reject it.
      const viewport = page.getViewport({ scale })
      if (
        !supportsRasterSnapshot() ||
        !rasterFitsBudget(
          Math.floor(viewport.width * ratio),
          Math.floor(viewport.height * ratio),
        )
      ) {
        return
      }
      // Render into a detached canvas so nothing touches the visible page. The
      // snapshot is started inside the same queued task, so an aborted prefetch
      // can never leave a bitmap of some other page in the cache.
      const canvas = document.createElement('canvas')
      const version = (rasterSeqRef.current += 1)
      const { snapshot } = await renderPdfPage(page, canvas, scale, controller.signal, {
        snapshot: true,
      })
      if (snapshot === null) return
      snapshot
        .then((bitmap) => {
          if (bitmap === null || bitmap === undefined) return
          if (docRef.current !== meta) {
            releaseRaster({ bitmap })
            return
          }
          // The copy may outlive the turn it was made for: if the reader has gone
          // back or jumped away, keeping this raster would evict the page they are
          // about to read next. Drop it instead.
          if (!lookaheadIsUseful(targetPage, pageIndexRef.current)) {
            releaseRaster({ bitmap })
            return
          }
          writeRaster(meta, targetPage, {
            bitmap,
            bytes: bitmap.width * bitmap.height * 4,
            ratio,
            scale,
            version,
          })
        })
        .catch(() => {
          // Read-ahead stays an optimization even when the copy fails.
        })
    },
    [viewerWidth, zoom, zoomMode],
  )

  useEffect(() => {
    cancelPrefetch()
    if (doc === null || renderState !== 'ready') return undefined
    // Only read ahead once the visible page has its model: its text extraction and
    // figure detection share the worker with anything started here.
    if (
      pageModel === null ||
      pageModel.pageIndex !== pageIndex ||
      pageModel.documentId !== doc.fingerprint
    ) {
      return undefined
    }
    // Translation and export already compete for the same PDF.js worker.
    if (progress?.running === true) return undefined
    const meta = doc
    const state = prefetchRef.current
    const generation = state.generation
    const controller = new AbortController()
    state.controller = controller

    const next = pageIndex + 1
    const following = pageIndex + 2
    const canPrefetch = next < meta.numPages || following < meta.numPages
    if (!canPrefetch) return undefined

    state.stop = scheduleIdle(() => {
      if (generation !== prefetchRef.current.generation) return
      const run = async () => {
        if (next < meta.numPages) await prefetchPage(next, controller)
        if (controller.signal.aborted) return
        // The page after next only needs its text model, which is cheap and makes
        // a quick double turn skip the parse step.
        if (following < meta.numPages && readModel(meta, following) === undefined) {
          const page = await meta.pdf.getPage(following + 1)
          if (controller.signal.aborted || docRef.current !== meta) return
          const library = await loadPdfJs()
          const base = page.getViewport({ scale: 1 })
          const [textContent, figures] = await Promise.all([
            pageTextContent(meta, following, page),
            pageFigureRegions(meta, following, page, library, base),
          ])
          if (controller.signal.aborted || docRef.current !== meta) return
          const model = buildPageModel(library, textContent, base, {
            pageIndex: following,
            figures,
            overrides: pageOverridesFor(
              equationOverridesRef.current,
              meta.fingerprint,
              following,
            ),
          })
          model.documentId = meta.fingerprint
          model.pageIndex = following
          writeModel(meta, following, model)
        }
      }
      run().catch((error) => {
        if (!isAbort(error) && !controller.signal.aborted) {
          // Read-ahead is an optimization; never surface its failures.
          console.warn('pdf-math-reader: page prefetch failed', error)
        }
      })
    })

    return () => {
      cancelPrefetch()
    }
  }, [cancelPrefetch, doc, pageIndex, pageModel, prefetchPage, progress?.running, renderState])

  useEffect(() => {
    if (!settingsOpen && !exportOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (settingsOpen) setSettingsOpen(false)
      if (exportOpen) setExportOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [settingsOpen, exportOpen])

  useEffect(() => {
    return () => {
      openTaskRef.current += 1
      window.clearTimeout(toastTimerRef.current)
      cancelPrefetch()
      translationAbortRef.current?.abort()
      selectionAbortRef.current?.abort()
      const meta = docRef.current
      docRef.current = null
      disposeCaches(meta)
      if (meta !== null) meta.pdf.destroy?.().catch?.(() => {})
    }
  }, [cancelPrefetch])

  const closeDocument = useCallback(() => {
    openTaskRef.current += 1
    translationEpochRef.current += 1
    cancelPrefetch()
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    selectionAbortRef.current?.abort()
    const meta = docRef.current
    docRef.current = null
    setDoc(null)
    setPageModel(null)
    setPageSize(null)
    setPageScale(1)
    setPageIndex(0)
    setTranslations({})
    setPageTranslationState({})
    setTranslationErrors({})
    setBusyPages({})
    setProgress(null)
    setSelection('')
    setSelectionResult(null)
    setActiveEquation(null)
    setEquationSelectMode(false)
    setEquationRect(null)
    equationImageCacheRef.current.clear()
    setOpenError('')
    disposeCaches(meta)
    if (meta !== null) meta.pdf.destroy?.().catch?.(() => {})
  }, [cancelPrefetch])

  const openFile = useCallback(
    async (file) => {
      if (file === null || file === undefined) return
      if (!isPdfFile(file)) {
        notify(tt('error.fileType'), 'error')
        return
      }
      const taskId = openTaskRef.current + 1
      openTaskRef.current = taskId
      translationEpochRef.current += 1
      cancelPrefetch()
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      selectionAbortRef.current?.abort()
      const previous = docRef.current
      docRef.current = null
      disposeCaches(previous)
      if (previous !== null) previous.pdf.destroy?.().catch?.(() => {})
      setDoc(null)
      setPageModel(null)
      setPageSize(null)
      setPageScale(1)
      setOpenError('')
      setTranslations({})
      setPageTranslationState({})
      setTranslationErrors({})
      setBusyPages({})
      setProgress(null)
      setSelection('')
      setSelectionResult(null)
      setActiveEquation(null)
      setEquationSelectMode(false)
      setEquationRect(null)
      equationImageCacheRef.current.clear()
      setOpening(true)
      try {
        const pdf = await openPdf(file, tt('pdf.passwordPrompt'))
        if (taskId !== openTaskRef.current) {
          await pdf.destroy?.().catch?.(() => {})
          return
        }
        const outline = await resolveOutline(pdf, await pdf.getOutline().catch(() => null))
        if (taskId !== openTaskRef.current) {
          await pdf.destroy?.().catch?.(() => {})
          return
        }
        const meta = {
          pdf,
          file,
          name: file.name,
          fingerprint: fileFingerprint(file),
          numPages: pdf.numPages,
          outline,
          ...createPageCaches(),
        }
        docRef.current = meta
        setDoc(meta)
        setPageIndex(0)
        setOpening(false)
        setRenderState('loading')
        notify(tt('toast.opened', { name: file.name }))
      } catch (error) {
        if (taskId !== openTaskRef.current) return
        setOpening(false)
        setOpenError(error?.message ?? tt('error.open'))
        setRenderState('idle')
      }
    },
    [cancelPrefetch, notify, tt],
  )

  const pickFile = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const onFileInput = useCallback(
    (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file !== undefined) openFile(file)
    },
    [openFile],
  )

  const goToPage = useCallback(
    (next) => {
      if (pageCount === 0) return
      setPageIndex(clamp(next, 0, pageCount - 1))
    },
    [pageCount],
  )

  const commitPageDraft = useCallback(() => {
    const parsed = Number.parseInt(pageDraft, 10)
    if (Number.isFinite(parsed)) goToPage(parsed - 1)
    else setPageDraft(String(pageIndex + 1))
  }, [goToPage, pageDraft, pageIndex])

  /** Explicit retry must bypass the raster cache, or it would repaint the failure. */
  const retryRender = useCallback(() => {
    const meta = docRef.current
    const entry = meta === null ? undefined : readRaster(meta, pageIndex)
    if (entry !== undefined) {
      releaseRaster(entry)
      meta.bitmapCache?.delete?.(pageIndex)
    }
    setRenderNonce((value) => value + 1)
  }, [pageIndex])

  useEffect(() => {
    if (doc === null) return undefined
    const element = viewerRef.current
    if (element === null) return undefined
    const onWheel = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (Date.now() < wheelLockRef.current) return
      const atTop = element.scrollTop <= 2
      const atBottom =
        element.scrollHeight - element.scrollTop - element.clientHeight <= 2
      if (event.deltaY > 0 && atBottom && pageIndex < pageCount - 1) {
        event.preventDefault()
        wheelLockRef.current = Date.now() + 1000
        goToPage(pageIndex + 1)
      } else if (event.deltaY < 0 && atTop && pageIndex > 0) {
        event.preventDefault()
        wheelLockRef.current = Date.now() + 1000
        goToPage(pageIndex - 1)
      }
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [doc, goToPage, pageCount, pageIndex])

  const zoomStep = useCallback(
    (factor) => {
      setZoomMode('custom')
      setZoom(clamp(currentScale * factor, 0.35, 4))
    },
    [currentScale],
  )

  useEffect(() => {
    if (doc === null) return undefined
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') {
        setActiveParagraph(null)
        setActiveEquation(null)
        setEquationSelectMode(false)
        setEquationRect(null)
        equationDragRef.current = null
        clearTextSelection()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToPage(pageIndex - 1)
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToPage(pageIndex + 1)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const element = viewerRef.current
        if (element !== null) {
          const amount = Math.max(80, Math.round(element.clientHeight * 0.85))
          element.scrollBy({
            top: event.key === 'ArrowDown' ? amount : -amount,
            behavior: 'smooth',
          })
        }
        return
      }
      if (key === 'a') {
        event.preventDefault()
        goToPage(pageIndex - 1)
      } else if (key === 'd') {
        event.preventDefault()
        goToPage(pageIndex + 1)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [clearTextSelection, doc, goToPage, pageIndex])

  const lineAtPoint = useCallback(
    (x, y) => {
      // `x`/`y` are pointer offsets inside the page box; the canonical model keeps
      // line boxes in page points, so convert once here.
      const scale = currentScale > 0 ? currentScale : 1
      const px = x / scale
      const py = y / scale
      return pageModel?.lines.find(
        (line) =>
          px >= line.x - 2 / scale &&
          px <= line.x + line.width + 2 / scale &&
          py >= line.top - 2 / scale &&
          py <= line.top + line.height + 2 / scale,
      )
    },
    [currentScale, pageModel],
  )

  const scrollToParagraph = useCallback(
    (paragraphId, model = pageModel) => {
      const paragraph = model?.paragraphs.find((item) => item.id === paragraphId)
      const root = viewerRef.current
      if (paragraph === undefined || root === null) return
      const pageElement = root.querySelector('.pmr-page')
      if (pageElement === null) return
      const rootRect = root.getBoundingClientRect()
      const pageRect = pageElement.getBoundingClientRect()
      const line = paragraph.lines[0]
      if (line === undefined) return
      const scale = currentScale > 0 ? currentScale : 1
      const target =
        root.scrollTop +
        (pageRect.top - rootRect.top) +
        line.top * scale +
        (line.height * scale) / 2 -
        root.clientHeight / 2
      root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    },
    [currentScale, pageModel],
  )

  const focusParagraph = useCallback(
    (paragraphId) => {
      if (activeParagraph === paragraphId) {
        setActiveParagraph(null)
        clearTextSelection()
        return
      }
      setActiveParagraph(paragraphId)
      setActiveEquation(null)
      clearTextSelection()
      scrollToParagraph(paragraphId)
    },
    [activeParagraph, clearTextSelection, scrollToParagraph],
  )

  const scrollToEquation = useCallback(
    (equation) => {
      const root = viewerRef.current
      if (root === null) return
      const pageElement = root.querySelector('.pmr-page')
      if (pageElement === null) return
      const scale = currentScale > 0 ? currentScale : 1
      const rootRect = root.getBoundingClientRect()
      const pageRect = pageElement.getBoundingClientRect()
      const top = equation.bbox[1] * scale
      const height = (equation.bbox[3] - equation.bbox[1]) * scale
      const target =
        root.scrollTop +
        (pageRect.top - rootRect.top) +
        top +
        height / 2 -
        root.clientHeight / 2
      root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    },
    [currentScale],
  )

  const focusEquation = useCallback(
    (equation) => {
      if (activeEquation === equation.id) {
        setActiveEquation(null)
        return
      }
      setActiveEquation(equation.id)
      setActiveParagraph(null)
      clearTextSelection()
      scrollToEquation(equation)
    },
    [activeEquation, clearTextSelection, scrollToEquation],
  )

  const equationAtPoint = useCallback(
    (x, y) =>
      equations.find(
        (equation) =>
          x >= equation.bbox[0] - 2 &&
          x <= equation.bbox[2] + 2 &&
          y >= equation.bbox[1] - 2 &&
          y <= equation.bbox[3] + 2,
      ),
    [equations],
  )

  const figureAtPoint = useCallback(
    (x, y) =>
      figures.find(
        (figure) =>
          x >= figure.bbox[0] - 2 &&
          x <= figure.bbox[2] + 2 &&
          y >= figure.bbox[1] - 2 &&
          y <= figure.bbox[3] + 2,
      ),
    [figures],
  )

  const commitPageOverrides = useCallback(
    (mutator) => {
      const meta = docRef.current
      if (meta === null) return
      const fingerprint = meta.fingerprint
      // The page model (and therefore paragraph ids) is about to change.
      // Cancel any in-flight translation and invalidate its epoch so late
      // responses cannot write results under the old p0/p1 ids.
      translationEpochRef.current += 1
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      setProgress(null)
      setBusyPages({})
      setPageTranslationState((previous) => {
        const next = {}
        for (const [key, value] of Object.entries(previous)) {
          if (value?.status !== 'loading') next[key] = value
        }
        return next
      })
      setEquationOverrides((previous) => {
        const pages = { ...(previous[fingerprint] ?? {}) }
        const current = pages[pageIndex] ?? { added: [], removed: [], figures: [] }
        const updated = mutator({
          added: [...(current.added ?? [])],
          removed: [...(current.removed ?? [])],
          figures: [...(current.figures ?? [])],
        })
        const nextPages = { ...pages }
        if (
          updated.added.length === 0 &&
          updated.removed.length === 0 &&
          (updated.figures?.length ?? 0) === 0
        ) {
          delete nextPages[pageIndex]
        } else {
          nextPages[pageIndex] = updated
        }
        const next = { ...previous }
        if (Object.keys(nextPages).length === 0) delete next[fingerprint]
        else next[fingerprint] = nextPages
        return next
      })
      // A correction changes the model and the crops that point at it, never the
      // PDF pixels: the text items, the raw figure detection and the page raster
      // stay valid and are reused when the page is rebuilt.
      invalidateModel(meta, pageIndex)
      const prefix = `${fingerprint}:${pageIndex}:`
      for (const key of [...equationImageCacheRef.current.keys()]) {
        if (key.startsWith(prefix)) equationImageCacheRef.current.delete(key)
      }
      setTranslations((previous) => {
        if (!(pageIndex in previous)) return previous
        const next = { ...previous }
        delete next[pageIndex]
        return next
      })
      setPageTranslationState((previous) => {
        if (!(pageIndex in previous)) return previous
        const next = { ...previous }
        delete next[pageIndex]
        return next
      })
      setTranslationErrors((previous) => {
        if (!(pageIndex in previous)) return previous
        const next = { ...previous }
        delete next[pageIndex]
        return next
      })
      setActiveEquation(null)
      setModelRevision((value) => value + 1)
    },
    [pageIndex],
  )

  const addManualEquation = useCallback(
    (box) => {
      const model = pageModel
      if (model === null) return
      const atoms = Array.isArray(model.atoms) ? model.atoms : []
      const hasAtom = atoms.some((atom) => {
        if (atom.text.trim() === '') return false
        const centerX = (atom.x + atom.endX) / 2
        const centerY = (atom.y + atom.top + atom.bottom) / 3
        return centerX >= box[0] && centerX <= box[2] && centerY >= box[1] && centerY <= box[3]
      })
      if (!hasAtom) {
        notify(tt('equation.emptyRegion'), 'error')
        return
      }
      commitPageOverrides((previous) => ({
        ...previous,
        added: [
          ...previous.added.filter((entry) => overlapRatio(entry.bbox, box) <= 0.3),
          { bbox: box },
        ],
      }))
      notify(tt('equation.added'))
    },
    [commitPageOverrides, notify, pageModel, tt],
  )

  const removeEquation = useCallback(
    (equation) => {
      commitPageOverrides((previous) => {
        if (equation.detectionSource === 'manual') {
          return {
            ...previous,
            added: previous.added.filter(
              (entry) => overlapRatio(entry.bbox, equation.bbox) <= 0.3,
            ),
          }
        }
        return {
          ...previous,
          removed: [
            ...previous.removed.filter(
              (box) => overlapRatio(box, equation.bbox) <= 0.3,
            ),
            equation.bbox,
          ],
        }
      })
      notify(tt('equation.removed'))
    },
    [commitPageOverrides, notify, tt],
  )

  const removeFigure = useCallback(
    (figure) => {
      commitPageOverrides((previous) => ({
        ...previous,
        figures: [
          ...previous.figures.filter((box) => overlapRatio(box, figure.bbox) <= 0.3),
          figure.bbox,
        ],
      }))
      notify(tt('figure.removed'))
    },
    [commitPageOverrides, notify, tt],
  )

  const resetPageEquations = useCallback(() => {
    commitPageOverrides(() => ({ added: [], removed: [], figures: [] }))
    notify(tt('equation.reset'))
  }, [commitPageOverrides, notify, tt])

  const beginEquationSelection = useCallback(() => {
    if (equationSelectMode) {
      setEquationSelectMode(false)
      setEquationRect(null)
      equationDragRef.current = null
      return
    }
    setEquationSelectMode(true)
    setActiveEquation(null)
    setActiveParagraph(null)
    clearTextSelection()
    notify(tt('equation.selectHint'))
  }, [clearTextSelection, equationSelectMode, notify, tt])

  /**
   * Pointer position in page points. The page box is laid out in display pixels
   * while the canonical model keeps page-point boxes, so the conversion lives in
   * one place for every pointer-driven selection.
   */
  const pagePointFromEvent = useCallback(
    (event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const scale = currentScale > 0 ? currentScale : 1
      const width = pageSize !== null ? pageSize.width / scale : 612
      const height = pageSize !== null ? pageSize.height / scale : 792
      return {
        x: clamp((event.clientX - rect.left) / scale, 0, width),
        y: clamp((event.clientY - rect.top) / scale, 0, height),
      }
    },
    [currentScale, pageSize],
  )

  const onEquationPointerDown = useCallback(
    (event) => {
      if (!equationSelectMode || pageModel === null) return
      if (event.button !== 0) return
      event.preventDefault()
      const point = pagePointFromEvent(event)
      equationDragRef.current = { x0: point.x, y0: point.y }
      setEquationRect({ x0: point.x, y0: point.y, x1: point.x, y1: point.y })
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    [equationSelectMode, pageModel, pagePointFromEvent],
  )

  const onEquationPointerMove = useCallback(
    (event) => {
      const drag = equationDragRef.current
      if (drag === null || pageModel === null) return
      const point = pagePointFromEvent(event)
      setEquationRect({ x0: drag.x0, y0: drag.y0, x1: point.x, y1: point.y })
    },
    [pageModel, pagePointFromEvent],
  )

  const onEquationPointerUp = useCallback(
    (event) => {
      const drag = equationDragRef.current
      if (drag === null || pageModel === null) return
      equationDragRef.current = null
      const point = pagePointFromEvent(event)
      const box = [
        Math.min(drag.x0, point.x),
        Math.min(drag.y0, point.y),
        Math.max(drag.x0, point.x),
        Math.max(drag.y0, point.y),
      ]
      setEquationRect(null)
      if (box[2] - box[0] < 6 || box[3] - box[1] < 4) {
        notify(tt('equation.tooSmall'), 'error')
        return
      }
      setEquationSelectMode(false)
      addManualEquation(box)
    },
    [addManualEquation, notify, pageModel, pagePointFromEvent, tt],
  )

  const handleTextMouseUp = useCallback(
    (event) => {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      const line = lineAtPoint(x, y)
      window.setTimeout(() => {
        const selected = window.getSelection()
        if (selected === null) return
        const text = selected.toString().replace(/\s+/g, ' ').trim()
        if (text !== '') {
          setSelection(text)
          setSelectionResult(null)
          if (line !== undefined) setActiveParagraph(line.paragraphId)
        }
      }, 0)
    },
    [lineAtPoint],
  )

  const handleTextClick = useCallback(
    (event) => {
      if ((window.getSelection()?.toString().trim() ?? '') !== '') return
      const rect = event.currentTarget.getBoundingClientRect()
      const x = (event.clientX - rect.left) / currentScale
      const y = (event.clientY - rect.top) / currentScale
      const equation = equationAtPoint(x, y)
      if (equation !== undefined) {
        setActiveParagraph(null)
        setActiveEquation((previous) => (previous === equation.id ? null : equation.id))
        return
      }
      const figure = figureAtPoint(x, y)
      if (figure !== undefined) {
        setActiveParagraph(null)
        setActiveEquation((previous) => (previous === figure.id ? null : figure.id))
        return
      }
      const line = lineAtPoint(event.clientX - rect.left, event.clientY - rect.top)
      if (line === undefined) {
        setActiveParagraph(null)
        setActiveEquation(null)
        return
      }
      setActiveEquation(null)
      if (activeParagraph === line.paragraphId) {
        setActiveParagraph(null)
        clearTextSelection()
      } else {
        setActiveParagraph(line.paragraphId)
      }
    },
    [activeParagraph, clearTextSelection, currentScale, equationAtPoint, figureAtPoint, lineAtPoint],
  )

  const saveNote = useCallback(() => {
    const text = noteText.trim()
    if (docFingerprint === '' || currentParagraph === undefined || text === '') {
      notify(tt('notes.selectFirst'), 'error')
      return
    }
    const note = {
      id: existingNote?.id ?? newNoteId(),
      doc: docFingerprint,
      pageIndex,
      paragraphId: currentParagraph.id,
      source: currentParagraph.text,
      sourceSnippet: currentParagraph.text.replace(/\s+/g, ' ').trim().slice(0, 180),
      // Canonical page points; older notes carry no unit and stored display pixels.
      anchorTop: currentParagraph.lines[0]?.top ?? null,
      anchorUnit: 'pt',
      text,
      updatedAt: Date.now(),
    }
    setNotes((previous) => {
      const index = previous.findIndex((entry) => entry.id === note.id)
      if (index < 0) return [...previous, note]
      const next = [...previous]
      next[index] = note
      return next
    })
    notify(tt('notes.saved'))
  }, [currentParagraph, docFingerprint, existingNote, noteText, notify, pageIndex, tt])

  const deleteNote = useCallback(
    (id, event) => {
      event?.stopPropagation?.()
      setNotes((previous) => previous.filter((note) => note.id !== id))
    },
    [],
  )

  const saveNotesToFile = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return
    if (docNotes.length === 0) {
      notify(tt('notes.noNotes'), 'error')
      return
    }
    const lines = [`# ${meta.name}`, '', `> ${tt('notes.title')} · ${new Date().toLocaleString()}`, '']
    for (const note of [...docNotes].sort((left, right) => left.pageIndex - right.pageIndex)) {
      lines.push(`## ${tt('page.short', { page: note.pageIndex + 1 })}`, '')
      if (note.source) lines.push(`> ${note.source.replace(/\s+/g, ' ')}`, '')
      lines.push(note.text, '')
    }
    try {
      const response = await saveNotes({
        directory: settings.saveDir,
        fileName: meta.name,
        markdown: lines.join('\n'),
      })
      notify(tt('notes.savedTo', { path: response.path }))
    } catch (error) {
      notify(`${tt('notes.saveFailed')}: ${error?.message ?? ''}`, 'error')
    }
  }, [docNotes, notify, settings.saveDir, tt])

  const scrollToOffset = useCallback(
    (top, model = pageModel, behavior = 'smooth') => {
      const root = viewerRef.current
      if (root === null || model === null) return
      const pageElement = root.querySelector('.pmr-page')
      if (pageElement === null) return
      const rootRect = root.getBoundingClientRect()
      const pageRect = pageElement.getBoundingClientRect()
      const target =
        root.scrollTop + (pageRect.top - rootRect.top) + top - root.clientHeight / 3
      root.scrollTo({ top: Math.max(0, target), behavior })
    },
    [pageModel],
  )

  const focusNote = useCallback(
    (note) => {
      clearTextSelection()
      const root = viewerRef.current
      setReturnTarget({
        documentId: note.doc,
        pageIndex,
        scrollTop: root?.scrollTop ?? 0,
        paragraphId: activeParagraph,
      })
      const requestId = focusRequestIdRef.current + 1
      focusRequestIdRef.current = requestId
      const request = {
        documentId: note.doc,
        pageIndex: note.pageIndex,
        paragraphId: note.paragraphId,
        sourceSnippet: note.sourceSnippet ?? note.source ?? '',
        anchorTop: Number.isFinite(note.anchorTop) ? note.anchorTop : null,
        // Notes saved before the canonical model stored display pixels; newer ones
        // store page points. The unit decides whether the anchor needs scaling.
        anchorUnit: note.anchorUnit === 'pt' ? 'pt' : 'px',
        requestId,
      }
      pendingFocusRef.current = request
      pendingScrollRef.current = null
      setFocusRequest(request)
      if (note.pageIndex !== pageIndex) {
        setActiveParagraph(null)
        setPageIndex(note.pageIndex)
      }
    },
    [activeParagraph, clearTextSelection, pageIndex],
  )

  const applyReturnScroll = useCallback((target) => {
    const root = viewerRef.current
    if (root === null) return
    window.requestAnimationFrame(() => {
      root.scrollTo({ top: target.scrollTop, behavior: 'auto' })
      setActiveParagraph(target.paragraphId ?? null)
    })
  }, [])

  const returnToPrevious = useCallback(() => {
    const target = returnTarget
    if (target === null) return
    setReturnTarget(null)
    pendingFocusRef.current = null
    setFocusRequest(null)
    if (target.pageIndex === pageIndex) {
      pendingScrollRef.current = null
      applyReturnScroll(target)
    } else {
      pendingScrollRef.current = target
      setActiveParagraph(null)
      setPageIndex(target.pageIndex)
    }
  }, [applyReturnScroll, pageIndex, returnTarget])

  useEffect(() => {
    const request = pendingFocusRef.current
    if (request === null || pageModel === null || doc === null) return
    if (
      request.documentId !== pageModel.documentId ||
      request.pageIndex !== pageModel.pageIndex ||
      request.documentId !== doc.fingerprint ||
      request.pageIndex !== pageIndex
    ) {
      return
    }
    const paragraph = findParagraphByAnchor(
      pageModel.paragraphs,
      request.paragraphId,
      request.sourceSnippet,
    )
    if (paragraph !== undefined) {
      setActiveParagraph(paragraph.id)
      window.requestAnimationFrame(() => {
        if (pendingFocusRef.current?.requestId !== request.requestId) return
        scrollToParagraph(paragraph.id, pageModel)
        pendingFocusRef.current = null
        setFocusRequest(null)
      })
      return
    }
    // A page-point anchor needs the display scale; a legacy anchor was already
    // saved in display pixels and must be used as it is.
    if (request.anchorTop !== null) {
      const anchorTop = request.anchorUnit === 'pt' ? request.anchorTop * currentScale : request.anchorTop
      scrollToOffset(anchorTop, pageModel)
    }
    if (pendingFocusRef.current?.requestId === request.requestId) {
      pendingFocusRef.current = null
      setFocusRequest(null)
      notify(tt('notes.notFound'), 'error')
    }
  }, [
    currentScale,
    doc,
    focusRequest,
    notify,
    pageIndex,
    pageModel,
    scrollToOffset,
    scrollToParagraph,
    tt,
  ])

  useEffect(() => {
    const target = pendingScrollRef.current
    if (target === null || pageModel === null || doc === null) return
    if (
      target.documentId !== pageModel.documentId ||
      target.pageIndex !== pageModel.pageIndex ||
      target.documentId !== doc.fingerprint
    ) {
      return
    }
    pendingScrollRef.current = null
    applyReturnScroll(target)
  }, [applyReturnScroll, doc, pageModel])

  useEffect(() => {
    setReturnTarget(null)
  }, [docFingerprint])

  const setTranslationFor = useCallback((targetPage, id, text) => {
    setTranslations((previous) => ({
      ...previous,
      [targetPage]: {
        ...(previous[targetPage] ?? {}),
        [id]: { text },
      },
    }))
    setTranslationErrors((previous) => {
      const page = previous[targetPage]
      if (page === undefined || page[id] === undefined) return previous
      const nextPage = { ...page }
      delete nextPage[id]
      const next = { ...previous, [targetPage]: nextPage }
      if (Object.keys(nextPage).length === 0) delete next[targetPage]
      return next
    })
  }, [])

  const setTranslationError = useCallback((targetPage, id, message) => {
    setTranslationErrors((previous) => ({
      ...previous,
      [targetPage]: { ...(previous[targetPage] ?? {}), [id]: message },
    }))
  }, [])

  const clearTranslationError = useCallback((targetPage, id) => {
    setTranslationErrors((previous) => {
      const page = previous[targetPage]
      if (page === undefined || page[id] === undefined) return previous
      const nextPage = { ...page }
      delete nextPage[id]
      const next = { ...previous, [targetPage]: nextPage }
      if (Object.keys(nextPage).length === 0) delete next[targetPage]
      return next
    })
  }, [])

  const translatePageInternal = useCallback(
    async (targetPage, targetParagraphs, options = {}) => {
      const signal = options.signal
      const force = options.force === true
      const epoch = translationEpochRef.current
      const targetLanguage = settings.targetLanguage
      const selectionKey = translationSelectionKey ?? 'default'
      const usable = targetParagraphs.filter((paragraph) => paragraph.text.trim() !== '')
      if (epoch !== translationEpochRef.current) return false
      if (usable.length === 0) {
        setPageTranslationState((previous) => ({
          ...previous,
          [targetPage]: { status: 'empty' },
        }))
        return false
      }
      if (signal?.aborted) return false
      setBusyPages((previous) => ({ ...previous, [targetPage]: true }))
      setPageTranslationState((previous) => ({
        ...previous,
        [targetPage]: { status: 'loading' },
      }))
      let applied = 0
      let failed = 0
      try {
        const entries = usable.map((paragraph) => ({
          id: paragraph.id,
          text: paragraph.translateText || paragraph.text,
          paragraph,
        }))
        const batches = makeBatches(entries, 5, 3800)
        for (const batch of batches) {
          if (signal?.aborted || epoch !== translationEpochRef.current) {
            throw new DOMException('Aborted', 'AbortError')
          }
          const pending = []
          for (const entry of batch) {
            const key = `${targetLanguage}\u0000${selectionKey}\u0000${glossaryKeyValue}\u0000${entry.text}`
            if (!force) {
              const cached = translationCacheRef.current.get(key)
              if (cached !== undefined) {
                setTranslationFor(
                  targetPage,
                  entry.id,
                  restorePlaceholders(cached, entry.paragraph.placeholders),
                )
                applied += 1
                continue
              }
            }
            pending.push({ entry, key })
          }
          if (pending.length === 0) continue
          const response = await translateSegments(
            {
              targetLanguage,
              sourceLanguage: 'auto',
              glossary,
              segments: pending.map(({ entry }) => ({ id: entry.id, text: entry.text })),
              modelSelection: settings.translationSelection,
              refresh: force,
            },
            signal,
          )
          if (epoch !== translationEpochRef.current) return false
          const byId = new Map(
            (Array.isArray(response.translations) ? response.translations : []).map((item) => [
              item.id,
              item,
            ]),
          )
          for (const { entry, key } of pending) {
            const item = byId.get(entry.id)
            if (item === undefined || item.error === 'placeholder') {
              failed += 1
              setTranslationError(
                targetPage,
                entry.id,
                tt('error.placeholder'),
              )
              continue
            }
            const text = typeof item.text === 'string' ? item.text : entry.text
            translationCacheRef.current.set(key, text)
            setTranslationFor(
              targetPage,
              entry.id,
              restorePlaceholders(text, entry.paragraph.placeholders),
            )
            applied += 1
          }
        }
        if (epoch !== translationEpochRef.current) return false
        setPageTranslationState((previous) => ({
          ...previous,
          [targetPage]:
            failed > 0
              ? { status: 'error', error: tt('panel.placeholderFailed', { count: failed }) }
              : { status: 'done' },
        }))
        return failed === 0
      } catch (error) {
        if (epoch !== translationEpochRef.current) return false
        if (signal?.aborted || isAbort(error)) {
          setPageTranslationState((previous) => ({
            ...previous,
            [targetPage]: { status: applied > 0 ? 'done' : 'idle' },
          }))
          return false
        }
        setPageTranslationState((previous) => ({
          ...previous,
          [targetPage]: { status: 'error', error: error?.message ?? tt('error.translate') },
        }))
        throw error
      } finally {
        if (epoch === translationEpochRef.current) {
          setBusyPages((previous) => {
            const next = { ...previous }
            delete next[targetPage]
            return next
          })
        }
      }
    },
    [
      glossary,
      glossaryKeyValue,
      setTranslationError,
      setTranslationFor,
      settings.targetLanguage,
      translationSelectionKey,
      tt,
    ],
  )

  const translateCurrentPage = useCallback(() => {
    if (!pageModel || readingUnits.length === 0 || pageBusy) return
    translationAbortRef.current?.abort()
    const controller = new AbortController()
    translationAbortRef.current = controller
    setProgress(null)
    translatePageInternal(pageIndex, readingUnits, {
      force: hasPageTranslation,
      signal: controller.signal,
    })
      .catch((error) => {
        if (!controller.signal.aborted && !isAbort(error)) {
          notify(`${tt('error.translate')}: ${error?.message ?? ''}`, 'error')
        }
      })
      .finally(() => {
        if (translationAbortRef.current === controller) translationAbortRef.current = null
      })
  }, [
    hasPageTranslation,
    notify,
    pageBusy,
    pageIndex,
    pageModel,
    readingUnits,
    translatePageInternal,
    tt,
  ])

  const retryUnit = useCallback(
    (unit) => {
      if (!pageModel || pageBusy || unit === undefined) return
      translationAbortRef.current?.abort()
      const controller = new AbortController()
      translationAbortRef.current = controller
      clearTranslationError(pageIndex, unit.id)
      translatePageInternal(pageIndex, [unit], {
        force: true,
        signal: controller.signal,
      })
        .catch((error) => {
          if (!controller.signal.aborted && !isAbort(error)) {
            notify(`${tt('error.translate')}: ${error?.message ?? ''}`, 'error')
          }
        })
        .finally(() => {
          if (translationAbortRef.current === controller) translationAbortRef.current = null
        })
    },
    [
      clearTranslationError,
      notify,
      pageBusy,
      pageIndex,
      pageModel,
      translatePageInternal,
      tt,
    ],
  )

  const getPageModel = useCallback(async (targetPage) => {
    const meta = docRef.current
    if (meta === null) return { blocks: [], paragraphs: [] }
    const cached = readModel(meta, targetPage)
    if (cached !== undefined) return cached
    const page = await meta.pdf.getPage(targetPage + 1)
    const library = await loadPdfJs()
    const base = page.getViewport({ scale: 1 })
    // Same caches as the viewer: a page already parsed for display is reused here,
    // and a page parsed here is shown without a second extraction.
    const [textContent, figures] = await Promise.all([
      pageTextContent(meta, targetPage, page),
      pageFigureRegions(meta, targetPage, page, library, base),
    ])
    if (docRef.current !== meta) return { blocks: [], paragraphs: [] }
    const model = buildPageModel(library, textContent, base, {
      pageIndex: targetPage,
      figures,
      overrides: pageOverridesFor(
        equationOverridesRef.current,
        meta.fingerprint,
        targetPage,
      ),
    })
    model.documentId = meta.fingerprint
    model.pageIndex = targetPage
    writeModel(meta, targetPage, model)
    return model
  }, [])

  const stopTranslation = useCallback(() => {
    translationAbortRef.current?.abort()
    setProgress(null)
  }, [])

  const translateAll = useCallback(async () => {
    const meta = docRef.current
    if (meta === null || progress?.running) return
    translationAbortRef.current?.abort()
    const controller = new AbortController()
    translationAbortRef.current = controller
    const epoch = translationEpochRef.current
    setProgress({ running: true, done: 0, total: meta.numPages })
    try {
      for (let index = 0; index < meta.numPages; index += 1) {
        if (controller.signal.aborted || epoch !== translationEpochRef.current) break
        setProgress({ running: true, done: index, total: meta.numPages })
        const model = await getPageModel(index)
        if (controller.signal.aborted || epoch !== translationEpochRef.current) break
        const composed = composeReading(model)
        if (composed.units.length > 0) {
          await translatePageInternal(index, composed.units, { signal: controller.signal })
        }
        if (epoch !== translationEpochRef.current) break
        setProgress({ running: true, done: index + 1, total: meta.numPages })
      }
      if (controller.signal.aborted) notify(tt('toast.cancelled'))
    } catch (error) {
      if (!controller.signal.aborted && !isAbort(error)) {
        notify(`${tt('error.translate')}: ${error?.message ?? ''}`, 'error')
      }
    } finally {
      if (translationAbortRef.current === controller) translationAbortRef.current = null
      if (epoch === translationEpochRef.current) setProgress(null)
    }
  }, [getPageModel, notify, progress?.running, translatePageInternal, tt])

  const translateSelection = useCallback(async () => {
    const source = selection.trim()
    if (source === '') return
    const epoch = translationEpochRef.current
    const targetLanguage = settings.targetLanguage
    selectionAbortRef.current?.abort()
    const controller = new AbortController()
    selectionAbortRef.current = controller
    setSelectionResult({ status: 'loading', source })
    try {
      const response = await translateSegments(
        {
          targetLanguage,
          sourceLanguage: 'auto',
          glossary,
          segments: [{ id: 'selection', text: source }],
          modelSelection: settings.translationSelection,
          refresh: false,
        },
        controller.signal,
      )
      const text = response.translations?.[0]?.text ?? ''
      if (!controller.signal.aborted && epoch === translationEpochRef.current) {
        setSelectionResult({ status: 'done', source, text })
        setRightOpen(true)
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        !isAbort(error) &&
        epoch === translationEpochRef.current
      ) {
        setSelectionResult({
          status: 'error',
          source,
          error: error?.message ?? tt('selection.failed'),
        })
      }
    } finally {
      if (selectionAbortRef.current === controller) selectionAbortRef.current = null
    }
  }, [glossary, selection, settings.targetLanguage, settings.translationSelection, tt])

  const copyText = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text)
        notify(tt('toast.copied'))
      } catch {
        window.prompt(tt('action.copy'), text)
      }
    },
    [notify, tt],
  )

  const copyPage = useCallback(
    (translatedOnly) => {
      const parts = []
      for (const block of readingBlocks) {
        if (block.type === 'authors') {
          const people = block.authors.map((author) => {
            const translatedAffiliation =
              translatedOnly && author.affiliationId
                ? pageTranslation[author.affiliationId]?.text
                : undefined
            return [
              `${author.name}${author.marks ? ` ${author.marks}` : ''}`,
              translatedAffiliation || author.affiliation,
              author.email,
            ]
              .filter(Boolean)
              .join(' · ')
          })
          if (people.length > 0) parts.push(people.join('\n'))
          continue
        }
        if (block.type === 'equation') {
          if (!translatedOnly && block.text) parts.push(block.text)
          continue
        }
        if (block.type === 'figure') continue
        const translated = block.translationId
          ? pageTranslation[block.translationId]?.text
          : undefined
        const value = translatedOnly ? translated : block.text ?? block.paragraph?.text
        if (value) parts.push(value)
      }
      if (parts.length === 0) {
        notify(tt(translatedOnly ? 'toast.noTranslation' : 'toast.noText'), 'error')
        return
      }
      copyText(parts.join('\n\n'))
    },
    [copyText, notify, pageTranslation, readingBlocks, tt],
  )

  const clearCache = useCallback(() => {
    translationCacheRef.current.clear()
    setTranslations({})
    setPageTranslationState({})
    setTranslationErrors({})
    notify(tt('toast.cacheCleared'))
  }, [notify, tt])

  const collectPages = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return []
    const pages = []
    for (let index = 0; index < meta.numPages; index += 1) {
      // One canonical model per page, with the same LRU bound as the viewer, so a
      // long document cannot pin every page in memory for chat or export.
      const model = await getPageModel(index)
      if (docRef.current !== meta) return []
      if ((model.blocks?.length ?? 0) > 0) {
        pages.push({ index, model, blocks: model.blocks, paragraphs: model.paragraphs })
      }
    }
    return pages
  }, [getPageModel])

  const buildChatContext = useCallback(
    async (scope) => {
      const meta = docRef.current
      if (meta === null) return { text: '', label: '' }
      const cacheKey = `${meta.fingerprint}:${scope}:${scope === 'page' ? pageIndex : 'all'}`
      const cached = chatContextCacheRef.current.get(cacheKey)
      if (cached !== undefined) return cached

      let pages = []
      let label = ''
      if (scope === 'document') {
        pages = await collectPages()
        label = '全文'
      } else {
        const indices = [pageIndex - 1, pageIndex, pageIndex + 1].filter(
          (index) => index >= 0 && index < meta.numPages,
        )
        for (const index of indices) {
          const model = await getPageModel(index)
          if ((model.blocks?.length ?? 0) > 0) {
            pages.push({ index, blocks: model.blocks, paragraphs: model.paragraphs })
          }
        }
        label = `第 ${pageIndex + 1} 页及相邻页`
      }

      const text = pages
        .map((page) => {
          const content = (page.blocks ?? []).map((block) =>
            block.type === 'equation'
              ? `[${tt('equation.context', { number: block.equationNumber ?? '' })}] ${block.text}`
              : block.text,
          )
          return `[Page ${page.index + 1}]\n${content.join('\n\n')}`
        })
        .join('\n\n')
      const clipped =
        text.length > 22000
          ? `${text.slice(0, 16000)}\n\n[... context truncated ...]\n\n${text.slice(-5600)}`
          : text
      const value = { text: clipped, label }
      chatContextCacheRef.current.set(cacheKey, value)
      return value
    },
    [collectPages, getPageModel, pageIndex, tt],
  )

  const sendChat = useCallback(
    async (suggestion) => {
      if (chatBusy || docRef.current === null) return
      const question = String(suggestion ?? chatInput).trim()
      if (question === '') return
      const history = chatMessages
        .filter((message) => message.error !== true)
        .slice(-8)
        .map((message) => ({ role: message.role, content: message.content }))
      chatAbortRef.current?.abort()
      const controller = new AbortController()
      chatAbortRef.current = controller
      setChatError('')
      setChatInput('')
      setChatMessages((previous) => [...previous, { role: 'user', content: question }])
      setChatBusy(true)
      setChatStatus('reading')
      try {
        const context = await buildChatContext(chatScope)
        if (controller.signal.aborted) return
        if (context.text.trim() === '') {
          throw new Error(tt('reading.noContext'))
        }
        setChatStatus('thinking')
        const response = await chatWithPaper(
          {
            question,
            history,
            context: context.text,
            contextLabel: context.label,
            skill: skill === null ? undefined : { name: skill.name, content: skill.content },
            modelSelection: settings.chatSelection,
          },
          controller.signal,
        )
        if (controller.signal.aborted) return
        setChatMessages((previous) => [
          ...previous,
          { role: 'assistant', content: response.answer },
        ])
      } catch (error) {
        if (!controller.signal.aborted && !isAbort(error)) {
          setChatError(error?.message ?? tt('reading.failed'))
        }
      } finally {
        if (chatAbortRef.current === controller) chatAbortRef.current = null
        setChatBusy(false)
        setChatStatus('')
      }
    },
    [
      buildChatContext,
      chatBusy,
      chatInput,
      chatMessages,
      chatScope,
      settings.chatSelection,
      skill,
      tt,
    ],
  )

  const stopChat = useCallback(() => {
    chatAbortRef.current?.abort()
    setChatBusy(false)
    setChatStatus('')
  }, [])

  const clearChat = useCallback(() => {
    chatAbortRef.current?.abort()
    chatAbortRef.current = null
    setChatMessages([])
    setChatError('')
    setChatBusy(false)
    setChatStatus('')
  }, [])

  const openSkillPicker = useCallback(async () => {
    setSkillsOpen(true)
    setSkillError('')
    if (skillList.length > 0 || skillsLoading) return
    setSkillsLoading(true)
    try {
      const payload = await listSkills()
      setSkillList(Array.isArray(payload.skills) ? payload.skills : [])
    } catch (error) {
      setSkillError(error?.message ?? tt('skills.failed'))
    } finally {
      setSkillsLoading(false)
    }
  }, [skillList.length, skillsLoading, tt])

  const chooseSkill = useCallback(
    async (name) => {
      if (chatBusy) return
      setSkillError('')
      try {
        const payload = await loadSkill(name)
        setSkill({
          name: payload.name,
          description: payload.description ?? '',
          content: payload.content ?? '',
        })
        setSkillsOpen(false)
      } catch (error) {
        setSkillError(error?.message ?? tt('skills.failed'))
      }
    },
    [chatBusy, tt],
  )

  const importSkillFile = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file === undefined) return
      try {
        const content = (await file.text()).trim()
        if (content === '') throw new Error(tt('skills.emptyFile'))
        setSkill({
          name: file.name.replace(/\.(md|txt|markdown)$/i, ''),
          description: tt('skills.localFile'),
          content: content.slice(0, 20000),
        })
        setSkillsOpen(false)
        setSkillError('')
      } catch (error) {
        setSkillError(error?.message ?? tt('skills.failed'))
      }
    },
    [tt],
  )

  const removeSkill = useCallback(() => {
    setSkill(null)
    setSkillError('')
  }, [])

  useEffect(() => {
    if (rightTab !== 'reading') return
    chatEndRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [chatBusy, chatMessages, rightTab])

  const renderExportImages = useCallback(async (meta, pages) => {
    const images = new Map()
    for (const page of pages) {
      const pageBlocks = (page.blocks ?? []).filter(
        (block) => block.type === 'equation' || block.type === 'figure',
      )
      if (pageBlocks.length === 0) continue
      let pdfPage
      try {
        pdfPage = await meta.pdf.getPage(page.index + 1)
      } catch {
        continue
      }
      for (const block of pageBlocks) {
        try {
          const cropBox = block.imageBbox ?? block.bbox
          const result = await renderEquationCrop(pdfPage, cropBox, {
            displayWidth: Math.min(
              1400,
              Math.max(320, (cropBox[2] - cropBox[0]) * 3),
            ),
            devicePixelRatio: 2,
            maxPixels: 8000000,
            maxScale: 6,
          })
          images.set(`${page.index}:${block.id}`, result)
        } catch {
          // The text fallback keeps the export complete when a crop fails.
        }
      }
    }
    return images
  }, [])

  const exportMarkdown = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return
    setExportOpen(false)
    const pages = await collectPages()
    if (pages.length === 0) {
      notify(tt('error.exportEmpty'), 'error')
      return
    }
    const lines = [
      `# ${meta.name}`,
      '',
      `> ${tt('export.generated')} · ${new Date().toLocaleString()} · ${settings.targetLanguage}`,
      '',
    ]
    for (const page of pages) {
      lines.push(`## ${tt('page.short', { page: page.index + 1 })}`, '')
      const reading = page.model ? composeReading(page.model) : { blocks: page.blocks ?? [] }
      for (const block of reading.blocks) {
        if (block.type === 'title') {
          lines.push(`### ${block.text}`, '')
          const translated = translations[page.index]?.[block.translationId]?.text
          if (translated) lines.push(translated, '')
          continue
        }
        if (block.type === 'authors') {
          lines.push(`**${tt('reading.authors')}**`, '')
          lines.push(
            block.authors
              .map((author) => exportAuthorLine(author, translations[page.index]))
              .join('  \n'),
            '',
          )
          continue
        }
        if (block.type === 'abstract' || block.type === 'keywords') {
          const label =
            block.type === 'abstract' ? tt('reading.abstract') : tt('reading.keywords')
          if (block.showLabel !== false) lines.push(`**${label}**`, '')
          lines.push(`> ${block.text}`, '')
          const translated = translations[page.index]?.[block.translationId]?.text
          if (translated) lines.push(translated, '')
          continue
        }
        if (block.type === 'equation') {
          if (block.equationNumber) {
            lines.push(`**${tt('equation.label')} ${block.equationNumber}**`, '')
          }
          lines.push('```', block.text, '```', '')
          continue
        }
        if (block.type === 'figure') {
          const label = block.figureNumber
            ? `${tt('figure.label')} ${block.figureNumber}`
            : tt('figure.unnumbered')
          lines.push(`**${label}**`, '')
          const labels = (block.labels ?? [])
            .map((line) => line.text)
            .filter((text) => text !== '')
          if (labels.length > 0) {
            lines.push(`${tt('figure.labelsInline')}`, '', ...labels.map((text) => `- ${text}`), '')
          }
          continue
        }
        const paragraph = block.paragraph
        if (paragraph === undefined) continue
        const translated = translations[page.index]?.[block.translationId ?? paragraph.id]?.text
        lines.push(`> ${paragraph.text.replace(/\s+/g, ' ')}`, '')
        if (translated) lines.push(translated, '')
      }
    }
    const filename = `${baseName(meta.name)}-bilingual.md`
    downloadBlob(lines.join('\n'), filename, 'text/markdown;charset=utf-8')
    notify(tt('toast.exported', { name: filename }))
  }, [collectPages, notify, settings.targetLanguage, translations, tt])

  const exportBundle = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return
    setExportOpen(false)
    notify(tt('toast.exporting'))
    const pages = await collectPages()
    if (pages.length === 0) {
      notify(tt('error.exportEmpty'), 'error')
      return
    }
    const images = await renderExportImages(meta, pages)
    const lines = [
      `# ${meta.name}`,
      '',
      `> ${tt('export.generated')} · ${new Date().toLocaleString()} · ${settings.targetLanguage}`,
      '',
    ]
    const files = []
    for (const page of pages) {
      lines.push(`## ${tt('page.short', { page: page.index + 1 })}`, '')
      const reading = page.model ? composeReading(page.model) : { blocks: page.blocks ?? [] }
      for (const block of reading.blocks) {
        if (block.type === 'title') {
          lines.push(`### ${block.text}`, '')
          const translated = translations[page.index]?.[block.translationId]?.text
          if (translated) lines.push(translated, '')
          continue
        }
        if (block.type === 'authors') {
          lines.push(`**${tt('reading.authors')}**`, '')
          lines.push(
            block.authors
              .map((author) => exportAuthorLine(author, translations[page.index]))
              .join('  \n'),
            '',
          )
          continue
        }
        if (block.type === 'abstract' || block.type === 'keywords') {
          const label =
            block.type === 'abstract' ? tt('reading.abstract') : tt('reading.keywords')
          if (block.showLabel !== false) lines.push(`**${label}**`, '')
          lines.push(`> ${block.text}`, '')
          const translated = translations[page.index]?.[block.translationId]?.text
          if (translated) lines.push(translated, '')
          continue
        }
        if (block.type === 'equation') {
          const image = images.get(`${page.index}:${block.id}`)
          const label = block.equationNumber
            ? `${tt('equation.label')} ${block.equationNumber}`
            : tt('equation.unnumbered')
          if (image !== undefined) {
            const name = `equations/${block.id}.png`
            files.push({ name, data: dataUrlToBytes(image.dataUrl) })
            lines.push(`![${label}](${name})`, '')
          } else {
            lines.push(`**${label}**`, '', '```', block.text, '```', '')
          }
          continue
        }
        if (block.type === 'figure') {
          const image = images.get(`${page.index}:${block.id}`)
          const label = block.figureNumber
            ? `${tt('figure.label')} ${block.figureNumber}`
            : tt('figure.unnumbered')
          if (image !== undefined) {
            const name = `figures/${block.id}.png`
            files.push({ name, data: dataUrlToBytes(image.dataUrl) })
            lines.push(`![${label}](${name})`, '')
          }
          const labels = (block.labels ?? [])
            .map((line) => line.text)
            .filter((text) => text !== '')
          if (labels.length > 0) {
            lines.push(`${tt('figure.labelsInline')}`, '', ...labels.map((text) => `- ${text}`), '')
          }
          continue
        }
        const paragraph = block.paragraph
        if (paragraph === undefined) continue
        const translated = translations[page.index]?.[block.translationId ?? paragraph.id]?.text
        lines.push(`> ${paragraph.text.replace(/\s+/g, ' ')}`, '')
        if (translated) lines.push(translated, '')
      }
    }
    const markdown = lines.join('\n')
    files.unshift({ name: `${baseName(meta.name)}-bilingual.md`, data: markdown })
    const zip = createZip(files)
    const filename = `${baseName(meta.name)}-bilingual.zip`
    downloadBlob(new Blob([zip], { type: 'application/zip' }), filename, 'application/zip')
    notify(tt('toast.exported', { name: filename }))
  }, [collectPages, notify, renderExportImages, settings.targetLanguage, translations, tt])

  const exportHtml = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return
    setExportOpen(false)
    notify(tt('toast.exporting'))
    const pages = await collectPages()
    if (pages.length === 0) {
      notify(tt('error.exportEmpty'), 'error')
      return
    }
    const images = await renderExportImages(meta, pages)
    const body = pages
      .map((page) => {
        const reading = page.model ? composeReading(page.model) : { blocks: page.blocks ?? [] }
        const content = reading.blocks
          .map((block) => {
            if (block.type === 'title') {
              const translated = translations[page.index]?.[block.translationId]?.text
              return `<div class="paper-title"><div class="src">${escapeHtml(block.text)}</div>${
                translated ? `<div class="tr">${escapeHtml(translated)}</div>` : ''
              }</div>`
            }
            if (block.type === 'authors') {
              const people = block.authors
                .map((author) => {
                  const translated = author.affiliationId
                    ? translations[page.index]?.[author.affiliationId]?.text
                    : undefined
                  const showTranslation =
                    typeof translated === 'string' &&
                    translated.trim() !== '' &&
                    translated !== author.affiliation
                  return [
                    `${escapeHtml(author.name)}${
                      author.marks !== ''
                        ? `<sup>${escapeHtml(author.marks)}</sup>`
                        : ''
                    }`,
                    escapeHtml(author.affiliation),
                    showTranslation
                      ? `<span class="aff-tr">${escapeHtml(translated)}</span>`
                      : '',
                    escapeHtml(author.email),
                  ]
                    .filter(Boolean)
                    .join(' · ')
                })
                .join(' · ')
              return `<div class="authors"><strong>${escapeHtml(
                tt('reading.authors'),
              )}</strong><div>${people}</div></div>`
            }
            if (block.type === 'abstract' || block.type === 'keywords') {
              const label =
                block.type === 'abstract'
                  ? tt('reading.abstract')
                  : tt('reading.keywords')
              const translated = translations[page.index]?.[block.translationId]?.text
              return `<div class="card">${
                block.showLabel !== false ? `<strong>${escapeHtml(label)}</strong>` : ''
              }<div class="src">${escapeHtml(block.text)}</div>${
                translated ? `<div class="tr">${escapeHtml(translated)}</div>` : ''
              }</div>`
            }
            if (block.type === 'equation') {
              const image = images.get(`${page.index}:${block.id}`)
              const label = block.equationNumber
                ? `${tt('equation.label')} ${block.equationNumber}`
                : tt('equation.unnumbered')
              const preview =
                image !== undefined
                  ? `<img src="${image.dataUrl}" alt="${escapeHtml(label)}">`
                  : `<pre>${escapeHtml(block.text)}</pre>`
              return `<figure class="equation">${preview}<figcaption>${escapeHtml(label)}</figcaption></figure>`
            }
            if (block.type === 'figure') {
              const image = images.get(`${page.index}:${block.id}`)
              const label = block.figureNumber
                ? `${tt('figure.label')} ${block.figureNumber}`
                : tt('figure.unnumbered')
              const preview =
                image !== undefined
                  ? `<img src="${image.dataUrl}" alt="${escapeHtml(label)}">`
                  : ''
              const labels = (block.labels ?? [])
                .map((line) => `<li>${escapeHtml(line.text)}</li>`)
                .join('')
              return `<figure class="figure">${preview}<figcaption>${escapeHtml(
                label,
              )}</figcaption>${
                labels !== ''
                  ? `<details><summary>${escapeHtml(
                      tt('figure.labels', { count: (block.labels ?? []).length }),
                    )}</summary><ul>${labels}</ul></details>`
                  : ''
              }</figure>`
            }
            const paragraph = block.paragraph
            if (paragraph === undefined) return ''
            const translated = translations[page.index]?.[block.translationId ?? paragraph.id]?.text
            return `<div class="card"><div class="src">${escapeHtml(paragraph.text)}</div>${
              translated ? `<div class="tr">${escapeHtml(translated)}</div>` : ''
            }</div>`
          })
          .join('\n')
        return `<section><h2>${escapeHtml(tt('page.short', { page: page.index + 1 }))}</h2>${content}</section>`
      })
      .join('\n')
    const html = `<!doctype html>
<html lang="${escapeHtml(settings.targetLanguage)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.name)} · ${escapeHtml(tt('page.title'))}</title>
<style>
:root { color-scheme: light dark; }
body { max-width: 860px; margin: 40px auto; padding: 0 22px 60px; font: 15px/1.65 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: #1f2937; background: #fff; }
h1 { font-size: 26px; line-height: 1.25; margin-bottom: 6px; }
.meta { color: #6b7280; font-size: 12px; margin-bottom: 30px; }
section { margin-top: 34px; }
h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
.card { padding: 14px 0 16px; border-bottom: 1px dashed #e5e7eb; }
.paper-title { margin: 10px 0 14px; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; }
.paper-title .src { font-size: 25px; font-weight: 700; line-height: 1.3; color: #111827; }
.paper-title .tr { margin-top: 8px; font-size: 23px; font-weight: 650; line-height: 1.38; }
.authors { padding: 4px 0 18px; font-size: 13px; color: #374151; line-height: 1.6; }
.authors .aff-tr { color: #6b7280; }
.authors strong { display: block; margin-bottom: 4px; color: #6b7280; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
.src { color: #4b5563; font-size: 13.5px; }
.tr { margin-top: 7px; font-size: 15px; }
figure.equation { margin: 18px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; text-align: center; background: #fff; }
figure.equation img { max-width: 100%; height: auto; }
figure.equation pre { margin: 0; white-space: pre-wrap; text-align: left; font-size: 12px; }
figure.equation figcaption { margin-top: 8px; color: #6b7280; font-size: 12px; }
figure.figure { margin: 18px 0; padding: 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fff; }
figure.figure img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
figure.figure figcaption { margin-top: 8px; color: #6b7280; font-size: 12px; }
figure.figure details { margin-top: 8px; }
figure.figure summary { cursor: pointer; color: #6b7280; font-size: 12px; }
figure.figure ul { margin: 6px 0 0; padding-left: 18px; color: #4b5563; font-size: 12px; }
@media print { body { max-width: none; margin: 0; padding: 0; } section { break-inside: avoid-page; } .card, figure.equation, figure.figure { break-inside: avoid; } }
@media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #111827; } .src { color: #9ca3af; } h2 { color: #9ca3af; border-color: #374151; } .card, figure.equation, figure.figure { border-color: #374151; } figure.equation, figure.figure { background: #fff; } .meta { color: #9ca3af; } }
</style>
</head>
<body>
<h1>${escapeHtml(meta.name)}</h1>
<div class="meta">${escapeHtml(tt('export.generated'))} · ${escapeHtml(new Date().toLocaleString())} · ${escapeHtml(settings.targetLanguage)}</div>
${body}
</body>
</html>`
    const filename = `${baseName(meta.name)}-reading.html`
    downloadBlob(html, filename, 'text/html;charset=utf-8')
    notify(tt('toast.exported', { name: filename }))
  }, [collectPages, notify, renderExportImages, settings.targetLanguage, translations, tt])

  const onDragEnter = useCallback((event) => {
    event.preventDefault()
    dragDepthRef.current += 1
    if (event.dataTransfer?.types?.includes('Files')) setDragging(true)
  }, [])
  const onDragOver = useCallback((event) => {
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDragLeave = useCallback((event) => {
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setDragging(false)
  }, [])
  const onDrop = useCallback(
    (event) => {
      event.preventDefault()
      dragDepthRef.current = 0
      setDragging(false)
      const file = event.dataTransfer?.files?.[0]
      if (file !== undefined) openFile(file)
    },
    [openFile],
  )

  const updateSettings = useCallback(
    (patch) => {
      if (
        patch.targetLanguage !== undefined &&
        patch.targetLanguage !== settings.targetLanguage
      ) {
        translationEpochRef.current += 1
        translationAbortRef.current?.abort()
        translationAbortRef.current = null
        selectionAbortRef.current?.abort()
        setBusyPages({})
        setProgress(null)
        setTranslations({})
        setPageTranslationState({})
        setTranslationErrors({})
        setSelectionResult(null)
        setSelection('')
      }
      if (
        patch.translationSelection !== undefined &&
        JSON.stringify(patch.translationSelection) !==
          JSON.stringify(settings.translationSelection)
      ) {
        // A model switch changes the meaning of "current translation": stop the
        // in-flight request but keep completed text until the user retranslates.
        translationEpochRef.current += 1
        translationAbortRef.current?.abort()
        translationAbortRef.current = null
        // The selection request belongs to the same epoch: abort it. The
        // loading card is cleared by the selection-key effect once the new
        // model is committed, so completed results stay visible.
        selectionAbortRef.current?.abort()
        selectionAbortRef.current = null
        setBusyPages({})
        setProgress(null)
      }
      setSettings((previous) => ({ ...previous, ...patch }))
    },
    [settings.targetLanguage, settings.translationSelection],
  )

  const startResize = useCallback(
    (side, event) => {
      if (event.button !== 0) return
      event.preventDefault()
      const startX = event.clientX
      const startWidth = side === 'rail' ? settings.railWidth : settings.translationWidth
      setResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const move = (moveEvent) => {
        const delta = moveEvent.clientX - startX
        if (side === 'rail') {
          updateSettings({ railWidth: clamp(startWidth + delta, 160, 380) })
        } else {
          updateSettings({ translationWidth: clamp(startWidth - delta, 300, 640) })
        }
      }
      const stop = () => {
        setResizing(false)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', stop)
        window.removeEventListener('pointercancel', stop)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', stop)
      window.addEventListener('pointercancel', stop)
    },
    [settings.railWidth, settings.translationWidth, updateSettings],
  )

  const changeViewMode = useCallback(
    (mode) => {
      setViewMode(mode)
      updateSettings({ viewMode: mode })
    },
    [updateSettings],
  )

  const changeFontSize = useCallback(
    (delta) => {
      updateSettings({
        readingFontSize: clamp(settings.readingFontSize + delta, 13, 22),
      })
    },
    [settings.readingFontSize, updateSettings],
  )

  const modeButtons = [
    ['bilingual', tt('view.bilingual'), 'columns'],
    ['translation', tt('view.translation'), 'languages'],
    ['source', tt('view.source'), 'file'],
  ]

  const pageProgress = progress?.running
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0

  // Switching the translation model cancels in-flight selection work. Drop a
  // stalled "translation in progress" card on the next paint so Retry is
  // usable at once, while completed results stay visible.
  useEffect(() => {
    if (translationSelectionKey === null) return
    setSelectionResult((previous) => (previous?.status === 'loading' ? null : previous))
  }, [translationSelectionKey])

  return (
    <section
      className={`pmr-root ${dragging ? 'is-dragging' : ''} ${resizing ? 'is-resizing' : ''}`}
      aria-label={tt('page.title')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: 'none' }}
        onChange={onFileInput}
      />

      <header className="pmr-topbar">
        <div className="pmr-brand">
          <img
            className="pmr-brand-mark"
            src={PANEL_ICON}
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <div className="pmr-brand-text">
            <div className="pmr-brand-title">{tt('page.title')}</div>
            <div className="pmr-brand-sub">{tt('page.subtitle')}</div>
          </div>
        </div>

        {doc !== null && (
          <div className="pmr-doc-title" title={doc.name}>
            {doc.name}
          </div>
        )}

        <div className="pmr-toolbar">
          {doc === null ? (
            <button type="button" className="pmr-btn pmr-btn-primary" onClick={pickFile}>
              <Icon name="folder" size={15} />
              {tt('empty.open')}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="pmr-iconbtn"
                onClick={pickFile}
                title={tt('action.open')}
                aria-label={tt('action.open')}
              >
                <Icon name="folder" size={16} />
              </button>
              <div className="pmr-group">
                <button
                  type="button"
                  className="pmr-iconbtn"
                  onClick={() => goToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  title={tt('action.prev')}
                  aria-label={tt('action.prev')}
                >
                  <Icon name="left" size={15} />
                </button>
                <input
                  className="pmr-input"
                  value={pageDraft}
                  inputMode="numeric"
                  aria-label={tt('page.short', { page: pageIndex + 1 })}
                  onChange={(event) => setPageDraft(event.target.value.replace(/[^\d]/g, ''))}
                  onBlur={commitPageDraft}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitPageDraft()
                    }
                  }}
                />
                <span style={{ fontSize: 10.5, color: 'var(--dsw-alias-label-secondary)', padding: '0 2px' }}>
                  / {pageCount}
                </span>
                <button
                  type="button"
                  className="pmr-iconbtn"
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex >= pageCount - 1}
                  title={tt('action.next')}
                  aria-label={tt('action.next')}
                >
                  <Icon name="right" size={15} />
                </button>
              </div>

              <div className="pmr-group">
                <button
                  type="button"
                  className="pmr-iconbtn"
                  onClick={() => zoomStep(1 / 1.12)}
                  title={tt('action.zoomOut')}
                  aria-label={tt('action.zoomOut')}
                >
                  <Icon name="minus" size={15} />
                </button>
                <button
                  type="button"
                  className="pmr-btn"
                  style={{ height: 26, padding: '0 6px', fontSize: 10.5, fontVariantNumeric: 'tabular-nums' }}
                  onClick={() => setZoomMode('fit')}
                  title={tt('action.fit')}
                >
                  {Math.round(currentScale * 100)}%
                </button>
                <button
                  type="button"
                  className="pmr-iconbtn"
                  onClick={() => zoomStep(1.12)}
                  title={tt('action.zoomIn')}
                  aria-label={tt('action.zoomIn')}
                >
                  <Icon name="plus" size={15} />
                </button>
              </div>

              <div className="pmr-divider" />
              <select
                className="pmr-select"
                value={settings.targetLanguage}
                onChange={(event) => updateSettings({ targetLanguage: event.target.value })}
                aria-label={tt('settings.target')}
                title={tt('settings.target')}
              >
                {LANGUAGES.map((language) => (
                  <option key={language.id} value={language.id}>
                    {language.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="pmr-btn pmr-btn-primary"
                onClick={translateCurrentPage}
                disabled={paragraphs.length === 0 || pageBusy || progress?.running}
              >
                {pageBusy ? <span className="pmr-spinner" /> : <Icon name="languages" size={14} />}
                {hasPageTranslation ? tt('action.retranslatePage') : tt('action.translatePage')}
              </button>
              <button
                type="button"
                className={`pmr-btn ${progress?.running ? 'pmr-btn-danger' : 'pmr-btn-ghost'}`}
                onClick={progress?.running ? stopTranslation : translateAll}
                disabled={pageCount === 0}
              >
                {progress?.running ? <Icon name="stop" size={13} /> : <Icon name="sparkle" size={14} />}
                {progress?.running ? tt('action.stop') : tt('action.translateAll')}
              </button>

              <button
                type="button"
                className={`pmr-btn pmr-eq-select-btn ${
                  equationSelectMode ? 'pmr-btn-primary' : 'pmr-btn-ghost'
                }`}
                onClick={beginEquationSelection}
                title={tt('equation.select')}
                disabled={pageModel === null}
              >
                <Icon name="crop" size={14} />
                <span className="pmr-eq-select-text">{tt('equation.select')}</span>
              </button>

              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="pmr-iconbtn"
                  onClick={() => {
                    setExportOpen((open) => !open)
                    setSettingsOpen(false)
                  }}
                  title={tt('action.export')}
                  aria-label={tt('action.export')}
                >
                  <Icon name="download" size={16} />
                </button>
                {exportOpen && (
                  <div className="pmr-menu">
                    <button type="button" onClick={exportMarkdown}>
                      <Icon name="download" size={13} />
                      {tt('action.exportMarkdown')}
                    </button>
                    <button type="button" onClick={exportBundle}>
                      <Icon name="file" size={13} />
                      {tt('action.exportBundle')}
                    </button>
                    <button type="button" onClick={exportHtml}>
                      <Icon name="file" size={13} />
                      {tt('action.exportHtml')}
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="pmr-iconbtn"
                onClick={closeDocument}
                title={tt('action.close')}
                aria-label={tt('action.close')}
              >
                <Icon name="close" size={16} />
              </button>
            </>
          )}

          <button
            type="button"
            className="pmr-iconbtn"
            onClick={() => {
              setSettingsOpen((open) => !open)
              setExportOpen(false)
            }}
            title={tt('action.settings')}
            aria-label={tt('action.settings')}
          >
            <Icon name="settings" size={16} />
          </button>
        </div>
      </header>

      {doc !== null && (
        <div className="pmr-body">
          {leftOpen && (
            <>
              <aside
                className="pmr-rail"
                aria-label={tt('rail.outline')}
                style={{ flexBasis: settings.railWidth, width: settings.railWidth }}
              >
              <div className="pmr-rail-head">
                <button
                  type="button"
                  className={`pmr-tabbtn ${railTab === 'outline' ? 'is-active' : ''}`}
                  onClick={() => setRailTab('outline')}
                >
                  {tt('rail.outline')}
                </button>
                <button
                  type="button"
                  className={`pmr-tabbtn ${railTab === 'pages' ? 'is-active' : ''}`}
                  onClick={() => setRailTab('pages')}
                >
                  {tt('rail.pages')}
                </button>
                {references.entries.length > 0 && (
                  <button
                    type="button"
                    className={`pmr-tabbtn ${railTab === 'references' ? 'is-active' : ''}`}
                    onClick={() => setRailTab('references')}
                    title={tt('rail.referenceCount', { count: references.entries.length })}
                  >
                    {settings.railWidth >= 200
                      ? tt('rail.references')
                      : tt('rail.referencesShort')}
                  </button>
                )}
                <button
                  type="button"
                  className="pmr-iconbtn"
                  style={{ marginLeft: 'auto', width: 24, height: 24 }}
                  onClick={() => setLeftOpen(false)}
                  title={tt('action.close')}
                  aria-label={tt('action.close')}
                >
                  <Icon name="close" size={13} />
                </button>
              </div>
              <div className="pmr-rail-scroll">
                {railTab === 'outline' ? (
                  doc.outline.length > 0 ? (
                    doc.outline.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={`pmr-outline-row ${entry.pageIndex === pageIndex ? 'is-current' : ''}`}
                        style={{ paddingLeft: 7 + Math.min(6, entry.depth) * 11 }}
                        disabled={entry.pageIndex === undefined}
                        onClick={() => {
                          if (entry.pageIndex !== undefined) goToPage(entry.pageIndex)
                        }}
                      >
                        <span className="pmr-outline-num">
                          {entry.pageIndex === undefined ? '·' : entry.pageIndex + 1}
                        </span>
                        <span className="pmr-outline-title">{entry.title}</span>
                      </button>
                    ))
                  ) : (
                    <div className="pmr-empty-note">{tt('rail.noOutline')}</div>
                  )
                ) : railTab === 'pages' ? (
                  <div className="pmr-thumbs">
                    {Array.from({ length: pageCount }, (_, index) => (
                      <PageThumbnail
                        key={index}
                        pdf={doc.pdf}
                        pageNumber={index + 1}
                        label={tt('rail.page', { page: index + 1 })}
                        active={index === pageIndex}
                        width={Math.round(
                          clamp((settings.railWidth - 34) / 2, 78, 168) *
                            Math.min(window.devicePixelRatio || 1, 2),
                        )}
                        cacheKey={`${doc.fingerprint}:${index + 1}`}
                        onClick={() => goToPage(index)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="pmr-reference-list">
                    <div className="pmr-reference-head">
                      <span>{tt('rail.referenceCount', { count: references.entries.length })}</span>
                      <button
                        type="button"
                        className="pmr-reference-copyall"
                        title={tt('action.copyReferences')}
                        aria-label={tt('action.copyReferences')}
                        onClick={() =>
                          copyText(references.entries.map((entry) => entry.text).join('\n'))
                        }
                      >
                        <Icon name="copy" size={12} />
                      </button>
                    </div>
                    {references.entries.map((entry, index) => (
                      <div className="pmr-reference-row" key={entry.id} title={entry.text}>
                        <span className="pmr-reference-num">
                          {entry.label === '' ? index + 1 : entry.label}
                        </span>
                        <span className="pmr-reference-text">{entry.text}</span>
                        <CopyButton
                          tt={tt}
                          text={entry.text}
                          label={tt('action.copy')}
                          onCopy={copyText}
                          className="pmr-reference-copy"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </aside>
              <div
                className="pmr-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label={tt('rail.outline')}
                onPointerDown={(event) => startResize('rail', event)}
              />
            </>
          )}

          <main className="pmr-viewer">
            <div className="pmr-viewer-scroll" ref={viewerRef}>
              <div className="pmr-stage">
                <div
                  className="pmr-page"
                  style={
                    pageSize !== null
                      ? { width: pageSize.width, height: pageSize.height }
                      : { width: 620, height: 800 }
                  }
                >
                  <canvas ref={canvasRef} className="pmr-canvas" />
                  <div className="pmr-highlights" aria-hidden="true">
                    {renderState !== 'ready' ? null : (
                      <>
                        {noteLines.map((line, index) => (
                          <div
                            key={`note-${line.id}-${index}`}
                            className="pmr-hl pmr-note-hl"
                            style={{
                              left: line.x * currentScale,
                              top: line.top * currentScale,
                              width: line.width * currentScale,
                              height: line.height * currentScale,
                            }}
                          />
                        ))}
                        {activeLines.map((line) => (
                          <div
                            key={line.id}
                            className="pmr-hl"
                            style={{
                              left: line.x * currentScale,
                              top: line.top * currentScale,
                              width: line.width * currentScale,
                              height: line.height * currentScale,
                            }}
                          />
                        ))}
                        {activeOverlayBlock !== undefined && (
                          <div
                            className="pmr-hl pmr-eq-hl"
                            style={{
                              left: activeOverlayBlock.bbox[0] * currentScale,
                              top: activeOverlayBlock.bbox[1] * currentScale,
                              width:
                                (activeOverlayBlock.bbox[2] - activeOverlayBlock.bbox[0]) *
                                currentScale,
                              height:
                                (activeOverlayBlock.bbox[3] - activeOverlayBlock.bbox[1]) *
                                currentScale,
                            }}
                          />
                        )}
                      </>
                    )}
                  </div>
                  <div
                    key={textLayerKey}
                    className="pmr-textlayer"
                    ref={textLayerRef}
                    onMouseUp={handleTextMouseUp}
                    onClick={handleTextClick}
                  />
                  {equationSelectMode && (
                    <div
                      className="pmr-eq-selector"
                      onPointerDown={onEquationPointerDown}
                      onPointerMove={onEquationPointerMove}
                      onPointerUp={onEquationPointerUp}
                      onPointerCancel={() => {
                        equationDragRef.current = null
                        setEquationRect(null)
                      }}
                    >
                      {equationRect !== null && (
                        <div
                          className="pmr-eq-box"
                          style={{
                            left:
                              Math.min(equationRect.x0, equationRect.x1) * currentScale,
                            top:
                              Math.min(equationRect.y0, equationRect.y1) * currentScale,
                            width:
                              Math.abs(equationRect.x1 - equationRect.x0) * currentScale,
                            height:
                              Math.abs(equationRect.y1 - equationRect.y0) * currentScale,
                          }}
                        />
                      )}
                    </div>
                  )}
                  {renderState === 'loading' && (
                    <div className="pmr-page-loading">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span className="pmr-spinner" />
                        {tt('status.rendering')}
                      </span>
                    </div>
                  )}
                  {renderState === 'error' && (
                    <div className="pmr-page-loading" style={{ background: 'rgba(255,255,255,.92)' }}>
                      <div style={{ textAlign: 'center', maxWidth: 320, padding: 18 }}>
                        <div style={{ color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 }}>
                          {tt('error.render')}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, color: '#475569' }}>{renderError}</div>
                        <button
                          type="button"
                          className="pmr-btn pmr-btn-ghost"
                          style={{ marginTop: 10 }}
                          onClick={retryRender}
                        >
                          {tt('action.retry')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!leftOpen && (
              <button
                type="button"
                className="pmr-iconbtn"
                style={{ position: 'absolute', left: 8, top: 8, zIndex: 5, background: 'var(--dsw-alias-bg-overlay)' }}
                onClick={() => setLeftOpen(true)}
                title={tt('rail.outline')}
                aria-label={tt('rail.outline')}
              >
                <Icon name="panelLeft" size={15} />
              </button>
            )}
            {!rightOpen && (
              <button
                type="button"
                className="pmr-iconbtn"
                style={{ position: 'absolute', right: 8, top: 8, zIndex: 5, background: 'var(--dsw-alias-bg-overlay)' }}
                onClick={() => setRightOpen(true)}
                title={tt('panel.translation')}
                aria-label={tt('panel.translation')}
              >
                <Icon name="panelRight" size={15} />
              </button>
            )}

            {progress?.running && (
              <div className="pmr-progress">
                <div className="pmr-progress-bar" style={{ width: `${pageProgress}%` }} />
                <div className="pmr-progress-label">
                  {tt('progress.page', { page: Math.min(progress.total, progress.done + 1), total: progress.total })}
                </div>
              </div>
            )}
          </main>

          {rightOpen && (
            <>
              <div
                className="pmr-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label={tt('panel.translation')}
                onPointerDown={(event) => startResize('translation', event)}
              />
              <aside
                className="pmr-translation"
                aria-label={tt('panel.translation')}
                style={{
                  flexBasis: settings.translationWidth,
                  width: settings.translationWidth,
                  '--pmr-reading-size': `${settings.readingFontSize}px`,
                }}
              >
              <div className="pmr-tr-head">
                <div className="pmr-tr-tabs">
                  <button
                    type="button"
                    className={`pmr-rtab ${rightTab === 'translation' ? 'is-active' : ''}`}
                    onClick={() => setRightTab('translation')}
                  >
                    <Icon name="languages" size={13} />
                    {tt('tab.translation')}
                  </button>
                  <button
                    type="button"
                    className={`pmr-rtab ${rightTab === 'notes' ? 'is-active' : ''}`}
                    onClick={() => setRightTab('notes')}
                  >
                    <Icon name="quote" size={13} />
                    {tt('tab.notes')}
                    {docNotes.length > 0 && <span className="pmr-tab-badge">{docNotes.length}</span>}
                  </button>
                  <button
                    type="button"
                    className={`pmr-rtab ${rightTab === 'reading' ? 'is-active' : ''}`}
                    onClick={() => setRightTab('reading')}
                  >
                    <Icon name="sparkle" size={13} />
                    {tt('tab.reading')}
                  </button>
                  <button
                    type="button"
                    className="pmr-iconbtn"
                    style={{ width: 24, height: 24, marginLeft: 'auto' }}
                    onClick={() => setRightOpen(false)}
                    title={tt('action.close')}
                    aria-label={tt('action.close')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
                {rightTab === 'translation' && (
                  <>
                    <div className="pmr-tr-headrow" style={{ marginTop: 7 }}>
                      <span className="pmr-tr-pageno">{tt('panel.page', { page: pageIndex + 1 })}</span>
                      <div className="pmr-tr-actions">
                        <button
                          type="button"
                          className="pmr-iconbtn"
                          style={{ width: 24, height: 24 }}
                          onClick={() => copyPage(false)}
                          title={tt('action.copyPageSource')}
                          aria-label={tt('action.copyPageSource')}
                        >
                          <Icon name="copy" size={12} />
                        </button>
                        <button
                          type="button"
                          className="pmr-iconbtn"
                          style={{ width: 24, height: 24 }}
                          onClick={() => copyPage(true)}
                          title={tt('action.copyPageTranslation')}
                          aria-label={tt('action.copyPageTranslation')}
                        >
                          <Icon name="languages" size={12} />
                        </button>
                        <div
                          className="pmr-fontctl"
                          role="group"
                          aria-label={tt('view.fontSize')}
                        >
                          <button
                            type="button"
                            onClick={() => changeFontSize(-1)}
                            disabled={settings.readingFontSize <= 13}
                            title={tt('view.fontSmaller')}
                            aria-label={tt('view.fontSmaller')}
                          >
                            A−
                          </button>
                          <span className="pmr-fontctl-value">{settings.readingFontSize}</span>
                          <button
                            type="button"
                            onClick={() => changeFontSize(1)}
                            disabled={settings.readingFontSize >= 22}
                            title={tt('view.fontLarger')}
                            aria-label={tt('view.fontLarger')}
                          >
                            A+
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="pmr-viewswitch" role="group" aria-label={tt('view.mode')}>
                      {modeButtons.map(([mode, label, icon]) => (
                        <button
                          key={mode}
                          type="button"
                          className={viewMode === mode ? 'is-active' : ''}
                          aria-pressed={viewMode === mode}
                          onClick={() => changeViewMode(mode)}
                        >
                          <Icon name={icon} size={13} />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>
                    <ModelControls
                      tt={tt}
                      catalog={catalog}
                      value={settings.translationSelection}
                      disabled={pageBusy}
                      fallback={health}
                      onChange={(selection) =>
                        updateSettings({ translationSelection: selection })
                      }
                    />
                    <div className="pmr-tr-hint">
                      <Icon name="sparkle" size={11} />
                      <span>{tt('panel.formulas')}</span>
                      {(equations.length > 0 || figures.length > 0) && (
                        <span className="pmr-count-badges">
                          {equations.length > 0 && (
                            <span className="pmr-eq-count-badge">
                              {tt('panel.equationCount', { count: equations.length })}
                            </span>
                          )}
                          {figures.length > 0 && (
                            <span className="pmr-eq-count-badge">
                              {tt('panel.figureCount', { count: figures.length })}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                  </>
                )}
                {rightTab === 'notes' && (
                  <div className="pmr-tr-hint">
                    <Icon name="quote" size={11} />
                    {tt('notes.hint')}
                  </div>
                )}
              </div>

              {rightTab === 'translation' && (
                <>
              <div className="pmr-tr-scroll" data-mode={viewMode}>
                {progress?.running && (
                  <div className="pmr-tr-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                    <span className="pmr-spinner" />
                    {tt('progress.page', {
                      page: Math.min(progress.total, progress.done + 1),
                      total: progress.total,
                    })}
                  </div>
                )}
                {readingBlocks.length === 0 ? (
                  <div className="pmr-tr-empty">
                    <Icon name="file" size={22} />
                    <strong>{tt('panel.empty')}</strong>
                  </div>
                ) : (
                  <>
                    {waitingForTranslation && (
                      <div className="pmr-tr-empty pmr-tr-waiting">
                        <Icon name="languages" size={22} />
                        <strong>{tt('panel.waiting')}</strong>
                        <p>{tt('panel.waitingAll')}</p>
                        <button
                          type="button"
                          className="pmr-btn pmr-btn-primary"
                          onClick={translateCurrentPage}
                          disabled={pageBusy || progress?.running}
                        >
                          <Icon name="languages" size={14} />
                          {tt('action.translatePage')}
                        </button>
                      </div>
                    )}
                    {pageStatus === 'error' && (
                      <div className="pmr-inline-error" role="alert">
                        <Icon name="alert" size={14} />
                        <span>
                          {tt('panel.failed')}
                          {pageError ? `: ${pageError}` : ''}
                        </span>
                        <button type="button" className="pmr-btn pmr-btn-ghost" onClick={translateCurrentPage}>
                          {tt('action.retry')}
                        </button>
                      </div>
                    )}
                    {(waitingForTranslation
                      ? readingBlocks.filter(
                          (block) => block.type === 'equation' || block.type === 'figure',
                        )
                      : readingBlocks
                    ).map((block) => {
                      if (block.type === 'equation') {
                        return (
                          <EquationBlock
                            key={block.id}
                            tt={tt}
                            equation={block}
                            pdf={doc.pdf}
                            fingerprint={docFingerprint}
                            pageIndex={pageIndex}
                            cache={equationImageCacheRef}
                            cacheVersion={modelRevision}
                            active={activeEquation === block.id}
                            onLocate={focusEquation}
                            onRemove={removeEquation}
                            onCopy={copyText}
                          />
                        )
                      }
                      if (block.type === 'figure') {
                        return (
                          <FigureBlock
                            key={block.id}
                            tt={tt}
                            figure={block}
                            pdf={doc.pdf}
                            fingerprint={docFingerprint}
                            pageIndex={pageIndex}
                            cache={equationImageCacheRef}
                            cacheVersion={modelRevision}
                            active={activeEquation === block.id}
                            onLocate={focusEquation}
                            onRemove={removeFigure}
                            onCopy={copyText}
                          />
                        )
                      }
                      const translationId = block.translationId ?? block.paragraphId
                      const translation = pageTranslation[translationId]
                      const error = translationErrors[pageIndex]?.[translationId]
                      const unit = unitById.get(translationId)
                      const common = {
                        tt,
                        block,
                        status: pageStatus,
                        mode: viewMode,
                        active: activeParagraph === block.paragraphId,
                        error,
                        onRetry: unit === undefined ? undefined : () => retryUnit(unit),
                        onClick: () => focusParagraph(block.paragraphId),
                        onCopy: copyText,
                      }
                      if (block.type === 'title') {
                        return <TitleBlock key={block.id} translation={translation} {...common} />
                      }
                      if (block.type === 'authors') {
                        return (
                          <AuthorBlock
                            key={block.id}
                            pageTranslation={pageTranslation}
                            {...common}
                          />
                        )
                      }
                      if (block.type === 'abstract') {
                        return (
                          <AbstractBlock key={block.id} translation={translation} {...common} />
                        )
                      }
                      if (block.type === 'keywords') {
                        return (
                          <KeywordsBlock key={block.id} translation={translation} {...common} />
                        )
                      }
                      return <SegmentCard key={block.id} translation={translation} {...common} />
                    })}
                    {hasPageOverrides && (
                      <div className="pmr-eq-reset">
                        <button type="button" className="pmr-btn pmr-btn-ghost" onClick={resetPageEquations}>
                          <Icon name="refresh" size={12} />
                          {tt('equation.restore')}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {selection !== '' && (
                <SelectionCard
                  tt={tt}
                  selection={selection}
                  result={selectionResult}
                  onTranslate={translateSelection}
                  onCopy={copyText}
                  onClose={() => {
                    setSelection('')
                    setSelectionResult(null)
                    clearTextSelection()
                  }}
                />
              )}
                </>
              )}

              {rightTab === 'notes' && (
                <div className="pmr-notes-pane">
                  {returnTarget !== null && (
                    <div className="pmr-return-row">
                      <button type="button" className="pmr-btn pmr-btn-ghost" onClick={returnToPrevious}>
                        <Icon name="left" size={12} />
                        {tt('notes.return')}
                      </button>
                    </div>
                  )}
                  <div className="pmr-notes-toolbar">
                    <span>{tt('notes.count', { count: docNotes.length })}</span>
                    <button
                      type="button"
                      className="pmr-btn pmr-btn-ghost"
                      onClick={saveNotesToFile}
                      disabled={docNotes.length === 0}
                    >
                      <Icon name="download" size={12} />
                      {tt('notes.saveToFile')}
                    </button>
                  </div>
                  <div className="pmr-note-compose">
                    {currentParagraph !== undefined ? (
                      <>
                        <div className="pmr-note-target">
                          <span className="pmr-tag">P{pageIndex + 1}</span>
                          <span className="pmr-note-quote">{currentParagraph.text}</span>
                        </div>
                        <textarea
                          className="pmr-textarea pmr-note-textarea"
                          value={noteText}
                          placeholder={tt('notes.placeholder')}
                          onChange={(event) => setNoteText(event.target.value)}
                          aria-label={tt('notes.title')}
                        />
                        <div className="pmr-note-actions">
                          <span className="pmr-note-mode">
                            {existingNote ? tt('notes.update') : tt('notes.current')}
                          </span>
                          <button
                            type="button"
                            className="pmr-btn pmr-btn-primary"
                            onClick={saveNote}
                            disabled={noteText.trim() === ''}
                          >
                            <Icon name="quote" size={13} />
                            {existingNote ? tt('notes.update') : tt('notes.save')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="pmr-tr-empty" style={{ minHeight: 110 }}>
                        <Icon name="quote" size={20} />
                        <strong>{tt('notes.selectFirst')}</strong>
                      </div>
                    )}
                  </div>
                  <div className="pmr-note-list">
                    {docNotes.length === 0 ? (
                      <div className="pmr-tr-empty">
                        <Icon name="quote" size={20} />
                        <strong>{tt('notes.empty')}</strong>
                      </div>
                    ) : (
                      [...docNotes]
                        .sort(
                          (left, right) =>
                            left.pageIndex - right.pageIndex || left.updatedAt - right.updatedAt,
                        )
                        .map((note) => (
                          <article
                            key={note.id}
                            className="pmr-note-card"
                            role="button"
                            tabIndex={0}
                            onClick={() => focusNote(note)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                focusNote(note)
                              }
                            }}
                          >
                            <div className="pmr-note-meta">
                              <span className="pmr-tag">P{note.pageIndex + 1}</span>
                              <span className="pmr-note-count">
                                {new Date(note.updatedAt).toLocaleDateString()}
                              </span>
                              <CopyButton
                                tt={tt}
                                text={note.text}
                                label={tt('action.copy')}
                                onCopy={copyText}
                                className="pmr-note-copy"
                              />
                              <button
                                type="button"
                                className="pmr-note-delete"
                                onClick={(event) => deleteNote(note.id, event)}
                                aria-label={tt('notes.delete')}
                                title={tt('notes.delete')}
                              >
                                <Icon name="close" size={11} />
                              </button>
                            </div>
                            {note.source ? <div className="pmr-note-source">{note.source}</div> : null}
                            <div className="pmr-note-body">{note.text}</div>
                          </article>
                        ))
                    )}
                  </div>
                </div>
              )}

              {rightTab === 'reading' && (
                <div className="pmr-chat-pane">
                  <div className="pmr-chat-toolbar">
                    <div className="pmr-seg">
                      <button
                        type="button"
                        className={chatScope === 'page' ? 'is-active' : ''}
                        onClick={() => setChatScope('page')}
                      >
                        {tt('reading.scope.page')}
                      </button>
                      <button
                        type="button"
                        className={chatScope === 'document' ? 'is-active' : ''}
                        onClick={() => setChatScope('document')}
                      >
                        {tt('reading.scope.document')}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="pmr-btn pmr-btn-ghost"
                      onClick={clearChat}
                      disabled={chatMessages.length === 0 && !chatBusy}
                    >
                      {tt('reading.clear')}
                    </button>
                  </div>
                  <ModelControls
                    tt={tt}
                    catalog={catalog}
                    value={settings.chatSelection}
                    disabled={chatBusy}
                    fallback={health}
                    onChange={(selection) => updateSettings({ chatSelection: selection })}
                  />
                  <div className="pmr-skill-row">
                    <button
                      type="button"
                      className={`pmr-skill-chip ${skill !== null ? 'has-skill' : ''}`}
                      onClick={() => {
                        if (skillsOpen) setSkillsOpen(false)
                        else openSkillPicker()
                      }}
                      disabled={chatBusy}
                      title={skill?.description ?? tt('skills.import')}
                    >
                      <Icon name="sparkle" size={12} />
                      <span>{skill === null ? tt('skills.import') : skill.name}</span>
                    </button>
                    {skill !== null && (
                      <button
                        type="button"
                        className="pmr-skill-remove"
                        onClick={removeSkill}
                        aria-label={tt('skills.clear')}
                        title={tt('skills.clear')}
                      >
                        <Icon name="close" size={11} />
                      </button>
                    )}
                  </div>
                  {skillsOpen && (
                    <div className="pmr-skill-panel">
                      <div className="pmr-skill-panel-head">
                        <span>{tt('skills.title')}</span>
                        <button
                          type="button"
                          className="pmr-iconbtn"
                          style={{ width: 22, height: 22, marginLeft: 'auto' }}
                          onClick={() => setSkillsOpen(false)}
                          aria-label={tt('common.cancel')}
                        >
                          <Icon name="close" size={11} />
                        </button>
                      </div>
                      {skillsLoading ? (
                        <div className="pmr-skill-state">
                          <span className="pmr-spinner" />
                          {tt('skills.loading')}
                        </div>
                      ) : (
                        <>
                          {skillError !== '' && <div className="pmr-skill-state is-error">{skillError}</div>}
                          {skillList.length === 0 && skillError === '' ? (
                            <div className="pmr-skill-state">{tt('skills.empty')}</div>
                          ) : (
                            <div className="pmr-skill-list">
                              {skillList.map((entry) => (
                                <button
                                  key={entry.name}
                                  type="button"
                                  className="pmr-skill-item"
                                  onClick={() => chooseSkill(entry.name)}
                                  title={entry.whenToUse || entry.description}
                                >
                                  <span className="pmr-skill-name">{entry.name}</span>
                                  <span className="pmr-skill-desc">{entry.description}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                      <div className="pmr-skill-file">
                        <input
                          ref={skillFileRef}
                          type="file"
                          accept=".md,.txt,.markdown"
                          style={{ display: 'none' }}
                          onChange={importSkillFile}
                        />
                        <button
                          type="button"
                          className="pmr-btn pmr-btn-ghost"
                          onClick={() => skillFileRef.current?.click()}
                        >
                          {tt('skills.fromFile')}
                        </button>
                        <span>{tt('skills.fileHint')}</span>
                      </div>
                    </div>
                  )}
                  <div className="pmr-chat-scroll" ref={chatScrollRef}>
                    {chatMessages.length === 0 ? (
                      <div className="pmr-tr-empty pmr-chat-empty">
                        <Icon name="sparkle" size={22} />
                        <strong>{tt('reading.empty')}</strong>
                        <div className="pmr-chat-examples">
                          {['reading.example1', 'reading.example2', 'reading.example3'].map((key) => (
                            <button
                              key={key}
                              type="button"
                              onClick={() => sendChat(tt(key))}
                              disabled={chatBusy}
                            >
                              {tt(key)}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      chatMessages.map((message, index) => (
                        <div
                          key={`${message.role}-${index}`}
                          className={`pmr-msg ${message.role === 'user' ? 'is-user' : 'is-assistant'}`}
                        >
                          <div className="pmr-msg-role">
                            {message.role === 'user' ? 'You' : 'AI'}
                          </div>
                          <div className="pmr-msg-body">{message.content}</div>
                          <CopyButton
                            tt={tt}
                            text={message.content}
                            label={tt('action.copy')}
                            onCopy={copyText}
                            className="pmr-msg-copy"
                          />
                        </div>
                      ))
                    )}
                    {chatBusy && (
                      <div className="pmr-msg is-assistant">
                        <div className="pmr-msg-role">AI</div>
                        <div className="pmr-msg-body pmr-msg-loading">
                          <span className="pmr-spinner" />
                          {chatStatus === 'reading' ? tt('reading.reading') : tt('reading.thinking')}
                        </div>
                      </div>
                    )}
                    {chatError !== '' && (
                      <div className="pmr-inline-error" role="alert">
                        <Icon name="alert" size={14} />
                        <span>{chatError}</span>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="pmr-chat-compose">
                    <textarea
                      className="pmr-textarea"
                      value={chatInput}
                      placeholder={tt('reading.placeholder')}
                      onChange={(event) => setChatInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          sendChat()
                        }
                      }}
                      aria-label={tt('reading.placeholder')}
                    />
                    <button
                      type="button"
                      className="pmr-btn pmr-btn-primary"
                      onClick={chatBusy ? stopChat : () => sendChat()}
                      disabled={!chatBusy && chatInput.trim() === ''}
                    >
                      {chatBusy ? <Icon name="stop" size={13} /> : <Icon name="sparkle" size={13} />}
                      {chatBusy ? tt('action.stop') : tt('reading.send')}
                    </button>
                  </div>
                  <div className="pmr-chat-foot">
                    {tt('reading.context', {
                      scope:
                        chatScope === 'document'
                          ? tt('reading.scope.document')
                          : tt('reading.scope.page'),
                    })}
                    <span> · {tt('reading.disclaimer')}</span>
                  </div>
                </div>
              )}
              </aside>
            </>
          )}
        </div>
      )}

      {doc === null && (
        <EmptyState tt={tt} onPick={pickFile} error={openError} opening={opening} />
      )}

      <footer className="pmr-footer">
        <span
          className={`pmr-status-dot ${
            health.status === 'ready'
              ? 'is-ok'
              : health.status === 'error' || health.status === 'unavailable'
                ? 'is-error'
                : 'is-busy'
          }`}
        />
        <span className="pmr-foot-item">
          {health.status === 'ready'
            ? tt('status.model', { provider: health.provider, model: health.model })
            : health.status === 'unavailable'
              ? tt('status.unavailable')
              : health.status === 'error'
                ? `${tt('status.unavailable')}${health.message ? `: ${health.message}` : ''}`
                : tt('status.loading')}
        </span>
        <span className="pmr-foot-spacer" />
        {doc !== null && (
          <span className="pmr-foot-item">
            {tt('status.page', { page: pageIndex + 1, total: pageCount })}
          </span>
        )}
        {doc !== null && (
          <span className="pmr-foot-item">{tt('status.zoom', { percent: Math.round(currentScale * 100) })}</span>
        )}
        {doc !== null && <span className="pmr-foot-item">{tt('status.shortcuts')}</span>}
        <span className="pmr-foot-item">{doc !== null ? 'PDF.js · local' : 'PDFMathTranslate-inspired'}</span>
      </footer>

      {settingsOpen && (
        <>
          <div className="pmr-scrim" onClick={() => setSettingsOpen(false)} />
          <SettingsPanel
            tt={tt}
            settings={settings}
            health={health}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
            onClearCache={clearCache}
          />
        </>
      )}

      {toast !== null && (
        <div className={`pmr-toast ${toast.kind === 'error' ? 'is-error' : ''}`} role="status">
          <Icon name={toast.kind === 'error' ? 'alert' : 'check'} size={14} />
          <span>{toast.message}</span>
          <button
            type="button"
            className="pmr-toast-close"
            onClick={() => setToast(null)}
            aria-label={tt('common.cancel')}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {dragging && <div className="pmr-drop-overlay">{tt('empty.drop')}</div>}
    </section>
  )
}

export function PdfReaderIcon({ size = 20, active }) {
  const px = Math.max(14, size)
  return (
    <span
      style={{
        display: 'inline-flex',
        width: px,
        height: px,
        flex: 'none',
        overflow: 'hidden',
        borderRadius: Math.round(px * 0.26),
        userSelect: 'none',
        boxShadow: active ? '0 0 0 1.5px var(--dsw-alias-brand-primary)' : 'none',
      }}
    >
      <img
        src={PANEL_ICON}
        alt=""
        aria-hidden="true"
        draggable={false}
        width={px}
        height={px}
        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </span>
  )
}

export const inject = ['slots', 'locale']

export function apply(ctx) {
  ctx.effect(() => ctx.locale.register('pdfReader', { zh, en }), 'pdf-math-reader: locale')
  const t = ctx.locale.bind('pdfReader')

  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        locale: 'pdfReader',
        label: () => t('panel.title'),
      },
      PdfReaderIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: 'pdfReader',
      },
      PdfReaderPanel,
    ),
  )
}
