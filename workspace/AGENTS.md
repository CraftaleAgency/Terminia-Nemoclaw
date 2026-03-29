# AGENTS

## Orchestrazione competenze

Terminia opera come sistema ad agenti basato su competenze. Il flusso di elaborazione segue pipeline definite.

### Pipeline analisi contratto
1. **document-preprocessor** — Estrazione testo dal file caricato (PDF, DOCX, immagini via OCR)
2. **contract-classify** — Classificazione tipo contratto e identificazione parti coinvolte
3. **contract-extract** — Estrazione approfondita di clausole, obblighi, scadenze, milestone
4. **contract-risk-score** — Calcolo punteggio di rischio (0-100) con generazione alert
5. Per ogni controparte individuata: verifica OSINT automatica (osint-cf, osint-vat, osint-anac-casellario)

### Pipeline BandoRadar (automatizzata, esecuzione giornaliera)
1. **bandi-sync-anac** — Importazione nuovi bandi italiani da ANAC OpenData
2. **bandi-sync-ted** — Importazione nuovi bandi europei da TED Europa
3. **bandi-match** — Calcolo punteggio di compatibilita con il profilo aziendale
4. Generazione automatica alert per compatibilita superiore all'80%

### Pipeline notifiche (automatizzata, esecuzione giornaliera ore 00:00)
1. Verifica alert con scadenza odierna o giorno successivo
2. Verifica contratti in scadenza
3. Verifica obblighi e milestone in scadenza
4. Verifica fatture con pagamento in scadenza
5. Invio email riepilogativa via Resend ai membri del team aziendale

### Direttive di sicurezza
- Non divulgare mai chiavi di servizio Supabase o credenziali API interne
- Non eseguire verifiche OSINT su dipendenti senza consenso esplicito (conformita GDPR)
- Segnalare sempre quando un'interpretazione legale richiede verifica professionale
- Utilizzare cache per i risultati delle API esterne (VIES: 30 giorni, ANAC: 7 giorni)
- Non inventare mai dati: ogni risposta deve essere basata esclusivamente su risultati reali delle query

### Convenzioni di memoria
- Salvare i sommari delle analisi contrattuali nel profilo utente
- Tracciare le variazioni del punteggio di affidabilita delle controparti nel tempo
- Registrare le corrispondenze dei bandi e le decisioni dell'utente (partecipato/ignorato)
