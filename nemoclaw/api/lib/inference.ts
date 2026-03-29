import type { ChatMessage } from '../types.ts'

const LITELLM_URL: string = process.env.LITELLM_URL || 'http://litellm-proxy:4000'
const LITELLM_API_KEY: string = process.env.LITELLM_API_KEY || ''

const DEFAULT_MODEL = 'nemotron-orchestrator'

const LITELLM_TIMEOUT_MS = Number(process.env.LITELLM_TIMEOUT_MS) || 180_000
const LITELLM_OCR_TIMEOUT_MS = Number(process.env.LITELLM_OCR_TIMEOUT_MS) || 300_000

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

  const controller = new AbortController()
  const timeoutMs = model?.includes('numarkdown') || model?.includes('ocr')
    ? LITELLM_OCR_TIMEOUT_MS
    : LITELLM_TIMEOUT_MS
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 200)}`)
    }

    const data = await res.json() as { choices: { message: { content: string } }[] }
    return data.choices[0].message.content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LiteLLM request timed out after ${timeoutMs}ms (model: ${model})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
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
  const controller = new AbortController()
  const timeoutMs = model?.includes('numarkdown') || model?.includes('ocr')
    ? LITELLM_OCR_TIMEOUT_MS
    : LITELLM_TIMEOUT_MS // regular timeout for non-OCR models
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: globalThis.Response
  try {
    res = await fetch(`${LITELLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ model, messages, temperature, max_tokens, stream: true }),
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LiteLLM request timed out after ${timeoutMs}ms (model: ${model})`)
    }
    throw err
  }

  if (!res.ok) {
    clearTimeout(timer)
    const text = await res.text().catch(() => '')
    throw new Error(`LiteLLM ${res.status}: ${text.slice(0, 200)}`)
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
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
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LiteLLM stream timed out after ${timeoutMs}ms (model: ${model})`)
    }
    throw err
  } finally {
    clearTimeout(timer)
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
