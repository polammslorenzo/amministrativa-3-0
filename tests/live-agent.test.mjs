import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../supabase/functions/agent/index.ts";

const apiKey = process.env.OPENAI_API_KEY || "";
const live = apiKey ? test : test.skip;
const runtime = { openaiApiKey: apiKey, openaiModel: process.env.OPENAI_MODEL || "gpt-5-mini", allowedOrigins: "http://localhost:8080" };

function request(agent, moduleName, payload) {
  return new Request("http://localhost/functions/v1/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Origin": "http://localhost:8080" },
    body: JSON.stringify({ agent, module: moduleName, payload }),
  });
}

live("chiamata reale extractor con output strutturato", async () => {
  const response = await handleRequest(request("extractor", "esposto", {
    sourceText: "Esposto PG 1234 dell'anno 2026 presentato da Mario Rossi per rumori in Via Roma 10.",
    practice: {},
  }), runtime);
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(data.agent, "extractor");
  assert.equal(data.module, "esposto");
  assert.equal(typeof data.fields.pgEsposto, "string");
});

live("chiamata reale writer senza Markdown", async () => {
  const response = await handleRequest(request("writer", "ricettive", {
    draft: "Durante il controllo risultavano indicati dieci posti letto.",
    practice: { subject: "Struttura Alfa", location: "Via Roma 10" },
  }), runtime);
  assert.equal(response.status, 200, await response.clone().text());
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.equal(typeof data.text, "string");
  assert.ok(data.text.length > 10);
  assert.equal(/[\*`]/.test(data.text), false);
});
