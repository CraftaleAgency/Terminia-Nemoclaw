#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { isoNow } from '../../_shared/utils.ts'

const ANAC_CKAN_API = 'https://dati.anticorruzione.it/api/3/action/package_search';
const ANAC_PACKAGE_SHOW = 'https://dati.anticorruzione.it/api/3/action/package_show';
const ANAC_DATASET_ID = 'bandi-gara';
const API_TIMEOUT_MS = 15000;
const INSERT_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  company_id?: string
}

interface CkanResource {
  format?: string
  url?: string
  [key: string]: unknown
}

interface CkanPackage {
  resources?: CkanResource[]
  [key: string]: unknown
}

interface CkanResponse {
  success: boolean
  result?: CkanPackage & {
    results?: CkanPackage[]
  }
}

interface ResolvedResource {
  url: string
  format: string
}

interface RawRecord {
  [key: string]: unknown
}

interface BandoRow {
  cig: string
  title: string
  description: string
  contracting_authority: string
  base_value: number | null
  cpv_codes: string[]
  procedure_type: string | null
  publication_date: string | null
  deadline: string | null
  nuts_code: string | null
  source: string
  source_url: string
  source_id: string
  raw_data: RawRecord
  is_active: boolean
}

interface HandlerResult {
  synced: number
  skipped_duplicates: number
  errors: number
  source: string
  error?: string
  detail?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs: number = API_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Discover the latest downloadable resource URL for the bandi-gara dataset.
 * Prefers JSON, falls back to CSV.
 */
async function resolveDatasetUrl(): Promise<ResolvedResource | null> {
  // Try package_show first (stable dataset id)
  try {
    const res = await fetchWithTimeout(
      `${ANAC_PACKAGE_SHOW}?id=${ANAC_DATASET_ID}`,
    );
    const body: CkanResponse = await res.json() as CkanResponse;
    if (body.success && body.result?.resources?.length) {
      return pickBestResource(body.result.resources);
    }
  } catch { /* fall through to search */ }

  // Fallback: search for the dataset
  const res = await fetchWithTimeout(
    `${ANAC_CKAN_API}?q=bandi+gara&rows=5`,
  );
  const body: CkanResponse = await res.json() as CkanResponse;
  if (!body.success || !body.result?.results?.length) {
    throw new Error('anac_no_dataset');
  }

  for (const pkg of body.result.results) {
    if (pkg.resources?.length) {
      const url = pickBestResource(pkg.resources);
      if (url) return url;
    }
  }

  throw new Error('anac_no_resource');
}

function pickBestResource(resources: CkanResource[]): ResolvedResource | null {
  const json = resources.find(
    (r) => r.format?.toUpperCase() === 'JSON' || r.url?.endsWith('.json'),
  );
  if (json) return { url: json.url!, format: 'json' };

  const csv = resources.find(
    (r) => r.format?.toUpperCase() === 'CSV' || r.url?.endsWith('.csv'),
  );
  if (csv) return { url: csv.url!, format: 'csv' };

  // Accept whatever is available
  if (resources[0]?.url) {
    const fmt = resources[0].format?.toLowerCase() || 'unknown';
    return { url: resources[0].url, format: fmt };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

interface JsonDataset {
  results?: RawRecord[]
  result?: RawRecord[]
  data?: RawRecord[]
  records?: RawRecord[]
  [key: string]: unknown
}

function parseJsonRecords(raw: RawRecord[] | JsonDataset): RawRecord[] {
  if (Array.isArray(raw)) return raw;
  if (raw.results && Array.isArray(raw.results)) return raw.results;
  if (raw.result && Array.isArray(raw.result)) return raw.result;
  if (raw.data && Array.isArray(raw.data)) return raw.data;
  if (raw.records && Array.isArray(raw.records)) return raw.records;
  throw new Error('anac_unknown_json_structure');
}

function parseCsvRecords(text: string): RawRecord[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"|"$/g, ''));

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, sep);
    const record: RawRecord = {};
    headers.forEach((h, i) => {
      record[h] = values[i] ?? '';
    });
    return record;
  });
}

function splitCsvLine(line: string, sep: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === sep && !inQuote) {
      values.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  values.push(current.trim());
  return values;
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

const CIG_FIELD_NAMES: string[] = ['cig', 'CIG', 'codice_cig', 'codiceCig'];
const TITLE_FIELD_NAMES: string[] = ['oggetto', 'oggetto_gara', 'oggettoGara', 'descrizione', 'object', 'title'];
const VALUE_FIELD_NAMES: string[] = ['importo', 'importo_complessivo_gara', 'importoComplessivoGara', 'importo_base', 'importoBase', 'base_value'];
const CPV_FIELD_NAMES: string[] = ['cpv', 'codice_cpv', 'codiceCpv', 'settore_merceologico'];
const PROC_FIELD_NAMES: string[] = ['tipo_procedura', 'tipoProcedura', 'modalita_realizzazione', 'procedure_type'];
const AUTHORITY_FIELD_NAMES: string[] = ['denominazione', 'stazione_appaltante', 'stazioneAppaltante', 'denominazione_stazione_appaltante'];
const PUB_DATE_FIELDS: string[] = ['data_pubblicazione', 'dataPubblicazione', 'data_inizio', 'publication_date'];
const DEADLINE_FIELDS: string[] = ['data_scadenza', 'dataScadenza', 'scadenza', 'deadline'];
const NUTS_FIELDS: string[] = ['codice_nuts', 'codiceNuts', 'luogo_istat', 'nuts_code'];

function pick(record: RawRecord, candidates: string[]): string | null {
  for (const key of candidates) {
    if (record[key] != null && String(record[key]).trim() !== '') {
      return String(record[key]).trim();
    }
  }
  return null;
}

function parseNumber(val: string | null): number | null {
  if (val == null) return null;
  const cleaned = String(val).replace(/[^\d.,-]/g, '').replace(',', '.');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseCpv(val: string | null): string[] {
  if (!val) return [];
  return String(val)
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDate(val: string | null): string | null {
  if (!val) return null;
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapRecord(raw: RawRecord): BandoRow | null {
  const cig = pick(raw, CIG_FIELD_NAMES);
  if (!cig) return null; // CIG is mandatory

  return {
    cig,
    title: pick(raw, TITLE_FIELD_NAMES) || 'N/D',
    description: pick(raw, TITLE_FIELD_NAMES) || '',
    contracting_authority: pick(raw, AUTHORITY_FIELD_NAMES) || 'N/D',
    base_value: parseNumber(pick(raw, VALUE_FIELD_NAMES)),
    cpv_codes: parseCpv(pick(raw, CPV_FIELD_NAMES)),
    procedure_type: pick(raw, PROC_FIELD_NAMES) || null,
    publication_date: parseDate(pick(raw, PUB_DATE_FIELDS)),
    deadline: parseDate(pick(raw, DEADLINE_FIELDS)),
    nuts_code: pick(raw, NUTS_FIELDS) || null,
    source: 'anac',
    source_url: `https://dati.anticorruzione.it/opendata/dataset/${ANAC_DATASET_ID}`,
    source_id: cig,
    raw_data: raw,
    is_active: true,
  };
}

// ---------------------------------------------------------------------------
// Supabase operations
// ---------------------------------------------------------------------------

async function fetchExistingCigs(cigs: string[]): Promise<Set<string>> {
  const existing = new Set<string>();
  let failedChunks = 0;
  // Query in chunks to stay within URL/body limits
  for (let i = 0; i < cigs.length; i += 500) {
    const chunk = cigs.slice(i, i + 500);
    const { data, error } = await supabase
      .from('bandi')
      .select('cig')
      .in('cig', chunk);

    if (error) {
      console.error(`[bandi-sync-anac] fetchExistingCigs chunk ${i}–${i + chunk.length} failed:`, error.message);
      failedChunks++;
    } else if (data) {
      (data as Array<{ cig: string }>).forEach((row) => existing.add(row.cig));
    }
  }
  if (failedChunks > 0) {
    console.warn(`[bandi-sync-anac] ${failedChunks} chunk(s) failed — dedup may be incomplete`);
  }
  return existing;
}

async function insertBatch(records: BandoRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < records.length; i += INSERT_CHUNK_SIZE) {
    const chunk = records.slice(i, i + INSERT_CHUNK_SIZE);
    const { error } = await supabase.from('bandi').insert(chunk);
    if (!error) {
      inserted += chunk.length;
    } else {
      // Retry individually to isolate bad rows
      for (const row of chunk) {
        const { error: singleErr } = await supabase.from('bandi').insert(row);
        if (!singleErr) inserted += 1;
      }
    }
  }
  return inserted;
}

async function markExpiredBandi(): Promise<void> {
  const { error } = await supabase
    .from('bandi')
    .update({ is_active: false })
    .eq('source', 'anac')
    .eq('is_active', true)
    .lt('deadline', new Date().toISOString());

  if (error) {
    console.warn('[bandi-sync-anac] Failed to mark expired bandi:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Sync Italian public procurement tenders from ANAC OpenData.
 */
async function handler(input: HandlerInput = {}): Promise<HandlerResult> {
  const result: HandlerResult = { synced: 0, skipped_duplicates: 0, errors: 0, source: 'anac' };

  // Step 1 — Resolve dataset URL
  let resource: ResolvedResource | null;
  try {
    resource = await resolveDatasetUrl();
    if (!resource) throw new Error('anac_no_resource');
  } catch (err: unknown) {
    return { ...result, error: 'anac_unavailable', detail: (err as Error).message };
  }

  // Step 2 — Download dataset
  let rawRecords: RawRecord[];
  try {
    const dataRes = await fetchWithTimeout(resource.url, {}, API_TIMEOUT_MS);
    if (resource.format === 'json' || resource.url.endsWith('.json')) {
      const json = await dataRes.json();
      rawRecords = parseJsonRecords(json as RawRecord[] | JsonDataset);
    } else {
      const text = await dataRes.text();
      rawRecords = parseCsvRecords(text);
    }
  } catch (err: unknown) {
    return { ...result, error: 'anac_unavailable', detail: (err as Error).message };
  }

  if (!rawRecords.length) {
    return { ...result, error: 'anac_empty_dataset' };
  }

  // Step 3 — Map records
  const mapped: BandoRow[] = [];
  for (const raw of rawRecords) {
    try {
      const record = mapRecord(raw);
      if (record) {
        mapped.push(record);
      } else {
        result.errors += 1;
      }
    } catch {
      result.errors += 1;
    }
  }

  if (!mapped.length) {
    return result;
  }

  // Step 4 — Dedup against existing CIGs
  const allCigs = mapped.map((r) => r.cig);
  const existingCigs = await fetchExistingCigs(allCigs);

  const toInsert: BandoRow[] = [];
  for (const record of mapped) {
    if (existingCigs.has(record.cig)) {
      result.skipped_duplicates += 1;
    } else {
      toInsert.push(record);
    }
  }

  // Step 5 — Batch insert
  if (toInsert.length) {
    result.synced = await insertBatch(toInsert);
  }

  // Step 6 — Mark expired bandi
  await markExpiredBandi();

  // Step 7 — Track sync metadata
  try {
    await supabase.from('sync_metadata').upsert(
      {
        source: 'anac',
        last_synced_at: isoNow(),
        records_synced: result.synced,
        records_skipped: result.skipped_duplicates,
        records_errored: result.errors,
      },
      { onConflict: 'source' },
    );
  } catch {
    // Non-fatal — metadata tracking is best-effort
  }

  return result;
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
