#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { isoNow } from '../../_shared/utils.ts'
import type { Database } from '../../_shared/database.ts'

type BandoInsert = Database['public']['Tables']['bandi']['Insert']

const ANAC_OCDS_RECORDS = 'https://dati.anticorruzione.it/opendata/ocds/api/records';
const API_TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;
const INSERT_CHUNK_SIZE = 50;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  company_id: string
}

interface OcdsValue {
  amount?: number
  currency?: string
}

interface OcdsClassification {
  id?: string
  [key: string]: unknown
}

interface OcdsItem {
  classification?: OcdsClassification
  deliveryLocation?: { region?: string; [key: string]: unknown }
  [key: string]: unknown
}

interface OcdsTenderPeriod {
  endDate?: string
  [key: string]: unknown
}

interface OcdsTender {
  title?: string
  description?: string
  value?: OcdsValue
  status?: string
  procurementMethod?: string
  mainProcurementCategory?: string
  items?: OcdsItem[]
  tenderPeriod?: OcdsTenderPeriod
  [key: string]: unknown
}

interface OcdsBuyer {
  name?: string
  identifier?: { id?: string; [key: string]: unknown }
  [key: string]: unknown
}

interface OcdsRelease {
  tender?: OcdsTender
  buyer?: OcdsBuyer
  releaseDate?: string
  [key: string]: unknown
}

interface OcdsRecord {
  ocid: string
  releaseDate?: string
  tag?: string
  tender?: OcdsTender
  releases?: OcdsRelease[]
  [key: string]: unknown
}

interface OcdsApiResponse {
  records: OcdsRecord[]
  totalCount: number
  page: number
  size: number
}

// BandoInsert from database.ts replaces the old BandoRow interface

interface HandlerResult {
  synced: number
  skipped_duplicates: number
  errors: number
  source: string
  pages_fetched: number
  total_remote: number
  error?: string
  detail?: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

async function fetchPage(from: string, to: string, page: number): Promise<OcdsApiResponse> {
  const url = `${ANAC_OCDS_RECORDS}?releaseDate_from=${from}&releaseDate_to=${to}&page=${page}&size=${PAGE_SIZE}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`ANAC OCDS HTTP ${res.status} ${res.statusText}`);
  return res.json() as Promise<OcdsApiResponse>;
}

// ---------------------------------------------------------------------------
// Record mapping
// ---------------------------------------------------------------------------

function mapRecord(record: OcdsRecord, companyId: string): BandoInsert | null {
  if (!record.ocid) return null;

  const release: OcdsRelease = record.releases?.length
    ? record.releases[record.releases.length - 1]
    : {};

  return {
    title: release.tender?.title || record.tender?.title || 'N/D',
    description: release.tender?.description || '',
    authority_name: release.buyer?.name || 'N/D',
    authority_code: release.buyer?.identifier?.id || null,
    source: 'anac',
    source_url: `https://dati.anticorruzione.it/opendata/ocds/api/records/${record.ocid}`,
    external_id: record.ocid,
    cig: record.ocid.split('-').pop() || record.ocid,
    base_value: release.tender?.value?.amount ?? null,
    currency: release.tender?.value?.currency || 'EUR',
    cpv_codes: release.tender?.items?.map(i => i.classification?.id).filter(Boolean) as string[] || [],
    procedure_type: release.tender?.procurementMethod || null,
    publication_date: release.releaseDate || record.releaseDate || null,
    deadline: release.tender?.tenderPeriod?.endDate || '2099-12-31',
    nuts_code: release.tender?.items?.[0]?.deliveryLocation?.region || null,
    contract_category: release.tender?.mainProcurementCategory || null,
    company_id: companyId,
    is_active: true,
    scraped_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Supabase operations
// ---------------------------------------------------------------------------

async function fetchExistingSourceIds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const existing = new Set<string>();
  let failedChunks = 0;

  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const { data, error } = await supabase
      .from('bandi')
      .select('external_id')
      .eq('source', 'anac')
      .in('external_id', chunk);

    if (error) {
      console.error(`[bandi-sync-anac] fetchExistingSourceIds chunk ${i}–${i + chunk.length} failed:`, error.message);
      failedChunks++;
    } else if (data) {
      (data as Array<{ external_id: string }>).forEach((row) => existing.add(row.external_id));
    }
  }
  if (failedChunks > 0) {
    console.warn(`[bandi-sync-anac] ${failedChunks} chunk(s) failed — dedup may be incomplete`);
  }
  return existing;
}

async function insertBatch(records: BandoInsert[]): Promise<number> {
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

async function handler(input: HandlerInput): Promise<HandlerResult> {
  if (!input.company_id) {
    throw new Error('company_id is required');
  }

  const result: HandlerResult = {
    synced: 0, skipped_duplicates: 0, errors: 0,
    source: 'anac', pages_fetched: 0, total_remote: 0,
  };

  const from = monthStart();
  const to = todayIso();
  let page = 0;
  let totalCount = Infinity;

  while (page * PAGE_SIZE < totalCount) {
    let body: OcdsApiResponse;
    try {
      body = await fetchPage(from, to, page);
      result.pages_fetched++;
    } catch (err: unknown) {
      if (page === 0) {
        return { ...result, error: 'anac_unavailable', detail: (err as Error).message };
      }
      console.error(`[bandi-sync-anac] Page ${page} failed, stopping pagination:`, (err as Error).message);
      result.errors++;
      break;
    }

    totalCount = body.totalCount ?? 0;
    result.total_remote = totalCount;

    if (!body.records?.length) break;

    // Map records
    const mapped: BandoInsert[] = [];
    for (const rec of body.records) {
      try {
        const row = mapRecord(rec, input.company_id);
        if (row) mapped.push(row);
        else result.errors++;
      } catch {
        result.errors++;
      }
    }

    if (!mapped.length) { page++; continue; }

    // Dedup against existing external_ids
    const candidateIds = mapped.map((r) => r.external_id).filter(Boolean) as string[];
    let existingIds: Set<string>;
    try {
      existingIds = await fetchExistingSourceIds(candidateIds);
    } catch {
      result.errors += mapped.length;
      page++;
      continue;
    }

    const toInsert: BandoInsert[] = [];
    for (const row of mapped) {
      if (row.external_id && existingIds.has(row.external_id)) {
        result.skipped_duplicates++;
      } else {
        toInsert.push(row);
      }
    }

    // Batch insert
    if (toInsert.length) {
      try {
        result.synced += await insertBatch(toInsert);
      } catch {
        result.errors += toInsert.length;
      }
    }

    page++;
  }

  // Mark expired bandi
  await markExpiredBandi();

  // Track sync metadata
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
