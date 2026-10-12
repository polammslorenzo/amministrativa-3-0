// Rubrica Egrammata: dati, composizione delle righe del destinatario e innesto nei moduli.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const RADICE = path.resolve(import.meta.dirname, "..");
const leggi = (f) => fs.readFileSync(path.join(RADICE, f), "utf8");

// I due file sono script da browser: li eseguo in un contesto isolato senza document,
// cosi parte solo la logica e non il riquadro.
const contesto = {};
contesto.window = contesto;
vm.createContext(contesto);
vm.runInContext(leggi("assets/rubrica-dati.js"), contesto);
vm.runInContext(leggi("assets/rubrica.js"), contesto);
const VOCI = contesto.ADMIN3_RUBRICA.voci;
const L = contesto.ADMIN3_RUBRICA_LOGICA;
const voce = (codice) => VOCI.find((v) => v.c === codice);
const riga = (testo) => `<w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>${testo}</w:t></w:r></w:p>`;
const testi = (xml) => (xml.match(/<w:p>[\s\S]*?<\/w:p>/g) || []).map((p) => p.replace(/<[^>]+>/g, ""));

test("rubrica: ogni struttura ha tipo, nome e un indirizzo di protocollo unico", () => {
  assert.ok(VOCI.length >= 50, "rubrica quasi vuota");
  const visti = new Set();
  for (const v of VOCI) {
    assert.ok(["A", "S", "U"].includes(v.t), `tipo: ${v.n}`);
    assert.ok(v.n && !/[<>]/.test(v.n), `nome: ${v.c}`);
    assert.match(v.c, /^\d+(\.\d+){4}$/, `indirizzo: ${v.n}`);
    assert.ok(!visti.has(v.c), `indirizzo doppio: ${v.c}`);
    visti.add(v.c);
  }
});

test("rubrica: un servizio diventa Area, Servizio, indirizzo di protocollo", () => {
  assert.deepEqual({ ...L.righe(voce("9.8.0.0.0")) }, {
    area: "All'Area Urbanistica",
    servizio: "Servizio Condono Edilizio",
    indirizzo: "9.8.0.0.0",
  });
  assert.equal(L.righe(voce("25.0.6.0.0")).area, "Alla Direzione Municipalità 4");
  assert.equal(L.righe(voce("21.22.0.0.0")).area, "All'Area Sicurezza");
});

test("rubrica: un'Area scelta come destinatario non ha la riga del servizio", () => {
  const r = L.righe(voce("9.0.0.0.0"));
  assert.equal(r.area, "All'Area Urbanistica");
  assert.equal(r.servizio, "");
});

test("rubrica: la ricerca ignora accenti e maiuscole e riconosce un indirizzo parziale", () => {
  assert.equal(L.cerca(VOCI, "MUNICIPALITA 4 tecniche", 5).trovate[0].c, "25.0.6.0.0");
  assert.equal(L.cerca(VOCI, "condono", 5).trovate[0].c, "9.8.0.0.0");
  const perIndirizzo = L.cerca(VOCI, "9.4", 20).trovate.map((v) => v.c);
  assert.equal(perIndirizzo[0], "9.4.0.0.0");
  assert.ok(perIndirizzo.every((c) => c === "9.4.0.0.0" || c.startsWith("9.4.")));
});

test("rubrica: il nominativo finisce sotto il servizio, e senza servizio non resta una riga vuota", () => {
  const conServizio = riga("All'Area Urbanistica") + riga("Servizio Condono Edilizio") + riga("Indirizzo di protocollo 9.8.0.0.0");
  const a = L.completa(conServizio, { nome: "c.a. Rossi & Bianchi" }, "All'Area Urbanistica", ["Servizio Condono Edilizio", "9.8.0.0.0"]);
  assert.equal(a.nomeInserito, true);
  assert.deepEqual(testi(a.xml), ["All'Area Urbanistica", "Servizio Condono Edilizio", "c.a. Rossi &amp; Bianchi", "Indirizzo di protocollo 9.8.0.0.0"]);
  assert.match(a.xml, /<w:jc w:val="right"\/><\/w:pPr><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">c\.a\./, "il nominativo non eredita lo stile della riga sopra");

  const senzaServizio = riga("Al Sindaco") + riga(L.SENZA_SERVIZIO) + riga("Indirizzo di protocollo 50.0.0.0.0");
  const b = L.completa(senzaServizio, { nome: "c.a. Segreteria" }, "Al Sindaco", [L.SENZA_SERVIZIO, "50.0.0.0.0"]);
  assert.deepEqual(testi(b.xml), ["Al Sindaco", "c.a. Segreteria", "Indirizzo di protocollo 50.0.0.0.0"]);
  assert.ok(!b.xml.includes(L.SENZA_SERVIZIO));

  const perso = L.completa(riga("altro"), { nome: "c.a. Rossi" }, "Area che non c'e", ["Servizio che non c'e", "1.0.0.0.0"]);
  assert.equal(perso.nomeInserito, false, "un nominativo non collocato deve essere segnalato");
});

test("rubrica: ogni modulo la carica e la usa, e i destinatari abituali non hanno valori troncati", () => {
  for (const f of fs.readdirSync(path.join(RADICE, "modules")).filter((x) => x.endsWith(".html"))) {
    const html = leggi(path.join("modules", f));
    assert.ok(html.includes('<script src="../assets/rubrica-dati.js"></script>'), `${f}: dati della rubrica non caricati`);
    assert.ok(html.includes('<script src="../assets/rubrica.js"></script>'), `${f}: rubrica non caricata`);
    assert.ok(html.includes("window.rubricaDestinatario()"), `${f}: la lettera non legge il destinatario dalla rubrica`);
    assert.ok(html.includes("window.rubricaCompleta(xmlL,_rub,areaVal,uffParts)"), `${f}: la lettera non completa le righe del destinatario`);
    // In HTML la barra rovesciata non protegge l'apice: value='All\'Area …' vale soltanto "All\".
    assert.ok(!/value='[^'>]*\\'/.test(html), `${f}: un attributo value e troncato da una barra rovesciata`);
  }
});

test("rubrica: i destinatari abituali hanno nomi e indirizzi della rubrica, uguali in tutti i moduli", () => {
  const opzioni = (html, id) => {
    const menu = new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html);
    assert.ok(menu, `menu ${id} assente`);
    return [...menu[1].matchAll(/<option value="([^"]*)">/g)].map((m) => m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  };
  const moduli = fs.readdirSync(path.join(RADICE, "modules")).filter((x) => x.endsWith(".html"));
  let primo = null;
  for (const f of moduli) {
    const html = leggi(path.join("modules", f));
    const aree = opzioni(html, "destA").filter(Boolean);
    const uffici = opzioni(html, "destU").filter((v) => v !== "|");
    assert.ok(uffici.length >= 5, `${f}: menu degli uffici quasi vuoto`);
    for (const valore of uffici) {
      const taglio = valore.lastIndexOf("|");
      const nome = valore.slice(0, taglio), codice = valore.slice(taglio + 1);
      const v = voce(codice);
      assert.ok(v, `${f}: ${codice} non esiste in rubrica`);
      const r = L.righe(v);
      // Una voce di vertice (21.0.0.0.0: Area Sicurezza e Servizio Polizia Locale) non ha riga del servizio.
      if (r.servizio) assert.equal(nome, r.servizio, `${f}: nome diverso dalla rubrica per ${codice}`);
      else assert.ok(v.n.includes(nome.replace(/^Servizio /, "")), `${f}: ${nome} non corrisponde a ${v.n}`);
      assert.ok(aree.includes(r.area), `${f}: manca tra le Aree quella di ${nome} (${r.area})`);
    }
    const tutteLeAree = new Set(VOCI.map((v) => L.righe(v).area));
    for (const a of aree) assert.ok(tutteLeAree.has(a), `${f}: "${a}" non corrisponde a nessuna struttura della rubrica`);
    const firma = JSON.stringify([aree, uffici]);
    if (primo === null) primo = firma;
    assert.equal(firma, primo, `${f}: menu diversi dagli altri moduli`);
  }
});

test("rubrica: i valori salvati prima dell'allineamento vengono tradotti in quelli nuovi", () => {
  const html = leggi("modules/sorvegliabilita.html");
  const valori = (id) => [...new RegExp(`<select id="${id}">([\\s\\S]*?)</select>`).exec(html)[1].matchAll(/<option value="([^"]*)">/g)].map((m) => m[1]);
  const aree = valori("destA"), uffici = valori("destU");
  assert.equal(L.traduciVecchio("All'Area Sviluppo Socio Economico e Competitivita", aree), "All'Area Sviluppo Economico");
  assert.equal(L.traduciVecchio("Alla Municipalita 4", aree), "Alla Direzione Municipalità 4");
  assert.equal(L.traduciVecchio("All'Area Sicurezza", aree), "All'Area Sicurezza");
  for (const vecchio of ["Servizio SUAP|11.11.0.0.0", "Servizio Tutela Ambiente|14.17.0.0.0", "Unita Operativa Attivita Tecniche|25.0.6.0.0", "Servizio Gestione Canoni e Altri Tributi|41.3.0.0.0"]) {
    const nuovo = L.traduciVecchio(vecchio, uffici);
    assert.ok(nuovo && nuovo.endsWith(vecchio.slice(vecchio.lastIndexOf("|"))), `non tradotto: ${vecchio}`);
  }
  assert.equal(L.traduciVecchio("Ufficio inesistente|0.0.0.0.1", uffici), null);
  assert.equal(L.traduciVecchio("|", uffici), "|");
});

test("rubrica: piu destinatari, con quelli per conoscenza in fondo dopo \"e, p.c.\"", () => {
  const riga2 = (testo, extra) => `<w:p><w:pPr><w:spacing w:before="0" w:after="20"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr>${extra}</w:rPr><w:t>${testo}</w:t></w:r></w:p>`;
  const lettera = riga2("All'Area Urbanistica", "") + riga2("Servizio Condono Edilizio", "<w:b/>") + riga2("Indirizzo di protocollo 9.8.0.0.0", "<w:i/>") + riga("Corpo della lettera");
  const altri = L.altriDa(JSON.stringify([
    { area: "All'Area Ambiente", servizio: "Servizio Verde & Giardini", indirizzo: "14.1.0.0.0", pc: true },
    { area: "All'Area Sicurezza", servizio: "U.O. San Lorenzo", indirizzo: "21.22.0.0.0", nome: "c.a. Dott. Rossi" },
    { area: "Al Sindaco", pc: true },
    { area: "", servizio: "" },
  ]));
  assert.equal(altri.length, 3, "una scheda vuota non e un destinatario");
  const esito = L.completa(lettera, { nome: "", altri }, "All'Area Urbanistica", ["Servizio Condono Edilizio", "9.8.0.0.0"]);
  assert.equal(esito.altriInseriti, true);
  assert.deepEqual(testi(esito.xml), [
    "All'Area Urbanistica", "Servizio Condono Edilizio", "Indirizzo di protocollo 9.8.0.0.0",
    "All'Area Sicurezza", "U.O. San Lorenzo", "c.a. Dott. Rossi", "Indirizzo di protocollo 21.22.0.0.0",
    "e, p.c.",
    "All'Area Ambiente", "Servizio Verde &amp; Giardini", "Indirizzo di protocollo 14.1.0.0.0",
    "Al Sindaco",
    "Corpo della lettera",
  ]);
  const paragrafi = esito.xml.match(/<w:p>[\s\S]*?<\/w:p>/g);
  assert.match(paragrafi[3], /w:before="160"[^>]*\/><w:jc w:val="right"\/>/, "manca lo stacco sopra il secondo destinatario");
  assert.match(paragrafi[4], /<w:b\/>/, "il servizio in piu non ha l'aspetto del servizio");
  assert.match(paragrafi[7], /<w:i\/>/, "\"e, p.c.\" deve avere l'aspetto della riga dell'indirizzo");
  assert.match(paragrafi[8], /w:before="40"/);
  assert.ok(esito.xml.indexOf("<w:spacing") < esito.xml.indexOf("<w:jc"), "spacing deve precedere jc");

  // Senza le righe del primo destinatario non si inventa una posizione: lo si segnala.
  assert.equal(L.completa(riga("solo corpo"), { altri }, "Area che non c'e", ["", "1.0.0.0.0"]).altriInseriti, false);
  // Nessun destinatario in piu: la lettera resta quella di prima.
  assert.equal(L.completa(lettera, { altri: [] }, "All'Area Urbanistica", ["Servizio Condono Edilizio", "9.8.0.0.0"]).xml, lettera);
  // Testo non valido nel campo salvato: nessun destinatario, nessun errore.
  assert.deepEqual([...L.altriDa("non e json")], []);
  assert.equal(L.altriDa(JSON.stringify(new Array(20).fill({ area: "X" }))).length, 6, "oltre sei destinatari non si va");
});
