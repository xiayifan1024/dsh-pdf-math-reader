/**
 * PDF Math Reader — Host half.
 *
 * The Host half owns two things that the browser cannot do reliably:
 *   1. serving the bundled PDF.js runtime (same origin, no CDN);
 *   2. turning a batch of PDF paragraphs into a translated batch through the
 *      model route that the current DSH profile already uses.
 *
 * The reader itself is local: the PDF never leaves the browser. Only the text
 * segments the user explicitly translates are posted here.
 */
import { readFileSync } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chatPrompt, normalizeHistory } from './lib/chat.js'
import { chatTimeoutMsFor, normalizeChatTokens } from './lib/chat-settings.js'
import {
  cacheKey,
  normalizeGlossary,
  normalizeTranslations,
  parseTranslationJson,
  splitBatches,
  translationPrompt,
} from './lib/translation.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')
const ROUTE = '/pdf-reader'
const ASSET_PREFIX = '/pdf-reader/assets/'
const VERSION = readVersion()

function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const DEFAULTS = {
  provider: '',
  model: '',
  maxSegmentsPerRequest: 6,
  maxCharsPerRequest: 4200,
  maxTextChars: 8000,
  timeoutMs: 180000,
  chatMaxChars: 24000,
  chatTimeoutMs: 150000,
  chatMaxTokens: 8192,
  cacheEntries: 600,
}

const MIME = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bcmap': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
}

export const inject = ['webServer']

class PluginError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.status = status
  }
}

function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  })
}

function textResponse(status, text, contentType = 'text/plain; charset=utf-8') {
  return new Response(text, {
    status,
    headers: { 'content-type': contentType, 'cache-control': 'no-store' },
  })
}

function readConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const number = (key, fallback, min, max) => {
    const value = Number(source[key])
    if (!Number.isFinite(value)) return fallback
    return Math.min(max, Math.max(min, Math.trunc(value)))
  }
  return {
    provider: typeof source.provider === 'string' ? source.provider.trim() : DEFAULTS.provider,
    model: typeof source.model === 'string' ? source.model.trim() : DEFAULTS.model,
    maxSegmentsPerRequest: number(
      'maxSegmentsPerRequest',
      DEFAULTS.maxSegmentsPerRequest,
      1,
      20,
    ),
    maxCharsPerRequest: number('maxCharsPerRequest', DEFAULTS.maxCharsPerRequest, 400, 30000),
    maxTextChars: number('maxTextChars', DEFAULTS.maxTextChars, 400, 30000),
    timeoutMs: number('timeoutMs', DEFAULTS.timeoutMs, 15000, 600000),
    chatMaxChars: number('chatMaxChars', DEFAULTS.chatMaxChars, 2000, 60000),
    chatTimeoutMs: number('chatTimeoutMs', DEFAULTS.chatTimeoutMs, 15000, 900000),
    chatMaxTokens: number('chatMaxTokens', DEFAULTS.chatMaxTokens, 256, 65536),
    cacheEntries: number('cacheEntries', DEFAULTS.cacheEntries, 0, 5000),
  }
}

function modelSelection(ctx, config) {
  let selected
  try {
    selected = ctx.get('agentDefaultModel')?.currentSelection?.()
  } catch {
    selected = undefined
  }
  const provider = config.provider || selected?.provider || 'deepseek-account'
  const model = config.model || selected?.model || 'deepseek-flash'
  // The profile's reasoning effort only describes the default route. When the
  // bundle config overrides either half of that route, inheriting the effort
  // could send an unsupported level to the configured model.
  const inheritsDefaultRoute =
    provider === selected?.provider && model === selected?.model
  const reasoningEffort =
    inheritsDefaultRoute && typeof selected?.reasoningEffort === 'string'
      ? selected.reasoningEffort
      : undefined
  return {
    provider,
    model,
    reasoningEffort,
    source: config.provider || config.model ? 'plugin-config' : 'profile-default',
  }
}

function cleanModelSelection(value) {
  if (value === null || typeof value !== 'object') return undefined
  const provider = String(value.provider ?? '').trim().slice(0, 120)
  const model = String(value.model ?? '').trim().slice(0, 120)
  if (provider === '' && model === '') return undefined
  const reasoningEffort = String(value.reasoningEffort ?? '').trim().slice(0, 80)
  return {
    provider,
    model,
    ...(reasoningEffort === '' ? {} : { reasoningEffort }),
  }
}

/**
 * Resolve the model route requested by one translation or chat call.
 * `agentDefaultModel` remains the fallback when the UI sends no explicit
 * selection; a selection without `reasoningEffort` intentionally asks for the
 * provider default rather than inheriting the profile-level effort.
 */
async function resolveRequestSelection(ctx, config, body) {
  const fallback = modelSelection(ctx, config)
  const requested = cleanModelSelection(body?.modelSelection)
  if (requested === undefined) return fallback
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.resolveModelInfo !== 'function') {
    throw new PluginError(
      'TRANSLATION_UNAVAILABLE',
      'The DSH model service is not mounted, so this plugin cannot select a model.',
      503,
    )
  }
  const provider = requested.provider || fallback.provider
  const model = requested.model || fallback.model
  let info
  try {
    info = await llm.resolveModelInfo(provider, model)
  } catch (error) {
    throw new PluginError(
      'MODEL_UNAVAILABLE',
      `Model route ${provider}/${model} is not available: ${
        error instanceof Error ? error.message : String(error)
      }`,
      400,
    )
  }
  if (requested.reasoningEffort !== undefined) {
    const efforts = Array.isArray(info?.reasoning?.efforts) ? info.reasoning.efforts : []
    if (!efforts.some((effort) => effort.id === requested.reasoningEffort)) {
      throw new PluginError(
        'REASONING_UNAVAILABLE',
        `Reasoning effort ${requested.reasoningEffort} is not supported by ${provider}/${model}.`,
        400,
      )
    }
  }
  return {
    provider,
    model,
    reasoningEffort: requested.reasoningEffort,
  }
}

function serviceInfo(ctx) {
  const llm = ctx.get('llm')
  let providers = []
  if (llm !== undefined && typeof llm.listProviders === 'function') {
    try {
      providers = llm.listProviders().map((entry) => entry.id)
    } catch {
      providers = []
    }
  }
  return { available: llm !== undefined, providers }
}

let modelCatalogCache = { at: 0, data: null }
const MODEL_CATALOG_TTL_MS = 60_000

/**
 * Read the provider/model catalog advertised by the mounted adapters.
 * Reasoning metadata is model-specific, so it is resolved per model and is
 * only a hint for the picker; the request path validates again.
 */
async function readModelCatalog(ctx, { force = false } = {}) {
  const now = Date.now()
  if (
    !force &&
    modelCatalogCache.data !== null &&
    now - modelCatalogCache.at < MODEL_CATALOG_TTL_MS
  ) {
    return modelCatalogCache.data
  }
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.listModels !== 'function') {
    return { providers: [], models: [], warnings: [] }
  }
  let providers = []
  try {
    providers = llm.listProviders()
  } catch {
    providers = []
  }
  const warnings = []
  const modelEntries = []
  await Promise.all(
    providers.map(async (provider) => {
      let models = []
      try {
        models = await llm.listModels(provider.id)
      } catch (error) {
        warnings.push(
          `${provider.id}: ${error instanceof Error ? error.message : String(error)}`,
        )
        return
      }
      if (!Array.isArray(models)) models = []
      for (const model of models.slice(0, 200)) {
        let info
        try {
          info =
            typeof llm.resolveModelInfo === 'function'
              ? await llm.resolveModelInfo(provider.id, model.id)
              : undefined
        } catch {
          info = undefined
        }
        modelEntries.push({
          provider: provider.id,
          providerName: provider.name ?? provider.id,
          id: model.id,
          name: model.name ?? model.id,
          ...(model.description ? { description: model.description } : {}),
          ...(model.badge ? { badge: model.badge } : {}),
          ...(info?.reasoning
            ? {
                reasoning: {
                  defaultEffort: info.reasoning.defaultEffort,
                  efforts: info.reasoning.efforts.map((effort) => ({
                    id: effort.id,
                    name: effort.name,
                    ...(effort.description ? { description: effort.description } : {}),
                  })),
                },
              }
            : {}),
        })
      }
    }),
  )
  const data = {
    providers: providers.map((provider) => ({
      id: provider.id,
      name: provider.name ?? provider.id,
    })),
    models: modelEntries,
    warnings,
  }
  modelCatalogCache = { at: now, data }
  return data
}

function remember(cache, key, value, limit) {
  if (limit <= 0) return
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

async function translateOnce({ ctx, config, selection, targetLanguage, sourceLanguage, glossary, segments, signal }) {
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new PluginError(
      'TRANSLATION_UNAVAILABLE',
      'The model service is not available in this DSH profile.',
      503,
    )
  }

  const controller = new AbortController()
  let timedOut = false
  const onOuterAbort = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, config.timeoutMs)

  const prompt = translationPrompt(targetLanguage, sourceLanguage, glossary, segments)
  let output = ''
  let finish
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens: 4096,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') output += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    if (timedOut) {
      throw new PluginError(
        'TRANSLATION_TIMEOUT',
        `The model did not finish within ${Math.round(config.timeoutMs / 1000)}s.`,
        504,
      )
    }
    if (controller.signal.aborted) {
      throw new PluginError('TRANSLATION_ABORTED', 'Translation was cancelled.', 499)
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new PluginError('TRANSLATION_FAILED', message, 502)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onOuterAbort)
  }

  if (finish?.kind === 'error') {
    throw new PluginError(
      'TRANSLATION_FAILED',
      finish.failure?.message ?? 'The model request failed.',
      502,
    )
  }
  if (finish?.kind === 'aborted') {
    throw new PluginError('TRANSLATION_ABORTED', 'Translation was cancelled.', 499)
  }
  if (finish?.kind === 'max-tokens') {
    throw new PluginError(
      'TRANSLATION_TRUNCATED',
      'The model reached its output limit. Retry with fewer paragraphs or shorter text.',
      502,
    )
  }

  const parsed = parseTranslationJson(output, segments.length)
  if (parsed === undefined) {
    throw new PluginError(
      'TRANSLATION_PARSE',
      'The model did not return one translation per paragraph. Retry to get a fresh response.',
      502,
    )
  }
  return normalizeTranslations(parsed, segments)
}

async function translateWithFallback(args) {
  try {
    return await translateOnce(args)
  } catch (error) {
    if (error?.code === 'TRANSLATION_PARSE' && args.segments.length > 1) {
      const middle = Math.ceil(args.segments.length / 2)
      const left = await translateWithFallback({ ...args, segments: args.segments.slice(0, middle) })
      const right = await translateWithFallback({ ...args, segments: args.segments.slice(middle) })
      return [...left, ...right]
    }
    throw error
  }
}

function validateTranslateBody(body, config) {
  if (body === null || typeof body !== 'object') {
    throw new PluginError('INVALID_REQUEST', 'Expected a JSON object.')
  }
  const targetLanguage = String(body.targetLanguage ?? '').trim()
  if (targetLanguage === '' || targetLanguage.length > 40) {
    throw new PluginError('INVALID_TARGET', 'A target language is required.')
  }
  const sourceLanguage = String(body.sourceLanguage ?? '').trim().slice(0, 40)
  if (!Array.isArray(body.segments) || body.segments.length === 0) {
    throw new PluginError('INVALID_SEGMENTS', 'At least one text segment is required.')
  }
  if (body.segments.length > 80) {
    throw new PluginError('INVALID_SEGMENTS', 'Too many segments in one request (max 80).')
  }
  const seen = new Set()
  const segments = []
  for (const raw of body.segments) {
    if (raw === null || typeof raw !== 'object') continue
    const id = String(raw.id ?? '')
    const text = String(raw.text ?? '')
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    if (text.trim() === '') continue
    if (text.length > config.maxTextChars) {
      throw new PluginError(
        'SEGMENT_TOO_LONG',
        `One paragraph is longer than ${config.maxTextChars} characters. Split it before translating.`,
      )
    }
    segments.push({ id, text })
  }
  if (segments.length === 0) {
    throw new PluginError('INVALID_SEGMENTS', 'All segments were empty.')
  }
  return {
    targetLanguage,
    sourceLanguage,
    glossary: normalizeGlossary(body.glossary),
    segments,
    refresh: body.refresh === true,
  }
}

function busyDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handleTranslate(ctx, config, body, cache, signal) {
  const request = validateTranslateBody(body, config)
  const selection = await resolveRequestSelection(ctx, config, body)
  const info = serviceInfo(ctx)
  if (!info.available) {
    throw new PluginError(
      'TRANSLATION_UNAVAILABLE',
      'The DSH model service is not mounted, so this plugin cannot translate.',
      503,
    )
  }

  const batches = splitBatches(request.segments, config)
  const translations = []
  const started = Date.now()

  for (const batch of batches) {
    if (signal?.aborted) {
      throw new PluginError('TRANSLATION_ABORTED', 'Translation was cancelled.', 499)
    }
    const key = cacheKey([
      'v1',
      selection.provider,
      selection.model,
      selection.reasoningEffort ?? '',
      request.targetLanguage,
      request.sourceLanguage,
      request.glossary,
      batch.map((segment) => [segment.id, segment.text]),
    ])
    // Each request owns its model call. Sharing an in-flight promise would
    // let one reader's disconnect abort another reader's translation.
    const result =
      !request.refresh && cache.has(key)
        ? cache.get(key)
        : await translateWithFallback({
            ctx,
            config,
            selection,
            targetLanguage: request.targetLanguage,
            sourceLanguage: request.sourceLanguage,
            glossary: request.glossary,
            segments: batch,
            signal,
          })
    const hasPlaceholderError = result.some((item) => item.error === 'placeholder')
    if (!request.refresh && !hasPlaceholderError) remember(cache, key, result, config.cacheEntries)
    translations.push(...result)
    // Be gentle with the account route when one logical page needs several
    // batches. A paint delay keeps progress visible and avoids bursty retries.
    if (batches.length > 1 && batch !== batches[batches.length - 1]) await busyDelay(120)
  }

  return {
    ok: true,
    translations,
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    batches: batches.length,
    elapsedMs: Date.now() - started,
    glossarySize: request.glossary.length,
  }
}

async function handleChat(ctx, config, body, signal) {
  if (body === null || typeof body !== 'object') {
    throw new PluginError('INVALID_REQUEST', 'Expected a JSON object.')
  }
  const question = String(body.question ?? '').trim()
  if (question === '') throw new PluginError('INVALID_QUESTION', 'A question is required.')
  if (question.length > 6000) {
    throw new PluginError('QUESTION_TOO_LONG', 'The question is longer than 6000 characters.')
  }
  const context = String(body.context ?? '').trim()
  if (context === '') {
    throw new PluginError('EMPTY_CONTEXT', 'No document context was supplied.')
  }
  if (context.length > config.chatMaxChars + 4000) {
    throw new PluginError('CONTEXT_TOO_LONG', 'The document context is too large for one request.')
  }
  const llm = ctx.get('llm')
  if (llm === undefined || typeof llm.stream !== 'function') {
    throw new PluginError(
      'TRANSLATION_UNAVAILABLE',
      'The model service is not available in this DSH profile.',
      503,
    )
  }
  const selection = await resolveRequestSelection(ctx, config, body)
  const skillName = String(body.skill?.name ?? '').trim().slice(0, 120)
  const skillContent = String(body.skill?.content ?? '').trim().slice(0, 16000)
  const prompt = chatPrompt({
    question,
    history: normalizeHistory(body.history),
    context: context.slice(0, config.chatMaxChars),
    contextLabel: String(body.contextLabel ?? '').slice(0, 120),
    skill:
      skillName !== '' && skillContent !== ''
        ? { name: skillName, content: skillContent }
        : undefined,
  })
  const controller = new AbortController()
  const onOuterAbort = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  const maxTokens = normalizeChatTokens(body.maxTokens, config.chatMaxTokens)
  const timeoutMs = chatTimeoutMsFor(config.chatTimeoutMs, maxTokens)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  let answer = ''
  let finish
  const started = Date.now()
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens,
      signal: controller.signal,
    })
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') answer += chunk.text
      else if (chunk.type === 'finish') finish = chunk.reason
    }
  } catch (error) {
    if (timedOut) {
      throw new PluginError(
        'CHAT_TIMEOUT',
        `The model did not finish within ${Math.round(timeoutMs / 1000)}s.`,
        504,
      )
    }
    if (controller.signal.aborted) {
      throw new PluginError('CHAT_ABORTED', 'The answer was cancelled.', 499)
    }
    throw new PluginError(
      'CHAT_FAILED',
      error instanceof Error ? error.message : String(error),
      502,
    )
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener?.('abort', onOuterAbort)
  }
  if (finish?.kind === 'error') {
    throw new PluginError(
      'CHAT_FAILED',
      finish.failure?.message ?? 'The model request failed.',
      502,
    )
  }
  if (finish?.kind === 'aborted') {
    throw new PluginError('CHAT_ABORTED', 'The answer was cancelled.', 499)
  }
  const text = answer.trim()
  if (text === '') {
    if (timedOut) {
      throw new PluginError('CHAT_TIMEOUT', 'AI 阅读等待超时，尚未收到回答正文。请降低推理强度或缩小提问范围后重试。', 504)
    }
    if (finish?.kind === 'max-tokens') {
      throw new PluginError(
        'CHAT_REASONING_LIMIT',
        '模型已达到输出额度，但尚未生成回答正文。推理过程可能耗尽了额度，请降低推理强度（例如从 Max 调低），或在设置中提高回答长度上限后重试。',
        502,
      )
    }
    throw new PluginError(
      'EMPTY_ANSWER',
      `模型服务未返回回答正文（结束状态：${finish?.kind ?? '未收到结束事件'}）。请重试或切换模型；若持续出现，请检查模型服务连接。`,
      502,
    )
  }
  return {
    ok: true,
    answer: text,
    truncated: finish?.kind === 'max-tokens',
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    elapsedMs: Date.now() - started,
  }
}


async function listAvailableSkills(ctx) {
  const service = ctx.get('skills')
  if (service === undefined || typeof service.list !== 'function') {
    throw new PluginError('SKILLS_UNAVAILABLE', 'The DSH skill service is not mounted.', 503)
  }
  const skills = await service.list({ cwd: process.cwd() })
  return skills.slice(0, 200).map((skill) => ({
    name: String(skill.name ?? ''),
    description: String(skill.description ?? ''),
    whenToUse: String(skill.whenToUse ?? ''),
    source: String(skill.source ?? ''),
    provider: String(skill.provider ?? ''),
  }))
}

async function loadAvailableSkill(ctx, name) {
  const service = ctx.get('skills')
  if (service === undefined || typeof service.get !== 'function') {
    throw new PluginError('SKILLS_UNAVAILABLE', 'The DSH skill service is not mounted.', 503)
  }
  const normalized = String(name ?? '').trim()
  if (normalized === '' || normalized.length > 160) {
    throw new PluginError('INVALID_SKILL', 'A skill name is required.')
  }
  const skill = await service.get(normalized, { cwd: process.cwd() })
  if (skill === undefined) {
    throw new PluginError('SKILL_NOT_FOUND', `Skill "${normalized}" was not found.`, 404)
  }
  return {
    ok: true,
    name: String(skill.name ?? normalized),
    description: String(skill.description ?? ''),
    content: String(skill.content ?? '').slice(0, 20000),
  }
}


function safeNotesFileName(name) {
  const base = String(name ?? 'document')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return base || 'document'
}

async function handleSaveNotes(ctx, body) {
  if (body === null || typeof body !== 'object') {
    throw new PluginError('INVALID_REQUEST', 'Expected a JSON object.')
  }
  const markdown = String(body.markdown ?? '')
  if (markdown.trim() === '') {
    throw new PluginError('EMPTY_NOTES', 'There are no notes to save.')
  }
  if (markdown.length > 2_500_000) {
    throw new PluginError('NOTES_TOO_LARGE', 'The notes file is too large.', 413)
  }
  const requested = String(body.directory ?? '').trim()
  if (requested.length > 1000 || requested.includes('\0')) {
    throw new PluginError('INVALID_DIRECTORY', 'The save directory is invalid.')
  }
  const directory = requested === '' ? defaultNotesDir(ctx) : resolve(requested)
  const base = safeNotesFileName(body.fileName ?? body.title ?? 'document')
  await mkdir(directory, { recursive: true })
  let target = join(directory, `${base}-notes.md`)
  try {
    await stat(target)
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+$/, '')
      .replace('T', '-')
    target = join(directory, `${base}-notes-${stamp}.md`)
  } catch {
    // No collision: write the normal name.
  }
  await writeFile(target, markdown, 'utf8')
  return {
    ok: true,
    path: target,
    directory,
    fileName: basename(target),
  }
}


function safeAssetPath(pathname) {
  let name
  try {
    name = decodeURIComponent(pathname.slice(ASSET_PREFIX.length))
  } catch {
    return undefined
  }
  if (
    name === '' ||
    name.includes('\0') ||
    name.includes('..') ||
    name.includes('\\') ||
    /^[A-Za-z]:/.test(name) ||
    isAbsolute(name)
  ) {
    return undefined
  }
  const root = resolve(ASSETS)
  const file = resolve(root, name)
  const rel = relative(root, file)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return undefined
  }
  return file
}

async function serveAsset(pathname) {
  const file = safeAssetPath(pathname)
  if (file === undefined) return textResponse(404, 'Not found')
  try {
    const data = await readFile(file)
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(data, {
      status: 200,
      headers: {
        'content-type': type,
        'content-length': String(data.byteLength),
        'cache-control': 'public, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return textResponse(404, 'Not found')
  }
}

function defaultNotesDir(ctx) {
  let base = ''
  try {
    const workingDirectory = ctx.get('workingDirectory')
    base = typeof workingDirectory?.defaultDirectory === 'string' ? workingDirectory.defaultDirectory : ''
  } catch {
    base = ''
  }
  return join(base || process.cwd(), 'pdf-reader-notes')
}

function healthPayload(ctx, config) {
  const selection = modelSelection(ctx, config)
  const info = serviceInfo(ctx)
  return {
    ok: true,
    version: VERSION,
    llm: info.available,
    providers: info.providers,
    provider: selection.provider,
    model: selection.model,
    reasoningEffort: selection.reasoningEffort,
    selectionSource: selection.source,
    defaultNotesDir: defaultNotesDir(ctx),
    limits: {
      maxSegmentsPerRequest: config.maxSegmentsPerRequest,
      maxCharsPerRequest: config.maxCharsPerRequest,
      maxTextChars: config.maxTextChars,
      timeoutMs: config.timeoutMs,
      chatMaxChars: config.chatMaxChars,
      chatTimeoutMs: config.chatTimeoutMs,
    },
  }
}

async function readNodeBody(req) {
  const declared = Number(req.headers['content-length'] ?? '0')
  if (Number.isFinite(declared) && declared > 2_500_000) {
    throw new PluginError('REQUEST_TOO_LARGE', 'The request body is too large.', 413)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 2_500_000) {
      throw new PluginError('REQUEST_TOO_LARGE', 'The request body is too large.', 413)
    }
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') {
    throw new PluginError('INVALID_JSON', 'The request body is empty.')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new PluginError('INVALID_JSON', 'The request body is not valid JSON.')
  }
}

function writeNodeJson(res, status, body) {
  if (res.destroyed) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function writeNodeError(res, error) {
  if (res.destroyed) return
  if (res.headersSent) {
    res.end()
    return
  }
  if (error instanceof PluginError) {
    writeNodeJson(res, error.status, {
      ok: false,
      error: { code: error.code, message: error.message },
    })
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  writeNodeJson(res, 500, {
    ok: false,
    error: { code: 'INTERNAL_ERROR', message },
  })
}

function clientAbortHandle(req, res) {
  const controller = new AbortController()
  const onClose = () => {
    if (!res.writableEnded) controller.abort()
  }
  const onAborted = () => controller.abort()
  res.on('close', onClose)
  req.on('aborted', onAborted)
  return {
    signal: controller.signal,
    dispose() {
      res.off('close', onClose)
      req.off('aborted', onAborted)
    },
  }
}

function createTranslateRoute(ctx, config, cache) {
  return async function translateRoute(req, res) {
    const abort = clientAbortHandle(req, res)
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const body = await readNodeBody(req)
      const result = await handleTranslate(ctx, config, body, cache, abort.signal)
      writeNodeJson(res, 200, result)
    } catch (error) {
      writeNodeError(res, error)
    } finally {
      abort.dispose()
    }
  }
}

function createChatRoute(ctx, config) {
  return async function chatRoute(req, res) {
    const abort = clientAbortHandle(req, res)
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const body = await readNodeBody(req)
      const result = await handleChat(ctx, config, body, abort.signal)
      writeNodeJson(res, 200, result)
    } catch (error) {
      writeNodeError(res, error)
    } finally {
      abort.dispose()
    }
  }
}

function createSkillsRoute(ctx) {
  return async function skillsRoute(req, res) {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { allow: 'GET' })
        res.end()
        return
      }
      const skills = await listAvailableSkills(ctx)
      writeNodeJson(res, 200, { ok: true, skills })
    } catch (error) {
      writeNodeError(res, error)
    }
  }
}

function createSkillRoute(ctx) {
  return async function skillRoute(req, res) {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const body = await readNodeBody(req)
      const skill = await loadAvailableSkill(ctx, body?.name)
      writeNodeJson(res, 200, skill)
    } catch (error) {
      writeNodeError(res, error)
    }
  }
}


function createSaveNotesRoute(ctx) {
  return async function saveNotesRoute(req, res) {
    try {
      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST' })
        res.end()
        return
      }
      const body = await readNodeBody(req)
      const result = await handleSaveNotes(ctx, body)
      writeNodeJson(res, 200, result)
    } catch (error) {
      writeNodeError(res, error)
    }
  }
}


function createModelsRoute(ctx) {
  return async function modelsRoute(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { allow: 'GET, HEAD' })
        res.end()
        return
      }
      const catalog = await readModelCatalog(ctx, {
        force: new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1',
      })
      writeNodeJson(res, 200, { ok: true, ...catalog })
    } catch (error) {
      writeNodeError(res, error)
    }
  }
}

function createHealthResource(ctx, config) {
  return async function healthResource() {
    return jsonResponse(200, healthPayload(ctx, config))
  }
}

function createAssetResource() {
  return async function assetResource(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return textResponse(405, 'Method not allowed')
    }
    const response = await serveAsset(new URL(request.url).pathname)
    if (request.method === 'HEAD') {
      return new Response(null, { status: response.status, headers: response.headers })
    }
    return response
  }
}

/**
 * Mount the reader route and its PDF.js assets.
 *
 * API POSTs must use a Node handler route: a web resource route only serves
 * GET/HEAD. Assets and health stay resources so they stream without buffering.
 * @param ctx Cordis context with `webServer`.
 * @param config Raw bundle config (all fields optional).
 */
export function apply(ctx, config) {
  const resolved = readConfig(config)
  const cache = new Map()
  const disposers = [
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      resource: async () => textResponse(200, 'PDF Math Reader host is running.'),
    }),
    ctx.webServer.register({
      kind: 'prefix',
      path: `${ROUTE}/assets`,
      resource: createAssetResource(),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/health`,
      resource: createHealthResource(ctx, resolved),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/models`,
      handler: createModelsRoute(ctx),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/translate`,
      handler: createTranslateRoute(ctx, resolved, cache),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/chat`,
      handler: createChatRoute(ctx, resolved),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/skills`,
      handler: createSkillsRoute(ctx),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/skill`,
      handler: createSkillRoute(ctx),
    }),
    ctx.webServer.register({
      kind: 'exact',
      path: `${ROUTE}/api/save-notes`,
      handler: createSaveNotesRoute(ctx),
    }),
  ]
  ctx.effect(
    () => () => {
      for (const dispose of disposers) dispose()
    },
    'pdf-math-reader: web routes',
  )
}
