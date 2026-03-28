import { supabase } from './supabase-client.js';

/**
 * Read a cached value from a Supabase table.
 * Returns the row if found and within TTL, otherwise null.
 *
 * @param {string} table - Supabase table name
 * @param {string} keyColumn - Column to match (e.g. 'vat_number')
 * @param {string} keyValue - Value to look up
 * @param {string} timestampColumn - Column storing last-updated timestamp
 * @param {number} maxAgeMinutes - Max cache age in minutes
 * @returns {Promise<object|null>}
 */
export async function getCached(table, keyColumn, keyValue, timestampColumn, maxAgeMinutes) {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(keyColumn, keyValue)
    .single();

  if (error || !data) return null;

  const updatedAt = data[timestampColumn];
  if (!updatedAt) return null;

  const ageMs = Date.now() - new Date(updatedAt).getTime();
  const maxAgeMs = maxAgeMinutes * 60 * 1000;

  return ageMs <= maxAgeMs ? data : null;
}

/**
 * Upsert a cached value into a Supabase table.
 *
 * @param {string} table - Supabase table name
 * @param {object} data - Row data including the key column
 * @param {string} conflictColumn - Column for upsert conflict resolution
 * @returns {Promise<object>}
 */
export async function setCache(table, data, conflictColumn) {
  const { data: result, error } = await supabase
    .from(table)
    .upsert(data, { onConflict: conflictColumn })
    .select()
    .single();

  if (error) throw new Error(`Cache write failed (${table}): ${error.message}`);
  return result;
}
