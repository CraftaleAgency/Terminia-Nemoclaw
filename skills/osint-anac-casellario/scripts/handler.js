#!/usr/bin/env node
import { supabase } from '../../_shared/supabase-client.js';
import { getCached } from '../../_shared/cache.js';
import { isoNow } from '../../_shared/utils.js';

const SEARCH_URL = 'https://casellario.anticorruzione.it/CasellarioSearch/Search';
const BASE_URL = 'https://casellario.anticorruzione.it';
const CACHE_TTL_MINUTES = 10080; // 7 days
const REQUEST_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; Terminia/1.0)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeErrorResult(errorCode) {
  return {
    checked: false,
    annotations_found: false,
    annotations: [],
    source_url: SEARCH_URL,
    checked_at: isoNow(),
    error: errorCode,
  };
}

function makeSuccessResult(annotations, sourceUrl) {
  return {
    checked: true,
    annotations_found: annotations.length > 0,
    annotations,
    source_url: sourceUrl,
    checked_at: isoNow(),
    error: null,
  };
}

/**
 * Fetch with an AbortController timeout.
 */
async function timedFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// HTML parsing — regex-based (no external deps)
// ---------------------------------------------------------------------------

/** Strip HTML tags for plain-text extraction. */
function stripTags(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Decode common HTML entities. */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Classify an annotation string into a known type.
 */
function classifyAnnotation(text) {
  const lower = text.toLowerCase();
  if (/esclusione|esclus[ao]|interdizione|interdi[ct]/.test(lower)) return 'esclusione';
  if (/falsa dichiarazione|falsa\s+dichiaraz/.test(lower)) return 'falsa_dichiarazione';
  if (/annotazione|iscrizione|segnalazione/.test(lower)) return 'annotazione';
  return 'altro';
}

/**
 * Try to extract a date in DD/MM/YYYY or YYYY-MM-DD format from a string.
 * Returns ISO YYYY-MM-DD or null.
 */
function extractDate(text) {
  const dmy = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];

  return null;
}

/**
 * Parse the search results HTML into structured annotations.
 *
 * Strategy:
 *  1. Detect "no results" indicators → empty annotations.
 *  2. Locate table rows (<tr>) that contain annotation data.
 *  3. For each row, extract cells (<td>) and map them to fields.
 *  4. If neither pattern is found, signal page_structure_changed.
 *
 * Returns { ok: boolean, annotations: object[], error?: string }
 */
function parseAnnotations(html) {
  const noResultPatterns = [
    /nessun\s+risultato/i,
    /0\s+risultat/i,
    /nessuna\s+annotazione/i,
    /nessun\s+dato/i,
    /non\s+sono\s+presenti/i,
    /nessuna\s+corrispondenza/i,
  ];

  for (const pat of noResultPatterns) {
    if (pat.test(html)) {
      return { ok: true, annotations: [] };
    }
  }

  // Look for a results table — try multiple patterns
  const annotations = [];

  // Pattern A: standard HTML table rows
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let rowMatch;
  let dataRowCount = 0;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    // Skip header rows
    if (/<th[\s>]/i.test(rowHtml)) continue;

    const cells = [];
    let cellMatch;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
      cells.push(decodeEntities(stripTags(cellMatch[1])));
    }

    if (cells.length < 2) continue;
    dataRowCount++;

    // Heuristic mapping: try to identify annotation fields from cell content
    const fullText = cells.join(' | ');
    const type = classifyAnnotation(fullText);
    const date = extractDate(fullText);

    // Use the longest cell as description, shortest non-date as reference
    const sorted = [...cells].sort((a, b) => b.length - a.length);
    const description = sorted[0] || '';
    const reference = cells.find(
      (c) => c !== description && c.length > 0 && !extractDate(c),
    ) || '';

    annotations.push({ type, date, description, reference });
  }

  if (dataRowCount > 0) {
    return { ok: true, annotations };
  }

  // Pattern B: <div> or <li> based results
  const itemRe = /<(?:li|div)[^>]*class="[^"]*(?:result|annotation|record)[^"]*"[^>]*>([\s\S]*?)<\/(?:li|div)>/gi;
  let itemMatch;
  while ((itemMatch = itemRe.exec(html)) !== null) {
    const text = decodeEntities(stripTags(itemMatch[1]));
    if (text.length < 5) continue;

    annotations.push({
      type: classifyAnnotation(text),
      date: extractDate(text),
      description: text,
      reference: '',
    });
  }

  if (annotations.length > 0) {
    return { ok: true, annotations };
  }

  // If the page returned HTML but we could not identify any known structure,
  // only flag as "changed" if the page seems to be a search results page.
  // A page with a <form> and no results section is likely just the empty form.
  const hasForm = /<form[\s>]/i.test(html);
  const hasResultSection = /risultat|casellario|annotazion|esclusione/i.test(html);
  if (hasForm && !hasResultSection) {
    // The form loaded but apparently returned no results content — treat as clean
    return { ok: true, annotations: [] };
  }

  if (hasResultSection) {
    return { ok: false, annotations: [], error: 'page_structure_changed' };
  }

  // Completely unrecognisable page
  return { ok: false, annotations: [], error: 'page_structure_changed' };
}

// ---------------------------------------------------------------------------
// Supabase counterpart update
// ---------------------------------------------------------------------------

async function updateCounterpart(counterpartId, result) {
  const { data: existing, error: readErr } = await supabase
    .from('counterparts')
    .select('verification_json')
    .eq('id', counterpartId)
    .single();

  if (readErr) {
    throw new Error(`Failed to read counterpart ${counterpartId}: ${readErr.message}`);
  }

  const verificationJson = existing?.verification_json ?? {};
  verificationJson.anac = { ...result };

  const updates = {
    has_anac_annotations: result.annotations_found,
    verification_json: verificationJson,
    reliability_updated_at: isoNow(),
  };

  // Fixed score based on result — avoids read-modify-write race on score_reputation
  if (result.checked) {
    updates.score_reputation = result.annotations_found ? 0 : 10;
  }

  const { error: updateErr } = await supabase
    .from('counterparts')
    .update(updates)
    .eq('id', counterpartId);

  if (updateErr) {
    throw new Error(`Failed to update counterpart ${counterpartId}: ${updateErr.message}`);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Check ANAC Casellario Informatico for supplier annotations.
 *
 * @param {{ vat_number: string, company_name: string, counterpart_id?: string }} input
 * @returns {Promise<object>}
 */
async function handler(input) {
  const { vat_number, company_name, counterpart_id } = input;

  if (!vat_number && !company_name) {
    throw new Error('At least one of vat_number or company_name is required');
  }

  // --- Cache check (via counterpart verification_json.anac) ---
  if (counterpart_id) {
    const cached = await getCached(
      'counterparts',
      'id',
      counterpart_id,
      'reliability_updated_at',
      CACHE_TTL_MINUTES,
    );

    if (cached?.verification_json?.anac) {
      return { ...cached.verification_json.anac, cached: true };
    }
  }

  // --- Build search URL ---
  const vatClean = (vat_number || '').replace(/\s+/g, '').replace(/^IT/i, '');
  const searchParams = new URLSearchParams();
  if (vatClean) searchParams.set('partitaIva', vatClean);
  if (company_name) searchParams.set('ragioneSociale', company_name);

  const sourceUrl = `${SEARCH_URL}?${searchParams.toString()}`;

  // --- Fetch search results ---
  let html;
  try {
    const res = await timedFetch(sourceUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'it-IT,it;q=0.9,en;q=0.5',
        Referer: BASE_URL,
      },
    });

    if (!res.ok) {
      const result = makeErrorResult('anac_unavailable');
      await safeUpdateCounterpart(counterpart_id, result);
      return result;
    }

    html = await res.text();
  } catch (err) {
    const errorCode = err.name === 'AbortError' ? 'anac_timeout' : 'anac_unavailable';
    const result = makeErrorResult(errorCode);
    await safeUpdateCounterpart(counterpart_id, result);
    return result;
  }

  // --- Parse HTML ---
  const parsed = parseAnnotations(html);

  if (!parsed.ok) {
    const result = makeErrorResult(parsed.error || 'page_structure_changed');
    await safeUpdateCounterpart(counterpart_id, result);
    return result;
  }

  const result = makeSuccessResult(parsed.annotations, sourceUrl);

  // --- Persist ---
  await safeUpdateCounterpart(counterpart_id, result);

  return result;
}

/**
 * Non-fatal wrapper around updateCounterpart.
 */
async function safeUpdateCounterpart(counterpartId, result) {
  if (!counterpartId) return;
  try {
    await updateCounterpart(counterpartId, result);
  } catch {
    // Non-fatal: ANAC result is still returned even if DB write fails
  }
}

// CLI entry point
async function main() {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
    }
    const input = JSON.parse(raw);
    const result = await handler(input);
    console.log(JSON.stringify(result));
    process.exit(0);
  } catch (err) {
    console.log(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

main();
