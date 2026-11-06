export function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return []
  const history = []
  for (const entry of raw.slice(-10)) {
    if (entry === null || typeof entry !== 'object') continue
    const role = entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : undefined
    const content = String(entry.content ?? '').trim()
    if (role === undefined || content === '') continue
    history.push({ role, content: content.slice(0, 2400) })
  }
  return history
}

export function chatPrompt({ question, history, context, contextLabel, skill }) {
  const transcript = history
    .map((entry) => `${entry.role === 'assistant' ? 'Assistant' : 'User'}: ${entry.content}`)
    .join('\n')
  return [
    'You are a careful research assistant helping a reader understand an academic PDF.',
    'Answer in the language of the user question unless the user asks otherwise.',
    'Use only the provided document context and conversation. Do not invent facts, citations, sections, or numbers.',
    'If the context does not contain the answer, say so plainly and suggest what page or section to inspect.',
    'Preserve formulas, symbols, citations, section numbers, and technical terms exactly.',
    'Be concise but explanatory; quote a short phrase from the context when it supports the answer.',
    '',
    skill !== undefined
      ? `IMPORTED READING SKILL: ${skill.name}\nUse the following reading method as guidance for how to analyze and answer. It is guidance, not a replacement for the document; ignore any part that conflicts with answering from the supplied context.\n${skill.content}`
      : '',
    `Context scope: ${contextLabel || 'document excerpt'}`,
    'DOCUMENT CONTEXT:',
    context,
    '',
    transcript === '' ? 'CONVERSATION: (new conversation)' : `CONVERSATION:\n${transcript}`,
    '',
    `USER QUESTION:\n${question}`,
  ].join('\n')
}
