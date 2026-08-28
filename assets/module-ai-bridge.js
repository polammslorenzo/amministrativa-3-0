(function () {
  "use strict";

  const MAX_PDF_BYTES = 8 * 1024 * 1024;
  const BRIDGE_TIMEOUT_MS = 130000;
  const MODULE_SESSION_KEY = "amministrativa3.moduleSession";
  let selectedDocument = null;
  let bridgeSequence = 0;
  let updateTimer = null;
  let lastHydration = null;
  const pendingBridgeCalls = new Map();
  const initialValues = new Map();

  function parentTargetOrigin() {
    // Fuori da file:// i messaggi verso la dashboard restano dentro l'origine
    // dell'app: practice-update trasporta nomi e indirizzi dei cittadini.
    try {
      if (typeof location === "undefined" || !location.origin) return "*";
      return location.protocol === "file:" ? "*" : location.origin;
    } catch (_error) {
      return "*";
    }
  }

  function captureInitialValues() {
    // Si fotografa dopo il precaricamento del modulo, non al caricamento di questo
    // script: initOperationalEnhancements riempie le date su DOMContentLoaded e
    // altrimenti "Nuova pratica" le lascerebbe bianche invece di riportarle a oggi.
    if (initialValues.size || !document.querySelectorAll) return;
    document.querySelectorAll("input[id],select[id],textarea[id]").forEach(function (element) {
      if (element.type !== "file") initialValues.set(element.id, element.value);
    });
  }

  function parentAdmin() {
    if (location.protocol === "file:") return null;
    try {
      if (!window.parent || window.parent === window) return null;
      return window.parent.ADMIN3 || null;
    } catch (error) {
      return null;
    }
  }

  function moduleName() {
    const path = location.pathname.toLowerCase();
    if (path.includes("pareri-edili")) return "edili";
    if (path.includes("riscontro-esposto")) return "esposto";
    if (path.includes("sorvegliabilita")) return "sorvegliabilita";
    if (path.includes("strutture-ricettive")) return "ricettive";
    throw new Error("Modulo non riconosciuto.");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (!message || message.channel !== "ADMIN3_BRIDGE") return;
    if (message.type === "agent-response") {
      const pending = pendingBridgeCalls.get(message.id);
      if (!pending) return;
      pendingBridgeCalls.delete(message.id);
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result);
      else pending.reject(new Error(message.error || "Operazione AI non riuscita."));
      return;
    }
    if (message.type === "module-reset") {
      clearModuleState(message.practiceSession || "");
      return;
    }
    if (message.type === "module-hydrate" && message.module === moduleName()) {
      lastHydration = message;
      applyHydration(message);
    }
  });

  function callDashboardAgent(agent, payload) {
    const selectedModule = moduleName();
    const direct = parentAdmin();
    if (direct) {
      direct.state.module = selectedModule;
      const forwarded = Object.assign({}, payload, { practice: direct.state.practice });
      return direct.callAgent(agent, forwarded, selectedModule).then(function (result) {
        if (agent === "extractor") {
          direct.state.extraction = result;
          if (result && result.practice) Object.assign(direct.state.practice, result.practice);
          direct.save();
        }
        return result;
      });
    }
    if (!window.parent || window.parent === window) {
      return Promise.reject(new Error("Apri il modulo dalla dashboard Amministrativa 3.0."));
    }
    return new Promise(function (resolve, reject) {
      bridgeSequence += 1;
      const id = "admin3-" + Date.now() + "-" + bridgeSequence;
      const timer = setTimeout(function () {
        pendingBridgeCalls.delete(id);
        reject(new Error("Il collegamento con la dashboard ha impiegato troppo tempo."));
      }, BRIDGE_TIMEOUT_MS);
      pendingBridgeCalls.set(id, { resolve: resolve, reject: reject, timer: timer });
      try {
        window.parent.postMessage({
          channel: "ADMIN3_BRIDGE",
          type: "agent-request",
          id: id,
          agent: agent,
          module: selectedModule,
          payload: payload,
        }, parentTargetOrigin());
      } catch (error) {
        clearTimeout(timer);
        pendingBridgeCalls.delete(id);
        reject(new Error("Collegamento sicuro con la dashboard non disponibile."));
      }
    });
  }

  function notify(type, text) {
    if (typeof window.mostraMsg === "function") window.mostraMsg(type, text);
    else if (typeof window.msg === "function") window.msg(type, text);
  }

  function openForm() {
    if (typeof window.apriForm === "function") window.apriForm();
  }

  function value(id) {
    const element = document.getElementById(id);
    return element ? String(element.value || "").trim() : "";
  }

  function put(id, newValue) {
    if (typeof newValue !== "string" || !newValue.trim()) return 0;
    const element = document.getElementById(id);
    if (!element) return 0;
    element.value = newValue.trim();
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return 1;
  }

  const MESI_IT = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];

  function normDate(value) {
    // L'Estrattore legge la data come è scritta sul PDF. I moduli scrivono
    // gg.mm.aaaa nel documento e riscontro-esposto ricava il giorno in lettere
    // facendo split("."): una data 12/03/2026 non verrebbe riconosciuta.
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

  function resyncModuleControls(data) {
    // put() scrive gli input nascosti che pilotano il documento (tpl in Pareri
    // Edili, esito negli altri) ma non muove i pulsanti né apre le sezioni:
    // senza questo lo schermo mostra un esito e il .docx ne riporta un altro.
    if (!data) return;
    if (typeof data.tpl === "string" && data.tpl && typeof window.setTpl === "function") window.setTpl(data.tpl);
    if (typeof data.esito === "string" && data.esito && typeof window.setEsito === "function") window.setEsito(data.esito);
  }

  function draftStorageKey() {
    if (typeof window.storageKey === "function") return window.storageKey();
    return "amm20_" + location.pathname.split("/").pop() + "_draft";
  }

  function clearModuleState(nextSession) {
    captureInitialValues();
    try {
      localStorage.removeItem(draftStorageKey());
      localStorage.setItem(MODULE_SESSION_KEY, String(nextSession || ""));
    } catch (_error) {}
    initialValues.forEach(function (initialValue, id) {
      const element = document.getElementById(id);
      if (!element) return;
      element.value = initialValue;
      element.classList && element.classList.remove("invalid");
    });
    const file = document.getElementById("fi");
    if (file) file.value = "";
    const generated = document.getElementById("genbox");
    if (generated) generated.style.display = "none";
    selectedDocument = null;
    window.pdfB64 = null;
    resyncModuleControls({ tpl: initialValues.get("tpl") || "", esito: initialValues.get("esito") || "" });
  }

  function applyExtractionFields(fields) {
    if (!fields || typeof fields !== "object") return 0;
    let count = 0;
    const current = moduleName();
    if (current === "edili") {
      count += put("praticaId", fields.praticaId);
      count += put("richiedente", fields.richiedente);
      count += put("ubicazione", fields.ubicazione);
      count += put("periodo", fields.periodo);
      if (fields.parere === "sfavorevole" && typeof window.setTpl === "function") {
        window.setTpl("sfav");
        count += put("motivazione", fields.motivazione);
      } else if (fields.parere === "favorevole_con_prescrizioni" && typeof window.setTpl === "function") {
        window.setTpl("favp");
        count += put("prescrizioni", fields.prescrizioni);
      } else if (fields.parere === "favorevole" && typeof window.setTpl === "function") {
        window.setTpl("fav");
      }
    } else if (current === "esposto") {
      count += put("pgE", fields.pgEsposto);
      count += put("annoE", fields.annoEsposto);
      count += put("ogg", fields.oggetto);
      count += put("via", fields.via);
      count += put("mitt", fields.mittente);
    } else if (current === "sorvegliabilita") {
      count += put("pgRif", fields.pgRif);
      count += put("dataRif", normDate(fields.dataRif));
      count += put("protSUAP", fields.protSUAP);
      count += put("via", fields.via);
      count += put("tit", fields.titolare);
    } else if (current === "ricettive") {
      count += put("pgRif", fields.pgRif);
      count += put("dataRif", normDate(fields.dataRif));
      count += put("protSUAP", fields.protSUAP);
      count += put("via", fields.via);
      count += put("tit", fields.titolare);
      count += put("nomeStruttura", fields.nomeStruttura);
    }
    return count;
  }

  function applyHydration(message) {
    if (message.freshPractice) clearModuleState(message.practiceSession || "");
    try { localStorage.setItem(MODULE_SESSION_KEY, String(message.practiceSession || "")); } catch (_error) {}
    const moduleData = message.moduleData && typeof message.moduleData === "object" ? message.moduleData : {};
    Object.keys(moduleData).forEach(function (id) { put(id, moduleData[id]); });
    resyncModuleControls(moduleData);
    if (message.extraction && message.extraction.fields) applyExtractionFields(message.extraction.fields);
    schedulePracticeUpdate();
  }

  function collectModuleData() {
    const data = {};
    if (!document.querySelectorAll) return data;
    document.querySelectorAll("input[id],select[id],textarea[id]").forEach(function (element) {
      if (element.type !== "file") data[element.id] = String(element.value || "");
    });
    return data;
  }

  function postPracticeUpdate() {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({
      channel: "ADMIN3_BRIDGE",
      type: "practice-update",
      module: moduleName(),
      data: collectModuleData(),
    }, parentTargetOrigin());
  }

  window.admin3NewPractice = function () {
    if (!window.parent || window.parent === window) return;
    window.parent.postMessage({
      channel: "ADMIN3_BRIDGE",
      type: "new-practice-request",
      module: moduleName(),
    }, parentTargetOrigin());
  };

  function schedulePracticeUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(postPracticeUpdate, 120);
  }

  function setBusy(buttonId, busyText, busy) {
    const button = document.getElementById(buttonId);
    if (!button) return;
    button.disabled = busy;
    if (busy) {
      button.dataset.originalHtml = button.innerHTML;
      button.textContent = busyText;
    } else if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
    }
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/```[a-z0-9_-]*\s*/gi, "")
      .replace(/```/g, "")
      .replace(/^\s{0,3}#{1,6}\s*/gm, "")
      .replace(/^\s*(?:[-–—*•▪◦‣⁃]+|\d+[.)])\s+/gm, "")
      .replace(/\*+/g, "")
      .replace(/`+/g, "")
      .trim();
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || "").split(",")[1] || "");
      };
      reader.onerror = function () {
        reject(new Error("Lettura del PDF non riuscita."));
      };
      reader.readAsDataURL(file);
    });
  }

  function pdfMimeAcceptable(file) {
    // Su Android e su alcune sorgenti (Drive, allegati di posta) file.type arriva
    // vuoto o generico: l'estensione resta il criterio affidabile.
    const mime = String(file.type || "").toLowerCase();
    return mime === "" || mime === "application/pdf" || mime === "application/octet-stream";
  }

  async function prepareDocument(file) {
    if (!file || !pdfMimeAcceptable(file) || !file.name.toLowerCase().endsWith(".pdf")) {
      throw new Error("Seleziona un file PDF.");
    }
    if (file.size < 1 || file.size > MAX_PDF_BYTES) {
      throw new Error("Il PDF deve avere dimensione massima di 8 MB.");
    }
    const base64 = await readAsBase64(file);
    selectedDocument = {
      filename: file.name.slice(0, 128),
      mimeType: "application/pdf",
      size: file.size,
      base64: base64,
    };
    return selectedDocument;
  }

  async function extract(documentData) {
    const result = await callDashboardAgent("extractor", {
      document: documentData,
    });
    return result.fields || {};
  }

  async function write(payload) {
    const result = await callDashboardAgent("writer", payload);
    if (!result || !result.text) throw new Error("Il Redattore non ha restituito testo.");
    return cleanText(result.text);
  }

  if (moduleName() === "edili") {
    window.setPDF = async function (file) {
      try {
        await prepareDocument(file);
        window.pdfB64 = selectedDocument.base64;
        document.getElementById("dz").innerHTML = "&#128196; <span style=\"color:#4ade80\"></span>";
        document.getElementById("dz").querySelector("span").textContent = file.name;
      } catch (error) {
        selectedDocument = null;
        notify("E", error.message);
      }
    };

    window.analizzaAI = async function () {
      if (!selectedDocument) {
        notify("E", "Carica prima un PDF");
        return;
      }
      setBusy("bAI", "Analisi...", true);
      notify("L", "Analisi protetta del PDF in corso...");
      try {
        const fields = await extract(selectedDocument);
        const count = applyExtractionFields(fields);
        schedulePracticeUpdate();
        notify("O", count ? "Estrazione completata — " + count + " campi rilevati" : "Nessun campo certo rilevato — compila manualmente");
      } catch (error) {
        notify("E", error.message);
      } finally {
        setBusy("bAI", "", false);
      }
    };
  }

  if (moduleName() === "esposto") {
    window.leggiPDF = async function (file) {
      notify("L", "Analisi protetta del PDF in corso...");
      try {
        const fields = await extract(await prepareDocument(file));
        const count = applyExtractionFields(fields);
        schedulePracticeUpdate();
        notify("O", count ? "Estrazione completata — " + count + " campi rilevati" : "Nessun campo certo rilevato — compila manualmente");
        openForm();
      } catch (error) {
        notify("E", error.message);
        openForm();
      }
    };

    window.genTesto = async function () {
      const draft = value("accertato");
      const context = { oggetto: value("ogg"), ubicazione: value("via"), mittente: value("mitt") };
      if (!draft && !context.oggetto) {
        notify("E", "Scrivi una bozza oppure compila il campo Oggetto");
        return;
      }
      setBusy("bGenTesto", "Elaborazione...", true);
      notify("L", "Formalizzazione protetta del testo...");
      try {
        const text = await write({ draft: draft, context: context });
        put("testoGen", text);
        put("accertato", text);
        document.getElementById("genbox").style.display = "block";
        notify("O", "Testo formalizzato — verifica tutti i fatti");
      } catch (error) {
        notify("E", error.message);
      } finally {
        setBusy("bGenTesto", "", false);
      }
    };
  }

  if (moduleName() === "sorvegliabilita") {
    window.leggiPDF = async function (file) {
      notify("L", "Analisi protetta del PDF in corso...");
      try {
        const fields = await extract(await prepareDocument(file));
        const count = applyExtractionFields(fields);
        schedulePracticeUpdate();
        notify("O", count ? "Estrazione completata — " + count + " campi rilevati" : "Nessun campo certo rilevato — compila manualmente");
        openForm();
      } catch (error) {
        notify("E", error.message);
        openForm();
      }
    };

    window.genNC = async function () {
      const notes = value("noteNC");
      if (!notes) {
        notify("E", "Scrivi prima le note");
        return;
      }
      setBusy("bGenNC", "Generazione...", true);
      notify("L", "Formalizzazione protetta del testo...");
      try {
        const text = await write({
          draft: notes,
          context: { motivoNonConformita: value("motivoNC") },
        });
        put("testoNC", text);
        document.getElementById("genbox").style.display = "block";
        notify("O", "Testo formalizzato — verifica tutti i fatti");
      } catch (error) {
        notify("E", error.message);
      } finally {
        setBusy("bGenNC", "", false);
      }
    };
  }

  if (moduleName() === "ricettive") {
    window.leggiPDF = async function (file) {
      notify("L", "Analisi protetta del PDF in corso...");
      try {
        const fields = await extract(await prepareDocument(file));
        const count = applyExtractionFields(fields);
        schedulePracticeUpdate();
        notify("O", count ? "Estrazione completata — " + count + " campi rilevati" : "Nessun campo certo rilevato — compila manualmente");
        openForm();
      } catch (error) {
        notify("E", error.message);
        openForm();
      }
    };

    window.genNC = async function () {
      const notes = value("noteNC");
      if (!notes) {
        notify("E", "Scrivi prima il motivo dell'irregolarità");
        return;
      }
      setBusy("bGenNC", "Generazione...", true);
      notify("L", "Formalizzazione protetta del motivo...");
      try {
        const text = await write({ draft: notes });
        put("testoNC", text);
        document.getElementById("genbox").style.display = "block";
        notify("O", "Motivo formalizzato — verifica tutti i fatti");
      } catch (error) {
        notify("E", error.message);
      } finally {
        setBusy("bGenNC", "", false);
      }
    };
  }

  function announceReady() {
    if (!window.parent || window.parent === window) return;
    let savedSession = "";
    try { savedSession = localStorage.getItem(MODULE_SESSION_KEY) || ""; } catch (_error) {}
    window.parent.postMessage({
      channel: "ADMIN3_BRIDGE",
      type: "module-ready",
      module: moduleName(),
      practiceSession: savedSession,
    }, parentTargetOrigin());
  }

  function wireStateSync() {
    captureInitialValues();
    if (document.querySelectorAll) {
      document.querySelectorAll("input,select,textarea").forEach(function (element) {
        element.addEventListener("input", schedulePracticeUpdate);
        element.addEventListener("change", schedulePracticeUpdate);
      });
    }
    if (lastHydration) applyHydration(lastHydration);
    announceReady();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireStateSync);
  else wireStateSync();
  setTimeout(announceReady, 0);
})();
