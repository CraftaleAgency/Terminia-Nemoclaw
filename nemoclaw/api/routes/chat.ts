import type { Request, Response } from 'express'
import type { ChatRequest, ChatResponse } from '../types.ts'
import { Router } from 'express'
import { chatCompletion, chatCompletionStream } from '../lib/inference.ts'
import { orchestrate } from '../lib/orchestrator.ts'
import supabase from '../lib/supabase.ts'

const router = Router()

// ── System Prompt ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sei Terminia AI, l'assistente professionale della piattaforma NemoClaw dedicata alle PMI italiane.
Rispondi esclusivamente in italiano, con tono formale e competente. Non utilizzare emoji nel testo.

RUOLO: Sei un orchestratore intelligente. Quando l'utente richiede dati, azioni o verifiche, i risultati reali dalla piattaforma vengono iniettati in una sezione denominata "DATI DALLA PIATTAFORMA" all'interno di questo messaggio di sistema. Devi basarti ESCLUSIVAMENTE su quei dati.

COMPETENZE:
- Analisi contratti, clausole e obblighi (OCR automatico per documenti e immagini)
- Verifica affidabilita controparti tramite OSINT (VIES, Codice Fiscale, ANAC Casellario)
- Monitoraggio scadenze, obblighi contrattuali e milestone
- Normativa italiana: Codice Civile, D.Lgs. 50/2016, GDPR, diritto commerciale e tributario
- Bandi di gara e appalti pubblici (ANAC OCDS, TED Europa)
- Fatturazione elettronica e monitoraggio pagamenti
- Gestione dipendenti e contratti di lavoro

AZIONI ESEGUIBILI DALLA CHAT:
- Verifica controparte: richiedi P.IVA o Codice Fiscale per avviare la verifica OSINT
- Risolvi alert: segna un alert come gestito
- Crea alert: crea un promemoria o alert personalizzato
- Cerca bandi esterni: ricerca su ANAC e TED Europa in tempo reale
- Aggiorna stato contratto: sospendi, attiva o termina un contratto
- Aggiorna stato fattura: segna una fattura come pagata o scaduta
- Analizza documento: l'utente puo allegare un PDF, immagine o documento per analisi diretta

PAGINE DELLA PIATTAFORMA (suggeriscile quando pertinente):
- Carica un contratto: /dashboard/contracts/new
- Dashboard: /dashboard
- Alert: /dashboard/alerts
- BandoRadar: /dashboard/bandi
- Fatture: /dashboard/invoices
- Controparti: /dashboard/counterparts
- Dipendenti: /dashboard/employees
- Analytics: /dashboard/analytics

REGOLE INDEROGABILI SULLA VERIDICITA DEI DATI:
1. Se la sezione "DATI DALLA PIATTAFORMA" e presente, usa ESCLUSIVAMENTE quei dati. Cita nomi, importi, date e punteggi specifici cosi come appaiono.
2. Se la sezione "DATI DALLA PIATTAFORMA" e ASSENTE o contiene risultati vuoti (array vuoti, count: 0, valori null), rispondi OBBLIGATORIAMENTE che non sono presenti dati per quella richiesta. Non inventare, non simulare, non ipotizzare alcun dato.
3. Per un account senza dati, rispondi: "Al momento non sono presenti [contratti/fatture/alert/etc.] nel tuo account. Puoi iniziare caricando un documento dalla sezione [link pertinente]."
4. NON generare MAI numeri, importi, date, nomi di contratti o controparti che non siano presenti nei dati iniettati. Questa regola non ammette eccezioni.
5. Se un'azione e stata eseguita con successo, confermala citando i dettagli dell'operazione.

REGOLE DI FORMATO:
- Non usare emoji. Mai.
- Usa markdown per strutturare le risposte (titoli, elenchi, grassetto per evidenziare)
- Formatta importi in EUR con separatore italiano (es. 1.234,56 EUR)
- Formatta date in DD/MM/YYYY
- Cita articoli di legge e riferimenti normativi quando rilevante
- Se non sei certo di un'interpretazione legale, indicalo esplicitamente con "Si consiglia di verificare con un professionista legale"
- Per domande generiche o informative, rispondi liberamente con le tue conoscenze giuridiche e professionali`

router.post('/', async (req: Request<object, ChatResponse, ChatRequest>, res: Response) => {
  const { messages, company_id, stream, attachment, conversation_id } = req.body as ChatRequest & {
    attachment?: { base64: string; content_type: string; filename: string }
    conversation_id?: string
  }

  if (!messages?.length) {
    return res.status(400).json({ error: 'messages è obbligatorio' })
  }

  const userId = req.user?.id

  // Persist user message if conversation_id provided
  if (conversation_id && userId) {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')
    if (lastUserMsg) {
      await supabase.from('chat_messages').insert({
        conversation_id,
        role: 'user',
        content: lastUserMsg.content,
        attachment: attachment ? { filename: attachment.filename, content_type: attachment.content_type } : null,
      })
    }
  }

  let lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || ''

  // If an attachment is present, append it to the orchestrator message
  if (attachment?.base64) {
    lastUserMessage += `\n\n[DOCUMENTO ALLEGATO: ${attachment.filename || 'documento'}, tipo: ${attachment.content_type}]\n[document_base64 disponibile per analyze_document]`
  }

  // Build recent conversation context for the orchestrator
  const recentMessages = messages.slice(-6)
  const conversationContext = recentMessages
    .map(m => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.content.slice(0, 200)}`)
    .join('\n')

  // ── Orchestrator: classify intent + execute tools ─────────────────────────
  let contextBlock = ''
  try {
    if (company_id) {
      const orchestratorMessage = attachment?.base64
        ? `${lastUserMessage}\n\n__ATTACHMENT_BASE64__:${attachment.base64}\n__ATTACHMENT_CONTENT_TYPE__:${attachment.content_type}`
        : lastUserMessage
      const result = await orchestrate(orchestratorMessage, company_id, conversationContext)
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
      // Persist assistant response
      if (conversation_id && userId) {
        await supabase.from('chat_messages').insert({
          conversation_id, role: 'assistant', content,
        })
        await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation_id)
      }
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

  let fullContent = ''
  try {
    for await (const chunk of chatCompletionStream({ messages: fullMessages })) {
      fullContent += chunk
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`)
    }
    res.write('data: [DONE]\n\n')

    // Persist complete assistant response after stream
    if (conversation_id && userId) {
      await supabase.from('chat_messages').insert({
        conversation_id, role: 'assistant', content: fullContent,
      })
      await supabase.from('conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversation_id)
    }
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
  }

  res.end()
})

export default router
