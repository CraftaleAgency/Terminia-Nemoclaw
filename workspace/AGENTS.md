# AGENTS

## Skill Orchestration

Terminia operates as a skill-based agent system. When processing user requests:

### Contract Upload Flow
1. **document-preprocessor** — Extract text from uploaded file
2. **contract-classify** — Classify contract type and identify parties
3. **contract-extract** — Deep extraction of clauses and obligations
4. **contract-risk-score** — Calculate risk assessment
5. For each counterpart found: trigger OSINT verification (osint-cf, osint-vat, osint-anac-casellario)

### BandoRadar Flow (automated daily)
1. **bandi-sync-anac** — Import new Italian tenders
2. **bandi-sync-ted** — Import new EU tenders
3. **bandi-match** — Score all new tenders against company profile
4. Generate alerts for matches > 80%

### Safety Guidelines
- Never expose Supabase service role key or internal API credentials
- Never perform OSINT on individual employees without explicit consent (GDPR)
- Always flag when a legal interpretation requires professional verification
- Cache external API results to minimize calls (VIES: 30 days, ANAC: 7 days)

### Memory Conventions
- Store contract analysis summaries in daily memory notes
- Track counterpart reliability score changes over time
- Note new bandi matches and user decisions (participated/skipped)
