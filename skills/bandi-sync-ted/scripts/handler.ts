#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { isoNow } from '../../_shared/utils.ts'
import type { Database } from '../../_shared/database.ts'

type BandoInsert = Database['public']['Tables']['bandi']['Insert']

const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';
const TED_API_KEY = process.env.TED_API_KEY || 'dcabd92b303f415fa4fd23ae877a90a1';
const API_TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const INSERT_BATCH_SIZE = 50;

// TED v3 field codes requested in every search
const TED_FIELDS = ['ND', 'TI', 'AC', 'PC', 'DT', 'CY', 'MA', 'AU'] as const;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  days_back?: number
  cpv?: string
  country?: string
  company_id?: string
}

interface TedNotice {
  ND?: string
  TI?: string | Record<string, string>
  AC?: string | Record<string, string>
  PC?: string | string[]
  DT?: string
  CY?: string
  MA?: string | number
  AU?: string
  [key: string]: unknown
}

interface TedApiResponse {
  notices?: TedNotice[]
  results?: TedNotice[]
  items?: TedNotice[]
  totalNoticeCount?: number
  totalPages?: number
  hasMore?: boolean
  [key: string]: unknown
}

interface HandlerResult {
  synced: number
  skipped_duplicates: number
  errors: number
  source: string
  error?: string
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

async function fetchPage(
  fromDate: string,
  toDate: string,
  pageNum: number,
): Promise<TedApiResponse> {
  const response = await fetch(TED_SEARCH_URL, {
    method: 'POST',
    headers: {
      'x-api-key': TED_API_KEY,
      'content-type': 'application/json; charset=utf-8',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      query: `CY=ITA AND PD>=${fromDate} AND PD<=${toDate}`,
      fields: [...TED_FIELDS],
      page: pageNum,
      limit: PAGE_SIZE,
    }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`TED API HTTP ${response.status}`);
  }

  return response.json() as Promise<TedApiResponse>;
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function textOf(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') {
    const obj = val as Record<string, string>;
    return obj.EN || obj.IT || Object.values(obj)[0] || '';
  }
  return '';
}

function mapNotice(notice: TedNotice, companyId: string): BandoInsert | null {
  const noticeId = notice.ND;
  if (!noticeId) return null;

  const title = textOf(notice.TI);
  const authority = textOf(notice.AU) || textOf(notice.AC);
  const cpvRaw = notice.PC;
  const cpvCodes = Array.isArray(cpvRaw)
    ? cpvRaw.filter(Boolean)
    : (typeof cpvRaw === 'string' ? cpvRaw.split(/[,;|]/).map(s => s.trim()).filter(Boolean) : []);

  const amountRaw = notice.MA;
  const baseValue = typeof amountRaw === 'number'
    ? amountRaw
    : (typeof amountRaw === 'string' ? (parseFloat(amountRaw) || null) : null);

  return {
    title: title || 'N/D',
    description: '',
    authority_name: authority || 'N/D',
    base_value: baseValue,
    currency: 'EUR',
    cpv_codes: cpvCodes,
    procedure_type: null,
    publication_date: notice.DT ?? null,
    deadline: notice.DT ?? '2099-12-31',
    nuts_code: null,
    source: 'ted',
    source_url: `https://ted.europa.eu/en/notice/-/${noticeId}`,
    external_id: String(noticeId),
    company_id: companyId,
    is_active: true,
    scraped_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Extract notices from response (handle multiple shapes)
// ---------------------------------------------------------------------------

function extractNotices(body: TedApiResponse): TedNotice[] {
  if (Array.isArray(body?.notices)) return body.notices;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body)) return body as unknown as TedNotice[];
  return [];
}

function hasMorePages(body: TedApiResponse, currentPage: number, totalFetched: number): boolean {
  if (body?.totalPages != null) return currentPage < body.totalPages;
  if (body?.totalNoticeCount != null) return totalFetched < body.totalNoticeCount;
  if (body?.hasMore === true) return true;
  return extractNotices(body).length >= PAGE_SIZE;
}

// ---------------------------------------------------------------------------
// Supabase operations
// ---------------------------------------------------------------------------

async function fetchExistingIds(externalIds: string[]): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();

  const existing = new Set<string>();
  let failedChunks = 0;

  for (let i = 0; i < externalIds.length; i += 500) {
    const chunk = externalIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('bandi')
      .select('external_id')
      .eq('source', 'ted')
      .in('external_id', chunk);

    if (error) {
      console.error(`[bandi-sync-ted] fetchExistingIds chunk ${i}–${i + chunk.length} failed:`, error.message);
      failedChunks++;
    } else if (data) {
      (data as Array<{ external_id: string }>).forEach((row) => existing.add(row.external_id));
    }
  }
  if (failedChunks > 0) {
    console.warn(`[bandi-sync-ted] ${failedChunks} chunk(s) failed — dedup may be incomplete`);
  }
  return existing;
}

async function batchInsert(rows: BandoInsert[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await supabase.from('bandi').insert(batch);
    if (!error) {
      inserted += batch.length;
    } else {
      for (const row of batch) {
        const { error: singleErr } = await supabase.from('bandi').insert(row);
        if (!singleErr) inserted += 1;
      }
    }
  }
  return inserted;
}

async function markExpired(): Promise<void> {
  const now = isoNow();
  const { error } = await supabase
    .from('bandi')
    .update({ is_active: false })
    .eq('source', 'ted')
    .eq('is_active', true)
    .lt('deadline', now)
    .not('deadline', 'is', null);

  if (error) {
    console.warn('[bandi-sync-ted] Failed to mark expired:', error.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

async function handler(input: HandlerInput): Promise<HandlerResult> {
  if (!input.company_id) {
    throw new Error('company_id is required');
  }
  const companyId = input.company_id;
  const daysBack = input?.days_back || 1;
  const now = new Date();
  const since = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  const fromDate = formatDate(since);
  const toDate = formatDate(now);

  let synced = 0;
  let skippedDuplicates = 0;
  let errors = 0;
  let totalFetched = 0;

  try {
    let pageNum = 1;
    let more = true;

    while (more) {
      let body: TedApiResponse;
      try {
        body = await fetchPage(fromDate, toDate, pageNum);
      } catch (err: unknown) {
        if (pageNum === 1) {
          return { synced: 0, skipped_duplicates: 0, errors: 0, source: 'ted', error: 'ted_unavailable' };
        }
        console.error(`[bandi-sync-ted] Page ${pageNum} failed:`, (err as Error).message);
        break;
      }

      const rawNotices = extractNotices(body);
      if (rawNotices.length === 0) break;
      totalFetched += rawNotices.length;

      // Map
      const mapped: BandoInsert[] = [];
      for (const raw of rawNotices) {
        try {
          const row = mapNotice(raw, companyId);
          if (row) mapped.push(row);
          else errors++;
        } catch {
          errors++;
        }
      }

      // Dedup
      const candidateIds = mapped.map((r) => r.external_id).filter((id): id is string => id != null);
      let existingIds: Set<string>;
      try {
        existingIds = await fetchExistingIds(candidateIds);
      } catch (err: unknown) {
        console.error('[bandi-sync-ted] fetchExistingIds failed:', err);
        errors += mapped.length;
        break;
      }

      const toInsert: BandoInsert[] = [];
      for (const row of mapped) {
        if (row.external_id && existingIds.has(row.external_id)) {
          skippedDuplicates++;
        } else {
          toInsert.push(row);
        }
      }

      // Insert
      if (toInsert.length > 0) {
        try {
          synced += await batchInsert(toInsert);
        } catch {
          errors += toInsert.length;
        }
      }

      more = hasMorePages(body, pageNum, totalFetched);
      pageNum++;
      if (pageNum > MAX_PAGES) break;
    }

    // Mark expired notices
    try {
      await markExpired();
    } catch {
      // Non-fatal
    }

    // Track sync metadata
    try {
      await supabase.from('sync_metadata').upsert(
        {
          source: 'ted',
          last_synced_at: isoNow(),
          records_synced: synced,
          records_skipped: skippedDuplicates,
          records_errored: errors,
        },
        { onConflict: 'source' },
      );
    } catch {
      // Non-fatal
    }
  } catch {
    return { synced, skipped_duplicates: skippedDuplicates, errors: errors + 1, source: 'ted', error: 'unexpected_error' };
  }

  return { synced, skipped_duplicates: skippedDuplicates, errors, source: 'ted' };
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
