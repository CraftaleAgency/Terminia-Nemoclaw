import { Router } from 'express'
import supabase from '../lib/supabase.js'
import { chatCompletion, chatCompletionStream } from '../lib/inference.js'

const router = Router()

const SYSTEM_PROMPT = `Sei Terminia AI, assistente legale e gestionale per PMI italiane. Rispondi in italiano, in modo professionale ma accessibile.

Le tue competenze:
- Analisi contratti e clausole
- Verifica affidabilità controparti (VIES, Codice Fiscale, ANAC)
- Scadenze e obblighi contrattuali
- Normativa italiana (Codice Civile, D.Lgs. 50/2016, GDPR)
- Bandi di gara e appalti pubblici

Regole:
- Rispondi sempre in italiano
- Sii conciso ma preciso
- Cita articoli di legge quando rilevante
- Se non sei sicuro, dillo esplicitamente
- Non inventare dati o numeri
- Usa formato markdown per strutturare le risposte`

router.post('/', async (req, res) => {
  const { messages, company_id, stream } = req.body

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages è obbligatorio' })
  }

  // Build company context
  let contextNote = ''
  if (company_id) {
    try {
      const [contracts, alerts] = await Promise.all([
        supabase.from('contracts').select('id', { count: 'exact', head: true }).eq('company_id', company_id),
        supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('company_id', company_id).eq('resolved', false),
      ])
      const contractCount = contracts.count ?? 0
      const alertCount = alerts.count ?? 0
      if (contractCount || alertCount) {
        contextNote = `\n\nContesto azienda: ${contractCount} contratti, ${alertCount} alert attivi.`
      }
    } catch {
      // non-fatal
    }
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT + contextNote },
    ...messages,
  ]

  // Non-streaming: return plain JSON response
  if (stream === false) {
    try {
      const content = await chatCompletion({ messages: fullMessages })
      return res.json({ content })
    } catch (err) {
      return res.status(502).json({ error: err.message })
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
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
  }

  res.end()
})

export default router
