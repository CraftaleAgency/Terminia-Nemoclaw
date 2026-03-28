import { Router } from 'express'
import supabase from '../lib/supabase.js'

const router = Router()

const VIES_API = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number'
const ANAC_SEARCH_URL = 'https://casellario.anticorruzione.it/CasellarioSearch/Search'
const ANAC_BASE_URL = 'https://casellario.anticorruzione.it'
const API_TIMEOUT_MS = 5000

// ── Italian Fiscal Code (Codice Fiscale) Algorithm ──────────────────────────

const MONTH_CODES = {
  A: 1, B: 2, C: 3, D: 4, E: 5, H: 6,
  L: 7, M: 8, P: 9, R: 10, S: 11, T: 12,
}

const EVEN_MAP = {}
for (let i = 0; i < 10; i++) EVEN_MAP[String(i)] = i
for (let i = 0; i < 26; i++) EVEN_MAP[String.fromCharCode(65 + i)] = i

const ODD_MAP = {
  '0': 1,  '1': 0,  '2': 5,  '3': 7,  '4': 9,
  '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
  A: 1,  B: 0,  C: 5,  D: 7,  E: 9,
  F: 13, G: 15, H: 17, I: 19, J: 21,
  K: 2,  L: 4,  M: 18, N: 20, O: 11,
  P: 3,  Q: 6,  R: 8,  S: 12, T: 14,
  U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
}

const CHECK_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function computeCheckChar(first15) {
  let sum = 0
  for (let i = 0; i < 15; i++) {
    const ch = first15[i]
    sum += (i + 1) % 2 === 1 ? ODD_MAP[ch] : EVEN_MAP[ch]
  }
  return CHECK_LETTERS[sum % 26]
}

function validateFiscalCode(cf) {
  const code = cf.toUpperCase().trim()
  const errors = []

  if (code.length !== 16) {
    errors.push(`Lunghezza non valida: attesi 16 caratteri, trovati ${code.length}`)
  }
  if (!/^[A-Z0-9]{16}$/.test(code)) {
    errors.push('Caratteri non validi: solo A-Z e 0-9 ammessi')
  }
  if (errors.length) {
    return { valid: false, checksum_ok: false, extracted: null, errors }
  }

  const first15 = code.slice(0, 15)
  const expectedCheck = computeCheckChar(first15)
  const actualCheck = code[15]
  const checksumOk = expectedCheck === actualCheck

  if (!checksumOk) {
    errors.push(`Checksum errato: atteso ${expectedCheck}, trovato ${actualCheck}`)
  }

  const birthMonthLetter = code[8]
  const birthMonth = MONTH_CODES[birthMonthLetter]
  if (!birthMonth) errors.push(`Codice mese non valido: ${birthMonthLetter}`)

  const birthDayRaw = parseInt(code.slice(9, 11), 10)
  const gender = birthDayRaw > 40 ? 'F' : 'M'
  const birthDay = birthDayRaw > 40 ? birthDayRaw - 40 : birthDayRaw
  if (birthDay < 1 || birthDay > 31) errors.push(`Giorno di nascita non valido: ${birthDay}`)

  const extracted = {
    surname_code: code.slice(0, 3),
    name_code: code.slice(3, 6),
    birth_year: code.slice(6, 8),
    birth_month: birthMonth || null,
    birth_day: birthDay,
    gender,
    municipality_code: code.slice(11, 15),
  }

  return {
    valid: checksumOk && errors.length === 0,
    checksum_ok: checksumOk,
    extracted,
    errors,
  }
}

// ── VIES VAT Check ──────────────────────────────────────────────────────────

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
])

function parseVat(raw) {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase()
  const match = cleaned.match(/^([A-Z]{2})(\d.*)$/)
  if (match) return { countryCode: match[1], vatNumber: match[2] }
  // Default to Italy
  return { countryCode: 'IT', vatNumber: cleaned }
}

async function checkVies(vatRaw) {
  const { countryCode, vatNumber } = parseVat(vatRaw)

  if (!EU_COUNTRY_CODES.has(countryCode)) {
    return { valid: null, country_code: countryCode, vat_number: vatNumber, error: `Codice paese non supportato: ${countryCode}` }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  try {
    const res = await fetch(VIES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`VIES HTTP ${res.status}`)
    const data = await res.json()
    return {
      valid: data.isValid ?? null,
      country_code: data.countryCode ?? countryCode,
      vat_number: data.vatNumber ?? vatNumber,
      name: data.name ?? null,
      address: data.address ?? null,
      request_date: data.requestDate ?? new Date().toISOString(),
      error: null,
    }
  } catch (err) {
    return {
      valid: null,
      country_code: countryCode,
      vat_number: vatNumber,
      error: err.name === 'AbortError' ? 'VIES timeout' : 'VIES non disponibile',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ── ANAC Casellario ─────────────────────────────────────────────────────────

function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
}

function classifyAnnotation(text) {
  const lower = text.toLowerCase()
  if (/esclusione|esclus[ao]|interdizione|interdi[ct]/.test(lower)) return 'esclusione'
  if (/falsa dichiarazione|falsa\s+dichiaraz/.test(lower)) return 'falsa_dichiarazione'
  if (/annotazione|iscrizione|segnalazione/.test(lower)) return 'annotazione'
  return 'altro'
}

function extractDate(text) {
  const dmy = text.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return iso[0]
  return null
}

function parseAnnotations(html) {
  const noResultPatterns = [
    /nessun\s+risultato/i, /0\s+risultat/i, /nessuna\s+annotazione/i,
    /nessun\s+dato/i, /non\s+sono\s+presenti/i, /nessuna\s+corrispondenza/i,
  ]
  for (const pat of noResultPatterns) {
    if (pat.test(html)) return { ok: true, annotations: [] }
  }

  const annotations = []
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let rowMatch
  let dataRowCount = 0

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1]
    if (/<th[\s>]/i.test(rowHtml)) continue
    const cells = []
    let cellMatch
    cellRe.lastIndex = 0
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(decodeEntities(stripTags(cellMatch[1])))
    }
    if (cells.length < 2) continue
    dataRowCount++
    const fullText = cells.join(' | ')
    const sorted = [...cells].sort((a, b) => b.length - a.length)
    annotations.push({
      type: classifyAnnotation(fullText),
      date: extractDate(fullText),
      description: sorted[0] || '',
      reference: cells.find(c => c !== sorted[0] && c.length > 0 && !extractDate(c)) || '',
    })
  }

  if (dataRowCount > 0) return { ok: true, annotations }

  const hasForm = /<form[\s>]/i.test(html)
  const hasResultSection = /risultat|casellario|annotazion|esclusione/i.test(html)
  if (hasForm && !hasResultSection) return { ok: true, annotations: [] }

  return { ok: !hasResultSection, annotations: [], error: hasResultSection ? 'page_structure_changed' : undefined }
}

async function checkAnac(vatNumber, companyName) {
  const vatClean = (vatNumber || '').replace(/\s+/g, '').replace(/^IT/i, '')
  const params = new URLSearchParams()
  if (vatClean) params.set('partitaIva', vatClean)
  if (companyName) params.set('ragioneSociale', companyName)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const res = await fetch(`${ANAC_SEARCH_URL}?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Terminia/1.0)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5',
        Referer: ANAC_BASE_URL,
      },
      signal: controller.signal,
    })
    if (!res.ok) return { checked: false, annotations_found: false, annotations: [], error: 'anac_unavailable' }

    const html = await res.text()
    const parsed = parseAnnotations(html)
    if (!parsed.ok) return { checked: false, annotations_found: false, annotations: [], error: parsed.error || 'page_structure_changed' }

    return {
      checked: true,
      annotations_found: parsed.annotations.length > 0,
      annotations: parsed.annotations,
      error: null,
    }
  } catch (err) {
    return {
      checked: false,
      annotations_found: false,
      annotations: [],
      error: err.name === 'AbortError' ? 'anac_timeout' : 'anac_unavailable',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// ── Reliability Score ───────────────────────────────────────────────────────

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v))
}

function computeReliabilityScore(vies, cf, anac) {
  const dimensions = {
    legal: 0,
    contributory: 0,
    reputation: 0,
    solidity: 0,
    consistency: 0,
  }

  // Legal (0-30): VAT valid + fiscal code valid
  if (vies?.valid === true) dimensions.legal += 15
  if (cf?.valid === true) dimensions.legal += 15
  dimensions.legal = clamp(dimensions.legal, 0, 30)

  // Contributory (0-20): VAT registration is active
  if (vies?.valid === true) dimensions.contributory += 15
  if (vies?.name) dimensions.contributory += 5
  dimensions.contributory = clamp(dimensions.contributory, 0, 20)

  // Reputation (0-20): No ANAC annotations
  if (anac?.checked) {
    dimensions.reputation = anac.annotations_found ? 0 : 20
  } else {
    dimensions.reputation = 10 // unknown = middle ground
  }

  // Solidity (0-20): address present, name matches
  if (vies?.address) dimensions.solidity += 10
  if (vies?.name) dimensions.solidity += 10
  dimensions.solidity = clamp(dimensions.solidity, 0, 20)

  // Consistency (0-10): no errors across checks
  let consistencyErrors = 0
  if (vies?.error) consistencyErrors++
  if (cf?.errors?.length) consistencyErrors++
  if (anac?.error) consistencyErrors++
  dimensions.consistency = clamp(10 - consistencyErrors * 4, 0, 10)

  const total = dimensions.legal + dimensions.contributory +
    dimensions.reputation + dimensions.solidity + dimensions.consistency

  return { score: clamp(total, 0, 100), dimensions }
}

// ── Route handler ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { vat_number, fiscal_code, company_name, counterpart_id } = req.body

  if (!vat_number && !fiscal_code && !company_name) {
    return res.status(400).json({
      error: 'Almeno uno tra vat_number, fiscal_code o company_name è richiesto',
    })
  }

  // Run checks in parallel
  const promises = []

  // VIES
  if (vat_number) {
    promises.push(checkVies(vat_number).then(r => ({ key: 'vies', result: r })))
  } else {
    promises.push(Promise.resolve({ key: 'vies', result: null }))
  }

  // Fiscal Code
  if (fiscal_code) {
    promises.push(Promise.resolve({ key: 'fiscal_code', result: validateFiscalCode(fiscal_code) }))
  } else {
    promises.push(Promise.resolve({ key: 'fiscal_code', result: null }))
  }

  // ANAC
  if (vat_number || company_name) {
    promises.push(checkAnac(vat_number, company_name).then(r => ({ key: 'anac', result: r })))
  } else {
    promises.push(Promise.resolve({ key: 'anac', result: null }))
  }

  const results = await Promise.all(promises)
  const vies = results.find(r => r.key === 'vies')?.result
  const cf = results.find(r => r.key === 'fiscal_code')?.result
  const anac = results.find(r => r.key === 'anac')?.result

  const { score, dimensions } = computeReliabilityScore(vies, cf, anac)

  // Persist to counterparts table
  if (counterpart_id) {
    try {
      const { data: existing } = await supabase
        .from('counterparts')
        .select('verification_json')
        .eq('id', counterpart_id)
        .single()

      const verificationJson = existing?.verification_json ?? {}
      if (vies) verificationJson.vies = { ...vies, checked_at: new Date().toISOString() }
      if (cf) verificationJson.fiscal_code = { ...cf, checked_at: new Date().toISOString() }
      if (anac) verificationJson.anac = { ...anac, checked_at: new Date().toISOString() }

      await supabase.from('counterparts').update({
        vat_verified: vies?.valid ?? null,
        fiscal_code_valid: cf?.valid ?? null,
        has_anac_annotations: anac?.annotations_found ?? null,
        reliability_score: score,
        score_legal: dimensions.legal,
        score_contributory: dimensions.contributory,
        score_reputation: dimensions.reputation,
        score_solidity: dimensions.solidity,
        score_consistency: dimensions.consistency,
        verification_json: verificationJson,
        reliability_updated_at: new Date().toISOString(),
      }).eq('id', counterpart_id)
    } catch {
      // Non-fatal: return result even if DB write fails
    }
  }

  res.json({
    vies,
    fiscal_code: cf,
    anac,
    reliability: { score, dimensions },
  })
})

export default router
