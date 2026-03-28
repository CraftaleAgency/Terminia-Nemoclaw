#!/usr/bin/env -S node --experimental-strip-types
import { supabase } from '../../_shared/supabase-client.ts'
import { callInference, parseInferenceJSON, isoNow, clamp } from '../../_shared/utils.ts'

const RISK_LABELS: Array<[number, string]> = [
  [76, 'critical'],
  [51, 'high'],
  [26, 'medium'],
  [0, 'low'],
];

const CLAUSE_RISK_SYSTEM_PROMPT = `Sei un consulente legale italiano. Analizza queste clausole contrattuali rischiose e fornisci un breve parere in italiano su ciascuna, spiegando il rischio concreto per l'azienda e cosa fare. Rispondi in JSON: { "clause_assessments": [{ "clause_type": "...", "risk_summary_it": "...", "recommendation_it": "..." }] }`;

const RISK_LEVEL_ORDER: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface HandlerInput {
  contract_id: string
  company_id: string
}

interface ContractRow {
  id: string
  auto_renewal?: boolean
  renewal_notice_days?: number | null
  payment_terms_days?: number | null
  end_date?: string | null
  [key: string]: unknown
}

interface ClauseRow {
  id?: string
  clause_type?: string
  risk_level?: string
  summary?: string
  title?: string
  original_text?: string
  [key: string]: unknown
}

interface ObligationRow {
  id?: string
  description?: string | null
  deadline?: string | null
  [key: string]: unknown
}

interface MilestoneRow {
  id?: string
  title?: string | null
  due_date?: string | null
  amount?: number | null
  [key: string]: unknown
}

interface RuleScores {
  renewal_risk: number
  payment_risk: number
  duration_risk: number
  clause_risk: number
  specific_clause_risk: number
  obligation_risk: number
}

interface ClauseAssessment {
  clause_type: string
  risk_summary_it: string
  recommendation_it: string
}

interface ClauseAssessmentResponse {
  clause_assessments: ClauseAssessment[]
}

interface RiskDetails {
  rule_scores: RuleScores
  clause_assessments: ClauseAssessment[]
  total: number
}

interface AlertRow {
  company_id: string
  type: string
  title: string
  message: string
  priority: string
  related_entity_type: string
  related_entity_id: string
  created_at: string
}

interface HandlerResult {
  risk_score: number
  risk_label: string
  risk_details: RiskDetails
  alerts_created: number
  write_errors?: string[]
}

function riskAtLeast(level: string | undefined, threshold: string): boolean {
  return (RISK_LEVEL_ORDER[level ?? ''] ?? 0) >= (RISK_LEVEL_ORDER[threshold] ?? 0);
}

function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return Infinity;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.floor((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function riskLabel(score: number): string {
  for (const [threshold, label] of RISK_LABELS) {
    if (score >= threshold) return label;
  }
  return 'low';
}

// ── Step 1: Fetch contract data ─────────────────────────────────────────────

interface ContractData {
  contract: ContractRow
  clauses: ClauseRow[]
  obligations: ObligationRow[]
  milestones: MilestoneRow[]
}

async function fetchContractData(contractId: string): Promise<ContractData> {
  const { data: contract, error: cErr } = await supabase
    .from('contracts')
    .select('*')
    .eq('id', contractId)
    .single();
  if (cErr) throw new Error(`Failed to fetch contract: ${cErr.message}`);

  const { data: clauses, error: clErr } = await supabase
    .from('clauses')
    .select('*')
    .eq('contract_id', contractId);
  if (clErr) throw new Error(`Failed to fetch clauses: ${clErr.message}`);

  const { data: obligations, error: oErr } = await supabase
    .from('obligations')
    .select('*')
    .eq('contract_id', contractId);
  if (oErr) throw new Error(`Failed to fetch obligations: ${oErr.message}`);

  const { data: milestones, error: mErr } = await supabase
    .from('milestones')
    .select('*')
    .eq('contract_id', contractId);
  if (mErr) throw new Error(`Failed to fetch milestones: ${mErr.message}`);

  return {
    contract: contract as ContractRow,
    clauses: (clauses || []) as ClauseRow[],
    obligations: (obligations || []) as ObligationRow[],
    milestones: (milestones || []) as MilestoneRow[],
  };
}

// ── Step 2: Rules-based scoring ─────────────────────────────────────────────

function computeRuleScores(contract: ContractRow, clauses: ClauseRow[], obligations: ObligationRow[]): RuleScores {
  let renewalRisk = 0;
  if (contract.auto_renewal) {
    if (contract.renewal_notice_days == null) {
      renewalRisk = 15;
    } else if (contract.renewal_notice_days < 30) {
      renewalRisk = 10;
    } else {
      renewalRisk = 5;
    }
  }

  let paymentRisk = 0;
  if ((contract.payment_terms_days ?? 0) > 60) {
    paymentRisk = 10;
  } else if ((contract.payment_terms_days ?? 0) > 30) {
    paymentRisk = 5;
  }

  const durationRisk = contract.end_date ? 0 : 5;

  // Clause-level risk
  let clauseRisk = 0;
  const hasCritical = clauses.some((c) => c.risk_level === 'critical');
  if (hasCritical) clauseRisk += 20;

  const highCount = clauses.filter((c) => c.risk_level === 'high').length;
  clauseRisk += Math.min(highCount * 10, 30);

  const mediumCount = clauses.filter((c) => c.risk_level === 'medium').length;
  clauseRisk += Math.min(mediumCount * 5, 15);

  // Specific clause type penalties
  let specificClauseRisk = 0;
  for (const c of clauses) {
    switch (c.clause_type) {
      case 'non_compete':
        if (riskAtLeast(c.risk_level, 'medium')) specificClauseRisk += 15;
        break;
      case 'limitazione_responsabilita':
        if (riskAtLeast(c.risk_level, 'high')) specificClauseRisk += 10;
        break;
      case 'proprieta_intellettuale':
        if (riskAtLeast(c.risk_level, 'medium')) specificClauseRisk += 10;
        break;
      case 'penale':
        if (riskAtLeast(c.risk_level, 'high')) specificClauseRisk += 10;
        break;
      case 'foro_competente':
        specificClauseRisk += 5;
        break;
    }
  }

  // Obligation deadline risks
  let obligationRisk = 0;
  for (const o of obligations) {
    const days = daysUntil(o.deadline);
    if (days < 0) {
      obligationRisk += 5;
    } else if (days <= 7) {
      obligationRisk += 3;
    }
  }

  return {
    renewal_risk: renewalRisk,
    payment_risk: paymentRisk,
    duration_risk: durationRisk,
    clause_risk: clauseRisk,
    specific_clause_risk: specificClauseRisk,
    obligation_risk: obligationRisk,
  };
}

// ── Step 3: AI clause assessment ────────────────────────────────────────────

async function assessRiskyClauses(clauses: ClauseRow[]): Promise<ClauseAssessment[]> {
  const risky = clauses.filter((c) => riskAtLeast(c.risk_level, 'high'));
  if (!risky.length) return [];

  const clauseSummaries = risky.map((c) => ({
    clause_type: c.clause_type,
    risk_level: c.risk_level,
    summary: c.summary || c.title || c.original_text || 'N/A',
  }));

  try {
    const raw = await callInference(
      CLAUSE_RISK_SYSTEM_PROMPT,
      JSON.stringify(clauseSummaries),
      { maxTokens: 2048 },
    );
    const parsed = parseInferenceJSON(raw) as ClauseAssessmentResponse;
    return parsed.clause_assessments || [];
  } catch {
    return [];
  }
}

// ── Step 5: Create alerts ───────────────────────────────────────────────────

function priorityFromDays(days: number): string {
  if (days < 0) return 'urgent';
  if (days <= 7) return 'high';
  if (days <= 14) return 'medium';
  return 'low';
}

function buildAlerts(
  contract: ContractRow,
  contractId: string,
  companyId: string,
  riskScore: number,
  obligations: ObligationRow[],
  milestones: MilestoneRow[],
): AlertRow[] {
  const now = isoNow();
  const alerts: AlertRow[] = [];

  if (riskScore >= 70) {
    alerts.push({
      company_id: companyId,
      type: 'high_risk_contract',
      title: 'Contratto ad alto rischio rilevato',
      message: `Il contratto ha ottenuto un punteggio di rischio di ${riskScore}/100. Si consiglia una revisione legale immediata.`,
      priority: 'urgent',
      related_entity_type: 'contract',
      related_entity_id: contractId,
      created_at: now,
    });
  }

  if (contract.auto_renewal && contract.renewal_notice_days == null) {
    alerts.push({
      company_id: companyId,
      type: 'auto_renewal_warning',
      title: 'Rinnovo automatico silenzioso',
      message: 'Il contratto prevede un rinnovo automatico senza un periodo di preavviso definito. Rischio di rinnovo involontario.',
      priority: 'high',
      related_entity_type: 'contract',
      related_entity_id: contractId,
      created_at: now,
    });
  }

  for (const o of obligations) {
    const days = daysUntil(o.deadline);
    if (days <= 30) {
      alerts.push({
        company_id: companyId,
        type: 'obligation_deadline',
        title: days < 0
          ? `Obbligo scaduto: ${o.description?.slice(0, 60) || 'N/D'}`
          : `Scadenza obbligo tra ${days} giorni`,
        message: `Obbligo: "${o.description || 'N/D'}". Scadenza: ${o.deadline}.`,
        priority: priorityFromDays(days),
        related_entity_type: 'contract',
        related_entity_id: contractId,
        created_at: now,
      });
    }
  }

  for (const m of milestones) {
    const days = daysUntil(m.due_date);
    if (days <= 30) {
      alerts.push({
        company_id: companyId,
        type: 'milestone_approaching',
        title: `Milestone in avvicinamento: ${m.title?.slice(0, 60) || 'N/D'}`,
        message: `Milestone "${m.title || 'N/D'}" in scadenza il ${m.due_date}.${m.amount != null ? ` Importo: €${m.amount}` : ''}`,
        priority: 'medium',
        related_entity_type: 'contract',
        related_entity_id: contractId,
        created_at: now,
      });
    }
  }

  return alerts;
}

async function insertAlerts(alerts: AlertRow[]): Promise<number> {
  if (!alerts.length) return 0;
  const { error } = await supabase.from('alerts').insert(alerts);
  if (error) throw new Error(`Failed to insert alerts: ${error.message}`);
  return alerts.length;
}

// ── Step 5b: Update contract with risk results ──────────────────────────────

async function updateContractRisk(contractId: string, riskScore: number, riskLbl: string, riskDetails: RiskDetails): Promise<void> {
  const { error } = await supabase
    .from('contracts')
    .update({
      risk_score: riskScore,
      risk_label: riskLbl,
      risk_details: riskDetails,
      status: 'analyzed',
      updated_at: isoNow(),
    })
    .eq('id', contractId);
  if (error) throw new Error(`Failed to update contract risk: ${error.message}`);
}

// ── Main handler ────────────────────────────────────────────────────────────

/**
 * Compute risk score for a contract that has already been extracted.
 */
async function handler(input: HandlerInput): Promise<HandlerResult> {
  const { contract_id, company_id } = input;

  if (!contract_id) throw new Error('Missing required field: contract_id');
  if (!company_id) throw new Error('Missing required field: company_id');

  // Step 1 — Fetch all contract data from Supabase
  const { contract, clauses, obligations, milestones } = await fetchContractData(contract_id);

  // Step 2 — Rules-based scoring
  const ruleScores = computeRuleScores(contract, clauses, obligations);
  const rawTotal = Object.values(ruleScores).reduce((sum: number, v: number) => sum + v, 0);
  const riskScore = clamp(rawTotal, 0, 100);

  // Step 3 — AI-powered clause assessment (only for high/critical clauses)
  const clauseAssessments = await assessRiskyClauses(clauses);

  // Step 4 — Risk label
  const riskLbl = riskLabel(riskScore);

  // Build risk details payload
  const riskDetails: RiskDetails = {
    rule_scores: ruleScores,
    clause_assessments: clauseAssessments,
    total: riskScore,
  };

  // Step 5 — Persist results and create alerts
  const writeErrors: string[] = [];

  try {
    await updateContractRisk(contract_id, riskScore, riskLbl, riskDetails);
  } catch (err: unknown) {
    writeErrors.push((err as Error).message);
  }

  let alertsCreated = 0;
  try {
    const alerts = buildAlerts(contract, contract_id, company_id, riskScore, obligations, milestones);
    alertsCreated = await insertAlerts(alerts);
  } catch (err: unknown) {
    writeErrors.push((err as Error).message);
  }

  // Step 6 — Return result
  const result: HandlerResult = {
    risk_score: riskScore,
    risk_label: riskLbl,
    risk_details: riskDetails,
    alerts_created: alertsCreated,
  };

  if (writeErrors.length) {
    result.write_errors = writeErrors;
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
