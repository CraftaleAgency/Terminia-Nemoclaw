#!/usr/bin/env node
import { supabase } from '../../_shared/supabase-client.js';
import { isoNow } from '../../_shared/utils.js';

const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';
const API_TIMEOUT_MS = 15000;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const INSERT_BATCH_SIZE = 50;

/**
 * Build a TED API search URL for Italian notices published since a given date.
 */
function buildSearchUrl(sinceDate, page) {
  const params = new URLSearchParams({
    q: `country=IT AND publication-date>=${sinceDate}`,
    fields: [
      'notice-id', 'title', 'description', 'contracting-authority',
      'estimated-value', 'cpv-codes', 'submission-deadline', 'nuts-code',
      'procedure-type', 'publication-date', 'document-url',
    ].join(','),
    pageSize: String(PAGE_SIZE),
    page: String(page),
    sortField: 'publication-date',
    sortOrder: 'desc',
  });
  return `${TED_SEARCH_URL}?${params}`;
}

/**
 * Fetch a single page from the TED API. Returns the parsed JSON body.
 * Handles both v3 and possible v2-style response shapes defensively.
 */
async function fetchPage(sinceDate, page) {
  const url = buildSearchUrl(sinceDate, page);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`TED API HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Normalize a raw TED notice into a row compatible with the bandi table.
 */
function mapNotice(notice) {
  const noticeId = notice['notice-id'] ?? notice.noticeId ?? notice.id;
  if (!noticeId) return null;

  const title = notice.title ?? notice['title-text'] ?? '';
  const description = notice.description ?? '';
  const authority = notice['contracting-authority'];
  const estimatedValue = notice['estimated-value'];
  const cpvCodes = notice['cpv-codes'];

  return {
    title: typeof title === 'string' ? title : JSON.stringify(title),
    description: typeof description === 'string' ? description : JSON.stringify(description),
    contracting_authority: authority?.name ?? (typeof authority === 'string' ? authority : ''),
    base_value: parseFloat(estimatedValue?.amount) || null,
    currency: estimatedValue?.currency || 'EUR',
    cpv_codes: Array.isArray(cpvCodes) ? cpvCodes : [],
    procedure_type: notice['procedure-type'] ?? '',
    publication_date: notice['publication-date'] ?? null,
    deadline: notice['submission-deadline'] ?? null,
    nuts_code: notice['nuts-code'] ?? '',
    source: 'ted',
    source_url: `https://ted.europa.eu/en/notice/-/${noticeId}`,
    source_id: String(noticeId),
    raw_data: notice,
    is_active: true,
  };
}

/**
 * Extract the notices array from a TED API response,
 * handling both v3 and possible v2 shapes.
 */
function extractNotices(body) {
  if (Array.isArray(body?.notices)) return body.notices;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.items)) return body.items;
  if (Array.isArray(body)) return body;
  return [];
}

/**
 * Determine whether more pages exist.
 */
function hasMorePages(body, currentPage) {
  // v3 style: total count or explicit flag
  if (body?.totalPages != null) return currentPage < body.totalPages;
  if (body?.hasMore === true) return true;

  const notices = extractNotices(body);
  return notices.length >= PAGE_SIZE;
}

/**
 * Look up existing source_ids in the bandi table.
 * Returns a Set of already-known TED notice IDs.
 */
async function fetchExistingIds(sourceIds) {
  if (sourceIds.length === 0) return new Set();

  const existing = new Set();
  let failedChunks = 0;
  // Query in chunks to stay within URL/body limits
  for (let i = 0; i < sourceIds.length; i += 500) {
    const chunk = sourceIds.slice(i, i + 500);
    const { data, error } = await supabase
      .from('bandi')
      .select('source_id')
      .eq('source', 'ted')
      .in('source_id', chunk);

    if (error) {
      console.error(`[bandi-sync-ted] fetchExistingIds chunk ${i}–${i + chunk.length} failed:`, error.message);
      failedChunks++;
    } else if (data) {
      data.forEach((row) => existing.add(row.source_id));
    }
  }
  if (failedChunks > 0) {
    console.warn(`[bandi-sync-ted] ${failedChunks} chunk(s) failed — dedup may be incomplete`);
  }
  return existing;
}

/**
 * Insert rows into the bandi table in batches.
 * Returns the count of successfully inserted rows.
 */
async function batchInsert(rows) {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + INSERT_BATCH_SIZE);
    const { error } = await supabase.from('bandi').insert(batch);
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    inserted += batch.length;
  }

  return inserted;
}

/**
 * Mark notices with an expired deadline as inactive.
 */
async function markExpired() {
  const now = isoNow();
  await supabase
    .from('bandi')
    .update({ is_active: false })
    .eq('source', 'ted')
    .eq('is_active', true)
    .lt('deadline', now)
    .not('deadline', 'is', null);
}

/**
 * Sync Italian EU procurement notices from TED Europa into the bandi table.
 *
 * @param {{ days_back?: number }} input
 * @returns {Promise<{ synced: number, skipped_duplicates: number, errors: number, source: string }>}
 */
async function handler(input) {
  const daysBack = input?.days_back || 1;
  const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  let synced = 0;
  let skippedDuplicates = 0;
  let errors = 0;

  try {
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let body;
      try {
        body = await fetchPage(sinceDate, page);
      } catch (err) {
        // First page failure means TED is unreachable
        if (page === 1) {
          return { synced: 0, skipped_duplicates: 0, errors: 0, source: 'ted', error: 'ted_unavailable' };
        }
        // Later page failure → return partial results
        break;
      }

      const rawNotices = extractNotices(body);
      if (rawNotices.length === 0) break;

      // Map raw notices to bandi rows
      const mapped = [];
      for (const raw of rawNotices) {
        try {
          const row = mapNotice(raw);
          if (row) mapped.push(row);
          else errors++;
        } catch {
          errors++;
        }
      }

      // Deduplicate against existing records
      const candidateIds = mapped.map((r) => r.source_id);
      let existingIds;
      try {
        existingIds = await fetchExistingIds(candidateIds);
      } catch (err) {
        console.error('fetchExistingIds failed:', err);
        errors += mapped.length;
        break;
      }

      const toInsert = [];
      for (const row of mapped) {
        if (existingIds.has(row.source_id)) {
          skippedDuplicates++;
        } else {
          toInsert.push(row);
        }
      }

      // Insert new records
      if (toInsert.length > 0) {
        try {
          synced += await batchInsert(toInsert);
        } catch {
          errors += toInsert.length;
        }
      }

      // Pagination
      hasMore = hasMorePages(body, page);
      page++;
      if (page > MAX_PAGES) break;
    }

    // Mark expired notices
    try {
      await markExpired();
    } catch {
      // Non-fatal: sync counts are still valid
    }
  } catch {
    return { synced, skipped_duplicates: skippedDuplicates, errors: errors + 1, source: 'ted', error: 'unexpected_error' };
  }

  return { synced, skipped_duplicates: skippedDuplicates, errors, source: 'ted' };
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
