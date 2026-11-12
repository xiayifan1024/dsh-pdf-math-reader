import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const routes = []
let slowAborted = false
const ctx = {
  webServer: {
    register(value) {
      routes.push(value)
      return () => {
        const index = routes.indexOf(value)
        if (index >= 0) routes.splice(index, 1)
      }
    },
  },
  effect(callback) {
    return callback()
  },
  get(name) {
    if (name === 'llm') {
      return {
        listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek Account' }],
        async listModels(provider) {
          assert.equal(provider, 'deepseek-account')
          return [
            { provider, id: 'deepseek-flash', name: 'DeepSeek Flash' },
            { provider, id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
          ]
        },
        async resolveModelInfo(provider, model) {
          assert.equal(provider, 'deepseek-account')
          if (model === 'missing-model') throw new Error('unknown model')
          return {
            provider,
            id: model,
            name: model,
            reasoning:
              model === 'deepseek-reasoner'
                ? {
                    defaultEffort: 'medium',
                    efforts: [
                      { id: 'low', name: 'Low' },
                      { id: 'medium', name: 'Medium' },
                      { id: 'high', name: 'High' },
                    ],
                  }
                : undefined,
          }
        },
        async *stream(options) {
          assert.equal(options.provider, 'deepseek-account')
          if (options.model === 'deepseek-reasoner') {
            assert.equal(options.reasoningEffort, 'high')
          } else {
            assert.equal(options.model, 'deepseek-flash')
            assert.equal(options.reasoningEffort, undefined)
          }
          const prompt = options.messages[0].content[0].text
          if (prompt.includes('research assistant')) {
            assert.equal(
              options.maxTokens,
              prompt.includes('__BUDGET__') ? 16384 : prompt.includes('__MAXBUDGET__') ? 65536 : 8192,
            )
            if (prompt.includes('__EMPTY_LIMIT__')) {
              yield { type: 'finish', reason: { kind: 'max-tokens' } }
              return
            }
            if (prompt.includes('__EMPTY_STOP__')) {
              yield { type: 'finish', reason: { kind: 'stop' } }
              return
            }
            yield { type: 'text-delta', index: 0, text: 'The paper proposes a new method.' }
            yield { type: 'finish', reason: { kind: prompt.includes('__TRUNCATED__') ? 'max-tokens' : 'stop' } }
            return
          }
          assert.ok(prompt.includes('Translate every segment'))
          if (prompt.includes('__SLOW__')) {
            await new Promise((resolve) => {
              const timer = setTimeout(resolve, 4000)
              options.signal?.addEventListener(
                'abort',
                () => {
                  clearTimeout(timer)
                  slowAborted = true
                  resolve()
                },
                { once: true },
              )
            })
            yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } }
            return
          }
          if (prompt.includes('__MALFORMED__')) {
            yield { type: 'text-delta', index: 0, text: '{"translations":["one","two"]}' }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          if (prompt.includes('__DROP_PLACEHOLDER__')) {
            yield { type: 'text-delta', index: 0, text: '{"translations":["译文丢失占位符"]}' }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          if (prompt.includes('__KEEP_PLACEHOLDER__')) {
            yield { type: 'text-delta', index: 0, text: '{"translations":["参见 ⟦MATH_001⟧ 处"]}' }
            yield { type: 'finish', reason: { kind: 'stop' } }
            return
          }
          yield { type: 'text-delta', index: 0, text: '{"translations":["' }
          yield { type: 'text-delta', index: 0, text: '第一段译文","第二段译文"]}' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      }
    }
    if (name === 'agentDefaultModel') {
      return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
    }
    if (name === 'skills') {
      return {
        async list() {
          return [
            {
              name: 'paper-close-reading',
              description: 'Read a paper closely',
              whenToUse: 'When reading a paper',
              source: 'user-dsh',
              provider: 'skills-filesystem',
            },
          ]
        },
        async get(skillName) {
          if (skillName !== 'paper-close-reading') return undefined
          return {
            name: 'paper-close-reading',
            description: 'Read a paper closely',
            content: '# Close reading\nRead claims and evidence carefully.',
          }
        },
      }
    }
    return undefined
  },
}

apply(ctx, {})

const matchRoute = (pathname) => {
  let best
  for (const route of routes) {
    const matches = route.kind === 'exact' ? pathname === route.path : pathname.startsWith(route.path)
    if (!matches) continue
    if (best === undefined || route.path.length > best.path.length) best = route
  }
  return best
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local')
    const route = matchRoute(url.pathname)
    if (route === undefined) {
      res.writeHead(404).end('no route')
      return
    }
    if (route.handler !== undefined) {
      await route.handler(req, res)
      return
    }
    const response = await route.resource(
      new Request(`http://local${req.url}`, {
        method: req.method,
        headers: req.headers,
      }),
    )
    res.writeHead(response.status, Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch (error) {
    res.writeHead(500).end(String(error))
  }
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`

// A bundle-config override must not inherit the profile's reasoning effort.
{
  const overrides = []
  const overrideRoutes = []
  const overrideCtx = {
    webServer: {
      register(value) {
        overrideRoutes.push(value)
        return () => {}
      },
    },
    effect(callback) {
      return callback()
    },
    get(name) {
      if (name === 'agentDefaultModel') {
        return {
          currentSelection: () => ({
            provider: 'deepseek-account',
            model: 'deepseek-flash',
            reasoningEffort: 'high',
          }),
        }
      }
      if (name === 'llm') {
        return {
          listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek Account' }],
          async listModels() {
            return [{ provider: 'deepseek-account', id: 'deepseek-chat', name: 'DeepSeek Chat' }]
          },
          async resolveModelInfo(provider, model) {
            return { provider, id: model, name: model }
          },
          async *stream(options) {
            overrides.push(options)
            yield { type: 'text-delta', index: 0, text: '{"translations":["a","b"]}' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          },
        }
      }
      return undefined
    },
  }
  apply(overrideCtx, { model: 'deepseek-chat' })
  const translateRoute = overrideRoutes.find((route) => route.path === '/pdf-reader/api/translate')
  assert.ok(translateRoute, 'translate route missing')
  const results = []
  const res = {
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(payload) {
      results.push({ status: this.status, body: JSON.parse(payload) })
    },
    on() {},
    off() {},
    once() {},
    destroyed: false,
  }
  const req = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    on() {},
    off() {},
    once() {},
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(
        JSON.stringify({
          targetLanguage: 'zh-CN',
          segments: [
            { id: 'a', text: 'First' },
            { id: 'b', text: 'Second' },
          ],
        }),
      )
    },
  }
  await translateRoute.handler(req, res)
  assert.equal(results[0]?.status, 200, JSON.stringify(results[0]))
  assert.equal(overrides.length, 1)
  assert.equal(overrides[0].model, 'deepseek-chat')
  assert.equal(overrides[0].reasoningEffort, undefined)
}

try {
  const health = await fetch(`${origin}/pdf-reader/api/health`)
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.llm, true)
  assert.equal(healthBody.model, 'deepseek-flash')

  const models = await fetch(`${origin}/pdf-reader/api/models`)
  assert.equal(models.status, 200)
  const modelsBody = await models.json()
  assert.equal(modelsBody.ok, true)
  assert.deepEqual(
    modelsBody.models.map((entry) => entry.id),
    ['deepseek-flash', 'deepseek-reasoner'],
  )
  const reasoner = modelsBody.models.find((entry) => entry.id === 'deepseek-reasoner')
  assert.equal(reasoner.reasoning.defaultEffort, 'medium')
  assert.deepEqual(
    reasoner.reasoning.efforts.map((effort) => effort.id),
    ['low', 'medium', 'high'],
  )

  const translated = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [
        { id: 'p1', text: 'Hello world' },
        { id: 'p2', text: 'Second paragraph' },
      ],
      glossary: [{ source: 'Hello', target: '你好' }],
    }),
  })
  assert.equal(translated.status, 200, await translated.clone().text())
  const translatedBody = await translated.json()
  assert.equal(translatedBody.translations.length, 2)
  assert.equal(translatedBody.translations[0].text, '第一段译文')
  assert.equal(translatedBody.translations[1].id, 'p2')

  const selectedTranslation = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [
        { id: 'selected1', text: 'Selected model' },
        { id: 'selected2', text: 'Second selected paragraph' },
      ],
      modelSelection: {
        provider: 'deepseek-account',
        model: 'deepseek-reasoner',
        reasoningEffort: 'high',
      },
    }),
  })
  assert.equal(selectedTranslation.status, 200, await selectedTranslation.clone().text())
  const selectedBody = await selectedTranslation.json()
  assert.equal(selectedBody.model, 'deepseek-reasoner')
  assert.equal(selectedBody.reasoningEffort, 'high')

  const badReasoning = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [{ id: 'bad', text: 'Bad reasoning' }],
      modelSelection: {
        provider: 'deepseek-account',
        model: 'deepseek-reasoner',
        reasoningEffort: 'ultra',
      },
    }),
  })
  assert.equal(badReasoning.status, 400)
  assert.equal((await badReasoning.json()).error.code, 'REASONING_UNAVAILABLE')

  const missingModel = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [{ id: 'missing', text: 'Missing model' }],
      modelSelection: {
        provider: 'deepseek-account',
        model: 'missing-model',
      },
    }),
  })
  assert.equal(missingModel.status, 400)
  assert.equal((await missingModel.json()).error.code, 'MODEL_UNAVAILABLE')

  const droppedPlaceholder = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [
        { id: 'ph1', text: 'value __DROP_PLACEHOLDER__ ⟦MATH_001⟧' },
      ],
    }),
  })
  assert.equal(droppedPlaceholder.status, 200)
  const droppedBody = await droppedPlaceholder.json()
  assert.equal(droppedBody.translations[0].error, 'placeholder')
  assert.equal(droppedBody.translations[0].placeholderIssue, 'missing')

  const keptPlaceholder = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [
        { id: 'ph2', text: 'value __KEEP_PLACEHOLDER__ ⟦MATH_001⟧' },
      ],
    }),
  })
  assert.equal(keptPlaceholder.status, 200)
  const keptBody = await keptPlaceholder.json()
  assert.equal(keptBody.translations[0].error, undefined)
  assert.match(keptBody.translations[0].text, /⟦MATH_001⟧/)

  const malformed = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [{ id: 'm1', text: '__MALFORMED__' }],
    }),
  })
  assert.equal(malformed.status, 502)
  const malformedBody = await malformed.json()
  assert.equal(malformedBody.error.code, 'TRANSLATION_PARSE')

  const controller = new AbortController()
  const slow = fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      targetLanguage: 'zh-CN',
      segments: [{ id: 'slow', text: '__SLOW__' }],
    }),
    signal: controller.signal,
  }).catch((error) => error)
  await new Promise((resolve) => setTimeout(resolve, 150))
  controller.abort()
  await slow
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(slowAborted, true)

  const asset = await fetch(`${origin}/pdf-reader/assets/pdf.min.mjs`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /text\/javascript/)
  assert.ok((await asset.text()).length > 1000)

  const escaped = await fetch(`${origin}/pdf-reader/assets/C%3A%5CWindows%5Cwin.ini`)
  assert.equal(escaped.status, 404)

  const bad = await fetch(`${origin}/pdf-reader/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targetLanguage: '', segments: [] }),
  })
  assert.equal(bad.status, 400)

  const chat = await fetch(`${origin}/pdf-reader/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: 'What is the main contribution?',
      context: '[Page 1]\nThe paper proposes a new method.',
      contextLabel: 'Page 1',
      history: [],
    }),
  })
  assert.equal(chat.status, 200, await chat.clone().text())
  const chatBody = await chat.json()
  assert.equal(chatBody.ok, true)
  assert.ok(chatBody.answer.length > 0)
  assert.equal(chatBody.truncated, false)

  const truncatedChat = await fetch(`${origin}/pdf-reader/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: '__TRUNCATED__', context: 'Paper context.' }),
  })
  assert.equal(truncatedChat.status, 200)
  const truncatedBody = await truncatedChat.json()
  assert.equal(truncatedBody.truncated, true)
  assert.equal(truncatedBody.answer, 'The paper proposes a new method.')

  for (const [question, code] of [['__EMPTY_LIMIT__', 'CHAT_REASONING_LIMIT'], ['__EMPTY_STOP__', 'EMPTY_ANSWER']]) {
    const response = await fetch(`${origin}/pdf-reader/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, context: 'Paper context.' }),
    })
    assert.equal(response.status, 502)
    assert.ok((await response.text()).includes(code))
  }

  for (const [question, maxTokens] of [['__BUDGET__', 16384], ['__MAXBUDGET__', 65536], ['invalid budget', 999999]]) {
    const response = await fetch(`${origin}/pdf-reader/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, maxTokens, context: 'Paper context.' }),
    })
    assert.equal(response.status, 200, await response.text())
  }

  const selectedChat = await fetch(`${origin}/pdf-reader/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      question: 'What is the main contribution?',
      context: '[Page 1]\nThe paper proposes a new method.',
      contextLabel: 'Page 1',
      history: [],
      modelSelection: {
        provider: 'deepseek-account',
        model: 'deepseek-reasoner',
        reasoningEffort: 'high',
      },
    }),
  })
  assert.equal(selectedChat.status, 200, await selectedChat.clone().text())
  const selectedChatBody = await selectedChat.json()
  assert.equal(selectedChatBody.model, 'deepseek-reasoner')
  assert.equal(selectedChatBody.reasoningEffort, 'high')

  const skills = await fetch(`${origin}/pdf-reader/api/skills`)
  assert.equal(skills.status, 200)
  const skillsBody = await skills.json()
  assert.equal(skillsBody.skills[0].name, 'paper-close-reading')

  const skill = await fetch(`${origin}/pdf-reader/api/skill`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'paper-close-reading' }),
  })
  assert.equal(skill.status, 200)
  const skillBody = await skill.json()
  assert.match(skillBody.content, /Close reading/)

  const notesDir = await mkdtemp(join(tmpdir(), 'pdf-reader-notes-'))
  try {
    const saved = await fetch(`${origin}/pdf-reader/api/save-notes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        directory: notesDir,
        fileName: 'paper.pdf',
        markdown: '# Notes\n\n- item',
      }),
    })
    assert.equal(saved.status, 200)
    const savedBody = await saved.json()
    assert.ok(savedBody.path.startsWith(notesDir))
    assert.match(await readFile(savedBody.path, 'utf8'), /# Notes/)
  } finally {
    await rm(notesDir, { recursive: true, force: true })
  }

  const wrongMethod = await fetch(`${origin}/pdf-reader/api/translate`)
  assert.equal(wrongMethod.status, 405)

  console.log('host route smoke test passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
}
