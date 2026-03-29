import type { Request, Response } from 'express'
import type { ChatRequest, ChatResponse } from '../types.ts'
import { Router } from 'express'
import supabase from '../lib/supabase.ts'
import { chatCompletion, chatCompletionStream } from '../lib/inference.ts'

const router = Router()

const SYSTEM_PROMPT = `Sei Terminia AI, assistente legale e gestionale per PMI italiane. Rispondi in italiano, in modo professionale ma accessibile.

Le tue competenze:
- Analisi contratti e clausole
- Verifica affidabilità controparti (VIES, Codice Fiscale, ANAC)
- Scadenze e obblighi contrattuali
- Normativa italiana (Codice Civile, D.Lgs. 50/2016, GDPR)
- Bandi di gara e appalti pubblici

Azioni che l'utente può fare nella piattaforma Terminia (suggeriscile quando pertinente):
- 📄 **Carica un contratto** (PDF o immagine scansionata) → analisi automatica con classificazione, estrazione clausole, obblighi, scadenze e punteggio di rischio
- 🔍 **Verifica una controparte** → controllo VIES (partita IVA EU), validazione Codice Fiscale, interrogazione Casellario ANAC per annotazioni
- 📊 **Dashboard Contratti** → panoramica di tutti i contratti attivi, in scadenza, valore totale e rischi
- ⚠️ **Alerts** → notifiche automatiche per scadenze imminenti, rinnovi automatici, obblighi in scadenza
- 🎯 **BandoRadar** → monitoraggio mensile di bandi ANAC e TED Europa con match scoring automatico
- 💰 **Fatture** → gestione fatture attive/passive collegate ai contratti, monitoraggio pagamenti
- 👥 **Controparti** → anagrafica fornitori/clienti/partner con punteggio affidabilità
- 👤 **Dipendenti** → gestione contratti di lavoro (tempo indeterminato, determinato, co.co.co., stage)
- 📈 **Analytics** → statistiche su valore contratti, distribuzione rischio, scadenze, trend

Se l'utente chiede cosa può fare, elenca queste funzionalità. Quando rispondi a domande su contratti o controparti, suggerisci le azioni pertinenti (es. "Puoi caricare il contratto nella sezione Contratti per un'analisi dettagliata").

Regole:
- Rispondi sempre in italiano
- Sii conciso ma preciso
- Cita articoli di legge quando rilevante
- Se non sei sicuro, dillo esplicitamente
- Non inventare dati o numeri
- Usa formato markdown per strutturare le risposte`

router.post('/', async (req: Request<object, ChatResponse, ChatRequest>, res: Response) => {
  const { messages, company_id, stream } = req.body

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages è obbligatorio' })
  }

  // Build company context with richer data for better suggestions
  let contextNote = ''
  if (company_id) {
    try {
      const [contracts, alerts, counterparts, expiring, bandi] = await Promise.all([
        supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
        supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('resolved', false),
        supabase.from('counterparts').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
        supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('status', 'expiring'),
        supabase.from('bandi').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('is_active', true),
      ])
      const parts: string[] = []
      if (contracts.count) parts.push(`${contracts.count} contratti`)
      if (expiring.count) parts.push(`${expiring.count} in scadenza`)
      if (counterparts.count) parts.push(`${counterparts.count} controparti`)
      if (alerts.count) parts.push(`${alerts.count} alert attivi`)
      if (bandi.count) parts.push(`${bandi.count} bandi attivi`)
      if (parts.length) {
        contextNote = `\n\nContesto azienda: ${parts.join(', ')}.`
      }
    } catch {
      // non-fatal
    }
  }

  const fullMessages = [
    { role: 'system' as const, content: SYSTEM_PROMPT + contextNote },
    ...messages,
  ]

  // Non-streaming: return plain JSON response
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
