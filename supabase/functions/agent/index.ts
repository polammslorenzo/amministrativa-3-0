const MODULES = ["edili", "esposto", "sorvegliabilita", "ricettive"] as const;
const AGENTS = ["extractor", "writer"] as const;

type ModuleName = (typeof MODULES)[number];
type RequestedModule = ModuleName | "auto";
type AgentName = (typeof AGENTS)[number];

export type RuntimeOptions = {
  openaiApiKey?: string;
  openaiModel?: string;
  allowedOrigins?: string;
  allowFileOrigin?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 100_000;
const MAX_WRITER_INPUT_CHARS = 60_000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 20;
const rateBuckets = new Map<string, number[]>();

const MODULE_LABELS: Record<ModuleName, string> = {
  edili: "Pareri Edili",
  esposto: "Riscontro Esposto",
  sorvegliabilita: "Sorvegliabilità",
  ricettive: "Strutture Ricettive",
};

const MODULE_ROUTING_GUIDE: Record<ModuleName, string> = {
  edili: "richieste e pareri edilizi, cantieri, lavori e trasmissioni connesse a pratiche edilizie",
  esposto: "esposti, reclami o segnalazioni di cittadini ai quali occorre dare riscontro",
  sorvegliabilita: "richieste SUAP sulla sorvegliabilità di esercizi o locali aperti al pubblico",
  ricettive: "strutture ricettive, B&B, affittacamere, case vacanze, locazioni brevi e relativi controlli",
};

const EXTRACTOR_FIELDS: Record<ModuleName, Record<string, unknown>> = {
  edili: {
    praticaId: { type: "string" },
    richiedente: { type: "string" },
    ubicazione: { type: "string" },
    periodo: { type: "string" },
    parere: {
      type: "string",
      enum: ["da_verificare", "favorevole", "favorevole_con_prescrizioni", "sfavorevole"],
    },
    motivazione: { type: "string" },
    prescrizioni: { type: "string" },
  },
  esposto: {
    pgEsposto: { type: "string" },
    annoEsposto: { type: "string" },
    oggetto: { type: "string" },
    via: { type: "string" },
    mittente: { type: "string" },
  },
  sorvegliabilita: {
    pgRif: { type: "string" },
    dataRif: { type: "string" },
    protSUAP: { type: "string" },
    via: { type: "string" },
    titolare: { type: "string" },
  },
  ricettive: {
    pgRif: { type: "string" },
    dataRif: { type: "string" },
    protSUAP: { type: "string" },
    via: { type: "string" },
    titolare: { type: "string" },
    nomeStruttura: { type: "string" },
  },
};

const ALL_EXTRACTOR_FIELDS = Object.assign({}, ...Object.values(EXTRACTOR_FIELDS));

const MODULE_EXTRACTOR_INSTRUCTIONS: Record<ModuleName, string> = {
  edili:
    "Estrai ID pratica, richiedente, ubicazione e periodo. L'Estrattore non decide l'esito: usa parere=da_verificare, salvo che il documento contenga già un parere esplicito e inequivoco; non dedurre prescrizioni o motivazioni.",
  esposto:
    "Estrai esclusivamente PG, anno, oggetto sintetico, ubicazione e mittente dell'esposto o reclamo.",
  sorvegliabilita:
    "Estrai esclusivamente i riferimenti della richiesta SUAP: PG, data, protocollo SUAP, indirizzo del locale e titolare/denominazione.",
  ricettive:
    "Estrai esclusivamente i riferimenti della pratica ricettiva: PG, data, protocollo SUAP, indirizzo, titolare/gestore e denominazione della struttura.",
};

const MODULE_WRITER_INSTRUCTIONS: Record<ModuleName, string> = {
  edili:
    "Formalizza un testo per un parere edilizio. Non determinare autonomamente l'esito e non aggiungere prescrizioni, misure, date o norme non presenti nei dati forniti.",
  esposto:
    "Formalizza il riscontro all'esposto in tono istituzionale e, se coerente con la bozza, in terza persona plurale. Distingui quanto segnalato da quanto accertato senza stabilire fatti nuovi.",
  sorvegliabilita:
    "Formalizza il testo relativo alla sorvegliabilità. Se la non conformità è indicata nei dati, descrivi soltanto i motivi forniti; non aggiungere violazioni o conclusioni.",
  ricettive:
    "Formalizza il testo relativo alla struttura ricettiva. Riporta soltanto controlli, irregolarità e provvedimenti espressamente presenti nei dati.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getEnv(name: string): string | undefined {
  try {
    if (typeof Deno !== "undefined") return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
  return undefined;
}

function runtimeOptions(overrides: RuntimeOptions): Required<RuntimeOptions> {
  return {
    openaiApiKey: overrides.openaiApiKey || getEnv("OPENAI_API_KEY") || "",
    openaiModel: overrides.openaiModel || getEnv("OPENAI_MODEL") || "gpt-5-mini",
    allowedOrigins: overrides.allowedOrigins ?? getEnv("ALLOWED_ORIGINS") ?? "",
    allowFileOrigin: overrides.allowFileOrigin ?? getEnv("ALLOW_FILE_ORIGIN") === "1",
    fetchImpl: overrides.fetchImpl || fetch,
    now: overrides.now || Date.now,
  };
}

function localOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") &&
      (url.protocol === "http:" || url.protocol === "https:")
    );
  } catch {
    return false;
  }
}

function originAllowed(origin: string, configured: string, allowFileOrigin = false): boolean {
  // Una richiesta senza intestazione Origin non proviene da un browser:
  // in questa applicazione non esiste un chiamante legittimo di quel tipo.
  if (!origin) return false;
  // I documenti aperti dal disco (file://) inviano Origin: null. Lo inviano però
  // anche gli iframe in sandbox e alcuni reindirizzamenti, quindi è ammesso solo
  // se il secret ALLOW_FILE_ORIGIN=1 lo abilita esplicitamente per lo sviluppo.
  if (origin === "null") return allowFileOrigin;
  if (localOrigin(origin)) return true;
  const exact = configured.split(",").map((item) => item.trim().replace(/\/$/, "")).filter(Boolean);
  // Senza ALLOWED_ORIGINS configurato non si apre a tutto *.github.io:
  // resta ammesso solo lo sviluppo locale.
  if (!exact.length) return false;
  return exact.includes(origin.replace(/\/$/, ""));
}

function corsHeaders(origin: string, allowed: boolean): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
  if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  origin: string,
  allowed: boolean,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin, allowed), "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  requestId: string,
  origin: string,
  allowed: boolean,
  retryAfter?: number,
): Response {
  const response = jsonResponse(status, { ok: false, error: { code, message }, requestId }, origin, allowed);
  if (retryAfter) response.headers.set("Retry-After", String(retryAfter));
  return response;
}

function clientKey(request: Request, origin: string): string {
  return [
    request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown",
    origin || "no-origin",
  ].join("|");
}

function sweepRateBuckets(now: number): void {
  for (const [key, timestamps] of rateBuckets) {
    if (!timestamps.some((timestamp) => timestamp > now - RATE_WINDOW_MS)) rateBuckets.delete(key);
  }
}

function rateLimited(key: string, now: number): boolean {
  if (rateBuckets.size > 500) sweepRateBuckets(now);
  const recent = (rateBuckets.get(key) || []).filter((timestamp) => timestamp > now - RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(key, recent);
    return true;
  }
  recent.push(now);
  rateBuckets.set(key, recent);
  return false;
}

function base64ByteLength(base64: string): number {
  const normalized = base64.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return -1;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.floor((normalized.length * 3) / 4) - padding;
}

function validateDocument(value: unknown): { filename: string; mimeType: string; base64: string; size: number } | null {
  if (!isRecord(value)) return null;
  const filename = typeof value.filename === "string" ? value.filename.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.toLowerCase() : "";
  const rawBase64 = typeof value.base64 === "string" ? value.base64 : "";
  const base64 = rawBase64.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "");
  const size = base64ByteLength(base64);
  if (!filename || filename.length > 128 || !filename.toLowerCase().endsWith(".pdf")) return null;
  if (mimeType !== "application/pdf" || size < 1 || size > MAX_PDF_BYTES) return null;
  if (typeof value.size === "number" && (value.size > MAX_PDF_BYTES || Math.abs(value.size - size) > 3)) return null;
  return { filename, mimeType, base64, size };
}

function cleanPromptPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "document") continue;
    clean[key] = value;
  }
  return clean;
}

function extractorSchema(requestedModule: RequestedModule): Record<string, unknown> {
  const practiceProperties = {
    id: { type: "string" },
    subject: { type: "string" },
    location: { type: "string" },
    protocol: { type: "string" },
    date: { type: "string" },
    notes: { type: "string" },
  };
  const fields = requestedModule === "auto" ? ALL_EXTRACTOR_FIELDS : EXTRACTOR_FIELDS[requestedModule];
  return {
    type: "object",
    properties: {
      module: { type: "string", enum: requestedModule === "auto" ? [...MODULES] : [requestedModule] },
      confidence: { type: "string", enum: ["alta", "media", "bassa"] },
      routeReason: { type: "string" },
      isSupported: { type: "boolean" },
      needsConfirmation: { type: "boolean" },
      practice: {
        type: "object",
        properties: practiceProperties,
        required: Object.keys(practiceProperties),
        additionalProperties: false,
      },
      fields: {
        type: "object",
        properties: fields,
        required: Object.keys(fields),
        additionalProperties: false,
      },
      sourceSummary: { type: "string" },
      keyFacts: { type: "array", items: { type: "string" } },
      missingInformation: { type: "array", items: { type: "string" } },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "module",
      "confidence",
      "routeReason",
      "isSupported",
      "needsConfirmation",
      "practice",
      "fields",
      "sourceSummary",
      "keyFacts",
      "missingInformation",
      "warnings",
    ],
    additionalProperties: false,
  };
}

function extractorRequest(requestedModule: RequestedModule, payload: Record<string, unknown>, document: ReturnType<typeof validateDocument>) {
  const supplied = JSON.stringify(cleanPromptPayload(payload));
  const content: Record<string, unknown>[] = [];
  if (document) {
    content.push({
      type: "input_file",
      filename: document.filename,
      file_data: `data:application/pdf;base64,${document.base64}`,
    });
  }
  const sourceText = typeof payload.sourceText === "string" ? payload.sourceText.trim() : "";
  content.push({
    type: "input_text",
    text: [
      requestedModule === "auto"
        ? `Classifica la pratica in uno solo dei percorsi supportati: ${MODULES.map((name) => `${name} = ${MODULE_ROUTING_GUIDE[name]}`).join("; ")}.`
        : `Modulo già scelto dall'operatore: ${MODULE_LABELS[requestedModule]}.`,
      requestedModule === "auto"
        ? "Scegli il percorso più coerente con il contenuto, spiega brevemente il motivo e assegna confidenza alta, media o bassa. Se nessun percorso è realmente appropriato, imposta isSupported=false, confidence=bassa e needsConfirmation=true; non forzare una certezza. Suolo Pubblico è fuori da questi percorsi."
        : MODULE_EXTRACTOR_INSTRUCTIONS[requestedModule],
      "Estrai soltanto dati esplicitamente presenti nella fonte. Non inventare, non completare per plausibilità e non formulare valutazioni giuridiche.",
      "Produci anche una sintesi neutra di massimo 900 caratteri, un elenco breve dei fatti chiave e le informazioni operative mancanti.",
      "Per ogni campo assente restituisci una stringa vuota. Nei campi non pertinenti al percorso scelto restituisci una stringa vuota.",
      "Ogni data va restituita nel formato gg.mm.aaaa, con giorno e mese a due cifre e anno a quattro (esempio: 04.03.2026). Il giorno viene sempre per primo. Se sul documento la data è scritta in lettere o in altro formato, convertila; se non è possibile stabilirla con certezza, restituisci una stringa vuota invece di indovinarla.",
      `Dati già forniti dall'operatore (da conservare, non reinterpretare): ${supplied}`,
      sourceText ? `Testo fonte aggiuntivo: ${sourceText.slice(0, MAX_TEXT_CHARS)}` : "",
    ].filter(Boolean).join("\n"),
  });
  return {
    model: undefined,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 5000,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: `amministrativa_extractor_${requestedModule}`,
        strict: true,
        schema: extractorSchema(requestedModule),
      },
    },
  };
}

function writerSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      text: { type: "string" },
      suggestions: { type: "array", maxItems: 3, items: { type: "string" } },
      missingInformation: { type: "array", maxItems: 6, items: { type: "string" } },
      nextQuestion: { type: "string" },
    },
    required: ["summary", "text", "suggestions", "missingInformation", "nextQuestion"],
    additionalProperties: false,
  };
}

function writerRequest(moduleName: ModuleName, payload: Record<string, unknown>) {
  return {
    model: undefined,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: 4000,
    instructions: [
      "Sei il Redattore di Amministrativa 3.0 per la Polizia Municipale di Napoli.",
      MODULE_WRITER_INSTRUCTIONS[moduleName],
      "Usa esclusivamente fatti e dati forniti dall'operatore. Non inventare nomi, date, esiti, sopralluoghi, norme, provvedimenti o circostanze mancanti.",
      "Se i dati non consentono una formulazione completa, restituisci una frase prudente che segnali all'operatore il dato mancante senza colmarlo.",
      "Distingui sempre tra fatti estratti dal documento e accertamenti confermati dall'operatore.",
      "La sintesi deve spiegare in modo semplice di cosa tratta la pratica. Il testo è una proposta amministrativa modificabile, non una decisione automatica.",
      "Se mode=summary, privilegia comprensione e punti da chiarire. Se mode=draft, prepara una proposta amministrativa breve e direttamente utilizzabile.",
      "I suggerimenti devono limitarsi a controllare o completare i dati mancanti. Non proporre nuovi sopralluoghi, indagini, acquisizioni, sanzioni, trasmissioni o altri provvedimenti.",
      "Non attribuire un fatto al documento se proviene soltanto dalle indicazioni dell'operatore. Usa formule come 'secondo quanto indicato dall’operatore' quando la provenienza è quella.",
      "Non inserire nel testo finale avvertenze sul funzionamento dell'AI o frasi come 'questa è una bozza' e 'non costituisce una decisione'.",
      "Indica informazioni mancanti e una sola domanda successiva utile. Non suggerire norme o provvedimenti non presenti nei dati.",
      "In tutti i campi usa testo semplice: niente Markdown, asterischi, titoli, elenchi formattati o blocchi di codice.",
    ].join("\n"),
    input: JSON.stringify({ module: moduleName, dataConfermati: payload }),
    text: {
      format: {
        type: "json_schema",
        name: `amministrativa_writer_${moduleName}`,
        strict: true,
        schema: writerSchema(),
      },
    },
  };
}

function outputText(data: unknown): string {
  if (!isRecord(data)) return "";
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  const texts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!isRecord(part)) continue;
      if (part.type === "refusal" && typeof part.refusal === "string") {
        throw new Error("MODEL_REFUSAL");
      }
      if (part.type === "output_text" && typeof part.text === "string") texts.push(part.text);
    }
  }
  return texts.join("\n").trim();
}

function parseJsonObject(text: string): unknown {
  const cleaned = text
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const candidates = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Prova il candidato successivo senza accettare JSON parziale.
    }
  }
  return null;
}

function validExtractorResult(value: unknown, requestedModule: RequestedModule): value is Record<string, unknown> {
  if (!isRecord(value) || !MODULES.includes(value.module as ModuleName)) return false;
  if (requestedModule !== "auto" && value.module !== requestedModule) return false;
  if (!isRecord(value.practice) || !isRecord(value.fields)) return false;
  const practiceKeys = ["id", "subject", "location", "protocol", "date", "notes"];
  const fieldKeys = Object.keys(requestedModule === "auto" ? ALL_EXTRACTOR_FIELDS : EXTRACTOR_FIELDS[requestedModule]);
  if (!practiceKeys.every((key) => typeof value.practice[key] === "string")) return false;
  if (!fieldKeys.every((key) => typeof value.fields[key] === "string")) return false;
  if (!["alta", "media", "bassa"].includes(String(value.confidence))) return false;
  if (typeof value.routeReason !== "string") return false;
  if (typeof value.isSupported !== "boolean" || typeof value.needsConfirmation !== "boolean") return false;
  if (typeof value.sourceSummary !== "string") return false;
  for (const key of ["keyFacts", "missingInformation", "warnings"]) {
    if (!Array.isArray(value[key]) || !(value[key] as unknown[]).every((item) => typeof item === "string")) return false;
  }
  return true;
}

function extractorOutput(data: unknown, requestedModule: RequestedModule):
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "refusal" }
  | { kind: "invalid" } {
  let text = "";
  try {
    text = outputText(data);
  } catch {
    return { kind: "refusal" };
  }
  if (!text) return { kind: "invalid" };
  const parsed = parseJsonObject(text);
  return validExtractorResult(parsed, requestedModule) ? { kind: "ok", value: parsed } : { kind: "invalid" };
}

function writerOutput(data: unknown):
  | { kind: "ok"; value: Record<string, unknown> }
  | { kind: "refusal" }
  | { kind: "invalid" } {
  let text = "";
  try {
    text = outputText(data);
  } catch {
    return { kind: "refusal" };
  }
  const parsed = parseJsonObject(text);
  if (!isRecord(parsed)) return { kind: "invalid" };
  if (!["summary", "text", "nextQuestion"].every((key) => typeof parsed[key] === "string")) return { kind: "invalid" };
  for (const key of ["suggestions", "missingInformation"]) {
    if (!Array.isArray(parsed[key]) || !(parsed[key] as unknown[]).every((item) => typeof item === "string")) return { kind: "invalid" };
  }
  return {
    kind: "ok",
    value: {
      summary: cleanWriterText(parsed.summary as string),
      text: cleanWriterText(parsed.text as string),
      suggestions: (parsed.suggestions as string[]).map(cleanWriterText).filter(Boolean),
      missingInformation: (parsed.missingInformation as string[]).map(cleanWriterText).filter(Boolean),
      nextQuestion: cleanWriterText(parsed.nextQuestion as string),
    },
  };
}

function safeUpstreamDiagnostics(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) return { responseShape: typeof data };
  const details = isRecord(data.incomplete_details) ? data.incomplete_details : {};
  return {
    upstreamId: typeof data.id === "string" ? data.id : undefined,
    upstreamStatus: typeof data.status === "string" ? data.status : undefined,
    incompleteReason: typeof details.reason === "string" ? details.reason : undefined,
    outputItems: Array.isArray(data.output) ? data.output.length : 0,
  };
}

function logStructuredIssue(event: string, requestId: string, moduleName: RequestedModule, data: unknown): void {
  if (typeof Deno === "undefined") return;
  console.warn(JSON.stringify({ event, requestId, module: moduleName, ...safeUpstreamDiagnostics(data) }));
}

function cleanWriterText(value: string): string {
  return value
    .replace(/```[a-z0-9_-]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*(?:[-–—*•▪◦‣⁃]+|\d+[.)])\s+/gm, "")
    .replace(/\*+/g, "")
    .replace(/`+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function callOpenAI(
  requestBody: Record<string, unknown>,
  options: Required<RuntimeOptions>,
): Promise<{ status: number; data: unknown }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    requestBody.model = options.openaiModel;
    const response = await options.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${options.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function upstreamMessage(status: number): { status: number; code: string; message: string } {
  if (status === 429) return { status: 429, code: "OPENAI_RATE_LIMIT", message: "Servizio AI temporaneamente occupato. Riprova tra poco." };
  if (status === 401 || status === 403) return { status: 502, code: "OPENAI_AUTH", message: "Configurazione OpenAI non valida sul server." };
  if (status >= 500) return { status: 503, code: "OPENAI_UNAVAILABLE", message: "Servizio AI temporaneamente non disponibile." };
  return { status: 502, code: "OPENAI_ERROR", message: "La richiesta al servizio AI non è stata completata." };
}

export async function handleRequest(request: Request, overrides: RuntimeOptions = {}): Promise<Response> {
  const options = runtimeOptions(overrides);
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin") || "";
  const allowed = originAllowed(origin, options.allowedOrigins, options.allowFileOrigin);

  if (!allowed) return errorResponse(403, "ORIGIN_NOT_ALLOWED", "Origine non autorizzata.", requestId, origin, false);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin, true) });
  if (request.method !== "POST") return errorResponse(405, "METHOD_NOT_ALLOWED", "Usa POST /agent.", requestId, origin, true);
  if (rateLimited(clientKey(request, origin), options.now())) {
    return errorResponse(429, "RATE_LIMIT", "Troppe richieste. Riprova tra alcuni minuti.", requestId, origin, true, 60);
  }
  if (!options.openaiApiKey) {
    return errorResponse(503, "SERVER_NOT_CONFIGURED", "Il secret OPENAI_API_KEY non è configurato.", requestId, origin, true);
  }
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) {
    return errorResponse(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type deve essere application/json.", requestId, origin, true);
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Payload troppo grande.", requestId, origin, true);
  }

  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await request.arrayBuffer());
  } catch {
    return errorResponse(400, "BODY_READ_ERROR", "Impossibile leggere la richiesta.", requestId, origin, true);
  }
  if (raw.byteLength > MAX_BODY_BYTES) {
    return errorResponse(413, "PAYLOAD_TOO_LARGE", "Payload troppo grande.", requestId, origin, true);
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return errorResponse(400, "INVALID_JSON", "JSON non valido.", requestId, origin, true);
  }
  if (!isRecord(body)) return errorResponse(400, "INVALID_BODY", "Corpo richiesta non valido.", requestId, origin, true);

  const agent = body.agent;
  const moduleName = body.module;
  const payload = body.payload;
  if (!AGENTS.includes(agent as AgentName)) {
    return errorResponse(400, "INVALID_AGENT", "Agente ammesso: extractor oppure writer.", requestId, origin, true);
  }
  const moduleAllowed = MODULES.includes(moduleName as ModuleName) || (agent === "extractor" && moduleName === "auto");
  if (!moduleAllowed) {
    return errorResponse(400, "INVALID_MODULE", "Modulo non riconosciuto.", requestId, origin, true);
  }
  if (!isRecord(payload)) return errorResponse(400, "INVALID_PAYLOAD", "payload deve essere un oggetto JSON.", requestId, origin, true);

  const selectedAgent = agent as AgentName;
  const selectedModule = moduleName as RequestedModule;
  let requestBody: Record<string, unknown>;
  if (selectedAgent === "extractor") {
    const document = payload.document === undefined ? null : validateDocument(payload.document);
    const sourceText = typeof payload.sourceText === "string" ? payload.sourceText.trim() : "";
    if (payload.document !== undefined && !document) {
      return errorResponse(400, "INVALID_DOCUMENT", "Il documento deve essere un PDF valido di massimo 8 MB.", requestId, origin, true);
    }
    if (!document && !sourceText) {
      return errorResponse(400, "SOURCE_REQUIRED", "Carica un PDF oppure fornisci sourceText.", requestId, origin, true);
    }
    if (sourceText.length > MAX_TEXT_CHARS) {
      return errorResponse(413, "TEXT_TOO_LARGE", "Testo fonte troppo lungo.", requestId, origin, true);
    }
    requestBody = extractorRequest(selectedModule, payload, document);
  } else {
    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_WRITER_INPUT_CHARS) {
      return errorResponse(413, "WRITER_INPUT_TOO_LARGE", "Dati per il Redattore troppo lunghi.", requestId, origin, true);
    }
    if (!serialized.replace(/[{}\[\]":,\s]/g, "")) {
      return errorResponse(400, "WRITER_INPUT_REQUIRED", "Inserisci dati o una bozza da formalizzare.", requestId, origin, true);
    }
    requestBody = writerRequest(selectedModule as ModuleName, payload);
  }

  let upstream: { status: number; data: unknown };
  try {
    upstream = await callOpenAI(requestBody, options);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return errorResponse(
      timedOut ? 504 : 503,
      timedOut ? "OPENAI_TIMEOUT" : "UPSTREAM_CONNECTION_ERROR",
      timedOut ? "Il servizio AI ha impiegato troppo tempo." : "Connessione al servizio AI non disponibile.",
      requestId,
      origin,
      true,
    );
  }
  if (upstream.status < 200 || upstream.status >= 300) {
    const mapped = upstreamMessage(upstream.status);
    return errorResponse(mapped.status, mapped.code, mapped.message, requestId, origin, true);
  }

  if (selectedAgent === "extractor") {
    let extraction = extractorOutput(upstream.data, selectedModule);
    if (extraction.kind === "refusal") {
      return errorResponse(422, "MODEL_REFUSAL", "Il modello non ha potuto elaborare il contenuto.", requestId, origin, true);
    }
    if (extraction.kind !== "ok") {
      logStructuredIssue("structured_output_retry", requestId, selectedModule, upstream.data);
      requestBody.max_output_tokens = 8000;
      requestBody.reasoning = { effort: "low" };
      let retry: { status: number; data: unknown };
      try {
        retry = await callOpenAI(requestBody, options);
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "AbortError";
        return errorResponse(
          timedOut ? 504 : 503,
          timedOut ? "OPENAI_TIMEOUT" : "UPSTREAM_CONNECTION_ERROR",
          timedOut ? "L'analisi del PDF ha impiegato troppo tempo. Riprova." : "Connessione al servizio AI non disponibile.",
          requestId,
          origin,
          true,
        );
      }
      if (retry.status < 200 || retry.status >= 300) {
        const mapped = upstreamMessage(retry.status);
        return errorResponse(mapped.status, mapped.code, mapped.message, requestId, origin, true);
      }
      extraction = extractorOutput(retry.data, selectedModule);
      if (extraction.kind === "refusal") {
        return errorResponse(422, "MODEL_REFUSAL", "Il modello non ha potuto elaborare il contenuto.", requestId, origin, true);
      }
      if (extraction.kind !== "ok") {
        logStructuredIssue("structured_output_failed", requestId, selectedModule, retry.data);
        return errorResponse(
          502,
          "INVALID_STRUCTURED_OUTPUT",
          "L'analisi del PDF non è stata completata correttamente. Riprova una volta.",
          requestId,
          origin,
          true,
        );
      }
    }
    return jsonResponse(200, { ok: true, requestId, agent: selectedAgent, ...extraction.value }, origin, true);
  }

  const writer = writerOutput(upstream.data);
  if (writer.kind === "refusal") {
    return errorResponse(422, "MODEL_REFUSAL", "Il modello non ha potuto elaborare il contenuto.", requestId, origin, true);
  }
  if (writer.kind !== "ok") {
    return errorResponse(502, "INVALID_WRITER_OUTPUT", "Il Redattore non ha restituito una proposta valida. Riprova.", requestId, origin, true);
  }
  if (!writer.value.summary && !writer.value.text) {
    return errorResponse(502, "EMPTY_WRITER_OUTPUT", "Il Redattore non ha restituito testo utilizzabile.", requestId, origin, true);
  }
  return jsonResponse(200, {
    ok: true,
    requestId,
    agent: selectedAgent,
    module: selectedModule,
    ...writer.value,
  }, origin, true);
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve((request: Request) => handleRequest(request));
}
