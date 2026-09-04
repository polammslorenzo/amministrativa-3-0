# Correzioni — secondo giro, 27 agosto 2026

In risposta a `RILIEVI_DEBUG.md`. Ho verificato ogni rilievo sui file prima di
toccarli: quelli confermati sono corretti, quelli che sono scelte tue restano
aperti in fondo.

Suite: 15 test superati, 0 falliti. Sintassi verificata su dashboard, bridge,
quattro moduli e Edge Function. Scansione segreti superata.

---

## Corretti

**R1 — Il PG della lettera in Sorvegliabilità.** `pgI` veniva letto e
normalizzato alla riga 385, poi la lettera riceveva `pgRif`: il valore calcolato
finiva nel nulla e l'operatore vedeva stampato il PG della richiesta SUAP al
posto del proprio. Ora vale la stessa regola degli altri tre moduli: si usa
`pgI` se compilato, altrimenti resta `pgRif`, così chi non compila quel campo
non cambia comportamento.

**R2 — «Data lettera» modificabile ma mai letta.** In tutti e quattro i moduli
`var dataI=dataR` dichiarava una variabile locale con lo stesso nome del campo,
oscurandolo. Ora si legge `#dataI` e si ripiega su `dataR` solo se è vuoto.

**R3 — Idratazione e campi nascosti.** `put()` scriveva `tpl` ed `esito` senza
chiamare `setTpl()` / `setEsito()`, le sole funzioni che aggiornano pulsanti e
sezioni visibili. Riaprendo una pratica salvata, lo schermo e il .docx generato
potevano dire cose diverse. Aggiunta `syncHiddenControls()`, richiamata dopo
l'idratazione e dopo l'azzeramento.

**R4 — Messaggi muti in Pareri Edili.** Il file chiama `mostraMsg` in sei punti
ma definisce `msg`. Aggiunto un alias, così «Bozza salvata» compare come negli
altri moduli.

**R5 — «Nuova pratica» svuotava le date.** La fotografia dei valori iniziali
veniva presa in fondo al `<body>`, prima che `initOperationalEnhancements`
precompilasse data, ora e anno di protocollo su `DOMContentLoaded`: l'azzeramento
ripristinava quindi i campi vuoti dell'HTML. Ora la fotografia si scatta sul
`DOMContentLoaded` del bridge — che gira dopo quello del modulo — e
`clearModuleState()` richiama la precompilazione.

**R6 — L'anno del protocollo digitato a mano.** L'espressione regolare toglieva
l'anno scritto dall'operatore e `protocolYear()` rimetteva quello corrente:
`PG/2025/278374` diventava `PG/2026/278374` in silenzio. È il difetto che a
gennaio colpisce ogni pratica a cavallo di dicembre. Aggiunta `pgYearOf()`: se
il PG è digitato per intero, l'anno indicato è quello che vale.

**R7 — Le date dell'Estrattore.** `dataRif` è l'unica data scritta dal modello e
finiva concatenata così com'era in una frase il cui modello usa `gg.mm.aaaa`.
Aggiunta `normalizeDate()` nel bridge, applicata solo a quel campo: ISO
`aaaa-mm-gg` e formati italiani con `/ - .` diventano `gg.mm.aaaa`; l'anno a due
cifre si espande. Sono documenti italiani, quindi giorno prima del mese. Quello
che non è riconosciuto resta intatto, visibile e correggibile — meglio un valore
strano sotto gli occhi che una data inventata. Collaudata su otto casi, compresi
`32/13/2026` e `marzo 2026`, che restano intatti. Lato server l'istruzione
dell'Estrattore ora chiede `gg.mm.aaaa` e impone di lasciare il campo vuoto
davanti a una data ambigua o parziale.

**R9 — La data della pratica non era né visibile né correggibile.**
`state.practice.date` veniva riempito dall'Estrattore e spedito al Redattore, ma
il pannello non aveva il campo: una data letta male entrava nel testo proposto
senza che nessuno potesse accorgersene. Aggiunto «Data della pratica», con
salvataggio e sincronizzazione come gli altri quattro campi.

**R10 — `postMessage` con bersaglio `"*"` nel bridge.** Il giro precedente aveva
ristretto solo la direzione dashboard → modulo. Ora anche i quattro invii del
modulo verso il padre usano `location.origin` fuori da `file://`. Riguarda
`practice-update`, che trasporta ogni campo del modulo: nomi, indirizzi,
titolari.

**S5 — Il Redattore chiamato dal modulo non riceveva `mode`.** Le istruzioni
dell'agente distinguono `summary` da `draft`, ma il bridge non mandava la chiave:
il modello sceglieva a caso. Ora il bridge invia `mode: "draft"`, che è quello
che i moduli chiedono davvero.

---

## Non corretti, perché sono decisioni tue

**R8 — La Municipalità 4 nei Pareri Edili.** Il select `destA` ha sei opzioni in
Pareri Edili e cinque negli altri tre. Può essere corretto — i pareri edilizi
seguono un percorso diverso — o può essere una svista. Non lo so, e allinearlo
d'ufficio potrebbe togliere un destinatario che usi davvero.

**S3 — Estensori contro agenti.** `ag1`–`ag4` offrono sei nominativi con
matricola, `estensore` ne offre tre e in altra grafia. Plausibile che non tutti
firmino, ma va confermato da te.

**S4 — Che cosa significa «Protocollo».** Nel pannello mostra il protocollo in
uscita per due moduli e quello SUAP per gli altri due; «ID pratica» ora un ID
interno, ora un PG. Le otto mappature esistono e funzionano: non è un errore di
stringa, è una scelta non fatta. Va deciso prima, non sistemato dopo.

**S1 e S2** restano aperti come li ha lasciati il debug: oggi non si innescano,
perché nessun bersaglio dell'Estrattore è una `<select>` e tutti sono campi di
testo. Diventano reali il giorno in cui una tendina entra in
`applyExtractionFields`. Se vuoi chiuderli in anticipo, `put()` può verificare
`element.value` dopo l'assegnazione e restituire 0 quando non attecchisce: sono
tre righe, e rende onesto anche il conteggio «N campi rilevati».

---

## Resta valido dal primo giro

I tre passaggi su Supabase e OpenAI elencati in `CORREZIONI.md` non sono stati
fatti da me e restano da fare: limite di spesa sul progetto OpenAI, secret
`ALLOWED_ORIGINS` con la sola origine GitHub Pages, e `ALLOW_FILE_ORIGIN`
lasciata disattivata in produzione. Senza il secondo, la funzione corretta
ammette soltanto `localhost` e il sito pubblicato non risponde.
