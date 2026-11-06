import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  chatWithPaper,
  fetchHealth,
  listSkills,
  loadSkill,
  saveNotes,
  translateSegments,
} from './api'
import { Icon } from './icons'
import {
  buildPageModel,
  extractPageModel,
  fileFingerprint,
  findParagraphByAnchor,
  glossaryKey,
  isPdfFile,
  loadPdfJs,
  makeBatches,
  openPdf,
  parseGlossary,
  renderPdfPage,
  renderThumbnail,
  resolveOutline,
} from './pdf'
import { en, translate, zh } from './locales'
import { CSS } from './styles'

const SETTINGS_KEY = 'pdf-math-reader.settings.v1'
const NOTES_KEY = 'pdf-math-reader.notes.v1'
const PANEL_ID = 'pdf-math-reader'

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

function loadSettings() {
  const fallback = {
    targetLanguage: 'zh-CN',
    glossaryText: '',
    saveDir: '',
    railWidth: 218,
    translationWidth: 390,
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
    }
  } catch {
    return fallback
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

function SegmentCard({ tt, paragraph, translation, status, mode, active, onClick }) {
  return (
    <div
      className={`pmr-seg-card ${active ? 'is-active' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      {mode !== 'translation' && <div className="pmr-seg-src">{paragraph.text}</div>}
      {mode !== 'source' &&
        (translation?.text ? (
          <div className="pmr-seg-tr">{translation.text}</div>
        ) : status === 'loading' ? (
          <>
            <div className="pmr-seg-skeleton" />
            <div className="pmr-seg-skeleton short" />
          </>
        ) : status === 'error' ? (
          <div className="pmr-seg-err">{tt('error.translate')}</div>
        ) : (
          <div className="pmr-seg-tr is-placeholder">{tt('panel.waiting')}</div>
        ))}
    </div>
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
  const [doc, setDoc] = useState(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [pageDraft, setPageDraft] = useState('1')
  const [pageModel, setPageModel] = useState(null)
  const [pageSize, setPageSize] = useState(null)
  const [renderState, setRenderState] = useState('idle')
  const [renderError, setRenderError] = useState('')
  const [renderNonce, setRenderNonce] = useState(0)
  const [viewerWidth, setViewerWidth] = useState(860)
  const [zoomMode, setZoomMode] = useState('fit')
  const [zoom, setZoom] = useState(1.2)
  const [railTab, setRailTab] = useState('outline')
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [rightTab, setRightTab] = useState('translation')
  const [viewMode, setViewMode] = useState('bilingual')
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

  const fileInputRef = useRef(null)
  const viewerRef = useRef(null)
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const textLayerTaskRef = useRef(null)
  const docRef = useRef(null)
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
  const ttRef = useRef(tt)
  ttRef.current = tt

  const glossary = useMemo(() => parseGlossary(settings.glossaryText), [settings.glossaryText])
  const glossaryKeyValue = useMemo(() => glossaryKey(glossary), [glossary])
  const pageCount = doc?.numPages ?? 0
  const paragraphs = pageModel?.paragraphs ?? []
  const pageTranslation = translations[pageIndex] ?? {}
  const pageStatus = pageTranslationState[pageIndex]?.status ?? 'idle'
  const pageError = pageTranslationState[pageIndex]?.error ?? ''
  const pageBusy = Boolean(busyPages[pageIndex]) || Boolean(progress?.running)
  const hasPageTranslation = paragraphs.some((paragraph) => Boolean(pageTranslation[paragraph.id]?.text))
  const currentScale = pageModel?.viewport?.scale ?? 1
  const activeLines = pageModel?.paragraphs.find((paragraph) => paragraph.id === activeParagraph)?.lines ?? []
  const docFingerprint = doc?.fingerprint ?? ''
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
    const controller = new AbortController()
    fetchHealth(controller.signal)
      .then((payload) => {
        if (controller.signal.aborted) return
        setHealth({
          status: payload.llm === true ? 'ready' : 'unavailable',
          provider: payload.provider,
          model: payload.model,
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
    setPageModel(null)
    setPageSize(null)
    setRenderError('')
    setActiveParagraph(null)
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
    let cancelled = false
    const controller = new AbortController()
    setRenderState('loading')
    setRenderError('')

    const run = async () => {
      try {
        const library = await loadPdfJs()
        if (cancelled) return
        const page = await doc.pdf.getPage(pageIndex + 1)
        if (cancelled) return
        const base = page.getViewport({ scale: 1 })
        const available = Math.max(260, viewerWidth - 56)
        const scale =
          zoomMode === 'fit' ? clamp(available / base.width, 0.4, 3) : clamp(zoom, 0.35, 4)
        const canvas = canvasRef.current
        if (canvas === null) return
        const viewport = await renderPdfPage(page, canvas, scale, controller.signal)
        if (cancelled) return
        setPageSize({ width: viewport.width, height: viewport.height })
        // The page must be readable even when text extraction or the text layer
        // fails; those are separate, non-fatal steps below.
        setRenderState('ready')

        let textContent
        let model = {
          paragraphs: [],
          lines: [],
          viewport,
          pageWidth: viewport.width,
          pageHeight: viewport.height,
        }
        try {
          textContent = await page.getTextContent({ includeMarkedContent: false })
          if (cancelled) return
          model = buildPageModel(library, textContent, viewport)
        } catch (error) {
          console.warn('pdf-math-reader: text extraction failed', error)
        }
        if (cancelled) return
        if (docRef.current !== doc) return
        model.documentId = doc.fingerprint
        model.pageIndex = pageIndex
        doc.pageCache?.set(pageIndex, model)
        setPageModel(model)

        const container = textLayerRef.current
        if (container !== null && textContent !== undefined && typeof library.TextLayer === 'function') {
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
  }, [doc, pageIndex, zoomMode, zoom, viewerWidth, renderNonce])

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
      translationAbortRef.current?.abort()
      selectionAbortRef.current?.abort()
      const meta = docRef.current
      docRef.current = null
      if (meta !== null) meta.pdf.destroy?.().catch?.(() => {})
    }
  }, [])

  const closeDocument = useCallback(() => {
    openTaskRef.current += 1
    translationEpochRef.current += 1
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    selectionAbortRef.current?.abort()
    const meta = docRef.current
    docRef.current = null
    setDoc(null)
    setPageModel(null)
    setPageIndex(0)
    setTranslations({})
    setPageTranslationState({})
    setBusyPages({})
    setProgress(null)
    setSelection('')
    setSelectionResult(null)
    setOpenError('')
    if (meta !== null) meta.pdf.destroy?.().catch?.(() => {})
  }, [])

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
      translationAbortRef.current?.abort()
      translationAbortRef.current = null
      selectionAbortRef.current?.abort()
      const previous = docRef.current
      docRef.current = null
      if (previous !== null) previous.pdf.destroy?.().catch?.(() => {})
      setDoc(null)
      setPageModel(null)
      setOpenError('')
      setTranslations({})
      setPageTranslationState({})
      setBusyPages({})
      setProgress(null)
      setSelection('')
      setSelectionResult(null)
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
          pageCache: new Map(),
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
    [notify, tt],
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
    (x, y) =>
      pageModel?.lines.find(
        (line) =>
          x >= line.x - 2 &&
          x <= line.x + line.width + 2 &&
          y >= line.top - 2 &&
          y <= line.top + line.height + 2,
      ),
    [pageModel],
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
      const target =
        root.scrollTop +
        (pageRect.top - rootRect.top) +
        line.top +
        line.height / 2 -
        root.clientHeight / 2
      root.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
    },
    [pageModel],
  )

  const focusParagraph = useCallback(
    (paragraphId) => {
      if (activeParagraph === paragraphId) {
        setActiveParagraph(null)
        clearTextSelection()
        return
      }
      setActiveParagraph(paragraphId)
      clearTextSelection()
      scrollToParagraph(paragraphId)
    },
    [activeParagraph, clearTextSelection, scrollToParagraph],
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
      const line = lineAtPoint(event.clientX - rect.left, event.clientY - rect.top)
      if (line === undefined) {
        setActiveParagraph(null)
        return
      }
      if (activeParagraph === line.paragraphId) {
        setActiveParagraph(null)
        clearTextSelection()
      } else {
        setActiveParagraph(line.paragraphId)
      }
    },
    [activeParagraph, clearTextSelection, lineAtPoint],
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
      anchorTop: currentParagraph.lines[0]?.top ?? null,
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
    if (request.anchorTop !== null) scrollToOffset(request.anchorTop, pageModel)
    if (pendingFocusRef.current?.requestId === request.requestId) {
      pendingFocusRef.current = null
      setFocusRequest(null)
      notify(tt('notes.notFound'), 'error')
    }
  }, [
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
  }, [])

  const translatePageInternal = useCallback(
    async (targetPage, targetParagraphs, options = {}) => {
      const signal = options.signal
      const force = options.force === true
      const epoch = translationEpochRef.current
      const targetLanguage = settings.targetLanguage
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
      try {
        const entries = usable.map((paragraph) => ({ id: paragraph.id, text: paragraph.text }))
        const batches = makeBatches(entries, 5, 3800)
        for (const batch of batches) {
          if (signal?.aborted || epoch !== translationEpochRef.current) {
            throw new DOMException('Aborted', 'AbortError')
          }
          const pending = []
          for (const entry of batch) {
            const key = `${targetLanguage}\u0000${glossaryKeyValue}\u0000${entry.text}`
            if (!force) {
              const cached = translationCacheRef.current.get(key)
              if (cached !== undefined) {
                setTranslationFor(targetPage, entry.id, cached)
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
              refresh: force,
            },
            signal,
          )
          if (epoch !== translationEpochRef.current) return false
          const byId = new Map(
            (Array.isArray(response.translations) ? response.translations : []).map((item) => [
              item.id,
              item.text,
            ]),
          )
          for (const { entry, key } of pending) {
            const text = byId.get(entry.id) ?? entry.text
            translationCacheRef.current.set(key, text)
            setTranslationFor(targetPage, entry.id, text)
            applied += 1
          }
        }
        if (epoch !== translationEpochRef.current) return false
        setPageTranslationState((previous) => ({
          ...previous,
          [targetPage]: { status: 'done' },
        }))
        return true
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
    [glossary, glossaryKeyValue, setTranslationFor, settings.targetLanguage, tt],
  )

  const translateCurrentPage = useCallback(() => {
    if (!pageModel || paragraphs.length === 0 || pageBusy) return
    translationAbortRef.current?.abort()
    const controller = new AbortController()
    translationAbortRef.current = controller
    setProgress(null)
    translatePageInternal(pageIndex, paragraphs, {
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
    paragraphs,
    translatePageInternal,
    tt,
  ])

  const getPageModel = useCallback(async (targetPage) => {
    const meta = docRef.current
    if (meta === null) return { paragraphs: [] }
    const cached = meta.pageCache?.get(targetPage)
    if (cached !== undefined) return cached
    const page = await meta.pdf.getPage(targetPage + 1)
    const model = await extractPageModel(page, 1, {
      documentId: meta.fingerprint,
      pageIndex: targetPage,
    })
    if (docRef.current !== meta) return { paragraphs: [] }
    meta.pageCache?.set(targetPage, model)
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
        if (model.paragraphs.length > 0) {
          await translatePageInternal(index, model.paragraphs, { signal: controller.signal })
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
  }, [glossary, selection, settings.targetLanguage, tt])

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

  const clearCache = useCallback(() => {
    translationCacheRef.current.clear()
    setTranslations({})
    setPageTranslationState({})
    notify(tt('toast.cacheCleared'))
  }, [notify, tt])

  const collectPages = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return []
    const cache = meta.pageCache ?? new Map()
    const pages = []
    for (let index = 0; index < meta.numPages; index += 1) {
      let model = cache.get(index)
      if (model === undefined) {
        const page = await meta.pdf.getPage(index + 1)
        model = await extractPageModel(page, 1, {
          documentId: meta.fingerprint,
          pageIndex: index,
        })
        if (docRef.current !== meta) return []
        cache.set(index, model)
      }
      if (model.paragraphs.length > 0) pages.push({ index, paragraphs: model.paragraphs })
    }
    return pages
  }, [])

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
          if (model.paragraphs.length > 0) pages.push({ index, paragraphs: model.paragraphs })
        }
        label = `第 ${pageIndex + 1} 页及相邻页`
      }

      const text = pages
        .map(
          (page) =>
            `[Page ${page.index + 1}]\n${page.paragraphs
              .map((paragraph) => paragraph.text)
              .join('\n\n')}`,
        )
        .join('\n\n')
      const clipped =
        text.length > 22000
          ? `${text.slice(0, 16000)}\n\n[... context truncated ...]\n\n${text.slice(-5600)}`
          : text
      const value = { text: clipped, label }
      chatContextCacheRef.current.set(cacheKey, value)
      return value
    },
    [collectPages, getPageModel, pageIndex],
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
    [buildChatContext, chatBusy, chatInput, chatMessages, chatScope, skill, tt],
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
      for (const paragraph of page.paragraphs) {
        const translated = translations[page.index]?.[paragraph.id]?.text
        lines.push(`> ${paragraph.text.replace(/\s+/g, ' ')}`, '')
        if (translated) lines.push(translated, '')
      }
    }
    const filename = `${baseName(meta.name)}-bilingual.md`
    downloadBlob(lines.join('\n'), filename, 'text/markdown;charset=utf-8')
    notify(tt('toast.exported', { name: filename }))
  }, [collectPages, notify, settings.targetLanguage, translations, tt])

  const exportHtml = useCallback(async () => {
    const meta = docRef.current
    if (meta === null) return
    setExportOpen(false)
    const pages = await collectPages()
    if (pages.length === 0) {
      notify(tt('error.exportEmpty'), 'error')
      return
    }
    const body = pages
      .map((page) => {
        const cards = page.paragraphs
          .map((paragraph) => {
            const translated = translations[page.index]?.[paragraph.id]?.text
            return `<div class="card"><div class="src">${escapeHtml(paragraph.text)}</div>${
              translated ? `<div class="tr">${escapeHtml(translated)}</div>` : ''
            }</div>`
          })
          .join('\n')
        return `<section><h2>${escapeHtml(tt('page.short', { page: page.index + 1 }))}</h2>${cards}</section>`
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
.src { color: #4b5563; font-size: 13.5px; }
.tr { margin-top: 7px; font-size: 15px; }
@media print { body { max-width: none; margin: 0; padding: 0; } section { break-inside: avoid-page; } .card { break-inside: avoid; } }
@media (prefers-color-scheme: dark) { body { color: #e5e7eb; background: #111827; } .src { color: #9ca3af; } h2 { color: #9ca3af; border-color: #374151; } .card { border-color: #374151; } .meta { color: #9ca3af; } }
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
  }, [collectPages, notify, settings.targetLanguage, translations, tt])

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
        setSelectionResult(null)
        setSelection('')
      }
      setSettings((previous) => ({ ...previous, ...patch }))
    },
    [settings.targetLanguage],
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

  const modeButtons = [
    ['bilingual', tt('view.bilingual')],
    ['translation', tt('view.translation')],
    ['source', tt('view.source')],
  ]

  const pageProgress = progress?.running
    ? Math.round((progress.done / Math.max(1, progress.total)) * 100)
    : 0

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
          <div className="pmr-brand-mark">
            <Icon name="book" size={18} />
          </div>
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
                ) : (
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
                    pageModel !== null
                      ? { width: pageModel.viewport.width, height: pageModel.viewport.height }
                      : pageSize !== null
                        ? { width: pageSize.width, height: pageSize.height }
                        : { width: 620, height: 800 }
                  }
                >
                  <canvas ref={canvasRef} className="pmr-canvas" />
                  <div className="pmr-highlights" aria-hidden="true">
                    {noteLines.map((line, index) => (
                      <div
                        key={`note-${line.id}-${index}`}
                        className="pmr-hl pmr-note-hl"
                        style={{
                          left: line.x,
                          top: line.top,
                          width: line.width,
                          height: line.height,
                        }}
                      />
                    ))}
                    {activeLines.map((line) => (
                      <div
                        key={line.id}
                        className="pmr-hl"
                        style={{
                          left: line.x,
                          top: line.top,
                          width: line.width,
                          height: line.height,
                        }}
                      />
                    ))}
                  </div>
                  <div
                    key={textLayerKey}
                    className="pmr-textlayer"
                    ref={textLayerRef}
                    onMouseUp={handleTextMouseUp}
                    onClick={handleTextClick}
                  />
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
                          onClick={() => setRenderNonce((value) => value + 1)}
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
                style={{ flexBasis: settings.translationWidth, width: settings.translationWidth }}
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
                        <div className="pmr-seg">
                          {modeButtons.map(([mode, label]) => (
                            <button
                              key={mode}
                              type="button"
                              className={viewMode === mode ? 'is-active' : ''}
                              onClick={() => setViewMode(mode)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="pmr-tr-hint">
                      <Icon name="sparkle" size={11} />
                      {tt('panel.formulas')}
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
              <div className="pmr-tr-scroll">
                {progress?.running && (
                  <div className="pmr-tr-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                    <span className="pmr-spinner" />
                    {tt('progress.page', {
                      page: Math.min(progress.total, progress.done + 1),
                      total: progress.total,
                    })}
                  </div>
                )}
                {paragraphs.length === 0 ? (
                  <div className="pmr-tr-empty">
                    <Icon name="file" size={22} />
                    <strong>{tt('panel.empty')}</strong>
                  </div>
                ) : viewMode !== 'source' && !hasPageTranslation && pageStatus !== 'loading' && pageStatus !== 'error' ? (
                  <div className="pmr-tr-empty">
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
                ) : (
                  <>
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
                    {paragraphs.map((paragraph) => (
                      <SegmentCard
                        key={paragraph.id}
                        tt={tt}
                        paragraph={paragraph}
                        translation={pageTranslation[paragraph.id]}
                        status={pageStatus}
                        mode={viewMode}
                        active={activeParagraph === paragraph.id}
                        onClick={() => focusParagraph(paragraph.id)}
                      />
                    ))}
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
  return (
    <span
      style={{
        display: 'inline-flex',
        color: active ? 'var(--dsw-alias-brand-primary)' : 'currentColor',
      }}
    >
      <Icon name="book" size={size} strokeWidth={1.6} />
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
