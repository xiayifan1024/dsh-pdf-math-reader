import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CHAT_TIMEOUT_MAX_MS,
  CHAT_TOKEN_STEPS,
  chatTimeoutMsFor,
  normalizeChatTokens,
} from '../lib/chat-settings.js'

test('accepts supported answer budgets and rejects invalid or excessive values', () => {
  for (const value of CHAT_TOKEN_STEPS) assert.equal(normalizeChatTokens(value), value)
  for (const value of [undefined, null, -1, 1000000, 'invalid', 8193]) {
    assert.equal(normalizeChatTokens(value), 8192)
    assert.equal(normalizeChatTokens(value, 4096), 4096)
  }
})

test('offers the 65,536-token deep-reading budget', () => {
  assert.deepEqual(CHAT_TOKEN_STEPS, [2048, 4096, 8192, 16384, 32768, 65536])
  assert.equal(normalizeChatTokens(65536), 65536)
  assert.equal(normalizeChatTokens('65536'), 65536)
})

test('grows the chat deadline with the answer budget and keeps the configured floor', () => {
  assert.equal(chatTimeoutMsFor(150000, 2048), 150000)
  assert.equal(chatTimeoutMsFor(150000, 8192), 150000)
  assert.equal(chatTimeoutMsFor(150000, 16384), 191072)
  assert.equal(chatTimeoutMsFor(150000, 32768), 322144)
  assert.equal(chatTimeoutMsFor(150000, 65536), 584288)
  assert.equal(chatTimeoutMsFor(undefined, 65536), 584288)
  assert.equal(chatTimeoutMsFor(150000, 1000000), CHAT_TIMEOUT_MAX_MS)
})
