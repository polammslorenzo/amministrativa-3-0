import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleRequest } from "../supabase/functions/agent/index.ts";

const origin = "https://armandoferrara.github.io";

function request(agent, moduleName, payload, requestOrigin = origin) {
  return new Request("https://example.supabase.co/functions/v1/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": requestOrigin },
    body: JSON.stringify({ agent, module: moduleName, payload }),
  });
}

function options(fetchImpl) {
  return {
    openaiApiKey: "test-key-not-secret",
    openaiModel: "gpt-5-mini",
    allowedOrigins: origin,
    fetchImpl,
  };
}

test("extractor invia il PDF come input_file e usa JSON Schema rigoroso", async () => {
  const pdf = Buffer.from("%PDF-1.4\n% test\n");
  const expected = {
    module: "esposto",
    confidence: "alta",
    routeReason: "Il documento è un esposto.",
    isSupported: true,
    needsConfirmation: false,
    practice: { id: "", subject: "Rumori", location: "Via Roma 1", protocol: "PG 123", date: "2026", notes: "" },
    fields: { pgEsposto: "123", annoEsposto: "2026", oggetto: "Rumori", via: "Via Roma 1", mittente: "Mario Rossi" },
    sourceSummary: "Esposto relativo a rumori.",
    keyFacts: ["Segnalazione per rumori"],
    missingInformation: ["Esito dell'accertamento"],
    warnings: [],
  };
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, "gpt-5-mini");
    assert.equal(body.store, false);
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.max_output_tokens, 5000);
    assert.equal(body.text.format.type, "json_schema");
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.equal(body.input[0].content[0].type, "input_file");
    assert.match(body.input[0].content[0].file_data, /^data:application\/pdf;base64,/);
    return new Response(JSON.stringify({ output_text: JSON.stringify(expected) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const response = await handleRequest(request("extractor", "esposto", {
    practice: {},
    document: { filename: "esposto.pdf", mimeType: "application/pdf", size: pdf.length, base64: pdf.toString("base64") },
  }), options(mockFetch));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.deepEqual(data.fields, expected.fields);
});

test("extractor ritenta automaticamente una risposta incompleta", async () => {
  const expected = {
    module: "esposto",
    confidence: "alta",
    routeReason: "Il documento è un esposto.",
    isSupported: true,
    needsConfirmation: false,
    practice: { id: "", subject: "Rumori", location: "Via Roma 1", protocol: "PG 123", date: "2026", notes: "" },
    fields: { pgEsposto: "123", annoEsposto: "2026", oggetto: "Rumori", via: "Via Roma 1", mittente: "Mario Rossi" },
    sourceSummary: "Esposto relativo a rumori.",
    keyFacts: ["Segnalazione per rumori"],
    missingInformation: ["Esito dell'accertamento"],
    warnings: [],
  };
  let calls = 0;
  const mockFetch = async (_url, init) => {
    calls += 1;
    const body = JSON.parse(init.body);
    if (calls === 1) {
      assert.equal(body.max_output_tokens, 5000);
      return new Response(JSON.stringify({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_text: '{"module":"esposto"',
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    assert.equal(body.max_output_tokens, 8000);
    assert.equal(body.reasoning.effort, "low");
    return new Response(JSON.stringify({ status: "completed", output_text: JSON.stringify(expected) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const response = await handleRequest(request("extractor", "esposto", {
    sourceText: "Esposto PG 123 anno 2026 presentato da Mario Rossi per rumori in Via Roma 1.",
  }), options(mockFetch));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.fields.pgEsposto, "123");
});

test("extractor non accetta JSON formalmente valido ma fuori schema", async () => {
  let calls = 0;
  const mockFetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ status: "completed", output_text: "{}" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const response = await handleRequest(request("extractor", "ricettive", {
    sourceText: "Documento di prova.",
  }), options(mockFetch));
  assert.equal(response.status, 502);
  assert.equal(calls, 2);
  const data = await response.json();
  assert.equal(data.error.code, "INVALID_STRUCTURED_OUTPUT");
});

test("writer applica il routing del modulo e rimuove Markdown e asterischi", async () => {
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.instructions, /struttura ricettiva/i);
    assert.match(body.instructions, /Non inventare/i);
    assert.match(body.input, /posti letto/i);
    assert.equal(body.reasoning.effort, "low");
    assert.equal(body.max_output_tokens, 4000);
    assert.equal(body.text.format.type, "json_schema");
    return new Response(JSON.stringify({ output_text: JSON.stringify({
      summary: "**Controllo di una struttura ricettiva.**",
      text: "**Nel corso del controllo** risultavano indicati dieci posti letto.",
      suggestions: ["*Verificare la capienza dichiarata.*"],
      missingInformation: ["Data del controllo"],
      nextQuestion: "Qual è la data del controllo?",
    }) }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  const response = await handleRequest(request("writer", "ricettive", {
    draft: "Risultavano indicati dieci posti letto.",
  }), options(mockFetch));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.text, "Nel corso del controllo risultavano indicati dieci posti letto.");
  assert.equal(data.text.includes("*"), false);
  assert.equal(data.summary, "Controllo di una struttura ricettiva.");
  assert.deepEqual(data.suggestions, ["Verificare la capienza dichiarata."]);
});

test("extractor automatico classifica, riassume e restituisce campi per il percorso", async () => {
  const allFields = {
    praticaId: "", richiedente: "", ubicazione: "", periodo: "", parere: "da_verificare", motivazione: "", prescrizioni: "",
    pgEsposto: "456", annoEsposto: "2026", oggetto: "Segnalazione rumori", via: "Via Verdi 8", mittente: "Anna Bianchi",
    pgRif: "", dataRif: "", protSUAP: "", titolare: "", nomeStruttura: "",
  };
  const expected = {
    module: "esposto",
    confidence: "alta",
    routeReason: "È una segnalazione presentata da una cittadina.",
    isSupported: true,
    needsConfirmation: false,
    practice: { id: "456", subject: "Segnalazione rumori", location: "Via Verdi 8", protocol: "PG 456", date: "2026", notes: "" },
    fields: allFields,
    sourceSummary: "La cittadina segnala rumori provenienti da Via Verdi 8.",
    keyFacts: ["Mittente: Anna Bianchi", "Ubicazione: Via Verdi 8"],
    missingInformation: ["Esito del sopralluogo"],
    warnings: [],
  };
  const mockFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.match(body.input[0].content.at(-1).text, /Classifica la pratica/i);
    assert.deepEqual(body.text.format.schema.properties.module.enum, ["edili", "esposto", "sorvegliabilita", "ricettive"]);
    return new Response(JSON.stringify({ output_text: JSON.stringify(expected) }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const response = await handleRequest(request("extractor", "auto", { sourceText: "Esposto PG 456 per rumori in Via Verdi 8." }), options(mockFetch));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.module, "esposto");
  assert.equal(data.sourceSummary, expected.sourceSummary);
  assert.deepEqual(data.missingInformation, ["Esito del sopralluogo"]);
});

test("CORS rifiuta origini diverse da quella configurata", async () => {
  const response = await handleRequest(
    request("writer", "edili", { draft: "testo" }, "https://evil.example"),
    options(async () => { throw new Error("non deve essere chiamata"); }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const data = await response.json();
  assert.equal(data.error.code, "ORIGIN_NOT_ALLOWED");
});

test("preflight locale è ammesso", async () => {
  const response = await handleRequest(new Request("https://example.supabase.co/functions/v1/agent", {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:8080" },
  }), options(async () => { throw new Error("non deve essere chiamata"); }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:8080");
});

test("apertura diretta file:// è ammessa solo con ALLOW_FILE_ORIGIN", async () => {
  const chiusa = await handleRequest(new Request("https://example.supabase.co/functions/v1/agent", {
    method: "OPTIONS",
    headers: { "Origin": "null" },
  }), options(async () => { throw new Error("non deve essere chiamata"); }));
  assert.equal(chiusa.status, 403);

  const aperta = await handleRequest(new Request("https://example.supabase.co/functions/v1/agent", {
    method: "OPTIONS",
    headers: { "Origin": "null" },
  }), { ...options(async () => { throw new Error("non deve essere chiamata"); }), allowFileOrigin: true });
  assert.equal(aperta.status, 204);
  assert.equal(aperta.headers.get("access-control-allow-origin"), "null");
});

test("una richiesta senza intestazione Origin viene rifiutata", async () => {
  const response = await handleRequest(new Request("https://example.supabase.co/functions/v1/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent: "writer", module: "edili", payload: { draft: "testo" } }),
  }), options(async () => { throw new Error("non deve essere chiamata"); }));
  assert.equal(response.status, 403);
  const data = await response.json();
  assert.equal(data.error.code, "ORIGIN_NOT_ALLOWED");
});

test("senza ALLOWED_ORIGINS non si apre a qualunque github.io", async () => {
  const base = options(async () => { throw new Error("non deve essere chiamata"); });
  const response = await handleRequest(
    request("writer", "edili", { draft: "testo" }, "https://sconosciuto.github.io"),
    { ...base, allowedOrigins: "" },
  );
  assert.equal(response.status, 403);
});

test("documenti non PDF o oltre limite vengono rifiutati prima di OpenAI", async () => {
  const response = await handleRequest(request("extractor", "edili", {
    document: { filename: "pratica.txt", mimeType: "text/plain", size: 4, base64: "dGVzdA==" },
  }), options(async () => { throw new Error("non deve essere chiamata"); }));
  assert.equal(response.status, 400);
  const data = await response.json();
  assert.equal(data.error.code, "INVALID_DOCUMENT");
});

test("il client usa l'URL completo senza aggiungere /agent due volte", () => {
  const client = fs.readFileSync(path.resolve(import.meta.dirname, "../assets/workflow.js"), "utf8");
  assert.match(client, /fetch\(endpoint,/);
  assert.doesNotMatch(client, /fetch\(base\s*\+\s*["']\/agent/);
});
