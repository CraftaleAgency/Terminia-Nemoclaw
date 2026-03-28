#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { getCached, setCache } from '../../_shared/cache.ts'
import { isoNow } from '../../_shared/utils.ts'

const VIES_API = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';
const CACHE_TTL_MINUTES = 43200; // 30 days
const API_TIMEOUT_MS = 5000;

const EU_COUNTRY_CODES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES',
  'FI', 'FR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]);

interface ParsedVat {
  countryCode: string
  vatNumber: string
}

interface ViesResult {
  isValid?: boolean
  countryCode?: string
  vatNumber?: string
  name?: string
  address?: string
  requestDate?: string
  userError?: string
}

interface HandlerInput {
  vat_number: string
  country_code?: string
  counterpart_id?: string
}

interface HandlerResult {
  valid: boolean | null
  country_code: string
  vat_number: string
  name: string | null
  address: string | null
  request_date: string
  cached: boolean
  error: string | null
}

interface VerificationJson {
  vies?: ViesResult & { checked_at?: string }
  [key: string]: unknown
}

/**
 * Parse a VAT string into { countryCode, vatNumber }.
 * Strips whitespace, detects 2-letter alpha prefix.
 */
function parseVat(raw: string, explicitCountry?: string): ParsedVat {
  const cleaned = raw.replace(/\s+/g, '').toUpperCase();
  let countryCode: string | null = explicitCountry?.toUpperCase() || null;
  let vatNumber = cleaned;

  const prefixMatch = cleaned.match(/^([A-Z]{2})(\d.*)$/);
  if (prefixMatch) {
    const detectedCC = prefixMatch[1];
    if (!countryCode) countryCode = detectedCC;
    vatNumber = prefixMatch[2];
  }

  if (!countryCode) {
    throw new Error('Cannot determine country code — provide country_code or use a prefixed VAT number');
  }

  return { countryCode, vatNumber };
}

/**
 * Call the VIES REST API with a 5-second timeout.
 */
async function callVies(countryCode: string, vatNumber: string): Promise<ViesResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const res = await fetch(VIES_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ countryCode, vatNumber }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`VIES HTTP ${res.status}`);
    }

    return await res.json() as ViesResult;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Update the counterparts row with VIES verification results.
 */
async function updateCounterpart(counterpartId: string, viesResult: ViesResult): Promise<void> {
  const { data: existing, error: readErr } = await supabase
    .from('counterparts')
    .select('verification_json')
    .eq('id', counterpartId)
    .single();

  if (readErr) {
    throw new Error(`Failed to read counterpart ${counterpartId}: ${readErr.message}`);
  }

  // Fixed score based on result — avoids read-modify-write race on score_legal
  const newScoreLegal = viesResult.isValid ? 10 : 0;

  const verificationJson: VerificationJson = (existing?.verification_json as VerificationJson) ?? {};
  verificationJson.vies = {
    ...viesResult,
    checked_at: isoNow(),
  };

  const { error: updateErr } = await supabase
    .from('counterparts')
    .update({
      vat_verified: viesResult.isValid,
      score_legal: newScoreLegal,
      verification_json: verificationJson,
      reliability_updated_at: isoNow(),
    })
    .eq('id', counterpartId);

  if (updateErr) {
    throw new Error(`Failed to update counterpart ${counterpartId}: ${updateErr.message}`);
  }
}

/**
 * Validate an EU VAT number via VIES.
 */
async function handler(input: HandlerInput): Promise<HandlerResult> {
  const { vat_number, country_code, counterpart_id } = input;

  if (!vat_number) throw new Error('Missing required field: vat_number');

  const { countryCode, vatNumber } = parseVat(vat_number, country_code);

  if (!EU_COUNTRY_CODES.has(countryCode)) {
    return {
      valid: null,
      country_code: countryCode,
      vat_number: vatNumber,
      name: null,
      address: null,
      request_date: isoNow(),
      cached: false,
      error: `Unsupported country code: ${countryCode}`,
    };
  }

  // --- Check cache ---
  if (counterpart_id) {
    const cached = await getCached(
      'counterparts',
      'id',
      counterpart_id,
      'reliability_updated_at',
      CACHE_TTL_MINUTES,
    );

    if ((cached as Record<string, unknown> & { verification_json?: VerificationJson })?.verification_json?.vies) {
      const vies = (cached as Record<string, unknown> & { verification_json: VerificationJson }).verification_json.vies!;
      return {
        valid: vies.isValid ?? null,
        country_code: vies.countryCode ?? countryCode,
        vat_number: vies.vatNumber ?? vatNumber,
        name: vies.name ?? null,
        address: vies.address ?? null,
        request_date: vies.requestDate ?? vies.checked_at ?? isoNow(),
        cached: true,
        error: null,
      };
    }
  }

  // --- Call VIES API ---
  let viesResult: ViesResult;
  try {
    viesResult = await callVies(countryCode, vatNumber);
  } catch (err: unknown) {
    const errorMsg = (err as Error).name === 'AbortError'
      ? 'VIES API timeout'
      : 'VIES API unavailable';

    return {
      valid: null,
      country_code: countryCode,
      vat_number: vatNumber,
      name: null,
      address: null,
      request_date: isoNow(),
      cached: false,
      error: errorMsg,
    };
  }

  // --- Persist to counterpart if ID provided ---
  if (counterpart_id) {
    try {
      await updateCounterpart(counterpart_id, viesResult);
    } catch {
      // Non-fatal: return result even if DB write fails
    }
  }

  return {
    valid: viesResult.isValid ?? null,
    country_code: viesResult.countryCode ?? countryCode,
    vat_number: viesResult.vatNumber ?? vatNumber,
    name: viesResult.name ?? null,
    address: viesResult.address ?? null,
    request_date: viesResult.requestDate ?? isoNow(),
    cached: false,
    error: viesResult.isValid === false ? (viesResult.userError ?? null) : null,
  };
}

// CLI entry point
async function main(): Promise<void> {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input: HandlerInput = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err: unknown) {
    console.log(JSON.stringify({ error: (err as Error).message }));
    process.exit(1);
  }
}

main();
