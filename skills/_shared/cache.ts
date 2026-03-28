import { supabase } from './supabase-client.ts'

/**
 * Read a cached value from a Supabase table.
 * Returns the row if found and within TTL, otherwise null.
 */
export async function getCached(
  table: string,
  keyColumn: string,
  keyValue: string,
  timestampColumn: string,
  maxAgeMinutes: number,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq(keyColumn, keyValue)
    .single()

  if (error || !data) return null

  const updatedAt = (data as Record<string, unknown>)[timestampColumn] as string | undefined
  if (!updatedAt) return null

  const ageMs = Date.now() - new Date(updatedAt).getTime()
  const maxAgeMs = maxAgeMinutes * 60 * 1000

  return ageMs <= maxAgeMs ? (data as Record<string, unknown>) : null
}

/**
 * Upsert a cached value into a Supabase table.
 */
export async function setCache(
  table: string,
  data: Record<string, unknown>,
  conflictColumn: string,
): Promise<Record<string, unknown>> {
  const { data: result, error } = await supabase
    .from(table)
    .upsert(data, { onConflict: conflictColumn })
    .select()
    .single()

  if (error) throw new Error(`Cache write failed (${table}): ${error.message}`)
  return result as Record<string, unknown>
}
