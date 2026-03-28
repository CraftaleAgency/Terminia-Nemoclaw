import type { ChatMessage } from '../types.ts'

const LITELLM_URL: string = process.env.LITELLM_URL || 'http://litellm-proxy:4000'
const LITELLM_API_KEY: string = process.env.LITELLM_API_KEY || ''

const DEFAULT_MODEL = 'nemotron-orchestrator'

interface ChatCompletionOptions {
  model?: string
  messages: (ChatMessage | { role: string; content: unknown })[]
  temperature?: number
  max_tokens?: number
  response_format?: { type: string }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (LITELLM_API_KEY) {
    headers['Authorization'] = `Bearer ${LITELLM_API_KEY}`
  }
  return headers
}

/**
 * Non-streaming chat completion via LiteLLM proxy.
 */
export async function chatCompletion({
  model = DEFAULT_MODEL,
  messages,
  temperature = 0.2,
  max_tokens = 4096,
  response_format,
}: ChatCompletionOptions): Promise<string> {
  const body: Record<string, unknown> = { model, messages, temperature, max_tokens }
  if (response_format) body.response_format = response_format

  const res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 200)}`)
  }

  const data = await res.json() as { choices: { message: { content: string } }[] }
  return data.choices[0].message.content
}

/**
 * Streaming chat completion — yields SSE chunks as strings.
 */
export async function* chatCompletionStream({
  model = DEFAULT_MODEL,
  messages,
  temperature = 0.4,
  max_tokens = 4096,
}: ChatCompletionOptions): AsyncGenerator<string> {
  const res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ model, messages, temperature, max_tokens, stream: true }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 200)}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const payload = trimmed.slice(6)
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) yield delta
      } catch {
        // skip malformed SSE chunks
      }
    }
  }
}

/**
 * Parse structured JSON from inference output.
 * Strips markdown code fences if present.
 */
export function parseInferenceJSON(text: string): unknown {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }
  return JSON.parse(cleaned)
}
