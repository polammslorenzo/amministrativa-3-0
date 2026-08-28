// I quattro strati di Amministrativa 3.0 si parlano confrontando stringhe
// letterali: index.ts -> workflow.js -> module-ai-bridge.js -> modules/*.html.
// Nessun compilatore verifica la corrispondenza, e quando una stringa cambia da
// un lato solo non esplode niente: il campo resta vuoto e nessuno se ne accorge.
// Questi test leggono i file veri, HTML compreso, e non usano fixture.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const AGENT = read("supabase/functions/agent/index.ts");
const WORKFLOW = read("assets/workflow.js");
const BRIDGE = read("assets/module-ai-bridge.js");
const DASHBOARD = read("index.html");

const MODULE_FILES = {
  edili: "modules/pareri-edili.html",
  esposto: "modules/riscontro-esposto.html",
  sorvegliabilita: "modules/sorvegliabilita.html",
  ricettive: "modules/strutture-ricettive.html",
};
const MODULE_HTML = Object.fromEntries(
  Object.entries(MODULE_FILES).map(([key, file]) => [key, read(file)]),
);

function slice(source, from, to) {
  const start = source.indexOf(from);
  assert.notEqual(start, -1, `blocco non trovato: ${from}`);
  const end = to ? source.indexOf(to, start + from.length) : -1;
  return source.slice(start, end === -1 ? source.length : end);
}

function matchAll(source, pattern) {
  return [...source.matchAll(pattern)];
}

// Gli id dichiarati nell'HTML, con apici doppi o singoli: i quattro moduli
// usano entrambe le convenzioni.
function idsOf(html) {
  return new Set(matchAll(html, /\bid=["']([A-Za-z0-9_-]+)["']/g).map((m) => m[1]));
}

test("catena dei nomi di campo: schema dell'Estrattore, bridge, HTML del modulo", () => {
  const schemaBlock = slice(AGENT, "const EXTRACTOR_FIELDS", "const ALL_EXTRACTOR_FIELDS");
  const schema = {};
  for (const key of Object.keys(MODULE_FILES)) {
    const block = slice(schemaBlock, `  ${key}: {`, "\n  },");
    schema[key] = new Set(matchAll(block, /^\s{4}(\w+):/gm).map((m) => m[1]));
    assert.ok(schema[key].size > 0, `EXTRACTOR_FIELDS.${key} è vuoto`);
  }

  const applyBlock = slice(BRIDGE, "function applyExtractionFields", "function applyHydration");
  const parts = applyBlock.split(/current === "(\w+)"/);
  const branches = {};
  for (let i = 1; i < parts.length; i += 2) branches[parts[i]] = parts[i + 1];

  assert.deepEqual(
    Object.keys(branches).sort(),
    Object.keys(MODULE_FILES).sort(),
    "applyExtractionFields non tratta esattamente i quattro moduli",
  );

  for (const [key, chunk] of Object.entries(branches)) {
    const ids = idsOf(MODULE_HTML[key]);
    // normDate() può avvolgere il valore prima di scriverlo nel campo.
    const pairs = matchAll(chunk, /put\("([A-Za-z0-9_-]+)",\s*(?:\w+\()?fields\.(\w+)/g);
    assert.ok(pairs.length > 0, `nessun put() nel ramo ${key}`);
    for (const [, elementId, schemaField] of pairs) {
      assert.ok(
        schema[key].has(schemaField),
        `${key}: il bridge legge fields.${schemaField}, assente da EXTRACTOR_FIELDS.${key}`,
      );
      assert.ok(
        ids.has(elementId),
        `${key}: il bridge scrive in #${elementId}, assente da ${MODULE_FILES[key]}`,
      );
    }
  }
});

test("updateCommonPractice: ogni sorgente esiste nel modulo corrispondente", () => {
  // È il contratto che si era già rotto una volta: la mappatura cercava
  // pgEsposto mentre il campo del modulo si chiama pgE.
  const block = slice(WORKFLOW, "function updateCommonPractice", "function hydrateFrame");
  for (const key of Object.keys(MODULE_FILES)) {
    const line = slice(block, `${key}: {`, "},");
    const sources = matchAll(line, /\w+:\s*"([A-Za-z0-9_-]+)"/g).map((m) => m[1]);
    assert.ok(sources.length > 0, `mappatura mancante per ${key}`);
    const ids = idsOf(MODULE_HTML[key]);
    for (const source of sources) {
      assert.ok(
        ids.has(source),
        `${key}: updateCommonPractice legge #${source}, assente da ${MODULE_FILES[key]}`,
      );
    }
  }
});

test("le chiavi di modulo coincidono in tutti i punti in cui sono scritte", () => {
  const expected = Object.keys(MODULE_FILES).sort();
  const listOf = (source, marker) =>
    matchAll(slice(source, marker, "]"), /"(\w+)"/g).map((m) => m[1]).sort();

  assert.deepEqual(listOf(AGENT, "const MODULES ="), expected, "MODULES in index.ts");
  assert.deepEqual(listOf(WORKFLOW, "const MODULES ="), expected, "MODULES in workflow.js");

  const meta = slice(DASHBOARD, "const MODULE_META=", "};");
  assert.deepEqual(
    matchAll(meta, /(\w+):\{label:/g).map((m) => m[1]).sort(),
    expected,
    "MODULE_META in index.html",
  );

  assert.deepEqual(
    [...new Set(matchAll(DASHBOARD, /data-key="(\w+)"/g).map((m) => m[1]))].sort(),
    expected,
    "attributi data-key",
  );

  const select = slice(DASHBOARD, '<select id="routeSelect"', "</select>");
  assert.deepEqual(
    matchAll(select, /<option value="(\w+)">/g).map((m) => m[1]).sort(),
    expected,
    "option del select di conferma percorso",
  );

  const nameFn = slice(BRIDGE, "function moduleName()", "}\n");
  assert.deepEqual(
    matchAll(nameFn, /return "(\w+)"/g).map((m) => m[1]).sort(),
    expected,
    "rami di moduleName() nel bridge",
  );

  // moduleName() ricava la chiave dal nome del file: un rinomino la rompe in
  // silenzio, e i data-module devono puntare a file che esistono davvero.
  for (const [key, file] of Object.entries(MODULE_FILES)) {
    const basename = path.basename(file, ".html");
    assert.ok(
      nameFn.includes(`path.includes("${basename}")`),
      `moduleName() non riconosce più il file ${basename}.html`,
    );
    assert.ok(fs.existsSync(path.join(root, file)), `file mancante: ${file}`);
    assert.ok(
      DASHBOARD.includes(`data-module="${file}"`),
      `nessun data-module verso ${file}`,
    );
    assert.ok(
      meta.includes(`${key}:{label:`) && meta.includes(`path:"${file}"`),
      `MODULE_META non punta a ${file}`,
    );
  }
});

test("DRAFT_KEYS corrisponde alle chiavi che i moduli scrivono davvero", () => {
  // reset() cancella queste chiavi una per una: se un file viene rinominato,
  // la bozza vecchia sopravvive e la pratica nuova ne eredita il testo.
  const declared = matchAll(slice(WORKFLOW, "const DRAFT_KEYS", "];"), /"([^"]+)"/g)
    .map((m) => m[1]).sort();
  const produced = Object.values(MODULE_FILES)
    .map((file) => `amm20_${path.basename(file)}_draft`).sort();
  assert.deepEqual(declared, produced);

  for (const [key, html] of Object.entries(MODULE_HTML)) {
    assert.ok(
      html.includes("function storageKey(){return 'amm20_'+location.pathname.split('/').pop()+'_draft';}"),
      `${key}: storageKey() non produce più la chiave attesa`,
    );
  }
});

test("le funzioni e gli id che il bridge usa esistono nei moduli che li usano", () => {
  const richiesti = {
    edili: { funzioni: ["setTpl"], id: ["bAI", "dz", "fi"] },
    esposto: { funzioni: ["apriForm"], id: ["bGenTesto", "genbox", "dz", "fi"] },
    sorvegliabilita: { funzioni: ["apriForm", "setEsito"], id: ["bGenNC", "genbox", "dz", "fi"] },
    ricettive: { funzioni: ["apriForm", "setEsito"], id: ["bGenNC", "genbox", "dz", "fi"] },
  };

  for (const [key, atteso] of Object.entries(richiesti)) {
    const html = MODULE_HTML[key];
    const ids = idsOf(html);
    for (const nome of [...atteso.funzioni, "storageKey"]) {
      assert.ok(
        new RegExp(`function\\s+${nome}\\s*\\(`).test(html),
        `${key}: il bridge chiama ${nome}(), non definita in ${MODULE_FILES[key]}`,
      );
    }
    for (const id of atteso.id) {
      assert.ok(ids.has(id), `${key}: il bridge usa #${id}, assente da ${MODULE_FILES[key]}`);
    }
    // notify() prova mostraMsg e ripiega su msg: almeno una delle due deve
    // esistere, e le funzioni della bozza del modulo chiamano solo mostraMsg.
    assert.ok(
      /function\s+mostraMsg\s*\(/.test(html),
      `${key}: mostraMsg non definita, i messaggi della bozza resterebbero muti`,
    );
  }

  // Le tre chiavi con cui il bridge pilota il modello del parere.
  const applyBlock = slice(BRIDGE, "function applyExtractionFields", "function applyHydration");
  const chiavi = matchAll(applyBlock, /setTpl\("(\w+)"\)/g).map((m) => m[1]);
  assert.deepEqual([...new Set(chiavi)].sort(), ["fav", "favp", "sfav"]);
  const setTpl = slice(MODULE_HTML.edili, "function setTpl", "\n}");
  for (const chiave of ["fav", "favp", "sfav"]) {
    assert.ok(setTpl.includes(`'${chiave}'`), `setTpl non gestisce '${chiave}'`);
  }
});

test("i tipi dei messaggi coincidono sui due lati del ponte", () => {
  const inviati = (source) => new Set(matchAll(source, /type:\s*"([a-z-]+)"/g).map((m) => m[1]));
  // workflow.js ascolta agent-request nella forma negata: message.type !== "agent-request".
  const ascoltati = (source) => new Set(matchAll(source, /message\.type [!=]== "([a-z-]+)"/g).map((m) => m[1]));

  const dashboardInvia = inviati(WORKFLOW);
  const dashboardAscolta = ascoltati(WORKFLOW);
  const moduloInvia = inviati(BRIDGE);
  const moduloAscolta = ascoltati(BRIDGE);

  for (const tipo of moduloInvia) {
    assert.ok(dashboardAscolta.has(tipo), `il modulo manda "${tipo}" e la dashboard non lo ascolta`);
  }
  for (const tipo of dashboardInvia) {
    assert.ok(moduloAscolta.has(tipo), `la dashboard manda "${tipo}" e il modulo non lo ascolta`);
  }
  assert.deepEqual([...moduloInvia].sort(), ["agent-request", "module-ready", "new-practice-request", "practice-update"]);
  assert.deepEqual([...dashboardInvia].sort(), ["agent-response", "module-hydrate", "module-reset"]);

  const canali = new Set(matchAll(WORKFLOW + BRIDGE, /channel:\s*"([A-Z0-9_]+)"/g).map((m) => m[1]));
  assert.deepEqual([...canali], ["ADMIN3_BRIDGE"]);
});

test("i campi nascosti che pilotano il documento vengono risincronizzati", () => {
  // put() scrive tpl ed esito ma non muove i pulsanti né apre le sezioni:
  // senza risincronizzazione lo schermo mostra un esito e il .docx un altro.
  const resync = slice(BRIDGE, "function resyncModuleControls", "\n  }");
  const idratazione = slice(BRIDGE, "function applyHydration", "\n  }");
  assert.ok(idratazione.includes("resyncModuleControls("), "applyHydration non risincronizza i comandi");

  for (const [key, html] of Object.entries(MODULE_HTML)) {
    const nascosti = matchAll(html, /<input[^>]*type=["']hidden["'][^>]*>/g)
      .map((m) => (m[0].match(/id=["']([A-Za-z0-9_-]+)["']/) || [])[1])
      .filter(Boolean);
    for (const id of nascosti) {
      const setter = { tpl: "setTpl", esito: "setEsito" }[id];
      if (!setter) continue;
      assert.ok(
        new RegExp(`function\\s+${setter}\\s*\\(`).test(html),
        `${key}: #${id} non ha una funzione ${setter}()`,
      );
      assert.ok(
        resync.includes(`data.${id}`) && resync.includes(`window.${setter}`),
        `${key}: #${id} pilota il documento ma resyncModuleControls non lo tratta`,
      );
    }
  }
});
