#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import {
  computeMatchScore,
  callInference,
  parseInferenceJSON,
  isoNow,
  clamp,
} from '../../_shared/utils.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BANDI_PER_RUN = 100;
const INFERENCE_TIMEOUT_MS = 10_000;
const SECTOR_SYSTEM_PROMPT =
  'Confronta i codici CPV del bando con il codice ATECO dell\'azienda. ' +
  'Valuta la corrispondenza settoriale. Rispondi SOLO con un JSON: ' +
  '{ "score": 0-35, "match_type": "exact|related|adjacent|none", "reasoning": "breve spiegazione" }';

const REGION_TO_NUTS: Record<string, string> = {
  'lombardia':              'ITC4',
  'piemonte':               'ITC1',
  'veneto':                 'ITH3',
  'emilia-romagna':         'ITH5',
  'toscana':                'ITI1',
  'lazio':                  'ITI4',
  'campania':               'ITF3',
  'puglia':                 'ITF4',
  'sicilia':                'ITG1',
  'sardegna':               'ITG2',
  'liguria':                'ITC3',
  'friuli venezia giulia':  'ITH4',
  'trentino-alto adige':    'ITH1',
  'marche':                 'ITI3',
  'abruzzo':                'ITF1',
  'umbria':                 'ITI2',
  'calabria':               'ITF6',
  'basilicata':             'ITF5',
  'molise':                 'ITF2',
  'valle d\'aosta':         'ITC2',
};

// NUTS macro-area prefixes that are considered "adjacent"
const ADJACENT_NUTS: Record<string, string[]> = {
  ITC: ['ITH', 'ITI'],          // Northwest ↔ Northeast, Central
  ITH: ['ITC', 'ITI'],          // Northeast ↔ Northwest, Central
  ITI: ['ITC', 'ITH', 'ITF'],   // Central ↔ Northwest, Northeast, South
  ITF: ['ITI', 'ITG'],          // South ↔ Central, Islands
  ITG: ['ITF'],                 // Islands ↔ South
};

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  company_id?: string
}

interface ContractInfo {
  contract_type: string | null
  counterpart_type: string | null
}

interface Certification {
  name?: string
  [key: string]: unknown
}

interface CompanyProfile {
  company_id: string
  ateco_code: string | null
  city: string | null
  region: string | null
  revenue: number | null
  employee_count: number | null
  certifications: Array<string | Certification>
  sector_description: string | null
  updated_at: string | null
  contracts: ContractInfo[]
}

interface BandoRow {
  id: string
  title?: string
  description?: string
  cpv_codes?: string[]
  base_value?: number | null
  nuts_code?: string
  raw_data?: Record<string, unknown>
  [key: string]: unknown
}

interface SectorResult {
  score: number
  matchType: string
  reasoning: string
}

interface SectorInferenceResult {
  score?: number
  match_type?: string
  reasoning?: string
}

interface DimensionScores {
  sector: number
  size: number
  geo: number
  requirements: number
  feasibility: number
}

interface HandlerResult {
  matched: number
  alerts_created: number
  errors: number
  detail?: string
}

// ---------------------------------------------------------------------------
// Step 1 — Load company profiles
// ---------------------------------------------------------------------------

async function loadCompanyProfiles(companyId?: string): Promise<CompanyProfile[]> {
  let query = supabase
    .from('companies')
    .select('id, ateco_code, city, region, revenue, employee_count, certifications, sector_description, updated_at')
    .eq('is_active', true);

  if (companyId) {
    query = query.eq('id', companyId);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load companies: ${error.message}`);
  if (!data?.length) return [];

  const profiles: CompanyProfile[] = [];
  for (const company of data as Array<Record<string, unknown>>) {
    const { data: contracts } = await supabase
      .from('contracts')
      .select('contract_type, counterpart_type')
      .eq('company_id', company.id as string)
      .neq('status', 'draft')
      .limit(20);

    profiles.push({
      company_id: company.id as string,
      ateco_code: (company.ateco_code as string | null) ?? null,
      city: (company.city as string | null) ?? null,
      region: (company.region as string | null) ?? null,
      revenue: (company.revenue as number | null) ?? null,
      employee_count: (company.employee_count as number | null) ?? null,
      certifications: (company.certifications as Array<string | Certification>) || [],
      sector_description: (company.sector_description as string | null) ?? null,
      updated_at: (company.updated_at as string | null) ?? null,
      contracts: (contracts || []) as ContractInfo[],
    });
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Step 2 — Load unscored bandi
// ---------------------------------------------------------------------------

async function loadUnscoredBandi(companyUpdatedAt: string | null): Promise<BandoRow[]> {
  let query = supabase
    .from('bandi')
    .select('*')
    .eq('is_active', true)
    .limit(BANDI_PER_RUN);

  if (companyUpdatedAt) {
    // Bandi that were never scored OR scored before the company profile changed
    query = query.or(`match_score.is.null,scored_at.lt.${companyUpdatedAt}`);
  } else {
    query = query.is('match_score', null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load bandi: ${error.message}`);
  return (data || []) as BandoRow[];
}

// ---------------------------------------------------------------------------
// Step 3 — Dimension scorers
// ---------------------------------------------------------------------------

// 3a. Sector (0-35) — AI inference with heuristic fallback
async function scoreSector(bando: BandoRow, profile: CompanyProfile): Promise<SectorResult> {
  const cpvCodes = (bando.cpv_codes || []).join(', ') || 'N/D';
  const atecoCode = profile.ateco_code || 'N/D';
  const descSnippet = `${bando.title || ''} ${bando.description || ''}`.slice(0, 500);
  const contractTypes = [...new Set(profile.contracts.map((c) => c.contract_type).filter(Boolean))].join(', ') || 'N/D';

  const userMessage =
    `CPV bando: ${cpvCodes}. ATECO azienda: ${atecoCode}. ` +
    `Descrizione bando: ${descSnippet}. ` +
    `Servizi azienda (dai contratti): ${contractTypes}`;

  try {
    const raw = await Promise.race([
      callInference(SECTOR_SYSTEM_PROMPT, userMessage, { model: 'nemotron-nano', temperature: 0.1, maxTokens: 512 }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), INFERENCE_TIMEOUT_MS)),
    ]);
    const parsed = parseInferenceJSON(raw) as SectorInferenceResult;
    return {
      score: clamp(parsed.score ?? 0, 0, 35),
      matchType: parsed.match_type || 'none',
      reasoning: parsed.reasoning || '',
    };
  } catch {
    // Heuristic fallback: compare first 2 digits of CPV vs ATECO prefix
    return sectorHeuristic(bando.cpv_codes, profile.ateco_code);
  }
}

function sectorHeuristic(cpvCodes: string[] | undefined, atecoCode: string | null): SectorResult {
  if (!cpvCodes?.length || !atecoCode) {
    return { score: 10, matchType: 'none', reasoning: 'Dati insufficienti (fallback euristico)' };
  }
  const atecoPrefix = atecoCode.split('.')[0];
  const cpvPrefixes = cpvCodes.map((c) => String(c).slice(0, 2));

  // Very rough mapping: CPV division 72 ≈ ATECO 62 (IT services), etc.
  // Without a full mapping table, check if any prefix digits overlap
  if (cpvPrefixes.includes(atecoPrefix)) {
    return { score: 25, matchType: 'related', reasoning: 'Corrispondenza prefisso (fallback euristico)' };
  }
  return { score: 5, matchType: 'adjacent', reasoning: 'Nessuna corrispondenza diretta (fallback euristico)' };
}

// 3b. Economic Size (0-25)
function scoreSize(bando: BandoRow, profile: CompanyProfile): number {
  if (!bando.base_value || !profile.revenue) return 15;
  const ratio = profile.revenue / bando.base_value;
  if (ratio >= 1.0) return 25;
  if (ratio >= 0.8) return 15;
  if (ratio >= 0.5) return 5;
  return 0;
}

// 3c. Geography (0-20)
function scoreGeo(bando: BandoRow, profile: CompanyProfile): number {
  const nutsCode = bando.nuts_code;
  if (!nutsCode || nutsCode === 'IT') return 20; // national scope

  const companyNuts = REGION_TO_NUTS[(profile.region || '').toLowerCase()] || null;
  if (!companyNuts) return 10; // unknown region, benefit of doubt

  if (nutsCode.startsWith(companyNuts) || companyNuts.startsWith(nutsCode)) return 20;
  if (isAdjacentRegion(nutsCode, companyNuts)) return 10;
  return 0;
}

function isAdjacentRegion(bandoNuts: string, companyNuts: string): boolean {
  const bandoMacro = bandoNuts.slice(0, 3);
  const companyMacro = companyNuts.slice(0, 3);
  const adjacent = ADJACENT_NUTS[companyMacro];
  return adjacent ? adjacent.some((prefix) => bandoMacro.startsWith(prefix)) : false;
}

// 3d. Requirements (0-15)
function scoreRequirements(bando: BandoRow, profile: CompanyProfile): number {
  const certs = profile.certifications || [];
  const rawData = bando.raw_data || {};

  const requirementText = JSON.stringify(rawData).toLowerCase();
  if (!requirementText || requirementText.length < 10) return 5;

  const certKeywords: string[] = ['iso 9001', 'iso 14001', 'iso 27001', 'soa', 'haccp', 'ohsas', 'iso 45001'];
  const mentionedCerts = certKeywords.filter((kw) => requirementText.includes(kw));

  if (!mentionedCerts.length) return 5; // no specific certs mentioned

  const companyCertsLower = certs.map((c) => (typeof c === 'string' ? c : (c as Certification).name || '').toLowerCase());
  const matchedCount = mentionedCerts.filter((kw) =>
    companyCertsLower.some((cc) => cc.includes(kw)),
  ).length;

  if (matchedCount === mentionedCerts.length) return 15;
  if (matchedCount > 0) return 10;
  return 0;
}

// 3e. Feasibility (0-5)
function scoreFeasibility(bando: BandoRow): number {
  const text = `${bando.title || ''} ${bando.description || ''} ${JSON.stringify(bando.raw_data || {})}`.toLowerCase();
  const rtiMandatory = text.includes('rti obbligatorio') || text.includes('raggruppamento obbligatorio');
  const rtiMentioned =
    text.includes('rti') ||
    text.includes('raggruppamento temporaneo') ||
    text.includes('raggruppamento di imprese');

  if (rtiMandatory) return 1;
  if (rtiMentioned) return 3;
  return 5;
}

// ---------------------------------------------------------------------------
// Step 4 — Write results
// ---------------------------------------------------------------------------

interface WriteResult {
  totalScore: number
  alertCreated: boolean
}

async function writeBandoScore(bando: BandoRow, profile: CompanyProfile, scores: DimensionScores, sectorResult: SectorResult): Promise<WriteResult> {
  const totalScore = computeMatchScore(scores);

  const snapshot: Record<string, unknown> = {
    company_id: profile.company_id,
    ateco_code: profile.ateco_code,
    region: profile.region,
    revenue: profile.revenue,
    certifications: profile.certifications,
    scored_at: isoNow(),
  };

  const updatePayload: Record<string, unknown> = {
    match_score: totalScore,
    score_sector: scores.sector,
    score_size: scores.size,
    score_geo: scores.geo,
    score_requirements: scores.requirements,
    score_feasibility: scores.feasibility,
    company_profile_snapshot: snapshot,
    scored_at: isoNow(),
  };

  const { error } = await supabase
    .from('bandi')
    .update(updatePayload)
    .eq('id', bando.id);

  if (error) throw new Error(`Failed to update bando ${bando.id}: ${error.message}`);

  let alertCreated = false;
  if (totalScore > 80) {
    alertCreated = await createAlert(bando, profile, totalScore, sectorResult.reasoning);
  }

  return { totalScore, alertCreated };
}

async function createAlert(bando: BandoRow, profile: CompanyProfile, score: number, reasoning: string): Promise<boolean> {
  const truncatedTitle = (bando.title || 'Bando senza titolo').slice(0, 80);
  const message = `Match ${score}%: ${reasoning || 'Alta compatibilità con il profilo aziendale.'}`;

  const { error } = await supabase.from('alerts').insert({
    type: 'new_bando_match',
    priority: 'high',
    company_id: profile.company_id,
    title: `Nuovo bando compatibile: ${truncatedTitle}`,
    message,
    related_entity_type: 'bando',
    related_entity_id: bando.id,
    created_at: isoNow(),
  });

  if (error) {
    console.warn(`[bandi-match] Failed to create alert for bando ${bando.id}:`, error.message);
    return false;
  }

  await supabase
    .from('bandi')
    .update({ alert_sent: true, alert_sent_at: isoNow() })
    .eq('id', bando.id);

  return true;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Match active bandi against company profiles using 5-dimension scoring.
 */
async function handler(input: HandlerInput = {}): Promise<HandlerResult> {
  const result: HandlerResult = { matched: 0, alerts_created: 0, errors: 0 };

  // Step 1 — Load company profiles
  const profiles = await loadCompanyProfiles(input.company_id);
  if (!profiles.length) {
    return { ...result, detail: 'no_active_companies' };
  }

  for (const profile of profiles) {
    // Step 2 — Load unscored bandi for this company
    const bandi = await loadUnscoredBandi(profile.updated_at);
    if (!bandi.length) continue;

    for (const bando of bandi) {
      try {
        // Step 3 — Compute 5-dimension scores
        const sectorResult = await scoreSector(bando, profile);

        const scores: DimensionScores = {
          sector: sectorResult.score,
          size: scoreSize(bando, profile),
          geo: scoreGeo(bando, profile),
          requirements: scoreRequirements(bando, profile),
          feasibility: scoreFeasibility(bando),
        };

        // Step 4 — Persist scores and create alerts
        const { alertCreated } = await writeBandoScore(bando, profile, scores, sectorResult);

        result.matched += 1;
        if (alertCreated) result.alerts_created += 1;
      } catch (err: unknown) {
        console.warn(`[bandi-match] Error scoring bando ${bando.id} for company ${profile.company_id}:`, (err as Error).message);
        result.errors += 1;
      }
    }
  }

  // Track sync metadata
  try {
    await supabase.from('sync_metadata').upsert(
      {
        source: 'bandi-match',
        last_synced_at: isoNow(),
        records_synced: result.matched,
        records_skipped: 0,
        records_errored: result.errors,
      },
      { onConflict: 'source' },
    );
  } catch {
    // Non-fatal
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
