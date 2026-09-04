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

  // ---- Aiutanti del Revisore ----
  // Il Revisore e' la sola parte del sistema che non inventa mai: quando segnala
  // qualcosa, quel qualcosa c'e'. Per questo conviene farlo crescere invece di
  // allungare i prompt. Le regole qui sotto guardano il merito, non la forma.
  function datiModulo(s) {
    const d = s.moduleData && s.module ? s.moduleData[s.module] : null;
    return d && typeof d === "object" ? d : {};
  }
  function tuttoIlTestoNoto(s) {
    const pezzi = [JSON.stringify(s.practice || {}), JSON.stringify(datiModulo(s))];
    if (s.extraction) pezzi.push(JSON.stringify(s.extraction));
    // Solo cifre: cosi' 04.09.2026 e 4/9/26 si confrontano fra loro. Concatenare
    // puo' produrre qualche corrispondenza di troppo, ed e' la direzione giusta
    // in cui sbagliare: un revisore che segnala il falso viene ignorato.
    return pezzi.join(" ").replace(/\D/g, "");
  }
  function aData(valore) {
    const m = String(valore || "").trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
    if (!m) return null;
    const giorno = Number(m[1]), mese = Number(m[2]);
    const anno = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (giorno < 1 || giorno > 31 || mese < 1 || mese > 12) return null;
    const d = new Date(anno, mese - 1, giorno);
    return d.getDate() === giorno && d.getMonth() === mese - 1 ? d : null;
  }
  function campiData(s) {
    const d = datiModulo(s), fuori = [];
    Object.keys(d).forEach(function (id) {
      if (!/^data/i.test(id)) return;
      const valore = aData(d[id]);
      if (valore) fuori.push({ id: id, data: valore });
    });
    return fuori;
  }
  function agentiSelezionati(s) {
    const d = datiModulo(s);
    return ["ag1", "ag2", "ag3", "ag4"]
      .map(function (id) { return String(d[id] || "").trim(); })
      .filter(function (v) { return v && v !== "--"; });
  }

  const RULES = {
    common: [
      { id: "missing_subject", label: "Oggetto/denominazione mancante", test: (s) => !s.practice.subject.trim() },
      { id: "missing_location", label: "Ubicazione mancante", test: (s) => !s.practice.location.trim() },
      { id: "route_unconfirmed", label: "Percorso della pratica non ancora confermato", test: (s) => !s.module },
      { id: "placeholder", label: "Sono presenti segnaposto non sostituiti", test: (s) => /\b(TESTO_|PLACEHOLDER|{{[^}]+}})\b/i.test(s.draft || "") },
      { id: "markdown", label: "Il testo contiene marcatori Markdown o asterischi", test: (s) => /(^|\s)\*{1,3}\S|(^|\n)\s*[-*]\s+/m.test(s.draft || "") },
      { id: "empty_draft", label: "Testo del documento non ancora predisposto", test: (s) => !(s.draft || "").trim() },
      { id: "future_date", label: "Una data è successiva a oggi", test: (s) => {
          const oggi = new Date(); oggi.setHours(23, 59, 59, 999);
          return campiData(s).some((c) => c.data > oggi);
        } },
      { id: "accertamento_dopo_risposta", label: "La data dell'accertamento è successiva alla data di risposta", test: (s) => {
          const campi = campiData(s);
          const acc = campi.find((c) => /^dataAcc/i.test(c.id));
          const ris = campi.find((c) => /^dataR$/i.test(c.id));
          return Boolean(acc && ris && acc.data > ris.data);
        } },
      { id: "pg_format", label: "Un numero di PG non è nel formato atteso", test: (s) => {
          const d = datiModulo(s);
          return Object.keys(d).some(function (id) {
            if (!/^pg/i.test(id)) return false;
            const v = String(d[id] || "").trim();
            return Boolean(v) && !/^(PG\/\d{4}\/)?\d+$/i.test(v);
          });
        } },
      { id: "duplicate_agents", label: "Lo stesso agente è selezionato più volte", test: (s) => {
          const a = agentiSelezionati(s);
          return new Set(a).size !== a.length;
        } },
      { id: "date_inventate", label: "Il testo cita una data che non compare in nessun campo", test: (s) => {
          // Segnala solo le date: sono il caso in cui un valore inventato passa
          // inosservato piu' facilmente, e i falsi allarmi sono rari.
          const testo = s.draft || "";
          const noto = tuttoIlTestoNoto(s);
          const trovate = testo.match(/\b(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/g) || [];
          return trovate.some(function (d) {
            const parti = d.split(/[./-]/);
            const gg = ("0" + parti[0]).slice(-2), mm = ("0" + parti[1]).slice(-2);
            const anno = parti[2].length === 2 ? "20" + parti[2] : parti[2];
            const candidati = [gg + mm + anno, gg + mm + anno.slice(-2)];
            return !candidati.some(function (c) { return noto.indexOf(c) >= 0; });
          });
        } },
      { id: "esito_contraddetto", label: "L'esito selezionato e il testo si contraddicono", test: (s) => {
          const esito = String(datiModulo(s).esito || "").trim().toLowerCase();
          const testo = (s.draft || "").toLowerCase();
          if (!esito || !testo) return false;
          // La negazione in italiano non sta sempre attaccata: "non conforme",
          // ma anche "non risulta conforme", "non e' conforme". Per ogni
          // occorrenza di "conform" si guarda se un "non" la governa nella
          // stessa proposizione.
          const negate = [];
          const re = /conform/gi;
          let m;
          while ((m = re.exec(testo)) !== null) {
            const prima = testo.slice(Math.max(0, m.index - 40), m.index);
            negate.push(/\bnon\b[^.;:]*$/.test(prima));
          }
          if (!negate.length) return false;
          const cInegate = negate.some(function (x) { return x; });
          const cIafferma = negate.some(function (x) { return !x; });
          // I moduli non usano lo stesso alfabeto: "c" ovunque per conforme,
          // ma "n"/"p" nelle ricettive e "nc" altrove per il resto.
          const negativo = esito === "nc" || esito === "n" || esito === "p";
          if (esito === "c" && cInegate) return true;
          if (negativo && cIafferma && !cInegate) return true;
          return false;
        } },
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
        if (isRecord(result.practice)) Object.assign(state.practice, result.practice);
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

  return { state, save, load, reset, review, callAgent, hydrateFrame };
})();

window.ADMIN3.load();
