// Controlli strutturali sui file HTML: intercettano due difetti che il browser
// non segnala in alcun modo e che quindi arriverebbero online inosservati.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const RADICE = path.resolve(import.meta.dirname, "..");

function fileHtml() {
  const elenco = fs.readdirSync(RADICE).filter((f) => f.endsWith(".html"));
  const moduli = path.join(RADICE, "modules");
  if (fs.existsSync(moduli)) {
    for (const f of fs.readdirSync(moduli)) {
      if (f.endsWith(".html")) elenco.push(path.join("modules", f));
    }
  }
  return elenco.sort();
}

const TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const HA_SRC = /\bsrc\s*=/i;
const TIPO = /\btype\s*=\s*["']([^"']+)["']/i;
const TIPI_JS = ["", "text/javascript", "application/javascript", "module"];

function blocchi(testo) {
  const trovati = [];
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(testo)) !== null) {
    const tipo = (TIPO.exec(m[1])?.[1] || "").toLowerCase();
    trovati.push({
      codice: m[2],
      conSrc: HA_SRC.test(m[1]),
      javascript: TIPI_JS.includes(tipo),
      riga: testo.slice(0, m.index).split("\n").length,
    });
  }
  return trovati;
}

test("nessuno <script src> contiene codice: l'HTML lo ignorerebbe in silenzio", () => {
  const problemi = [];
  for (const f of fileHtml()) {
    const testo = fs.readFileSync(path.join(RADICE, f), "utf8");
    for (const b of blocchi(testo)) {
      if (b.conSrc && b.codice.trim()) {
        const righe = b.codice.trim().split("\n").length;
        problemi.push(
          `${f}:${b.riga} — ${righe} righe di codice dentro un <script src>. ` +
            `Il browser carica il file esterno e ignora questo codice senza segnalare nulla. ` +
            `Chiudere il tag con </script> e aprirne uno nuovo per il codice.`,
        );
      }
    }
  }
  assert.deepEqual(problemi, [], "\n  " + problemi.join("\n  "));
});

test("ogni script in linea e sintatticamente valido", () => {
  const problemi = [];
  for (const f of fileHtml()) {
    const testo = fs.readFileSync(path.join(RADICE, f), "utf8");
    for (const b of blocchi(testo)) {
      if (b.conSrc || !b.javascript || !b.codice.trim()) continue;
      try {
        new vm.Script(b.codice, { filename: f });
      } catch (e) {
        problemi.push(
          `${f}: blocco che inizia a riga ${b.riga} — ${e.message}. ` +
            `Un errore di sintassi annulla l'intero blocco: tutte le funzioni che contiene spariscono.`,
        );
      }
    }
  }
  assert.deepEqual(problemi, [], "\n  " + problemi.join("\n  "));
});

test("ogni pagina carica il tema condiviso, dopo i propri stili", () => {
  for (const f of ["tema.css", "tema-moduli.css", "tema-dashboard.css", "tema.js"]) {
    assert.ok(fs.existsSync(path.join(RADICE, "assets", f)), `manca assets/${f}`);
  }
  const valori = fs.readFileSync(path.join(RADICE, "assets", "tema.css"), "utf8");
  for (const f of fileHtml()) {
    const testo = fs.readFileSync(path.join(RADICE, f), "utf8");
    const modulo = f.startsWith("modules");
    const base = modulo ? "../assets/" : "assets/";
    const aspetto = modulo ? "tema-moduli.css" : "tema-dashboard.css";
    const iValori = testo.indexOf(`href="${base}tema.css"`);
    const iAspetto = testo.indexOf(`href="${base}${aspetto}"`);
    assert.ok(iValori > 0 && iAspetto > iValori, `${f}: tema non caricato, o caricato nell'ordine sbagliato`);
    assert.ok(iValori > testo.lastIndexOf("</style>", testo.indexOf("</head>")), `${f}: il tema deve venire dopo gli stili della pagina`);
    if (modulo) assert.ok(testo.includes('src="../assets/tema.js"'), `${f}: tema.js non caricato`);
    // Ogni variabile usata dal foglio di aspetto deve essere definita in tema.css.
    const foglio = fs.readFileSync(path.join(RADICE, "assets", aspetto), "utf8");
    for (const nome of new Set([...foglio.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))) {
      assert.ok(valori.includes(nome + ":"), `${aspetto} usa ${nome}, che tema.css non definisce`);
    }
  }
});

// ---- Modelli Word chiusi dentro i moduli ----
// Lettura minima di un file .docx (uno zip) senza librerie: basta per controllare il pie' di pagina.
import zlib from "node:zlib";
function leggiZip(buffer) {
  const fine = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(fine >= 0, "zip senza indice");
  const quanti = buffer.readUInt16LE(fine + 10);
  let p = buffer.readUInt32LE(fine + 16);
  const file = {};
  for (let i = 0; i < quanti; i++) {
    const metodo = buffer.readUInt16LE(p + 10), compresso = buffer.readUInt32LE(p + 20);
    const lNome = buffer.readUInt16LE(p + 28), lExtra = buffer.readUInt16LE(p + 30), lNota = buffer.readUInt16LE(p + 32);
    const locale = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString("utf8", p + 46, p + 46 + lNome);
    const inizio = locale + 30 + buffer.readUInt16LE(locale + 26) + buffer.readUInt16LE(locale + 28);
    const dati = buffer.subarray(inizio, inizio + compresso);
    file[nome] = metodo === 0 ? dati : zlib.inflateRawSync(dati);
    p += 46 + lNome + lExtra + lNota;
  }
  return file;
}

test("ogni modello Word ha il pie' di pagina dell'ufficio e non stira le righe prima di un a capo", () => {
  let modelli = 0;
  for (const f of fileHtml().filter((x) => x.startsWith("modules"))) {
    const testo = fs.readFileSync(path.join(RADICE, f), "utf8");
    for (const m of testo.matchAll(/([A-Za-z_]\w*)\s*[:=]\s*'(UEsDB[A-Za-z0-9+/=]{2000,})'/g)) {
      modelli++;
      const dove = `${f}, modello ${m[1]}`;
      const zip = leggiZip(Buffer.from(m[2], "base64"));
      const piede = (zip["word/footer1.xml"] || Buffer.alloc(0)).toString("utf8");
      assert.ok(piede.includes("POLIZIA AMMINISTRATIVA"), `${dove}: manca la firma dell'ufficio nel pie' di pagina`);
      assert.ok(piede.includes("Via Cesare Rosaroll, 31"), `${dove}: manca la sede nel pie' di pagina`);
      assert.ok(piede.includes(" PAGE ") && piede.includes(" NUMPAGES "), `${dove}: manca "Pag. X / Y"`);
      for (const recapito of ["081 7952809", "polizialocale.sanlorenzo@comune.napoli.it", "polizialocale.sanlorenzo@pec.comune.napoli.it"]) {
        assert.ok(piede.includes(recapito), `${dove}: manca il recapito ${recapito} nel pie' di pagina`);
      }
      // Testo giustificato con a capo (MAIUSC+INVIO): senza questa opzione Word stira la riga prima dell'a capo.
      const impostazioni = (zip["word/settings.xml"] || Buffer.alloc(0)).toString("utf8");
      assert.match(impostazioni, /<w:compat>\s*<w:doNotExpandShiftReturn\/>/, `${dove}: manca l'opzione che evita le righe stirate prima di un a capo`);
      const legame = /r:embed="([^"]+)"/.exec(piede);
      assert.ok(legame, `${dove}: manca il marchio nel pie' di pagina`);
      const relazioni = (zip["word/_rels/footer1.xml.rels"] || Buffer.alloc(0)).toString("utf8");
      const bersaglio = new RegExp(`Id="${legame[1]}"[^>]*Target="([^"]+)"`).exec(relazioni);
      assert.ok(bersaglio && zip["word/" + bersaglio[1]] && zip["word/" + bersaglio[1]].length > 1000, `${dove}: l'immagine del marchio non e nel modello`);
    }
  }
  assert.ok(modelli >= 9, `trovati solo ${modelli} modelli Word`);
});

// ---- Lettera di trasmissione comune (assets/lettera.js) ----
function caricaLettera() {
  const finestra = {};
  vm.runInContext(fs.readFileSync(path.join(RADICE, "assets", "lettera.js"), "utf8"), vm.createContext({ window: finestra }));
  return finestra.ADMIN3_LETTERA;
}
function testiParagrafi(xml) {
  return (xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
    .map((p) => (p.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""))
    .filter((t) => t.trim());
}

test("lettera comune: date, PG e nomi degli agenti", () => {
  const L = caricaLettera();
  assert.equal(L.data("16/10/26"), "16.10.2026");
  assert.equal(L.data("2026-10-16"), "16.10.2026");
  assert.equal(L.data("4.9.2026"), "04.09.2026");
  assert.equal(L.protocollo("1097676", "13/10/2026"), "PG/2026/1097676 del 13.10.2026");
  assert.equal(L.protocollo("PG/2025/1200", ""), "PG/2025/1200");
  assert.equal(L.protocollo("301627", "09.03.2026", "2025"), "PG/2025/301627 del 09.03.2026");
  assert.equal(L.protocollo("", "13.10.2026"), "");
  assert.equal(L.agenti(["A.C. FERRARA 3015", "ASS SEBASTIANO 639S", "AC DI MARTINO 046S", "AG. ESPOSITO 2583"]), "A.C. Ferrara – Ass. Sebastiano – A.C. Di Martino – Ag. Esposito");
  assert.equal(L.corpo("il parere redatto", []), "Si trasmette, in allegato, il parere redatto dal personale di questa U.O. in merito a quanto in oggetto.");
});

test("lettera comune: compone il modello di ogni modulo e rifinisce data in calce e firma", () => {
  const L = caricaLettera();
  let lettere = 0;
  for (const f of fileHtml().filter((x) => x.startsWith("modules"))) {
    const testo = fs.readFileSync(path.join(RADICE, f), "utf8");
    assert.ok(testo.includes('<script src="../assets/lettera.js"></script>'), `${f}: lettera.js non caricato`);
    for (const m of testo.matchAll(/([A-Za-z_]\w*)\s*[:=]\s*'(UEsDB[A-Za-z0-9+/=]{2000,})'/g)) {
      const xml = leggiZip(Buffer.from(m[2], "base64"))["word/document.xml"].toString("utf8");
      const finito = L.rifinisci(xml);
      const righe = testiParagrafi(finito);
      assert.ok(righe.includes("Napoli, data del protocollo"), `${f} ${m[1]}: manca "Napoli, data del protocollo"`);
      assert.ok(!righe.some((r) => /^Napoli,\s*li/.test(r)), `${f} ${m[1]}: resta una data in calce`);
      assert.ok(righe.includes("Firma autografa sostituita a mezzo stampa ai sensi dell’art. 3, comma 2, del D.Lgs. 39/1993"), `${f} ${m[1]}: formula di firma`);
      const calce = finito.match(/<w:p(?:\s[^>]*)?>(?:(?!<\/w:p>)[\s\S])*Napoli, data del protocollo[\s\S]*?<\/w:p>/)[0];
      assert.match(calce, /<w:rPr><w:rFonts[^>]*\/><w:i\/><w:iCs\/>/, `${f} ${m[1]}: la data in calce non e' in corsivo o le proprieta' sono fuori ordine`);
      if (!xml.includes("CONTROLLO POSTEGGIO MERCATO CARAMANICO")) continue;
      lettere++;
      const lettera = testiParagrafi(L.componi(xml, {
        pg: "PG/2026/1101234", data: "22/10/26",
        riferimenti: [["Rif. Vs. nota: ", "PG/2026/948424 del 11.09.2026"], ["Pratica: ", ""], ["Rif. Prot. SUAP: ", "1201698/2025"]],
        oggetto: "Riscontro Vs. nota PG/2026/948424 del 11.09.2026 – Richiesta controlli",
        corpo: L.corpo("la relazione di servizio redatta", ["ASS SEBASTIANO 639S"]),
        dati: [["Attività: ", "chiosco edicola"], ["Ubicazione: ", ""]],
      }));
      const attese = [
        "PG/2026/1101234   del   22.10.2026",
        "Rif. Vs. nota: PG/2026/948424 del 11.09.2026",
        "Rif. Prot. SUAP: 1201698/2025",
        "OGGETTO",
        "Riscontro Vs. nota PG/2026/948424 del 11.09.2026 – Richiesta controlli",
        "Si trasmette, in allegato, la relazione di servizio redatta dal personale di questa U.O. (Ass. Sebastiano) in merito a quanto in oggetto.",
        "Attività: chiosco edicola",
        "Si resta a disposizione per ogni ulteriore chiarimento.",
      ];
      let da = 0;
      for (const riga of attese) {
        const i = lettera.indexOf(riga, da);
        assert.ok(i >= 0, `${f} ${m[1]}: manca o e' fuori posto "${riga}"\n${lettera.join("\n")}`);
        da = i + 1;
      }
      for (const via of ["Pratica:", "Riscontro accertamento", "Ubicazione:", "Trasmissione atti", "c_f839"]) {
        assert.ok(!lettera.some((r) => r.includes(via)), `${f} ${m[1]}: resta "${via}"`);
      }
    }
  }
  assert.equal(lettere, 5, "una lettera di trasmissione per modulo");
});
