export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function readJsonResponse(response) {
  let payload
  try {
    payload = await response.json()
  } catch {
    throw new ApiError('BAD_RESPONSE', `The server returned ${response.status}.`, response.status)
  }
  if (response.ok && payload?.ok === true) return payload
  const error = payload?.error
  throw new ApiError(
    typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
    typeof error?.message === 'string' ? error.message : `The request failed (${response.status}).`,
    response.status,
  )
}

export async function fetchHealth(signal) {
  const response = await fetch('/pdf-reader/api/health', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  })
  return await readJsonResponse(response)
}

export async function translateSegments(payload, signal) {
  const response = await fetch('/pdf-reader/api/translate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  return await readJsonResponse(response)
}

export async function chatWithPaper(payload, signal) {
  const response = await fetch('/pdf-reader/api/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  return await readJsonResponse(response)
}

export async function listSkills(signal) {
  const response = await fetch('/pdf-reader/api/skills', {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  })
  return await readJsonResponse(response)
}

export async function loadSkill(name, signal) {
  const response = await fetch('/pdf-reader/api/skill', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
    signal,
  })
  return await readJsonResponse(response)
}

export async function saveNotes(payload, signal) {
  const response = await fetch('/pdf-reader/api/save-notes', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  return await readJsonResponse(response)
}
