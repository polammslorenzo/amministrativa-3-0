# Correzioni applicate — 27 agosto 2026

Suite di test: 15 superati, 0 falliti (erano 13, ne ho aggiunti 2 sulle origini).
Sintassi verificata su dashboard, quattro moduli, bridge, script e Edge Function.
Scansione segreti superata.

---

## Da fare a mano sul progetto Supabase e OpenAI

Le correzioni al codice non bastano. Questi tre passaggi restano tuoi.

1. **Limite di spesa sul progetto OpenAI.** Due minuti, e mette un tetto al
   danno qualunque cosa vada storta. Da fare per primo.
2. **Secret `ALLOWED_ORIGINS`** valorizzato con la sola origine GitHub Pages in
   uso, per esempio `https://nomeutente.github.io`. Senza questo valore la
   funzione corretta ammette soltanto `localhost`, quindi il sito pubblicato
   smette di funzionare finché non lo imposti.
3. **Non impostare `ALLOW_FILE_ORIGIN`** in produzione. Serve solo se vuoi
   continuare ad aprire `index.html` con doppio clic durante lo sviluppo.

Poi ripubblica la funzione:

```bash
supabase secrets set ALLOWED_ORIGINS=https://NOMEUTENTE.github.io
supabase functions deploy agent --no-verify-jwt
```

---

## supabase/functions/agent/index.ts

**`originAllowed` ammetteva tre categorie di chiamanti non previsti.**
`if (!origin) return true` accettava qualunque richiesta priva di intestazione
`Origin`, cioè ogni chiamata non fatta da un browser. `if (origin === "null")`
accettava `file://` ma anche gli iframe in sandbox. Il ripiego finale accettava
qualunque dominio `*.github.io` quando `ALLOWED_ORIGINS` non era configurato.
Ora: Origin assente rifiutato, `null` solo con `ALLOW_FILE_ORIGIN=1`, e senza
`ALLOWED_ORIGINS` resta ammesso soltanto lo sviluppo locale.
`githubPagesOrigin` è stata rimossa perché non più usata.

**`rateBuckets` cresceva senza limite.** Le chiavi venivano filtrate solo quando
rilette, mai eliminate: in un'istanza Edge di lunga vita la Map accumulava una
voce per ogni combinazione IP/origine mai vista. Aggiunta una passata di pulizia
oltre le 500 chiavi.

**`detail: "low"` su `input_file`.** Non è un parametro della Responses API per i
file, appartiene a `input_image`. Rimosso.

## assets/workflow.js

**`save()` poteva interrompere l'applicazione.** `load()` aveva un try/catch,
`save()` no. A quota `localStorage` esaurita l'eccezione risaliva la catena e
bloccava il flusso che l'aveva chiamata. Ora l'errore viene assorbito, la pratica
resta in memoria per la sessione e la dashboard mostra `MEMORIA PIENA` nel badge
di stato. Il rischio è concreto: `sanitizeModuleData` ammette 20.000 caratteri
per campo senza limitare il numero di campi, moltiplicato per quattro moduli.

**Il PG dell'esposto non arrivava mai alla dashboard.** `updateCommonPractice`
leggeva `data["pgEsposto"]`, ma nel modulo `riscontro-esposto.html` il campo ha
`id="pgE"`; `pgEsposto` non esiste in quel file. Di conseguenza «ID pratica» e
«Protocollo» del pannello destro restavano vuoti per tutto il percorso Riscontro
Esposto, e il Revisore non lo segnalava perché non controlla quei due campi.
Corretto in `pgE`; `protocol` ora punta a `pgR`, che esiste, invece di duplicare
lo stesso campo di `id`.

**`postMessage` con bersaglio `"*"`.** I messaggi di idratazione trasportano
`practice` ed `extraction`, cioè nomi e indirizzi dei cittadini. Fuori da
`file://` il bersaglio è ora `location.origin`.

## index.html

**Il controllo MIME rifiutava PDF validi.** `file.type !== "application/pdf"`
scartava i file per cui il browser non dichiara il tipo: succede su Android e con
allegati provenienti da Drive o dalla posta. Visto che vuoi usare la scheda anche
da cellulare, era la correzione più urgente dopo quelle di sicurezza. Ora
l'estensione è il criterio e il MIME è accettato se vuoto o generico. Stessa
correzione in `assets/module-ai-bridge.js`.

**Errore silenzioso in `analyzePractice`.** `await readWorkflowDocument()` stava
fuori dal `try`: se la lettura falliva non compariva nessun avviso, il pulsante
restava attivo e la riga «sta leggendo» non si spegneva. Spostata dentro.

**`A.reset()` cancellava senza chiedere.** `newPractice()` chiedeva conferma,
`analyzePractice` no: rianalizzare un PDF azzerava bozza, estrazione e bozze dei
moduli in silenzio. Ora chiede conferma, ma solo se c'è davvero del lavoro da
perdere.

**`syncUI()` sovrascriveva i campi in compilazione.** La guardia su
`document.activeElement` c'era su `operatorNotes` e `wfDraft` ma non sugli altri
quattro. Poiché i moduli inviano `practice-update` ogni 120 ms, il campo su cui
stavi scrivendo poteva azzerarsi. Guardia estesa a tutti.

**Autosave solo sulla proposta.** Gli altri campi si salvavano solo col pulsante.
Aggiunto il salvataggio in uscita dal campo.

**Nessuna guardia se `config.js` o `workflow.js` non caricano.** `window.ADMIN3`
restava `undefined` e ogni clic produceva un errore incomprensibile. Ora compare
un messaggio esplicito.

## tests/agent.test.mjs

Il test «apertura diretta file:// è ammessa» verificava il comportamento che ho
chiuso: ora verifica che `Origin: null` sia rifiutato senza `ALLOW_FILE_ORIGIN` e
ammesso con. Aggiunti due test: richiesta senza `Origin` rifiutata, e nessuna
apertura a `*.github.io` quando `ALLOWED_ORIGINS` è vuoto.

## README.md

Corretta la sezione sui limiti, che descriveva le origini larghe di prima, e la
sezione sullo sviluppo locale, che consigliava il doppio clic ora subordinato a
`ALLOW_FILE_ORIGIN`. Aggiunta una sezione esplicita sul fatto che la funzione
non è autenticata.

---

## Non ho toccato

I quattro moduli operativi, se non attraverso il bridge condiviso. Sono grossi e
funzionanti, e nessuno dei difetti trovati stava dentro di loro.
