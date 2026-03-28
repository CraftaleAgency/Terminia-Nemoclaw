// ─── NemoClaw API Type Definitions ──────────────────────────────────────────
// JSDoc typedefs mirroring the TypeScript interfaces in
//   Terminia-Frontend/types/terminia.ts
// This is the SINGLE SOURCE OF TRUTH on the backend side.
// ────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// API Request Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AnalyzeContractRequest
 * @property {string} [document_text]
 * @property {string} [document_base64]
 * @property {string} [content_type]
 * @property {string} company_id
 * @property {string} [contract_id]
 */

/**
 * @typedef {Object} VerifyOSINTRequest
 * @property {string} [vat_number]
 * @property {string} [fiscal_code]
 * @property {string} [company_name]
 * @property {string} [counterpart_id]
 */

/**
 * @typedef {Object} ChatRequest
 * @property {ChatMessage[]} messages
 * @property {string} company_id
 * @property {boolean} [stream]
 */

/**
 * @typedef {Object} OCRRequest
 * @property {string} image_base64
 */

// ═══════════════════════════════════════════════════════════════════════════
// API Response Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/analyze → res.json()
 * @typedef {Object} AnalyzeContractResponse
 * @property {ContractClassification} classification
 * @property {ContractExtraction} extraction
 * @property {ContractRisk} risk
 * @property {string|null} [counterpart_id]
 * @property {string[]} [warnings]
 */

/**
 * POST /api/osint → res.json()
 * @typedef {Object} VerifyOSINTResponse
 * @property {VIESResult|null} vies
 * @property {FiscalCodeResult|null} fiscal_code
 * @property {ANACResult|null} anac
 * @property {ReliabilityScore} reliability
 */

/**
 * POST /api/chat (stream: false) → res.json()
 * @typedef {Object} ChatResponse
 * @property {string} content
 */

/**
 * POST /api/chat (stream: true) — SSE data chunks
 * @typedef {Object} ChatStreamChunk
 * @property {string} [content]
 * @property {string} [error]
 */

/**
 * POST /api/ocr → res.json()
 * @typedef {Object} OCRResponse
 * @property {string} text
 * @property {string} format
 */

// ═══════════════════════════════════════════════════════════════════════════
// Contract Analysis Domain Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ContractClassification
 * @property {string} contract_type
 * @property {string|null} [counterpart_type]
 * @property {string} [language]
 * @property {number} confidence
 * @property {{company?: string, counterpart?: CounterpartInfo}|null} [parties]
 * @property {string|null} [summary_it]
 */

/**
 * @typedef {Object} CounterpartInfo
 * @property {string} [name]
 * @property {string} [vat]
 * @property {string} [cf]
 * @property {string} [role]
 */

/**
 * @typedef {Object} ContractExtraction
 * @property {ExtractionDates|null} [dates]
 * @property {ExtractionValue|null} [value]
 * @property {ExtractionRenewal|null} [renewal]
 * @property {ExtractionClause[]} clauses
 * @property {ExtractionObligation[]} obligations
 * @property {ExtractionMilestone[]} milestones
 */

/**
 * @typedef {Object} ExtractionDates
 * @property {string|null} [start_date]
 * @property {string|null} [end_date]
 * @property {string|null} [signing_date]
 * @property {number|null} [notice_period_days]
 */

/**
 * @typedef {Object} ExtractionValue
 * @property {number|null} [total_value]
 * @property {string} [currency]
 * @property {number|null} [payment_terms_days]
 * @property {string|null} [payment_method]
 */

/**
 * @typedef {Object} ExtractionRenewal
 * @property {boolean} [auto_renewal]
 * @property {number|null} [renewal_notice_days]
 * @property {number|null} [max_renewals]
 * @property {number|null} [renewal_duration_months]
 */

/**
 * @typedef {Object} ExtractionClause
 * @property {string} [clause_type]
 * @property {string} [title]
 * @property {string} [summary_it]
 * @property {string} [risk_level]
 * @property {string|null} [risk_reason]
 * @property {string} [original_text]
 */

/**
 * @typedef {Object} ExtractionObligation
 * @property {string} description
 * @property {string} [responsible_party]
 * @property {string|null} [deadline]
 * @property {boolean} [recurring]
 * @property {string|null} [frequency]
 */

/**
 * @typedef {Object} ExtractionMilestone
 * @property {string} [title]
 * @property {string|null} [due_date]
 * @property {number|null} [amount]
 * @property {string} [description]
 */

// ═══════════════════════════════════════════════════════════════════════════
// Contract Risk Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ContractRisk
 * @property {number|null} risk_score
 * @property {string|null} [risk_label]
 * @property {Object<string, RiskDimension>|null} [dimensions]
 * @property {RiskItem[]} top_risks
 * @property {string[]} recommendations_it
 */

/**
 * @typedef {Object} RiskDimension
 * @property {number} score
 * @property {string} note
 */

/**
 * @typedef {Object} RiskItem
 * @property {string} title
 * @property {string} description
 * @property {string} severity
 */

// ═══════════════════════════════════════════════════════════════════════════
// OSINT / Verification Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} VIESResult
 * @property {boolean|null} valid
 * @property {string} [country_code]
 * @property {string} [vat_number]
 * @property {string|null} [name]
 * @property {string|null} [address]
 * @property {string} [request_date]
 * @property {string|null} [error]
 */

/**
 * @typedef {Object} FiscalCodeResult
 * @property {boolean} valid
 * @property {boolean} checksum_ok
 * @property {FiscalCodeExtracted|null} [extracted]
 * @property {string[]} errors
 */

/**
 * @typedef {Object} FiscalCodeExtracted
 * @property {string} surname_code
 * @property {string} name_code
 * @property {string} birth_year
 * @property {number|null} birth_month
 * @property {number} birth_day
 * @property {string} gender
 * @property {string} municipality_code
 */

/**
 * @typedef {Object} ANACResult
 * @property {boolean} checked
 * @property {boolean} annotations_found
 * @property {ANACAnnotation[]} annotations
 * @property {string|null} [error]
 */

/**
 * @typedef {Object} ANACAnnotation
 * @property {string} type
 * @property {string|null} date
 * @property {string} description
 * @property {string} reference
 */

/**
 * @typedef {Object} ReliabilityScore
 * @property {number} score
 * @property {ReliabilityDimensions} dimensions
 */

/**
 * @typedef {Object} ReliabilityDimensions
 * @property {number} legal
 * @property {number} contributory
 * @property {number} reputation
 * @property {number} solidity
 * @property {number} consistency
 */

// ═══════════════════════════════════════════════════════════════════════════
// Scoring
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MatchScoreDimensions
 * @property {number} sector
 * @property {number} size
 * @property {number} geo
 * @property {number} requirements
 * @property {number} feasibility
 */

// ═══════════════════════════════════════════════════════════════════════════
// Chat
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} ChatMessage
 * @property {'user'|'assistant'|'system'} role
 * @property {string} content
 */

// ═══════════════════════════════════════════════════════════════════════════
// Error
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} NemoClawErrorResponse
 * @property {string} error
 * @property {string} [details]
 */

export default {}
