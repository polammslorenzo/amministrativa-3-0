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
