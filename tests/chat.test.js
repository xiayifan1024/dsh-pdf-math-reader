import assert from 'node:assert/strict'
import test from 'node:test'
import { chatPrompt, normalizeHistory } from '../lib/chat.js'

test('continuations receive the end of a long assistant answer', () => {
  const content = 'Beginning'.repeat(500) + 'The actual stopping point'
  const [entry] = normalizeHistory([{ role: 'assistant', content }])
  assert.equal(entry.content.length, 2400)
  assert.ok(entry.content.endsWith('The actual stopping point'))
})

test('normalizes history roles, empties and length', () => {
  const history = normalizeHistory([
    { role: 'user', content: '  hello  ' },
    { role: 'assistant', content: 'hi' },
    { role: 'tool', content: 'ignore' },
    { role: 'user', content: '' },
  ])
  assert.deepEqual(history, [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi' },
  ])
})

test('includes context, skill and latest question', () => {
  const prompt = chatPrompt({
    question: 'What is the contribution?',
    history: [{ role: 'user', content: 'Earlier question' }],
    context: '[Page 1]\nA document excerpt.',
    contextLabel: 'Page 1',
    skill: { name: 'close-reading', content: 'Read claims and evidence separately.' },
  })
  assert.match(prompt, /Page 1/)
  assert.match(prompt, /A document excerpt/)
  assert.match(prompt, /IMPORTED READING SKILL: close-reading/)
  assert.match(prompt, /Read claims and evidence separately/)
  assert.match(prompt, /USER QUESTION:\nWhat is the contribution\?/)
  assert.match(prompt, /User: Earlier question/)
})
