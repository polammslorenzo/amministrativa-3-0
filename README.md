# AMMINISTRATIVA 3.0 — PERCORSO GUIDATO + SUPABASE

Build GitHub-ready con backend OpenAI lato server. Include esclusivamente:

- Pareri Edili (`edili`)
- Riscontro Esposto (`esposto`)
- Sorvegliabilità (`sorvegliabilita`)
- Strutture Ricettive (`ricettive`)

Suolo Pubblico non è incluso e non è stato modificato.

## Architettura

Il browser carica l'app statica da GitHub Pages e invia le richieste a una Supabase Edge Function chiamata `agent`. Solo la funzione legge `OPENAI_API_KEY` dai secret Supabase e chiama la Responses API di OpenAI.

I quattro moduli operativi sono caricati in un iframe. Quando l'app è aperta direttamente da disco (`file://`), Chrome assegna origini opache distinte alla dashboard e al modulo: per questo la comunicazione usa `postMessage` e non accede direttamente agli oggetti JavaScript della finestra principale. La dashboard accetta richieste soltanto dal proprio iframe.

La chiave OpenAI non deve mai essere inserita in `config.js`, nei moduli HTML, nel repository o nella build GitHub Pages.

## Flusso operativo semplificato

1. Dalla dashboard si carica una sola volta il PDF della nuova pratica.
2. L'Estrattore classifica il documento, propone uno dei quattro percorsi, spiega il motivo, assegna un livello di confidenza, riassume il contenuto e segnala i dati mancanti.
3. L'operatore conferma o corregge il percorso suggerito.
4. L'app apre il modulo corrispondente e compila i campi estratti.
5. Le correzioni effettuate nel modulo vengono sincronizzate con il workflow comune.
6. Il Redattore produce una sintesi, suggerimenti, una domanda utile e una proposta di testo modificabile usando soltanto dati estratti e indicazioni dell'operatore.
7. Il Revisore esegue i controlli trasversali prima della generazione del documento.

L'Estrattore non decide l'esito amministrativo. Nei Pareri Edili, nella Sorvegliabilità e nelle Strutture Ricettive la scelta finale dell'esito resta sempre dell'operatore.

Il comando `Nuova pratica / azzera tutto`, compresi i pulsanti presenti nei moduli, cancella lo stato condiviso, l'ultima estrazione, il testo del Redattore e le bozze operative. Una nuova pratica non eredita più dati dalla precedente.

## Funzioni disponibili

`POST /functions/v1/agent` accetta:

```json
{
  "agent": "extractor",
  "module": "ricettive",
  "payload": {
    "practice": {},
    "document": {
      "filename": "pratica.pdf",
      "mimeType": "application/pdf",
      "size": 123456,
      "base64": "..."
    }
  }
}
```

Per classificare automaticamente il documento si usa:

```json
{
  "agent": "extractor",
  "module": "auto",
  "payload": {
    "document": {
      "filename": "pratica.pdf",
      "mimeType": "application/pdf",
      "size": 123456,
      "base64": "..."
    }
  }
}
```

Agenti:

- `extractor`: usa Structured Outputs con JSON Schema, valida nuovamente il risultato sul server e restituisce percorso, confidenza, motivazione, `practice`, `fields`, sintesi, fatti chiave, informazioni mancanti e avvisi;
- `writer`: restituisce in forma strutturata sintesi, proposta testuale, suggerimenti, informazioni mancanti e una domanda successiva. Formalizza solo i dati forniti, senza inventare fatti e senza Markdown o asterischi.

Se OpenAI restituisce una risposta incompleta o un JSON troncato durante l'analisi di un PDF articolato, l'Estrattore esegue un solo secondo tentativo automatico con maggiore margine. Nessun JSON parziale o fuori schema viene inviato al frontend.

## Limiti e protezioni

- un PDF per richiesta;
- solo `application/pdf` con estensione `.pdf`;
- PDF massimo 8 MB;
- corpo HTTP massimo 12 MB;
- testo fonte massimo 100.000 caratteri;
- input Redattore massimo 60.000 caratteri;
- 20 richieste ogni 10 minuti per combinazione IP/origine e istanza;
- timeout OpenAI di 50 secondi per tentativo e un solo retry controllato dell'Estrattore;
- CORS limitato alle origini elencate in `ALLOWED_ORIGINS` e allo sviluppo locale;
- errori JSON con codici leggibili e senza dettagli sensibili.

## La funzione non è autenticata

`verify_jwt = false` e l'URL della funzione è pubblicato in `config.js`, quindi è
leggibile da chiunque apra il sito. Le protezioni sopra riducono l'abuso
accidentale ma **non sono autenticazione**: l'intestazione `Origin` è scelta dal
chiamante e chiunque può impostarla con `curl`. Il rate limit vive in memoria e
riparte a ogni cambio di istanza Edge.

Finché la funzione resta aperta, ogni chiamata è a carico dell'account OpenAI
collegato. Prima dell'uso su pratiche reali servono, nell'ordine:

1. un limite di spesa impostato sul progetto OpenAI;
2. `ALLOWED_ORIGINS` valorizzato con la sola origine GitHub Pages in uso;
3. Supabase Auth con `verify_jwt = true` e accesso ristretto ai colleghi
   autorizzati.

## Configurazione locale

1. Copiare `.env.example` in `.env.local`.
2. Valorizzare `OPENAI_API_KEY` solo nel file locale.
3. Non committare `.env.local`: è già escluso da `.gitignore`.

Variabili supportate:

- `OPENAI_API_KEY` obbligatoria;
- `OPENAI_MODEL` facoltativa, valore predefinito `gpt-5-mini`;
- `ALLOWED_ORIGINS` **obbligatoria in produzione**, elenco separato da virgole di
  origini esatte. Se non è valorizzata la funzione ammette soltanto `localhost`;
- `ALLOW_FILE_ORIGIN` facoltativa. Solo con valore `1` la funzione accetta
  `Origin: null`, cioè l'apertura di `index.html` con doppio clic. Va lasciata
  disattivata in produzione: `Origin: null` è inviato anche dagli iframe in
  sandbox e da alcuni reindirizzamenti.

## Progetto Supabase già attivo

Questa consegna è già collegata al progetto Supabase `Amministrativa 3.0`, regione Francoforte:

```text
Project ref: xebhjdqufgdekxcoebiy
Edge Function: https://xebhjdqufgdekxcoebiy.supabase.co/functions/v1/agent
```

La funzione `agent` è pubblicata, il secret `OPENAI_API_KEY` è configurato lato server e `config.js` contiene già l'URL completo. Non serve ripetere il deploy per usare questa build.

La chiave creata da Codex è inoltre conservata localmente fuori dallo ZIP e non è presente nel repository o nella build GitHub Pages.

## Deploy futuro o replica del progetto

Lo script seguente resta disponibile soltanto per ripubblicare la funzione o collegare una copia a un diverso progetto:

```bash
chmod +x scripts/configure-and-deploy.sh
./scripts/configure-and-deploy.sh PROJECT_REF https://NOMEUTENTE.github.io
```

Indicare soltanto l'origine GitHub Pages, senza il nome del repository. Lo script collega il progetto, trasferisce i secret senza stamparli, pubblica `agent` e aggiorna `config.js` evitando doppi percorsi `/agent`.

## Deploy manuale equivalente

```bash
supabase link --project-ref PROJECT_REF
supabase secrets set --env-file .env.local
supabase functions deploy agent --no-verify-jwt
node scripts/set-config.mjs PROJECT_REF
```

Prima di `secrets set`, aggiungere in `.env.local` anche:

```dotenv
OPENAI_MODEL=gpt-5-mini
ALLOWED_ORIGINS=https://NOMEUTENTE.github.io
```

## Pubblicazione GitHub Pages

1. Creare un repository GitHub e caricare il contenuto di questa cartella.
2. Verificare che `config.js` contenga l'URL completo della funzione.
3. In GitHub aprire Settings → Pages e scegliere GitHub Actions come sorgente.
4. Fare push sul branch `main`.

Il workflow `.github/workflows/pages.yml` pubblica solo `index.html`, `config.js`, `assets`, `modules` e `.nojekyll`. I file backend e di configurazione locale non entrano nell'artefatto Pages.

## Sviluppo locale

Il modo consigliato è un server statico locale: qualsiasi origine
`http://localhost:*` o `http://127.0.0.1:*` è ammessa senza configurazione.

L'apertura con doppio clic su `index.html` funziona solo se il secret
`ALLOW_FILE_ORIGIN=1` è attivo sul progetto Supabase, e va usata soltanto in
sviluppo. Il collegamento dashboard-moduli usa comunque un bridge `postMessage`
compatibile con le restrizioni iframe di Chrome.

Per avviare un server statico nella cartella del progetto:

```bash
python3 -m http.server 8080
```

Poi aprire `http://localhost:8080`.

## Test

Test locali con OpenAI simulata:

```bash
node --test tests/agent.test.mjs tests/frontend-bridge.test.mjs tests/contracts.test.mjs
```

La suite verifica anche classificazione automatica, output strutturato del Redattore, sincronizzazione sicura dashboard-moduli e azzeramento completo delle memorie della pratica.

`contracts.test.mjs` è diverso dagli altri due: non usa fixture, legge i file veri —
HTML dei moduli compreso — e verifica che le stringhe con cui i quattro strati si
parlano coincidano davvero. Nomi dei campi dell'Estrattore, sorgenti di
`updateCommonPractice`, chiavi di modulo, `DRAFT_KEYS`, funzioni e id attesi dal
bridge, tipi dei messaggi. Rinominare un campo o un file rompe un test invece di
lasciare un campo vuoto che nessuno nota.

Test reali, facoltativi e a consumo API, usando `.env.local`:

```bash
node --test tests/live-agent.test.mjs
```

I test non stampano né incorporano la chiave.

## Controllo segreti prima della pubblicazione

```bash
node scripts/secret-scan.mjs
```

Il controllo fallisce se trova pattern di chiavi OpenAI o assegnazioni non vuote a `OPENAI_API_KEY` nei file destinati al repository. `.env.local` è escluso deliberatamente dal controllo e non deve essere inserito nello ZIP o nel repository.
