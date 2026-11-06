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
        async *stream(options) {
          assert.equal(options.provider, 'deepseek-account')
          assert.equal(options.model, 'deepseek-flash')
          const prompt = options.messages[0].content[0].text
          if (prompt.includes('research assistant')) {
            yield { type: 'text-delta', index: 0, text: 'The paper proposes a new method.' }
            yield { type: 'finish', reason: { kind: 'stop' } }
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

try {
  const health = await fetch(`${origin}/pdf-reader/api/health`)
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.llm, true)
  assert.equal(healthBody.model, 'deepseek-flash')

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
