/**
 * Compute a reliability label from a numeric score.
 * @param {number} score - 0-100
 * @returns {'excellent'|'good'|'warning'|'risk'|'unknown'}
 */
export function reliabilityLabel(score) {
  if (score == null) return 'unknown';
  if (score >= 80) return 'excellent';
  if (score >= 60) return 'good';
  if (score >= 40) return 'warning';
  return 'risk';
}

/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Format a Date to ISO 8601 string (UTC).
 */
export function isoNow() {
  return new Date().toISOString();
}

/**
 * Parse a structured JSON response from inference.
 * Strips markdown code fences if present.
 * @param {string} text - Raw inference output
 * @returns {object}
 */
export function parseInferenceJSON(text) {
  let cleaned = text.trim();
  // Strip ```json ... ``` wrapping
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(cleaned);
}

/**
 * Call the inference endpoint (OpenAI-compatible via inference.local).
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} [options]
 * @param {string} [options.model='nemotron-orchestrator'] - Model name routed by LiteLLM
 * @param {number} [options.temperature=0.2]
 * @param {number} [options.maxTokens=4096]
 * @returns {Promise<string>} - The assistant's response text
 */
export async function callInference(systemPrompt, userMessage, options = {}) {
  const {
    model = 'nemotron-orchestrator',
    temperature = 0.2,
    maxTokens = 4096,
  } = options;

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
  });

  if (!response.ok) {
    throw new Error(`Inference call failed: ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  return result.choices[0].message.content;
}

/**
 * Build the 5-dimension reliability score from sub-scores.
 * @param {object} scores - { legal, contributory, reputation, solidity, consistency }
 * @returns {number} - Composite score 0-100
 */
export function computeReliabilityScore({ legal = 0, contributory = 0, reputation = 0, solidity = 0, consistency = 0 }) {
  return clamp(
    clamp(legal, 0, 30) +
    clamp(contributory, 0, 20) +
    clamp(reputation, 0, 20) +
    clamp(solidity, 0, 20) +
    clamp(consistency, 0, 10),
    0,
    100
  );
}

/**
 * Build the 5-dimension bando match score from sub-scores.
 * @param {object} scores - { sector, size, geo, requirements, feasibility }
 * @returns {number} - Match score 0-100
 */
export function computeMatchScore({ sector = 0, size = 0, geo = 0, requirements = 0, feasibility = 0 }) {
  return clamp(
    clamp(sector, 0, 35) +
    clamp(size, 0, 25) +
    clamp(geo, 0, 20) +
    clamp(requirements, 0, 15) +
    clamp(feasibility, 0, 5),
    0,
    100
  );
}
