// ─── NemoClaw API Type Definitions ──────────────────────────────────────────
// TypeScript interfaces mirroring the frontend types in
//   Terminia-Frontend/types/terminia.ts
// This is the SINGLE SOURCE OF TRUTH on the backend side.
// ────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// Express augmentation
// ═══════════════════════════════════════════════════════════════════════════

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        email: string
        company_id: string | null
        role: string
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Chat
// ═══════════════════════════════════════════════════════════════════════════

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

// ═══════════════════════════════════════════════════════════════════════════
// API Request Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalyzeContractRequest {
  document_text?: string
  document_base64?: string
  content_type?: string
  company_id: string
  contract_id?: string
}

export interface VerifyOSINTRequest {
  vat_number?: string
  fiscal_code?: string
  company_name?: string
  counterpart_id?: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  company_id: string
  stream?: boolean
}

export interface OCRRequest {
  image_base64: string
}

// ═══════════════════════════════════════════════════════════════════════════
// API Response Types
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalyzeContractResponse {
  classification: ContractClassification
  extraction: ContractExtraction
  risk: ContractRisk
  counterpart_id?: string | null
  warnings?: string[]
  source_text?: string
  registration_profile?: RegistrationProfile
}

export interface RegistrationProfile {
  account_type_hint?: 'person' | 'company' | 'unknown'
  document_kind?: string | null
  full_name?: string | null
  company_name?: string | null
  fiscal_code?: string | null
  vat_number?: string | null
  city?: string | null
  sector?: string | null
  confidence?: number | null
}

export interface VerifyOSINTResponse {
  vies: VIESResult | null
  fiscal_code: FiscalCodeResult | null
  anac: ANACResult | null
  reliability: ReliabilityScore
}

export interface ChatResponse {
  content: string
}

export interface ChatStreamChunk {
  content?: string
  error?: string
}

export interface OCRResponse {
  text: string
  format: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Analysis Domain Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ContractClassification {
  contract_type: string
  counterpart_type?: string | null
  language?: string
  confidence: number
  parties?: { company?: string; counterpart?: CounterpartInfo } | null
  summary_it?: string | null
}

export interface CounterpartInfo {
  name?: string
  vat?: string
  cf?: string
  role?: string
}

export interface ContractExtraction {
  dates?: ExtractionDates | null
  value?: ExtractionValue | null
  renewal?: ExtractionRenewal | null
  clauses: ExtractionClause[]
  obligations: ExtractionObligation[]
  milestones: ExtractionMilestone[]
}

export interface ExtractionDates {
  start_date?: string | null
  end_date?: string | null
  signing_date?: string | null
  notice_period_days?: number | null
}

export interface ExtractionValue {
  total_value?: number | null
  currency?: string
  payment_terms_days?: number | null
  payment_method?: string | null
}

export interface ExtractionRenewal {
  auto_renewal?: boolean
  renewal_notice_days?: number | null
  max_renewals?: number | null
  renewal_duration_months?: number | null
}

export interface ExtractionClause {
  clause_type?: string
  title?: string
  summary_it?: string
  risk_level?: string
  risk_reason?: string | null
  original_text?: string
}

export interface ExtractionObligation {
  description: string
  responsible_party?: string
  deadline?: string | null
  recurring?: boolean
  frequency?: string | null
}

export interface ExtractionMilestone {
  title?: string
  due_date?: string | null
  amount?: number | null
  description?: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Contract Risk Types
// ═══════════════════════════════════════════════════════════════════════════

export interface ContractRisk {
  risk_score: number | null
  risk_label?: string | null
  dimensions?: Record<string, RiskDimension> | null
  top_risks: RiskItem[]
  recommendations_it: string[]
}

export interface RiskDimension {
  score: number
  note: string
}

export interface RiskItem {
  title: string
  description: string
  severity: string
}

// ═══════════════════════════════════════════════════════════════════════════
// OSINT / Verification Types
// ═══════════════════════════════════════════════════════════════════════════

export interface VIESResult {
  valid: boolean | null
  country_code?: string
  vat_number?: string
  name?: string | null
  address?: string | null
  request_date?: string
  error?: string | null
}

export interface FiscalCodeResult {
  valid: boolean
  checksum_ok: boolean
  extracted?: FiscalCodeExtracted | null
  errors: string[]
}

export interface FiscalCodeExtracted {
  surname_code: string
  name_code: string
  birth_year: string
  birth_month: number | null
  birth_day: number
  gender: string
  municipality_code: string
}

export interface ANACResult {
  checked: boolean
  annotations_found: boolean
  annotations: ANACAnnotation[]
  error?: string | null
}

export interface ANACAnnotation {
  type: string
  date: string | null
  description: string
  reference: string
}

// ═══════════════════════════════════════════════════════════════════════════
// Reliability
// ═══════════════════════════════════════════════════════════════════════════

export interface ReliabilityScore {
  score: number
  dimensions: ReliabilityDimensions
}

export interface ReliabilityDimensions {
  legal: number
  contributory: number
  reputation: number
  solidity: number
  consistency: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════════════════════

export interface MatchScoreDimensions {
  sector: number
  size: number
  geo: number
  requirements: number
  feasibility: number
}

// ═══════════════════════════════════════════════════════════════════════════
// Error
// ═══════════════════════════════════════════════════════════════════════════

export interface NemoClawErrorResponse {
  error: string
  details?: string
}
