window.ADMIN3 = (() => {
  "use strict";

  const MODULES = ["edili", "esposto", "sorvegliabilita", "ricettive"];
  const AGENTS = ["extractor", "writer"];
  const EMPTY_PRACTICE = { id: "", subject: "", location: "", protocol: "", date: "", notes: "" };
  const DRAFT_KEYS = [
    "amm20_pareri-edili.html_draft",
    "amm20_riscontro-esposto.html_draft",
    "amm20_sorvegliabilita.html_draft",
    "amm20_strutture-ricettive.html_draft",
  ];

  function frameTargetOrigin() {
    // In file:// le origini sono opache e l'unico bersaglio possibile è "*".
    // Fuori da lì si restringe all'origine dell'app, così i dati della pratica
    // non possono finire a una pagina di terzi caricata nell'iframe.
    try {
      if (typeof location === "undefined" || !location.origin) return "*";
      return location.protocol === "file:" ? "*" : location.origin;
    } catch (_error) {
      return "*";
    }
  }

  function newSessionId() {
    return "practice-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  const state = {
    module: null,
    practice: { ...EMPTY_PRACTICE },
    extraction: null,
    classification: null,
    moduleData: {},
    writer: null,
    draft: "",
    review: [],
    status: "new",
    saveError: "",
    sessionId: newSessionId(),
  };

  const RULES = {
    common: [
      { id: "missing_subject", label: "Oggetto/denominazione mancante", test: (s) => !s.practice.subject.trim() },
      { id: "missing_location", label: "Ubicazione mancante", test: (s) => !s.practice.location.trim() },
      { id: "route_unconfirmed", label: "Percorso della pratica non ancora confermato", test: (s) => !s.module },
      { id: "placeholder", label: "Sono presenti segnaposto non sostituiti", test: (s) => /\b(TESTO_|PLACEHOLDER|{{[^}]+}})\b/i.test(s.draft || "") },
      { id: "markdown", label: "Il testo contiene marcatori Markdown o asterischi", test: (s) => /(^|\s)\*{1,3}\S|(^|\n)\s*[-*]\s+/m.test(s.draft || "") },
      { id: "empty_draft", label: "Testo del documento non ancora predisposto", test: (s) => !(s.draft || "").trim() },
    ],
  };

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function save() {
    try {
      localStorage.setItem("amministrativa3.workflow", JSON.stringify(state));
      state.saveError = "";
    } catch (error) {
      // Quota localStorage esaurita o accesso negato: la pratica resta in memoria
      // per la sessione corrente e l'interfaccia lo segnala, ma l'app non si blocca.
      state.saveError = "Salvataggio locale non riuscito: la pratica non sopravvive alla chiusura della scheda.";
    }
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem("amministrativa3.workflow") || "null");
      if (isRecord(saved)) {
        state.module = MODULES.includes(saved.module) ? saved.module : null;
        state.practice = { ...EMPTY_PRACTICE, ...(isRecord(saved.practice) ? saved.practice : {}) };
        state.practice.date = normDate(state.practice.date);
        state.extraction = isRecord(saved.extraction) ? saved.extraction : null;
        state.classification = isRecord(saved.classification) ? saved.classification : null;
        state.moduleData = isRecord(saved.moduleData) ? saved.moduleData : {};
        state.writer = isRecord(saved.writer) ? saved.writer : null;
        state.draft = typeof saved.draft === "string" ? saved.draft : "";
        state.review = Array.isArray(saved.review) ? saved.review : [];
        state.status = typeof saved.status === "string" ? saved.status : "new";
        state.sessionId = typeof saved.sessionId === "string" && saved.sessionId ? saved.sessionId : newSessionId();
      }
    } catch (_error) {
      // Se la memoria è corrotta si riparte con uno stato pulito.
    }
    return state;
  }

  function clearKnownModuleDrafts() {
    for (const key of DRAFT_KEYS) localStorage.removeItem(key);
  }

  function reset() {
    const frame = document.getElementById("frame");
    const nextSession = newSessionId();
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage({
        channel: "ADMIN3_BRIDGE",
        type: "module-reset",
        practiceSession: nextSession,
      }, frameTargetOrigin());
    }
    clearKnownModuleDrafts();
    state.module = null;
    state.practice = { ...EMPTY_PRACTICE };
    state.extraction = null;
    state.classification = null;
    state.moduleData = {};
    state.writer = null;
    state.draft = "";
    state.review = [];
    state.status = "new";
    state.saveError = "";
    state.sessionId = nextSession;
    save();
  }

  function review() {
    const findings = RULES.common.filter((rule) => rule.test(state)).map((rule) => ({
      id: rule.id,
      label: rule.label,
      severity: "warning",
    }));
    state.review = findings;
    state.status = findings.length ? "needs_review" : "ready";
    save();
    return findings;
  }

  function agentUrl() {
    const config = window.ADMIN3_CONFIG || {};
    const direct = String(config.AI_AGENT_URL || "").trim().replace(/\/$/, "");
    if (direct) return direct;
    const legacy = String(config.AI_BACKEND_URL || "").trim().replace(/\/$/, "");
    if (!legacy) return "";
    if (/\/agent$/i.test(legacy)) return legacy;
    return legacy + "/agent";
  }

  async function callAgent(agent, payload, moduleOverride) {
    const endpoint = agentUrl();
    if (!endpoint) throw new Error("Backend AI non configurato. La build pubblica non contiene chiavi API.");
    const headers = { "Content-Type": "application/json" };
    const publishableKey = String((window.ADMIN3_CONFIG || {}).SUPABASE_PUBLISHABLE_KEY || "").trim();
    if (publishableKey) headers.apikey = publishableKey;
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ agent, module: moduleOverride || state.module, payload }),
      });
    } catch (_error) {
      throw new Error("Connessione al backend non riuscita. Verifica la connessione Internet e usa la build aggiornata.");
    }
    if (!response.ok) {
      let detail = "";
      try {
        const problem = await response.json();
        detail = problem && problem.error && problem.error.message || "";
      } catch (_error) {
        // Mantiene un messaggio comprensibile anche per risposte non JSON.
      }
      throw new Error("Errore backend AI (" + response.status + ")" + (detail ? ": " + detail : ""));
    }
    return await response.json();
  }

  function sanitizeModuleData(value) {
    if (!isRecord(value)) return {};
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") clean[String(key).slice(0, 80)] = item.slice(0, 20_000);
    }
    return clean;
  }

  const MESI_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

  function normDate(value) {
    // Le date girano fra Estrattore, pannello e moduli in formato gg.mm.aaaa.
    // Un formato non riconosciuto si lascia com'è: non si indovina.
    const text = String(value == null ? "" : value).trim();
    if (!text) return text;
    const pad = (n) => (String(n).length < 2 ? "0" + n : String(n));
    let match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (match) return pad(match[3]) + "." + pad(match[2]) + "." + match[1];
    match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (match) return pad(match[1]) + "." + pad(match[2]) + "." + (match[3].length === 2 ? "20" + match[3] : match[3]);
    match = text.match(/^(\d{1,2})\s+([A-Za-zàèéìòù]+)\s+(\d{4})$/);
    if (match) {
      const month = MESI_IT.indexOf(match[2].toLowerCase());
      if (month >= 0) return pad(match[1]) + "." + pad(month + 1) + "." + match[3];
    }
    return text;
  }

  function updateCommonPractice(moduleName, data) {
    const mappings = {
      edili: { id: "praticaId", subject: "richiedente", location: "ubicazione", protocol: "pgR" },
      esposto: { id: "pgE", subject: "ogg", location: "via", protocol: "pgR" },
      sorvegliabilita: { id: "pgRif", subject: "tit", location: "via", protocol: "protSUAP" },
      ricettive: { id: "pgRif", subject: "nomeStruttura", location: "via", protocol: "protSUAP" },
    };
    const mapping = mappings[moduleName] || {};
    for (const [target, source] of Object.entries(mapping)) {
      if (typeof data[source] === "string" && data[source].trim()) state.practice[target] = data[source].trim();
    }
  }

  function hydrateFrame(targetWindow, reportedSession) {
    if (!targetWindow || !state.module) return;
    targetWindow.postMessage({
      channel: "ADMIN3_BRIDGE",
      type: "module-hydrate",
      module: state.module,
      practiceSession: state.sessionId,
      freshPractice: reportedSession !== state.sessionId,
      practice: state.practice,
      extraction: state.extraction,
      moduleData: isRecord(state.moduleData[state.module]) ? state.moduleData[state.module] : {},
    }, frameTargetOrigin());
  }

  window.addEventListener("message", async function (event) {
    const message = event.data;
    if (!message || message.channel !== "ADMIN3_BRIDGE") return;
    const frame = document.getElementById("frame");
    if (!frame || event.source !== frame.contentWindow || !event.source) return;

    if (message.type === "new-practice-request") {
      if (typeof window.requestNewPracticeFromModule === "function") window.requestNewPracticeFromModule();
      return;
    }

    if (message.type === "module-ready") {
      if (!MODULES.includes(message.module)) return;
      state.module = message.module;
      save();
      hydrateFrame(event.source, typeof message.practiceSession === "string" ? message.practiceSession : "");
      return;
    }

    if (message.type === "practice-update") {
      if (!MODULES.includes(message.module)) return;
      const data = sanitizeModuleData(message.data);
      state.module = message.module;
      state.moduleData[message.module] = data;
      updateCommonPractice(message.module, data);
      save();
      if (typeof window.syncUI === "function") window.syncUI();
      return;
    }

    if (message.type !== "agent-request") return;
    const id = typeof message.id === "string" ? message.id : "";
    const agent = message.agent;
    const moduleName = message.module;
    const reply = function (body) {
      event.source.postMessage({ channel: "ADMIN3_BRIDGE", type: "agent-response", id, ...body }, frameTargetOrigin());
    };
    if (!id || !AGENTS.includes(agent) || !MODULES.includes(moduleName)) {
      reply({ ok: false, error: "Richiesta del modulo non valida." });
      return;
    }
    try {
      const incoming = isRecord(message.payload) ? message.payload : {};
      const forwarded = {
        ...incoming,
        practice: state.practice,
        extraction: state.extraction,
        moduleData: state.moduleData[moduleName] || {},
      };
      state.module = moduleName;
      const result = await callAgent(agent, forwarded, moduleName);
      if (agent === "extractor") {
        state.extraction = result;
        state.classification = {
          suggestedModule: result.module,
          confidence: result.confidence,
          routeReason: result.routeReason,
          confirmedModule: moduleName,
        };
        if (isRecord(result.practice)) {
          Object.assign(state.practice, result.practice);
          state.practice.date = normDate(state.practice.date);
        }
      } else {
        state.writer = result;
        if (typeof result.text === "string") state.draft = result.text;
      }
      save();
      if (typeof window.syncUI === "function") window.syncUI();
      reply({ ok: true, result });
    } catch (error) {
      reply({ ok: false, error: error && error.message ? error.message : "Operazione AI non riuscita." });
    }
  });

  return { state, save, load, reset, review, callAgent, hydrateFrame, normDate };
})();

window.ADMIN3.load();
