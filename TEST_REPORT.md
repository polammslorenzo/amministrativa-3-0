# Rapporto di collaudo

Data: 19 agosto 2026

## Esito

- Test automatici locali: 13 superati, 0 falliti.
- Chiamata reale `extractor`: superata con output conforme allo schema JSON.
- Chiamata reale `writer`: superata con testo semplice privo di asterischi e Markdown.
- Progetto Supabase creato in `eu-central-1` e risultato `ACTIVE_HEALTHY`.
- Edge Function `agent` versione 6 pubblicata e risultata `ACTIVE`.
- Secret `OPENAI_API_KEY` configurato nel backend senza esposizione del valore.
- Chiamate online alla funzione pubblicata: `extractor` e `writer` entrambe superate con HTTP 200.
- Chiamata online `extractor` con origine `file://` (`Origin: null`): superata con HTTP 200 e intestazione CORS corretta.
- Chiamata online `extractor` con PDF A4 valido di 12 pagine e circa 30.000 caratteri: superata con HTTP 200 e campi corretti.
- Chiamata online `writer` dopo la correzione: superata con HTTP 200 e testo privo di Markdown.
- Chiamata online del nuovo Estrattore con `module: auto`: superata con HTTP 200, percorso `esposto`, confidenza alta, motivazione, sintesi, fatti chiave e informazioni mancanti.
- Chiamata online del nuovo Redattore strutturato: superata con HTTP 200, sintesi, proposta testuale, suggerimenti limitati al completamento dati, informazioni mancanti e domanda successiva.
- Collaudo visivo della nuova dashboard nel browser locale: superato senza errori in console.
- Sincronizzazione reale modulo Pareri Edili → dati comuni della dashboard: superata.
- Verifica sintattica JavaScript di dashboard e quattro moduli: superata.
- Verifica sintattica script di deploy: superata.
- Scansione segreti del progetto: superata.

## Copertura

I test verificano:

- routing degli agenti `extractor` e `writer`;
- classificazione automatica e routing dei quattro moduli;
- conferma o correzione manuale del percorso suggerito;
- invio PDF come `input_file` Base64 alla Responses API;
- Structured Outputs con JSON Schema rigoroso;
- rilevamento di risposte incomplete o troncate, retry automatico singolo e validazione server dello schema;
- rimozione di Markdown e asterischi dal testo del Redattore;
- output strutturato del Redattore con sintesi, proposta, suggerimenti, informazioni mancanti e domanda utile;
- CORS per GitHub Pages, localhost e apertura diretta `file://`;
- bridge `postMessage` tra dashboard e iframe quando Chrome blocca l'accesso diretto tra origini `null`;
- rifiuto delle richieste bridge provenienti da finestre diverse dall'iframe operativo;
- sincronizzazione dei campi modificati nel modulo con la pratica comune;
- azzeramento completo di estrazione, redazione e bozze quando si avvia una nuova pratica;
- rifiuto di origini non autorizzate;
- rifiuto di formati documento non validi;
- uso dell'URL completo della funzione senza doppio `/agent`;
- assenza di chiavi incorporate nei file del progetto.

## Stato Supabase

Progetto operativo:

```text
Nome: Amministrativa 3.0
Project ref: xebhjdqufgdekxcoebiy
Regione: eu-central-1 (Francoforte)
Stato progetto: ACTIVE_HEALTHY
Funzione: agent, versione 6, ACTIVE
URL: https://xebhjdqufgdekxcoebiy.supabase.co/functions/v1/agent
```

`config.js` è già collegato a questo URL. Il valore di `OPENAI_API_KEY` non compare nei file del progetto né nello ZIP.
