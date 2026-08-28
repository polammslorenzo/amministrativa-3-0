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

---

# Secondo giro — 29 agosto 2026

Parte dai rilievi di `RILIEVI_DEBUG.md`. Suite: 22 test superati, 0 falliti
(erano 15; i 7 nuovi sono `tests/contracts.test.mjs`). Sintassi verificata su
dashboard, quattro moduli, bridge e workflow. Scansione segreti superata.
Dashboard e modulo Sorvegliabilità provati nel browser.

## Il test che chiude la famiglia

`tests/contracts.test.mjs` non usa fixture: legge i file veri, HTML dei moduli
compreso, e verifica che le stringhe con cui i quattro strati si parlano
coincidano. Catena dei nomi di campo dell'Estrattore, sorgenti di
`updateCommonPractice`, chiavi di modulo nei sette posti, `DRAFT_KEYS`, funzioni
e id attesi dal bridge, tipi dei messaggi, risincronizzazione dei campi
nascosti.

Provato contro il codice precedente a queste correzioni: due test falliscono,
`mostraMsg non definita` e `resyncModuleControls` assente. Non è un test che
passa per costruzione.

`.github/workflows/pages.yml` ora esegue scansione segreti e suite prima di
pubblicare: il deploy dipende dal job `verifica`. Prima la pipeline pubblicava
senza eseguire nulla.

## modules/sorvegliabilita.html

**Il PG della lettera veniva calcolato e buttato via.** La riga 385 leggeva e
normalizzava `pgI`, la riga 402 scriveva nella lettera `pgRif`. `pgI` non
compariva più altrove nel file. La lettera riportava il PG della richiesta SUAP
al posto di quello digitato dall'operatore.

## Tutti e quattro i moduli

**Il campo «data lettera» era modificabile ma non veniva letto.** `var
dataI=dataR;` dichiarava una locale che oscurava l'`input#dataI`. Ora
`letterDate(dataR)` legge il campo e ripiega su `dataR` solo se è vuoto: il
precaricamento continua a funzionare, ma una correzione a mano resta.

**L'anno del protocollo digitato veniva riscritto.** `pg.replace(/^PG\/\d{4}\//i,'')`
toglieva l'anno scritto e `protocolYear()` rimetteva quello corrente: digitando
`PG/2025/278374` usciva `PG/2026/278374`. La nuova `protocolRef()` rispetta un
anno scritto per esteso e usa `protocolYear()` solo quando l'operatore ha
digitato il solo numero. Vale anche per `pgI`.

**Tre convenzioni di data conviventi.** Aggiunta `normDate()`, che porta a
gg.mm.aaaa le forme `2026-03-12`, `12/03/2026`, `12-3-2026`, `12.03.26` e
`4 marzo 2026`. Il giorno viene sempre per primo. Un formato non riconosciuto si
lascia com'è: non si indovina. È applicata a `dataR`, `dataAcc`, `dataRif` e
`dataI` in generazione, e nel bridge alla `dataRif` che arriva dall'Estrattore.

Il precaricamento della data odierna scriveva `29/08/26` nell'IIFE «Data odierna
di default» e `29.08.2026` in `initOperationalEnhancements`: la seconda non
interveniva mai, perché la prima aveva già riempito il campo. Ora entrambe
scrivono gg.mm.aaaa. L'etichetta dice `(GG.MM.AAAA)` invece di `(GG/MM/AA)`.

Non toccate `dataNap` e `dataN`, che vogliono la data per esteso («29 agosto
2026»), né `annoE`, che è il solo anno.

## modules/pareri-edili.html

**`mostraMsg` non esisteva.** `saveDraft`, `loadDraft` e `clearDraft` si
affidano a `mostraMsg`; quel file definisce solo `msg`. «Salva bozza» non dava
nessun riscontro, e solo lì. Aggiunta `mostraMsg` come alias di `msg`.

## assets/module-ai-bridge.js

**L'idratazione non risincronizzava i campi nascosti che pilotano il documento.**
`put()` scriveva `tpl` ed `esito` senza chiamare `setTpl`/`setEsito`, che sono le
sole funzioni che muovono i pulsanti e aprono le sezioni. Si riapriva una pratica
salvata, a schermo il parere risultava favorevole e il .docx usciva sfavorevole —
`genera()` legge proprio quel campo nascosto. Aggiunta `resyncModuleControls()`,
chiamata da `applyHydration` e da `clearModuleState`.

**«Nuova pratica» svuotava le date invece di riportarle a oggi.** I valori
iniziali venivano fotografati al caricamento dello script, prima che
`initOperationalEnhancements` (che gira su `DOMContentLoaded`) riempisse le date.
La fotografia ora si fa in `wireStateSync`, dopo il precaricamento.

**`postMessage` con bersaglio `"*"`.** Il primo giro aveva ristretto il bersaglio
in `workflow.js` ma non qui: tutti e quattro i messaggi verso la dashboard —
`practice-update` compreso, che trasporta nomi e indirizzi — partivano con `"*"`.
Aggiunta `parentTargetOrigin()`, stessa logica di `frameTargetOrigin()`.

**`dataRif` dall'Estrattore** passa da `normDate()` prima di finire nel campo.

## assets/workflow.js e index.html

**`state.practice.date` era popolato ma invisibile.** Lo scriveva solo
l'Estrattore, nessun campo lo mostrava, `saveCommon()` non lo toccava, e finiva
comunque nel contesto spedito al Redattore: una data letta male entrava nel testo
proposto senza che nessuno potesse accorgersene. Aggiunto il campo «Data della
pratica» nel pannello Dati comuni, con salvataggio in uscita dal campo come gli
altri. `normDate()` è in `workflow.js` ed è esposta su `window.ADMIN3`; la data
viene normalizzata all'arrivo dall'Estrattore e sullo stato ripristinato da
`localStorage`.

## supabase/functions/agent/index.ts

Aggiunta l'istruzione sul formato: ogni data va restituita in gg.mm.aaaa, giorno
per primo, stringa vuota se non è stabilibile con certezza. Prima lo schema
diceva soltanto `{ type: "string" }` e il prompt soltanto «data».

**Va ripubblicata la funzione** perché l'istruzione abbia effetto:

```bash
supabase functions deploy agent --no-verify-jwt
```

## Deciso di lasciare com'è

`destA` ha l'opzione «Alla Municipalità 4» solo in Pareri Edili: è voluto.

## Non toccato

Il resto dei quattro moduli. `riscontro-esposto.html` costruisce il PG della
lettera su `annoE`, l'anno dell'esposto, invece che su `protocolYear()`: è
coerente con il documento che cita, e non è stato cambiato.

## Deploy eseguito — 29 agosto 2026

Progetto `xebhjdqufgdekxcoebiy` («Amministrativa 3.0»), collegato.

    supabase secrets set ALLOWED_ORIGINS=https://polammslorenzo.github.io
    supabase functions deploy agent --no-verify-jwt

Origine ricavata dal repository `polammslorenzo/polammslorenzo.github.io`.
`OPENAI_API_KEY` era già impostata. `ALLOW_FILE_ORIGIN` non è impostata, come
previsto per la produzione.

Verifica sulla funzione pubblicata, con preflight OPTIONS:

    https://polammslorenzo.github.io   204, access-control-allow-origin corretto
    https://malintenzionato.example    403
    http://localhost:8080              204
    nessuna intestazione Origin        403

Prova di fumo con agente inesistente: 400 `INVALID_AGENT`, senza arrivare a
OpenAI.

`localhost` resta ammesso anche con `ALLOWED_ORIGINS` impostata: è voluto per lo
sviluppo, ma va ricordato che chiunque può servire una pagina da localhost. La
funzione è pubblicata con `--no-verify-jwt`, quindi il controllo sulle origini
non è un controllo d'accesso: la protezione effettiva è il limite di 20 richieste
ogni 10 minuti per IP, più il tetto di spesa sul progetto OpenAI.

## Sito pubblicato — 29 agosto 2026

Repository `polammslorenzo/amministrativa-3-0`, pubblico. Pages con sorgente
GitHub Actions: https://polammslorenzo.github.io/amministrativa-3-0/

Non è stato usato il repository `polammslorenzo.github.io`, che serve la radice
del sito utente e contiene già una cartella `oauth/`. L'origine però è la stessa,
quindi `ALLOWED_ORIGINS` resta valida.

Il primo workflow ha superato entrambi i job: `verifica` (scansione segreti e 22
test) e `deploy`. Sito raggiungibile, motore caricato, nessun errore in console.

Resta da fare: il **limite di spesa sul progetto OpenAI**, punto 1 dell'elenco in
cima a questo file. È l'unica voce ancora aperta.
