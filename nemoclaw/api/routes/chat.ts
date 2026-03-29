import type { Request, Response } from 'express'
import type { ChatRequest, ChatResponse } from '../types.ts'
import { Router } from 'express'
import { chatCompletion, chatCompletionStream } from '../lib/inference.ts'
import { orchestrate } from '../lib/orchestrator.ts'

const router = Router()

// ── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sei Terminia AI, l'assistente agentico di NemoClaw per PMI italiane. Rispondi in italiano, in modo professionale ma accessibile.

Sei un orchestratore intelligente: quando l'utente chiede dati, azioni o verifiche, i risultati reali dalla piattaforma vengono iniettati nel contesto. Usa SEMPRE quei dati — non inventare nulla.

Le tue competenze:
- Analisi contratti e clausole (OCR automatico per immagini/PDF)
- Verifica affidabilità controparti (VIES, Codice Fiscale, ANAC Casellario)
- Scadenze e obblighi contrattuali
- Normativa italiana (Codice Civile, D.Lgs. 50/2016, GDPR)
- Bandi di gara e appalti pubblici (ANAC OCDS, TED Europa)
- Fatturazione e monitoraggio pagamenti
- Gestione dipendenti e contratti di lavoro
- Domande informative su diritto commerciale, tributario, del lavoro

Azioni disponibili dalla chat (puoi eseguirle direttamente quando l'utente lo chiede):
- 🔍 **Verifica controparte** — chiedi P.IVA o Codice Fiscale e lancio la verifica OSINT
- ✅ **Risolvi alert** — posso segnare un alert come risolto
- ⚠️ **Crea alert** — posso creare un promemoria/alert personalizzato
- 📋 **Cerca bandi esterni** — posso cercare su ANAC e TED Europa in tempo reale
- 📝 **Aggiorna stato contratto** — posso sospendere/attivare/terminare un contratto
- 💰 **Aggiorna stato fattura** — posso segnare una fattura come pagata/scaduta

Pagine della piattaforma (suggeriscile quando pertinente):
- 📄 Carica un contratto → /dashboard/contracts/new
- 📊 Dashboard → /dashboard
- ⚠️ Alerts → /dashboard/alerts
- 🎯 BandoRadar → /dashboard/bandi
- 💰 Fatture → /dashboard/invoices
- 👥 Controparti → /dashboard/counterparts
- 👤 Dipendenti → /dashboard/employees
- 📈 Analytics → /dashboard/analytics

Regole:
- Rispondi sempre in italiano
- Usa i DATI REALI iniettati, cita nomi/importi/date/punteggi specifici
- Se un'azione è stata eseguita, conferma con dettagli
- Sii conciso ma preciso, usa markdown per strutturare
- Cita articoli di legge quando rilevante
- Se non sei sicuro, dillo esplicitamente
- Per domande generiche/informative rispondi liberamente con le tue conoscenze`

router.post('/', async (req: Request<object, ChatResponse, ChatRequest>, res: Response) => {
  const { messages, company_id, stream } = req.body

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages è obbligatorio' })
  }

  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || ''

  // Build recent conversation context for the orchestrator
  const recentMessages = messages.slice(-6)
  const conversationContext = recentMessages
    .map(m => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.content.slice(0, 200)}`)
    .join('\n')

  // ── Orchestrator: classify intent + execute tools ─────────────────────────
  let contextBlock = ''
  try {
    if (company_id) {
      const result = await orchestrate(lastUserMessage, company_id, conversationContext)
      contextBlock = result.contextBlock
    }
  } catch {
    // Non-fatal — proceed without tool data
  }

  const fullMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT + contextBlock },
    ...messages,
  ]

  // Non-streaming JSON response
  if (stream === false) {
    try {
      const content = await chatCompletion({ messages: fullMessages })
      return res.json({ content })
    } catch (err) {
      return res.status(502).json({ error: (err as Error).message })
    }
  }

  // SSE streaming response (default)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  try {
    for await (const chunk of chatCompletionStream({ messages: fullMessages })) {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
    }
    res.write('data: [DONE]\n\n')
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
  }

  res.end()
})

export default router
