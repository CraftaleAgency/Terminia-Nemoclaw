type ReliabilityLabel = 'excellent' | 'good' | 'warning' | 'risk' | 'unknown'

export function reliabilityLabel(score: number | null | undefined): ReliabilityLabel {
  if (score == null) return 'unknown'
  if (score >= 80) return 'excellent'
  if (score >= 60) return 'good'
  if (score >= 40) return 'warning'
  return 'risk'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function isoNow(): string {
  return new Date().toISOString()
}

export function parseInferenceJSON(text: string): unknown {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }
  return JSON.parse(cleaned)
}

interface InferenceOptions {
  model?: string
  temperature?: number
  maxTokens?: number
}

interface InferenceResponse {
  choices: Array<{ message: { content: string } }>
}

export async function callInference(
  systemPrompt: string,
  userMessage: string,
  options: InferenceOptions = {},
): Promise<string> {
  const {
    model = 'nemotron-orchestrator',
    temperature = 0.2,
    maxTokens = 4096,
  } = options

  const response = await fetch('https://inference.local/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    throw new Error(`Inference call failed: ${response.status} ${response.statusText}`)
  }

  const result: InferenceResponse = await response.json()
  return result.choices[0].message.content
}

interface ReliabilityScores {
  legal?: number
  contributory?: number
  reputation?: number
  solidity?: number
  consistency?: number
}

export function computeReliabilityScore({
  legal = 0,
  contributory = 0,
  reputation = 0,
  solidity = 0,
  consistency = 0,
}: ReliabilityScores): number {
  return clamp(
    clamp(legal, 0, 30) +
    clamp(contributory, 0, 20) +
    clamp(reputation, 0, 20) +
    clamp(solidity, 0, 20) +
    clamp(consistency, 0, 10),
    0,
    100,
  )
}

interface MatchScores {
  sector?: number
  size?: number
  geo?: number
  requirements?: number
  feasibility?: number
}

export function computeMatchScore({
  sector = 0,
  size = 0,
  geo = 0,
  requirements = 0,
  feasibility = 0,
}: MatchScores): number {
  return clamp(
    clamp(sector, 0, 35) +
    clamp(size, 0, 25) +
    clamp(geo, 0, 20) +
    clamp(requirements, 0, 15) +
    clamp(feasibility, 0, 5),
    0,
    100,
  )
}
