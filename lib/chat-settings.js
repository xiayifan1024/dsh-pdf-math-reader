export const CHAT_TOKEN_STEPS = [2048, 4096, 8192, 16384, 32768, 65536]

/** Slowest streaming rate the chat timeout plans for, in milliseconds per output token. */
export const CHAT_MS_PER_TOKEN = 8

/** Prefill, queueing and the first token, added to the per-token budget. */
export const CHAT_TIMEOUT_HEADROOM_MS = 60000

/** Hard ceiling for one chat request, whatever the configured floor is. */
export const CHAT_TIMEOUT_MAX_MS = 900000

export function normalizeChatTokens(value, fallback = 8192) {
  return CHAT_TOKEN_STEPS.includes(Number(value)) ? Number(value) : fallback
}

/**
 * The configured chat timeout is a floor: a large answer budget needs more wall
 * clock than a short one, so the deadline grows with the requested tokens.
 * At 8 ms per token a 65,536-token answer gets roughly ten minutes.
 */
export function chatTimeoutMsFor(baseMs, maxTokens) {
  const floor = Number(baseMs) > 0 ? Number(baseMs) : 0
  const budget = Number(maxTokens) * CHAT_MS_PER_TOKEN + CHAT_TIMEOUT_HEADROOM_MS
  return Math.round(Math.min(CHAT_TIMEOUT_MAX_MS, Math.max(floor, budget)))
}
