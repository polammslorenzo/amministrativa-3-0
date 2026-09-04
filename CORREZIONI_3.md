# Terzo giro — lavoro degli agenti

Tutto verificato: 15 test superati, sintassi controllata su dashboard, bridge,
quattro moduli ed Edge Function, scansione segreti superata. Le tre parti nuove
sono state collaudate con dati finti su casi costruiti apposta, compresi i casi
in cui devono restare zitte.

---

## 1. Il Redattore adesso vede la pratica

Chiamato dalla dashboard riceveva `practice`, `extraction`, `moduleData`,
`operatorNotes`, `currentDraft`. Chiamato da un modulo riceveva la sola bozza.
Stesso agente, stesse istruzioni, ma nel secondo caso cieco: non sapeva il nome
della struttura, l'indirizzo, l'esito, né cosa dicesse il documento caricato.

Il bridge ora conserva pratica ed estrazione quando la dashboard lo idrata, e le
rispedisce con ogni richiesta.

**Le etichette al posto degli id.** Il modello riceveva `{tit, pgR, destU, prov}`
e doveva indovinare cosa fossero. Ora riceve `"Tipologia (tipoStruttura)"`,
`"PG Risposta (pgR)"`: le etichette erano già scritte nella maschera, bastava
riusarle. Restano fuori i campi vuoti, quelli a `--` e i valori oltre i 4.000
caratteri.

**Ogni chiamata dichiara il bersaglio.** Le istruzioni chiedevano «una proposta
amministrativa breve e direttamente utilizzabile» anche quando il bersaglio era
un paragrafo dentro un modulo, e con 4.000 token a disposizione il modello
riempiva lo spazio. Ora ogni chiamata dice in quale campo finisce il testo, cosa
non deve contenere (intestazione, destinatario, firma, formula di chiusura) e
quante righe deve occupare. Lato server quelle indicazioni entrano nelle
istruzioni.

Riscritta anche l'istruzione delle Ricettive, che chiedeva «controlli,
irregolarità e provvedimenti» — tre categorie, cioè un invito a scrivere una
relazione intera dentro un paragrafo.

## 2. Il Revisore guarda il merito

Aveva sei regole, tutte di forma: oggetto mancante, ubicazione mancante,
percorso non confermato, segnaposto, Markdown, bozza vuota. Sei di merito in più:

- una data successiva a oggi;
- data dell'accertamento successiva alla data di risposta;
- un PG fuori formato;
- lo stesso agente selezionato due volte;
- **una data citata nel testo che non compare in nessun campo** — è il controllo
  che intercetta un valore inventato dal modello;
- **esito e testo che si contraddicono** — esito «non conforme» e paragrafo che
  dice «risulta conforme», o viceversa.

Due difetti trovati collaudandole, e corretti:

Il confronto delle date spezzava le cifre, e segnalava come inventata una data
scritta correttamente. Ora `04.09.2026` e `4/9/26` si riconoscono fra loro.

Il rilevatore di contraddizione cercava «non conforme» attaccato, e prendeva un
abbaglio su «non risulta conforme». Ora per ogni «conform» guarda se un «non» la
governa nella stessa proposizione. Collaudato su nove formulazioni, incluso il
testo vero preso dallo screenshot.

Allineati anche i valori dell'esito: le Ricettive usano `c`/`p`/`n`, gli altri
moduli `c`/`nc`. La regola li riconosce entrambi.

## 3. Checklist delle Strutture Ricettive

Sette voci, ciascuna conforme / non conforme / non rilevato: conformità alla
SCIA, CIN, Alloggiati Web, Tourist Tax, autocontrollo legionellosi, estintore,
rilevatore di monossido.

Il pulsante «Componi accertamento» scrive il testo da sé, sempre con le stesse
parole, e resta modificabile. I due portali si citano insieme — «iscritta ai
portali Alloggiati Web e Tourist Tax» — come li cita l'ufficio.

Con le voci impostate come nel documento che hai mandato, esce parola per parola
il tuo testo. Le voci non conformi diventano una frase a parte; quelle non
rilevate non compaiono, invece di essere date per conformi.

`genera()` riconosce il testo composto e lo usa integralmente, senza riavvolgerlo
nei modelli fissi. Se la checklist non viene usata, il comportamento di prima
resta identico: le bozze vecchie non cambiano.

Un difetto trovato al collaudo: con la SCIA difforme usciva «risulta difforme
dalla SCIA, **inoltre** risulta conforme agli obblighi». Ora la congiunzione
regge solo dopo un'apertura affermativa.

L'esito non viene impostato in automatico: il messaggio dice quante voci sono
non conformi e lascia la scelta a te, e la nuova regola del Revisore segnala se
esito e testo non si parlano.

---

## Cosa resta di quanto avevo elencato

**Registrare cosa propone il modello e cosa correggi tu.** È la voce che rende
tutto il resto misurabile: oggi ogni modifica ai prompt, comprese le mie, è
un'ipotesi ragionata e non una misura. Il registro locale delle pratiche esiste
già (`amm20_registry_v1`); aggiungerci il valore estratto accanto al valore
finale significa sapere, fra un mese e con i numeri, quali campi il modello
sbaglia davvero.

**`reasoning: effort "low"` sull'Estrattore.** Su un PDF scansionato o
disordinato è lì che nascono gli errori di lettura. Il meccanismo di ritentativo
esiste già per la troncatura: si potrebbe alzare lo sforzo al secondo tentativo.
