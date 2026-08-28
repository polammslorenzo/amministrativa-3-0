import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";


const root = path.resolve(import.meta.dirname, "..");


test("la dashboard inoltra richieste AI solo dal proprio iframe", async () => {
  const listeners = {};
  const replies = [];
  const requests = [];
  const childWindow = { postMessage: (message) => replies.push(message) };
  const frame = { contentWindow: childWindow };
  const storage = new Map();
  const windowObject = {
    ADMIN3_CONFIG: { AI_AGENT_URL: "https://example.supabase.co/functions/v1/agent" },
    addEventListener: (type, listener) => { listeners[type] = listener; },
  };
  const context = vm.createContext({
    window: windowObject,
    document: { getElementById: (id) => id === "frame" ? frame : null },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    fetch: async (_url, init) => {
      requests.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        ok: true,
        practice: { id: "P-1", subject: "Oggetto", location: "Via Roma", protocol: "PG 1", date: "", notes: "" },
        fields: { praticaId: "P-1" },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    Response,
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "assets/workflow.js"), "utf8"), context);

  await listeners.message({
    source: childWindow,
    data: {
      channel: "ADMIN3_BRIDGE",
      type: "agent-request",
      id: "req-1",
      agent: "extractor",
      module: "edili",
      payload: { document: { filename: "test.pdf" } },
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].module, "edili");
  assert.equal(requests[0].agent, "extractor");
  assert.equal(typeof requests[0].payload.practice, "object");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].ok, true);
  assert.equal(windowObject.ADMIN3.state.practice.id, "P-1");

  await listeners.message({
    source: { postMessage() {} },
    data: { channel: "ADMIN3_BRIDGE", type: "agent-request", id: "spoof", agent: "writer", module: "edili", payload: {} },
  });
  assert.equal(requests.length, 1);
});


test("il modulo usa postMessage quando Chrome blocca parent.ADMIN3", async () => {
  const listeners = {};
  const notifications = [];
  const elements = new Map();
  function element(value = "") {
    return {
      value,
      disabled: false,
      innerHTML: "Pulsante",
      textContent: "",
      dataset: {},
      style: {},
      dispatchEvent() {},
    };
  }
  elements.set("accertato", element("Bozza confermata dall'operatore."));
  elements.set("ogg", element("Esposto per rumori"));
  elements.set("via", element("Via Roma 1"));
  elements.set("mitt", element("Mario Rossi"));
  elements.set("bGenTesto", element());
  elements.set("testoGen", element());
  elements.set("genbox", element());

  let moduleMessageListener;
  const parentMessages = [];
  let directAccessAttempts = 0;
  const parentProxy = {
    get ADMIN3() {
      directAccessAttempts += 1;
      throw new DOMException("Blocked a frame with origin null", "SecurityError");
    },
    postMessage(message) {
      parentMessages.push(message);
      if (message.type !== "agent-request") return;
      setTimeout(() => moduleMessageListener({
        source: parentProxy,
        data: {
          channel: "ADMIN3_BRIDGE",
          type: "agent-response",
          id: message.id,
          ok: true,
          result: { text: "Testo formalizzato senza Markdown." },
        },
      }), 0);
    },
  };
  const windowObject = {
    parent: parentProxy,
    addEventListener(type, listener) {
      listeners[type] = listener;
      if (type === "message") moduleMessageListener = listener;
    },
    mostraMsg: (type, message) => notifications.push({ type, message }),
  };
  const context = vm.createContext({
    window: windowObject,
    document: { getElementById: (id) => elements.get(id) || null },
    location: { pathname: "/modules/riscontro-esposto.html", protocol: "file:" },
    DOMException,
    Event: class Event { constructor(type) { this.type = type; } },
    FileReader: class FileReader {},
    Promise,
    Map,
    Date,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "assets/module-ai-bridge.js"), "utf8"), context);

  await windowObject.genTesto();

  const parentRequest = parentMessages.find((message) => message.type === "agent-request");
  assert.equal(parentRequest.type, "agent-request");
  assert.equal(directAccessAttempts, 0);
  assert.equal(parentRequest.module, "esposto");
  assert.equal(parentRequest.agent, "writer");
  assert.equal(elements.get("testoGen").value, "Testo formalizzato senza Markdown.");
  assert.equal(elements.get("genbox").style.display, "block");
  assert.equal(notifications.at(-1).type, "O");
});

test("nuova pratica azzera estrazione, redazione e bozze salvate", () => {
  const listeners = {};
  const storage = new Map([
    ["amm20_pareri-edili.html_draft", "vecchia bozza"],
    ["amm20_riscontro-esposto.html_draft", "vecchia bozza"],
  ]);
  const childMessages = [];
  const childWindow = { postMessage: (message) => childMessages.push(message) };
  const frame = { contentWindow: childWindow };
  const windowObject = {
    ADMIN3_CONFIG: {},
    addEventListener: (type, listener) => { listeners[type] = listener; },
  };
  const context = vm.createContext({
    window: windowObject,
    document: { getElementById: (id) => id === "frame" ? frame : null },
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async () => { throw new Error("non deve essere chiamata"); },
    Math,
    Date,
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(root, "assets/workflow.js"), "utf8"), context);
  windowObject.ADMIN3.state.module = "esposto";
  windowObject.ADMIN3.state.extraction = { module: "esposto" };
  windowObject.ADMIN3.state.writer = { text: "vecchio testo" };
  windowObject.ADMIN3.state.draft = "vecchio testo";
  windowObject.ADMIN3.reset();

  assert.equal(windowObject.ADMIN3.state.module, null);
  assert.equal(windowObject.ADMIN3.state.extraction, null);
  assert.equal(windowObject.ADMIN3.state.writer, null);
  assert.equal(windowObject.ADMIN3.state.draft, "");
  assert.equal(storage.has("amm20_pareri-edili.html_draft"), false);
  assert.equal(storage.has("amm20_riscontro-esposto.html_draft"), false);
  assert.equal(childMessages.at(-1).type, "module-reset");
});
