# Rilievi di coerenza — Amministrativa 3.0

Controllo del 27 agosto 2026. Nessun file è stato modificato.

Metodo: lettura di entrambi i lati di ogni contratto nei file reali. Gli `id`
dei quattro moduli sono stati estratti con grep sull'HTML, non dedotti dai nomi.

---

## Confermati

Ho letto entrambi i lati e non corrispondono.

### 1. Il PG della lettera di trasmissione viene calcolato e buttato via

`modules/sorvegliabilita.html:385` legge il campo `pgI` e lo normalizza:

    var pgI=document.getElementById('pgI').value.trim(); pgI=pgI.replace(...); if(pgI) pgI='PG/'+protocolYear()+'/'+pgI;

`modules/sorvegliabilita.html:402` scrive nella lettera un'altra variabile:

    xmlL=rf(xmlL,'PG/2026/301627','PG/'+protocolYear()+'/'+pgRif);

`pgI` non compare più da nessuna parte nel file: l'unica occorrenza dopo la
riga 385 è la riga 385 stessa. Negli altri tre moduli la stessa riga usa `pgI`
(`pareri-edili.html:319`, `riscontro-esposto.html:359`,
`strutture-ricettive.html:374`, tutte nella forma `pgI ? ... : ...`).

**Cosa vede l'operatore:** compila «PG lettera», genera la lettera di
trasmissione, e la lettera riporta il PG della richiesta SUAP al posto del suo.
Solo nel modulo Sorvegliabilità.

### 2. Il campo «data lettera» è modificabile ma non viene letto mai

In tutti e quattro i moduli il campo `dataR` ricopia il proprio valore in
`dataI` a ogni battuta (attributo `oninput` sul campo Data risposta), e poi il
codice della lettera dichiara una variabile locale con lo stesso nome:

    pareri-edili.html:308        var dataI=dataR;
    riscontro-esposto.html:346   var dataI=dataR;
    sorvegliabilita.html:386     var dataI=dataR;
    strutture-ricettive.html:362 var dataI=dataR;

La variabile locale oscura il campo. L'`input#dataI` non viene mai letto.

**Cosa vede l'operatore:** corregge a mano la data della lettera, la lettera
esce con la data della risposta. Nessun avviso.

### 3. L'idratazione non risincronizza i campi nascosti che pilotano il documento

`assets/module-ai-bridge.js:197` assegna ogni chiave di `moduleData` con `put()`:

    Object.keys(moduleData).forEach(function (id) { put(id, moduleData[id]); });

`collectModuleData()` raccoglie anche gli `input[type=hidden]`, quindi fra le
chiavi ci sono `tpl` (Pareri Edili) ed `esito` (Sorvegliabilità e Ricettive).
`put()` scrive il valore ma non chiama né `setTpl()` né `setEsito()`, che sono
le sole funzioni che aggiornano i pulsanti e la visibilità delle sezioni:

    pareri-edili.html:200    setTpl  → bFAV/bFAVP/bSFAV, secPres, secMot
    sorvegliabilita.html:264 setEsito → bOk/bNo, ncRow
    strutture-ricettive.html:238 setEsito → bOk/bNo, ncRow

E `pareri-edili.html:253` genera il documento proprio su quel valore nascosto:

    var tpl=document.getElementById('tpl').value;

**Cosa vede l'operatore:** riapre una pratica salvata, sullo schermo il parere
risulta favorevole e la sezione Motivazione è chiusa, ma il .docx esce
sfavorevole — o si blocca su «Inserisci la motivazione sfavorevole» per un campo
che non è visibile. Stessa cosa per la riga di non conformità negli altri due
moduli.

Nota collegata: `loadDraft()` risincronizza `esito` (`if(typeof
setEsito==='function')…`), ma nessuno risincronizza `tpl`. Quindi in Pareri
Edili anche il pulsante «Riprendi bozza» del modulo, senza dashboard, lascia i
pulsanti del parere disallineati.

### 4. In Pareri Edili i messaggi della bozza non compaiono

Le tre funzioni della bozza si affidano a `mostraMsg`:

    pareri-edili.html:367  if(show&&typeof mostraMsg==='function')mostraMsg('O','Bozza salvata sul dispositivo');
    pareri-edili.html:368  … 'Bozza ripristinata'
    pareri-edili.html:369  … 'Bozza cancellata'

In quel file `mostraMsg` non è definita: la funzione dei messaggi si chiama
`msg` (`pareri-edili.html:198`). Le sei occorrenze di `mostraMsg` nel file sono
tutte guardie `typeof`. Gli altri tre moduli definiscono `mostraMsg`
(righe 228, 247, 230).

**Cosa vede l'operatore:** preme «Salva bozza» in Pareri Edili e non succede
niente di visibile. La bozza in realtà è salvata. Solo in quel modulo.

Il bridge invece è a posto: `notify()` prova `mostraMsg` e poi ripiega su `msg`
(`module-ai-bridge.js:105-108`).

### 5. «Nuova pratica» svuota le date invece di riportarle a oggi

`module-ai-bridge.js:14-18` fotografa i valori iniziali quando lo script viene
eseguito, cioè in fondo al `<body>`, **prima** di `DOMContentLoaded`.
`initOperationalEnhancements()` precompila `dataR`, `dataAcc`, `ora`, `dataNap`,
`dataN` e crea `annoProt` solo dopo, su `DOMContentLoaded` (riga 386, 433, 469,
443 nei quattro moduli).

`clearModuleState()` (riga 138) ripristina la fotografia, cioè i campi vuoti
dell'HTML.

**Cosa vede l'operatore:** dopo «Nuova pratica / azzera tutto» i campi data
restano bianchi, mentre a pagina appena aperta contenevano la data di oggi. Se
non se ne accorge, il documento esce con « del » e niente dopo.

### 6. L'anno del protocollo digitato a mano viene riscritto

Tutti e quattro i moduli, nella funzione `genera()`:

    var pg=…value.trim(); pg=pg.replace(/^PG\/\d{4}\//i,''); if(pg) pg='PG/'+protocolYear()+'/'+pg;

`protocolYear()` (righe 353, 401, 437, 411) legge `annoProt`, un campo creato da
JavaScript e precompilato con l'anno corrente, senza etichetta, appeso sotto
«PG Risposta» con il solo `placeholder='Anno protocollo'`.

**Cosa vede l'operatore:** digita `PG/2025/278374` per intero, l'espressione
regolare toglie `2025` e rimette l'anno corrente: nel documento finisce
`PG/2026/278374`. Nessun messaggio. È il rilievo che al cambio d'anno colpisce
tutte le pratiche a cavallo di dicembre.

### 7. Tre convenzioni di data che convivono, e nessuna normalizzazione

`dataRif` è l'unico campo data scritto dall'Estrattore
(`module-ai-bridge.js:178` e `:184`). Nello schema è
`dataRif: { type: "string" }` (`index.ts:60` e `:69`), senza formato, e
l'istruzione dice soltanto «Estrai … PG, data, protocollo SUAP …»
(`index.ts:85-87`). Non esiste normalizzazione: `put()` fa solo `trim()`.

Il valore finisce concatenato tale e quale nel documento:

    sorvegliabilita.html:349      rf(xml,'PG/2026/278374 del 13.02.2026','PG/'+protocolYear()+'/'+pgRif+' del '+dataRif)
    strutture-ricettive.html:332  rf(xml,'PG/2026/188193 del 10.02.2026', … +' del '+dataRif)

Il modello del documento usa `gg.mm.aaaa`. Gli altri campi data dello stesso
modulo ne usano altri due:

    dataR       etichetta «Data risposta (GG/MM/AA)»; segnaposto nel .docx
                'del   04.03.26' (punti) e nella lettera 'del   28/03/26'
                (barre); precompilato da initOperationalEnhancements come
                27/08/26
    dataAcc     segnaposto «es. 28.03.2026»; precompilato come 27/08/26
    dataNap/N   formatDateExt → «27 agosto 2026»
    annoE       solo l'anno, «2026»

Tutti i campi data sono `type="text"`: nessun controllo del browser interviene.

**Cosa vede l'operatore:** una richiesta SUAP con la data scritta `12/03/2026` e
una con `2026-03-12` producono due `dataRif` diversi che finiscono entrambi
nella stessa frase del documento, indistinguibili, e nessuno dei due nel formato
del modello. Con `12/03/2026` non c'è modo di sapere se il PDF diceva 12 marzo o
3 dicembre.

### 8. Un ufficio destinatario in più in Pareri Edili

`select#destA` in `pareri-edili.html` ha sei opzioni; negli altri tre moduli ne
ha cinque. La sesta è:

    <option value='Alla Municipalita 4'>Municipalità 4</option>

I `value` delle altre cinque coincidono nei quattro moduli. Anche `destU` ha
valori identici ovunque (`Servizio SUAP|11.11.0.0.0` e seguenti); in Pareri
Edili cambiano solo le etichette a schermo, abbreviate («Serv. SUE», «U.O.
Attivita Tecniche»).

**Cosa vede l'operatore:** può indirizzare alla Municipalità 4 un parere edilizio
ma non un riscontro a esposto, e non c'è niente nel codice che spieghi perché.

### 9. `state.practice.date` viene riempito ma non è né visibile né correggibile

Nel front-end la stringa `date` compare in un solo punto:

    assets/workflow.js:6  const EMPTY_PRACTICE = { id:"", subject:"", location:"", protocol:"", date:"", notes:"" };

È nello schema dell'Estrattore (`index.ts:248`, obbligatoria per
`validExtractorResult`, `index.ts:428`) e viene scritta da
`Object.assign(A.state.practice, result.practice)` (`index.html:266` e
`workflow.js:266`). Poi:

- il pannello «Dati comuni» ha `wfId`, `wfSubject`, `wfLocation`, `wfProtocol` —
  nessun campo data (`index.html:101-104`);
- `saveCommon()` non la tocca (`index.html:172-180`);
- `updateCommonPractice()` non ha nessuna mappatura verso `date`
  (`workflow.js:181-186`);
- ma `practice` intero, `date` compresa, viene spedito al Redattore
  (`index.html:280`, `workflow.js:252`).

Non è codice morto: manca la mappatura sul lato interfaccia.

**Cosa vede l'operatore:** una data letta male dal PDF entra nel testo che il
Redattore propone, e non c'è nessun campo in cui accorgersene o correggerla.

### 10. Il bersaglio di `postMessage` è stato ristretto in una direzione sola

`workflow.js` usa `frameTargetOrigin()` (righe 14-24), che fuori da `file://`
restituisce `location.origin`. Il bridge invece manda sempre a `"*"`, in tutti e
quattro i punti in cui scrive al padre:

    module-ai-bridge.js:96   agent-request
    module-ai-bridge.js:218  practice-update
    module-ai-bridge.js:226  new-practice-request
    module-ai-bridge.js:463  module-ready

`practice-update` trasporta `collectModuleData()`, cioè ogni campo del modulo:
nomi, indirizzi, titolari.

L'impatto pratico è contenuto — il padre di quell'iframe è la dashboard, stessa
origine — ma la riga di `CORREZIONI.md` che dice «Fuori da `file://` il bersaglio
è ora `location.origin`» descrive metà del traffico.

---

## Sospetti

Sembrano sbagliati ma non ho potuto chiuderli senza eseguire il codice.

### S1. `put()` sulle select: rischio reale, oggi non innescato

Ho verificato uno per uno i bersagli di `applyExtractionFields`
(`module-ai-bridge.js:152-191`): `praticaId`, `richiedente`, `ubicazione`,
`periodo`, `motivazione`, `prescrizioni`, `pgE`, `annoE`, `ogg`, `via`, `mitt`,
`pgRif`, `dataRif`, `protSUAP`, `tit`, `nomeStruttura`. Nessuno di questi è una
`<select>`: sono tutti `input type="text"` o `textarea`. Quindi oggi
l'Estrattore non può azzerare nessuna tendina.

`applyHydration` invece fa `put()` su **tutte** le chiavi di `moduleData`,
comprese `estensore`, `ag1`–`ag4`, `fqual`, `fnome`, `destA`, `destU`,
`tipoEsitoEsposto`, `tipoStruttura`. Lì il rischio è quello descritto: un valore
non più presente fra le `option` azzera la select in silenzio e `put()`
restituisce 1 lo stesso.

**Per chiudere il dubbio serve:** aprire una pratica, salvarla con `ag1` = «AG.
IAVARONE 3449», togliere quella `option` dall'HTML, ricaricare la pratica e
guardare se il nome sparisce dal .docx. Mi aspetto di sì, ma non l'ho eseguito.

### S2. Il conteggio «N campi rilevati»

Nel percorso in cui il numero viene mostrato — `applyExtractionFields` chiamata
da `analizzaAI`/`leggiPDF` — tutti i bersagli sono campi di testo, per i quali
l'assegnazione attecchisce sempre. Su questo percorso, oggi, il numero è
veritiero.

Diventa falso appena una select entra in `applyExtractionFields`, oppure se un
modulo aggiunge un gestore `input` che riscrive o rifiuta il valore: `put()`
emette un evento `input` (riga 124) e non ricontrolla `element.value` dopo.

**Per chiudere il dubbio serve:** eseguire un'estrazione vera e contare a
schermo i campi effettivamente pieni contro il numero annunciato.

### S3. Elenco degli estensori contro elenco degli agenti

`ag1`–`ag4` offrono sei nominativi con matricola, identici nei quattro moduli:
A.C. FERRARA 3015, ASS SEBASTIANO 639S, ASS BATTAGLIA 651S, AC DI MARTINO 046S,
AG. ESPOSITO 2583, AG. IAVARONE 3449.

`estensore` ne offre tre, in altra grafia: A.C. Ferrara, ASS Sebastiano, ASS
Battaglia. Anche questo identico nei quattro moduli.

Può essere voluto — non tutti firmano — ma la divergenza non è scritta da
nessuna parte.

**Per chiudere il dubbio serve:** una tua conferma, non una verifica sul codice.

### S4. «Protocollo» nel pannello destro significa quattro cose diverse

`updateCommonPractice` (`workflow.js:181-186`):

    edili           id←praticaId   protocol←pgR
    esposto         id←pgE         protocol←pgR
    sorvegliabilita id←pgRif       protocol←protSUAP
    ricettive       id←pgRif       protocol←protSUAP

Tutte e otto le sorgenti esistono davvero negli HTML: il contratto regge. Ma
sotto la stessa etichetta «Protocollo» il pannello mostra ora il protocollo in
uscita, ora quello SUAP; e sotto «ID pratica» ora un ID interno, ora il PG
dell'esposto, ora il PG della richiesta.

**Per chiudere il dubbio serve:** decidere che cosa devono significare quei due
campi. Non è un errore di stringa, è una scelta non fatta.

### S5. Il Redattore chiamato dal modulo non riceve `mode`

`index.html:278` manda `mode` ("summary" o "draft"). Il bridge, in `write()`
(`module-ai-bridge.js:302`), manda `{draft, context}` e basta. Le istruzioni
dell'agente parlano di `mode` («Se mode=summary … Se mode=draft …»,
`index.ts:369`).

**Per chiudere il dubbio serve:** una chiamata vera dal modulo, per vedere che
cosa produce il Redattore in assenza di quella chiave.

---

## Verificati e a posto

Contratti letti su entrambi i lati, che tornano. Qui non serve ricontrollare al
prossimo giro, salvo rinomini di file o campi.

1. **Catena dei nomi di campo, quattro anelli.** Per tutti e quattro i moduli:
   ogni proprietà `fields.X` letta in `applyExtractionFields` esiste in
   `EXTRACTOR_FIELDS[modulo]`, e ogni id `put("Y", …)` esiste nell'HTML.
   Compresi i due che erano più a rischio, `pgE`←`pgEsposto` e `tit`←`titolare`.
   Nessun anello rotto.

2. **`updateCommonPractice`.** Tutte e sedici le sorgenti (`praticaId`,
   `richiedente`, `ubicazione`, `pgR`, `pgE`, `ogg`, `via`, `pgRif`, `tit`,
   `protSUAP`, `nomeStruttura`) esistono come `id=` nel modulo corrispondente.
   Il bug noto è chiuso davvero.

3. **Chiavi di modulo, sette posti.** `edili`, `esposto`, `sorvegliabilita`,
   `ricettive` coincidono in: `MODULES` (`index.ts:1`), `MODULES`
   (`workflow.js:4`), `MODULE_META` (`index.html:140`), gli attributi `data-key`
   (righe 31-34 e 77-80), i `value` delle `option` di `#routeSelect` (riga 67),
   i `data-module` — che puntano a file esistenti — e i rami di `moduleName()`
   (`module-ai-bridge.js:30-37`). Anche le etichette coincidono fra
   `MODULE_LABELS` (`index.ts:25`), `MODULE_META` e i `data-title`.

4. **`DRAFT_KEYS`.** Le quattro stringhe di `workflow.js:7-12` corrispondono a
   `'amm20_'+nomefile+'_draft'` per i nomi di file effettivi. `storageKey()` è
   identica nei quattro moduli (righe 366, 413, 449, 423).

5. **Funzioni e id attesi dal bridge.** `setTpl` esiste in Pareri Edili e accetta
   proprio `fav`/`favp`/`sfav` (`pareri-edili.html:200`). `apriForm` esiste nei
   tre moduli in cui il bridge chiama `openForm()` e manca solo in Pareri Edili,
   dove il bridge non lo chiama. `storageKey` c'è in tutti e quattro. Gli id
   passati a `setBusy` e a `getElementById` esistono dove servono: `bAI` e `dz`
   in Pareri Edili, `bGenTesto` e `genbox` in Riscontro Esposto, `bGenNC` e
   `genbox` in Sorvegliabilità e Ricettive, `fi` in tutti e quattro. Le
   sovrascritture del bridge (`window.leggiPDF`, `window.setPDF`,
   `window.analizzaAI`, `window.genTesto`, `window.genNC`) hanno effetto perché
   `module-ai-bridge.js` è l'ultimo script del file (righe 528, 549, 587, 582) e
   i pulsanti lo chiamano da `onclick`, cioè al momento del clic.

6. **Valori `type` dei messaggi.** I sette valori coincidono sui due lati.
   Manda il modulo e ascolta la dashboard: `module-ready`, `practice-update`,
   `agent-request`, `new-practice-request`. Manda la dashboard e ascolta il
   modulo: `module-hydrate`, `module-reset`, `agent-response`. Il `channel` è
   `"ADMIN3_BRIDGE"` in tutti i dodici punti in cui compare.

7. **`protocolYear()` e `annoProt`.** `annoProt` non è nell'HTML: viene creato a
   runtime da `initOperationalEnhancements` (riga 441 in Sorvegliabilità e
   corrispondenti). La funzione quindi trova il campo. Il difetto è nel
   comportamento, non nel contratto: vedi il rilievo 6.

8. **Schema del Redattore contro pannello.** Le cinque chiavi di `writerSchema()`
   (`index.ts:343-347`) — `summary`, `text`, `suggestions`, `missingInformation`,
   `nextQuestion` — sono esattamente quelle lette da `renderWriter()`
   (`index.html:204-208`).

9. **Nomi, gradi e matricole.** `ag1`–`ag4`, `fqual`, `fnome`, `estensore` e i
   `value` di `destU` sono identici nei quattro moduli. L'unica differenza è
   quella del rilievo 8.

10. **Riferimenti normativi in chiaro.** Nel testo dei moduli compaiono soltanto
    `D.P.R. 495/1992` (Pareri Edili) e `D.M. 564/1992` (Sorvegliabilità, tre
    occorrenze). Sono corretti e non contengono anni destinati a scadere.

11. **Anni cablati nei modelli.** Le stringhe `PG/2026/285347`,
    `del 13.02.2026`, `1201698/2025`, `c_f839/Comune_di_Napoli
    1176287/17-12-2025`, `04.03.26`, `28/03/26` non sono valori prodotti: sono le
    stringhe che `rf()` cerca **dentro** i .docx modello per sostituirle. Non si
    guastano al cambio d'anno; si guastano solo se i modelli vengono rigenerati
    con contenuti d'esempio diversi. L'anno che si guasta da solo è quello del
    rilievo 6.
