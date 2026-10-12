// Rubrica Egrammata dentro i moduli: destinatari non abituali della lettera di
// trasmissione. I dati stanno in rubrica-dati.js (generato); qui ci sono la
// ricerca, la composizione delle tre righe e il riquadro nella sezione lettera.
(function (window) {
  "use strict";

  var MINUSCOLE = ["e", "ed", "di", "del", "dello", "della", "dei", "degli", "delle", "a", "al", "alla", "alle", "da", "in", "per", "il", "la", "lo", "le", "i", "gli", "con"];

  function norm(testo) {
    return String(testo || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  // "SVILUPPO ECONOMICO" -> "Sviluppo Economico"; le sigle tra parentesi restano come sono.
  function maiuscoleIniziali(testo) {
    return String(testo).split(" ").map(function (parola, indice) {
      if (!parola || /^\(.*\)$/.test(parola)) return parola;
      var bassa = parola.toLowerCase();
      if (indice > 0 && MINUSCOLE.indexOf(bassa) >= 0) return bassa;
      var apostrofo = bassa.indexOf("'");
      if (apostrofo > 0 && apostrofo < bassa.length - 1) {
        return bassa.slice(0, apostrofo + 1) + bassa.charAt(apostrofo + 1).toUpperCase() + bassa.slice(apostrofo + 2);
      }
      return bassa.charAt(0).toUpperCase() + bassa.slice(1);
    }).join(" ");
  }

  function rigaArea(nome) {
    var pulito = String(nome || "").replace(/\s+-\s+[A-Z]{2,6}\d{3,5}\b.*$/, "").trim();
    var municipalita = /^Dir\.\s*Municipalit\S*\s+(\d+)/i.exec(pulito);
    if (municipalita) return "Alla Direzione Municipalità " + municipalita[1];
    if (/^AREA\s/i.test(pulito)) {
      var resto = pulito.replace(/^AREA\s+/i, "");
      return "All'Area " + (resto === resto.toUpperCase() ? maiuscoleIniziali(resto) : resto);
    }
    if (/^Assessorato\b/i.test(pulito)) return "All'" + pulito;
    if (/^(Sindaco|Vice Sindaco|Direttore Generale|Segretario Generale|Presidente del Consiglio Comunale)$/i.test(pulito)) return "Al " + pulito;
    return pulito;
  }

  // Le tre righe del destinatario: Area, Servizio, indirizzo di protocollo.
  function righe(voce) {
    var antenati = voce.p || [];
    var area = voce.n;
    if (voce.t !== "A" || antenati.length) {
      area = antenati[0] || voce.n;
      for (var i = antenati.length - 1; i >= 0; i--) {
        if (/^AREA\s/i.test(antenati[i])) { area = antenati[i]; break; }
      }
    }
    var servizio = voce.t === "A" && !antenati.length ? "" : String(voce.n).replace(/^Serv\.\s*/i, "Servizio ");
    return { area: rigaArea(area), servizio: servizio, indirizzo: voce.c };
  }

  function indice(voce) {
    if (!voce._h) voce._h = norm(voce.n + " " + (voce.p || []).join(" ") + " " + (voce.o || "") + " " + voce.c);
    if (!voce._n) voce._n = norm(voce.n);
    return voce;
  }

  function cerca(voci, domanda, massimo) {
    var parole = norm(domanda).split(" ").filter(Boolean);
    if (!parole.length) return { trovate: [], totale: 0 };
    // Solo cifre e separatori: e un indirizzo di protocollo, anche parziale ("9.4").
    if (/^\s*\d+(?:[\s.|]+\d+)*[\s.|]*$/.test(String(domanda))) {
      var codice = parole.join(".");
      var perCodice = voci.filter(function (voce) { return voce.c === codice || voce.c.indexOf(codice + ".") === 0; });
      return { trovate: perCodice.slice(0, massimo || 8), totale: perCodice.length };
    }
    var trovate = [];
    voci.forEach(function (voce) {
      indice(voce);
      var punti = 0;
      for (var i = 0; i < parole.length; i++) {
        if (voce._h.indexOf(parole[i]) < 0) return;
        punti += voce._n.indexOf(parole[i]) >= 0 ? 3 : 1;
      }
      if (voce._n.indexOf(parole.join(" ")) >= 0) punti += 4;
      trovate.push({ voce: voce, punti: punti });
    });
    trovate.sort(function (a, b) { return b.punti - a.punti || a.voce.n.length - b.voce.n.length; });
    return { trovate: trovate.slice(0, massimo || 8).map(function (t) { return t.voce; }), totale: trovate.length };
  }

  function xmlTesto(frammento) {
    return String(frammento || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }
  function xmlProteggi(testo) {
    return String(testo).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Aggiunge una riga subito sotto il paragrafo il cui testo e esattamente
  // `ancora`, copiandone allineamento e carattere. Restituisce null se il
  // paragrafo non c'e, cosi chi chiama puo avvisare invece di perdere il nome.
  function rigaSotto(xml, ancora, testo) {
    var cercato = String(ancora || "").trim();
    var nuovo = String(testo || "").trim();
    if (!cercato || !nuovo) return null;
    var fatto = false;
    var esito = String(xml).replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, function (paragrafo) {
      if (fatto || xmlTesto(paragrafo).trim() !== cercato) return paragrafo;
      fatto = true;
      var proprieta = (/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr(?:\s[^>]*)?\/>/.exec(paragrafo) || [""])[0];
      var senzaProprieta = paragrafo.replace(proprieta, "");
      var carattere = (/<w:r(?:\s[^>]*)?>\s*(<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>)/.exec(senzaProprieta) || ["", ""])[1];
      return paragrafo + "<w:p>" + proprieta + "<w:r>" + carattere + '<w:t xml:space="preserve">' + xmlProteggi(nuovo) + "</w:t></w:r></w:p>";
    });
    return fatto ? esito : null;
  }

  // Toglie il primo paragrafo il cui testo e esattamente `testo`.
  function togliRiga(xml, testo) {
    var cercato = String(testo || "").trim();
    var fatto = false;
    if (!cercato) return String(xml);
    return String(xml).replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, function (paragrafo) {
      if (fatto || xmlTesto(paragrafo).trim() !== cercato) return paragrafo;
      fatto = true;
      return "";
    });
  }

  // Un destinatario senza servizio (un'Area, il Sindaco) non deve lasciare una
  // riga vuota tra Area e indirizzo: il modulo scrive questo segnaposto al posto
  // del servizio e completa() elimina l'intero paragrafo.
  var SENZA_SERVIZIO = "§§senza-servizio§§";

  // ---- Altri destinatari, anche per conoscenza ----
  var MAX_ALTRI = 6;
  function pulito(v) { return String(v == null ? "" : v).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, 200); }

  // L'elenco viaggia in un solo campo nascosto, come testo: cosi bozze e ripristini
  // lo salvano e lo ricaricano come qualunque altro campo del modulo.
  function altriDa(testo) {
    var grezzi;
    try { grezzi = JSON.parse(String(testo || "[]")); } catch (errore) { return []; }
    if (!Array.isArray(grezzi)) return [];
    return grezzi.slice(0, MAX_ALTRI).map(function (g) {
      g = g || {};
      return { area: pulito(g.area), servizio: pulito(g.servizio), indirizzo: pulito(g.indirizzo), nome: pulito(g.nome), pc: g.pc === true };
    }).filter(function (a) { return a.area || a.servizio; });
  }
  // Prima i destinatari diretti, poi quelli per conoscenza: e l'ordine in cui escono.
  function inOrdine(altri) {
    return altri.filter(function (a) { return !a.pc; }).concat(altri.filter(function (a) { return a.pc; }));
  }

  function paragrafoCon(xml, testo) {
    var cercato = String(testo || "").trim(), trovato = null;
    if (!cercato) return null;
    String(xml).replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, function (paragrafo) {
      if (trovato === null && xmlTesto(paragrafo).trim() === cercato) trovato = paragrafo;
      return paragrafo;
    });
    return trovato;
  }
  // Nuovo paragrafo con allineamento e carattere di `modello`; `prima` e lo spazio sopra (in ventesimi di punto).
  function clona(modello, testo, prima) {
    var proprieta = (/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr(?:\s[^>]*)?\/>/.exec(modello) || [""])[0];
    var carattere = (/<w:r(?:\s[^>]*)?>\s*(<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>)/.exec(modello.replace(proprieta, "")) || ["", ""])[1];
    if (prima) {
      var spazio = /<w:spacing\b[^>]*\/>/.exec(proprieta);
      if (spazio) {
        var nuovoSpazio = /w:before="[^"]*"/.test(spazio[0])
          ? spazio[0].replace(/w:before="[^"]*"/, 'w:before="' + prima + '"')
          : spazio[0].replace("<w:spacing", '<w:spacing w:before="' + prima + '"');
        proprieta = proprieta.replace(spazio[0], nuovoSpazio);
      } else if (/<w:jc\b/.test(proprieta)) {
        proprieta = proprieta.replace(/<w:jc\b/, '<w:spacing w:before="' + prima + '"/><w:jc');
      } else if (/<\/w:pPr>/.test(proprieta)) {
        proprieta = proprieta.replace("</w:pPr>", '<w:spacing w:before="' + prima + '"/></w:pPr>');
      } else {
        proprieta = '<w:pPr><w:spacing w:before="' + prima + '"/></w:pPr>';
      }
    }
    return "<w:p>" + proprieta + "<w:r>" + carattere + '<w:t xml:space="preserve">' + xmlProteggi(testo) + "</w:t></w:r></w:p>";
  }

  var E_PER_CONOSCENZA = "e, p.c.";

  function completa(xml, destinatario, areaVal, uffParts) {
    var servizio = (uffParts && uffParts[0]) || "";
    var esito = String(xml);
    if (servizio === SENZA_SERVIZIO) {
      esito = togliRiga(esito, SENZA_SERVIZIO).split(SENZA_SERVIZIO).join("");
      servizio = "";
    }
    var nome = destinatario && destinatario.nome;
    var nomeInserito = true;
    if (nome) {
      var conNome = rigaSotto(esito, servizio || areaVal, nome);
      nomeInserito = conNome !== null;
      if (nomeInserito) esito = conNome;
    }
    var altri = inOrdine((destinatario && destinatario.altri) || []);
    if (!altri.length) return { xml: esito, nomeInserito: nomeInserito, altriInseriti: true };

    // I destinatari in piu vanno sotto l'indirizzo del primo, con lo stesso aspetto
    // delle sue tre righe: Area, Servizio (e nominativo), indirizzo di protocollo.
    var mArea = paragrafoCon(esito, areaVal);
    var mInd = paragrafoCon(esito, "Indirizzo di protocollo " + ((uffParts && uffParts[1]) || ""));
    if (!mArea || !mInd) return { xml: esito, nomeInserito: nomeInserito, altriInseriti: false };
    var mServ = (servizio && paragrafoCon(esito, servizio)) || mArea;
    var nuovi = "", intestazionePc = false;
    altri.forEach(function (a) {
      var stacco = 160;
      if (a.pc && !intestazionePc) { nuovi += clona(mInd, E_PER_CONOSCENZA, 160); intestazionePc = true; stacco = 40; }
      var prima = true;
      function riga(modello, testo) { if (!testo) return; nuovi += clona(modello, testo, prima ? stacco : 0); prima = false; }
      riga(mArea, a.area); riga(mServ, a.servizio); riga(mServ, a.nome);
      riga(mInd, a.indirizzo ? "Indirizzo di protocollo " + a.indirizzo : "");
    });
    var fatto = false;
    esito = esito.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, function (paragrafo) {
      if (fatto || paragrafo !== mInd) return paragrafo;
      fatto = true;
      return paragrafo + nuovi;
    });
    return { xml: esito, nomeInserito: nomeInserito, altriInseriti: fatto };
  }

  // I menu dei destinatari abituali sono stati allineati alla rubrica: bozze e
  // pratiche salvate prima portano ancora i vecchi valori. Per gli uffici fa
  // fede l'indirizzo di protocollo; per le Aree i due nomi cambiati.
  var AREE_RINOMINATE = {
    "All'Area Sviluppo Socio Economico e Competitivita": "All'Area Sviluppo Economico",
    "Alla Municipalita 4": "Alla Direzione Municipalità 4"
  };
  function traduciVecchio(valore, disponibili) {
    var testo = String(valore == null ? "" : valore);
    if (disponibili.indexOf(testo) >= 0) return testo;
    if (AREE_RINOMINATE[testo] && disponibili.indexOf(AREE_RINOMINATE[testo]) >= 0) return AREE_RINOMINATE[testo];
    var barra = testo.lastIndexOf("|");
    if (barra >= 0 && barra < testo.length - 1) {
      var coda = testo.slice(barra);
      for (var i = 0; i < disponibili.length; i++) {
        if (disponibili[i].slice(-coda.length) === coda) return disponibili[i];
      }
    }
    return null;
  }

  window.ADMIN3_RUBRICA_LOGICA = { norm: norm, righe: righe, cerca: cerca, rigaSotto: rigaSotto, togliRiga: togliRiga, completa: completa, altriDa: altriDa, inOrdine: inOrdine, E_PER_CONOSCENZA: E_PER_CONOSCENZA, SENZA_SERVIZIO: SENZA_SERVIZIO, maiuscoleIniziali: maiuscoleIniziali, traduciVecchio: traduciVecchio };

  if (typeof document === "undefined") return;

  function campo(id) { return document.getElementById(id); }
  function valore(id) { var e = campo(id); return e ? String(e.value || "").trim() : ""; }

  // Usata dai moduli al momento di comporre la lettera.
  window.rubricaDestinatario = function () {
    var area = valore("rubArea"), servizio = valore("rubServ"), indirizzo = valore("rubInd");
    return { attivo: !!(area || servizio || indirizzo), area: area, servizio: servizio, indirizzo: indirizzo, nome: valore("rubNome"), altri: altriDa(valore("rubAltri")), senzaServizio: SENZA_SERVIZIO };
  };
  window.rubricaCompleta = function (xml, destinatario, areaVal, uffParts) {
    var esito = completa(xml, destinatario, areaVal, uffParts);
    if (!esito.nomeInserito && typeof window.mostraMsg === "function") {
      window.mostraMsg("E", "Nominativo non inserito nella lettera: aggiungilo a mano sotto il servizio.");
    }
    if (!esito.altriInseriti && typeof window.mostraMsg === "function") {
      window.mostraMsg("E", "Gli altri destinatari non sono stati inseriti nella lettera: aggiungili a mano.");
    }
    return esito.xml;
  };

  function crea(tag, classe, testo) {
    var e = document.createElement(tag);
    if (classe) e.className = classe;
    if (testo != null) e.textContent = testo;
    return e;
  }
  function casella(id, etichetta, segnaposto) {
    var f = crea("div", "f");
    var l = crea("label", null, etichetta); l.setAttribute("for", id);
    var i = crea("input"); i.id = id; i.placeholder = segnaposto || ""; i.autocomplete = "off";
    f.appendChild(l); f.appendChild(i);
    return f;
  }

  // Bozze e ripristini scrivono select.value: se il valore e uno di quelli vecchi
  // il menu resterebbe senza selezione e la generazione della lettera andrebbe in
  // errore. Qui il valore viene tradotto; se non e traducibile si torna a "-".
  function proteggiMenu(menu) {
    var nativo = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value");
    if (!menu || !nativo || !nativo.set || menu.dataset.rubricaProtetto) return;
    menu.dataset.rubricaProtetto = "1";
    Object.defineProperty(menu, "value", {
      configurable: true,
      get: function () { return nativo.get.call(this); },
      set: function (valore) {
        nativo.set.call(this, valore);
        if (this.selectedIndex >= 0) return;
        var disponibili = [];
        for (var i = 0; i < this.options.length; i++) disponibili.push(this.options[i].value);
        var tradotto = traduciVecchio(valore, disponibili);
        if (tradotto !== null) nativo.set.call(this, tradotto);
        if (this.selectedIndex < 0) this.selectedIndex = 0;
      }
    });
  }

  function avvia() {
    var dati = window.ADMIN3_RUBRICA;
    var selArea = campo("destA"), selUff = campo("destU");
    proteggiMenu(selArea); proteggiMenu(selUff);
    if (!dati || !dati.voci || !selArea || !selUff || campo("rubArea")) return;
    var griglia = selArea.closest ? selArea.closest(".g2") : null;
    if (!griglia || !griglia.parentNode) return;

    var stile = crea("style");
    stile.textContent =
      ".rub{margin:14px 0 12px;padding:14px;border:1px solid #2a2d38;border-radius:10px;background:#12151c}" +
      ".rub-t{font-size:12px;font-weight:600;color:#e8eaf0;margin-bottom:3px}" +
      ".rub-s{font-size:11px;color:#8a94a6;line-height:1.5;margin-bottom:10px}" +
      ".rub-l{display:grid;gap:6px;margin:8px 0 12px}" +
      ".rub-v{display:block;width:100%;text-align:left;background:#1c1f28;border:1px solid #343846;border-radius:8px;padding:9px 11px;color:#e8eaf0;font:inherit;font-size:13px;cursor:pointer}" +
      ".rub-v:hover,.rub-v:focus{border-color:#2563eb;outline:none}" +
      ".rub-v small{display:block;color:#8a94a6;font-size:11px;margin-top:2px}" +
      ".rub-v b{font-weight:600}.rub-v i{font-style:normal;color:#fbbf24}" +
      ".rub-n{font-size:11px;color:#8a94a6}" +
      ".rub-a{margin-top:12px;padding:11px 13px;border:1px dashed #343846;border-radius:8px}" +
      ".rub-a span{display:block;font-size:10px;letter-spacing:.7px;text-transform:uppercase;color:#8a94a6;margin-bottom:6px}" +
      ".rub-a div{text-align:right;font-size:13px;line-height:1.5;color:#e8eaf0}" +
      ".rub-a div.manca{color:#fbbf24}" +
      ".rub-x{margin-top:10px;display:none}" +
      ".rub-altri{margin-top:16px;padding-top:14px;border-top:1px solid #2a2d38}" +
      ".rub-c{border:1px solid #2a2d38;border-radius:8px;padding:12px;margin:10px 0;background:#16191f}" +
      ".rub-ch{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;font-size:13px;font-weight:600;color:#e8eaf0}" +
      ".rub-ch label{display:flex;align-items:center;gap:7px;margin-left:auto;font-size:13px;font-weight:500;text-transform:none;letter-spacing:0;color:#b3bccb;cursor:pointer}" +
      ".rub-ch input{width:auto;min-height:0}" +
      ".rub-a div.pc{font-style:italic;color:#8a94a6}.rub-a div.stacco{margin-top:9px}";
    document.head.appendChild(stile);

    var riquadro = crea("div", "rub");
    riquadro.appendChild(crea("div", "rub-t", "Destinatario non abituale"));
    var data = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dati.estratto || "");
    riquadro.appendChild(crea("div", "rub-s",
      "Cerca nella Rubrica Egrammata (" + dati.voci.length + " strutture" + (data ? ", estratto del " + data[3] + "." + data[2] + "." + data[1] : "") +
      "). Le tre righe restano modificabili: quando sono compilate sostituiscono i due menu qui sopra."));

    var ricerca = crea("div", "f");
    var cercaInput = crea("input");
    cercaInput.type = "search"; cercaInput.autocomplete = "off";
    cercaInput.placeholder = "Cerca struttura, ufficio o indirizzo (es. edilizia, municipalità 4, 9.4)";
    cercaInput.setAttribute("aria-label", "Cerca nella Rubrica Egrammata");
    ricerca.appendChild(cercaInput);
    riquadro.appendChild(ricerca);
    var elenco = crea("div", "rub-l");
    riquadro.appendChild(elenco);

    var tre = crea("div", "g3");
    tre.appendChild(casella("rubArea", "Area", "es. All'Area Urbanistica"));
    tre.appendChild(casella("rubServ", "Servizio / Ufficio", "es. Servizio Condono Edilizio"));
    tre.appendChild(casella("rubInd", "Indirizzo di protocollo", "es. 9.8.0.0.0"));
    riquadro.appendChild(tre);
    var nominativo = casella("rubNome", "Nominativo sotto il servizio (facoltativo)", "es. c.a. Dott. Mario Rossi");
    nominativo.style.marginTop = "12px";
    riquadro.appendChild(nominativo);

    var nascosto = crea("input"); nascosto.type = "hidden"; nascosto.id = "rubAltri";
    riquadro.appendChild(nascosto);
    var sezioneAltri = crea("div", "rub-altri");
    sezioneAltri.appendChild(crea("div", "rub-t", "Altri destinatari"));
    sezioneAltri.appendChild(crea("div", "rub-s", "Aggiungi qui gli uffici a cui la lettera va inviata oltre al primo. Quelli segnati \"per conoscenza\" escono in fondo, dopo la riga \"e, p.c.\"."));
    var schede = crea("div");
    sezioneAltri.appendChild(schede);
    var aggiungi = crea("button", "bsmall", "+ Aggiungi un destinatario");
    aggiungi.type = "button";
    sezioneAltri.appendChild(aggiungi);
    riquadro.appendChild(sezioneAltri);

    var anteprima = crea("div", "rub-a");
    anteprima.appendChild(crea("span", null, "Come uscirà nella lettera"));
    var righeAnteprima = crea("div");
    anteprima.appendChild(righeAnteprima);
    riquadro.appendChild(anteprima);

    var togli = crea("button", "bsmall rub-x", "Torna ai destinatari abituali");
    togli.type = "button";
    riquadro.appendChild(togli);

    griglia.parentNode.insertBefore(riquadro, griglia.nextSibling);

    function scrivi(id, testo) {
      var e = campo(id);
      e.value = testo;
      e.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function scegli(voce) {
      var r = righe(voce);
      scrivi("rubArea", r.area); scrivi("rubServ", r.servizio); scrivi("rubInd", r.indirizzo);
      cercaInput.value = ""; mostra([], 0);
      aggiorna();
    }
    function mostra(voci, totale) {
      while (elenco.firstChild) elenco.removeChild(elenco.firstChild);
      voci.forEach(function (voce) {
        var b = crea("button", "rub-v"); b.type = "button";
        b.appendChild(crea("b", null, voce.n));
        if (voce.x) b.appendChild(crea("i", null, "  ⚠ possibile struttura sospesa"));
        b.appendChild(crea("small", null, ((voce.p || []).join(" › ") || "struttura di vertice") + "  ·  " + voce.c));
        b.addEventListener("click", function () { scegli(voce); });
        elenco.appendChild(b);
      });
      if (totale > voci.length) elenco.appendChild(crea("div", "rub-n", "Altre " + (totale - voci.length) + " strutture: aggiungi una parola per restringere."));
      if (!voci.length && norm(cercaInput.value)) elenco.appendChild(crea("div", "rub-n", "Nessuna struttura trovata: puoi scrivere le tre righe a mano qui sotto."));
    }
    var ultime = [];
    cercaInput.addEventListener("input", function () {
      var r = cerca(dati.voci, cercaInput.value, 8);
      ultime = r.trovate; mostra(r.trovate, r.totale);
    });
    cercaInput.addEventListener("keydown", function (evento) {
      if (evento.key === "Enter") { evento.preventDefault(); if (ultime.length) scegli(ultime[0]); }
    });
    togli.addEventListener("click", function () {
      scrivi("rubArea", ""); scrivi("rubServ", ""); scrivi("rubInd", "");
      aggiorna();
    });

    // ---- schede degli altri destinatari ----
    var ultimoScritto = "";
    function raccogli() {
      var lista = [];
      Array.prototype.forEach.call(schede.children, function (scheda) {
        var c = scheda.querySelectorAll("input[data-campo]");
        var voce = { pc: scheda.querySelector("input[type=checkbox]").checked };
        Array.prototype.forEach.call(c, function (i) { voce[i.getAttribute("data-campo")] = i.value.trim(); });
        lista.push(voce);
      });
      // Le schede ancora vuote restano a schermo ma non finiscono nel campo salvato.
      var piene = lista.filter(function (a) { return a.area || a.servizio || a.indirizzo || a.nome; });
      var testo = piene.length ? JSON.stringify(piene) : "";
      if (testo === nascosto.value) return;
      nascosto.value = testo; ultimoScritto = testo;
      nascosto.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function casellaScheda(nomeCampo, etichetta, segnaposto, valoreIniziale) {
      var f = crea("div", "f");
      var l = crea("label", null, etichetta);
      var i = crea("input"); i.setAttribute("data-campo", nomeCampo); i.placeholder = segnaposto; i.autocomplete = "off"; i.value = valoreIniziale || "";
      l.appendChild(i); f.appendChild(l);
      // L'etichetta contiene il campo: cosi il clic sull'etichetta porta al campo senza bisogno di un id.
      l.style.display = "flex"; l.style.flexDirection = "column"; l.style.gap = "5px";
      return f;
    }
    function nuovaScheda(a) {
      a = a || {};
      var scheda = crea("div", "rub-c");
      var testa = crea("div", "rub-ch");
      testa.appendChild(crea("span", null, "Destinatario"));
      var spunta = crea("label");
      var casellaPc = crea("input"); casellaPc.type = "checkbox"; casellaPc.checked = a.pc === true;
      spunta.appendChild(casellaPc); spunta.appendChild(document.createTextNode("Per conoscenza"));
      testa.appendChild(spunta);
      var via = crea("button", "bsmall", "Togli"); via.type = "button";
      testa.appendChild(via);
      scheda.appendChild(testa);

      var cercaF = crea("div", "f");
      var cercaI = crea("input"); cercaI.type = "search"; cercaI.autocomplete = "off";
      cercaI.placeholder = "Cerca nella rubrica (nome o indirizzo), oppure scrivi le righe qui sotto";
      cercaI.setAttribute("aria-label", "Cerca nella Rubrica Egrammata");
      cercaF.appendChild(cercaI); scheda.appendChild(cercaF);
      var trovati = crea("div", "rub-l"); scheda.appendChild(trovati);

      var tre2 = crea("div", "g3");
      tre2.appendChild(casellaScheda("area", "Area", "es. All'Area Urbanistica", a.area));
      tre2.appendChild(casellaScheda("servizio", "Servizio / Ufficio", "es. Servizio Condono Edilizio", a.servizio));
      tre2.appendChild(casellaScheda("indirizzo", "Indirizzo di protocollo", "es. 9.8.0.0.0", a.indirizzo));
      scheda.appendChild(tre2);
      scheda.appendChild(casellaScheda("nome", "Nominativo sotto il servizio (facoltativo)", "es. c.a. Dott. Mario Rossi", a.nome));

      function mostraTrovati(voci, totale) {
        while (trovati.firstChild) trovati.removeChild(trovati.firstChild);
        voci.forEach(function (voce) {
          var b = crea("button", "rub-v"); b.type = "button";
          b.appendChild(crea("b", null, voce.n));
          if (voce.x) b.appendChild(crea("i", null, "  ⚠ possibile struttura sospesa"));
          b.appendChild(crea("small", null, ((voce.p || []).join(" › ") || "struttura di vertice") + "  ·  " + voce.c));
          b.addEventListener("click", function () {
            var r = righe(voce);
            scheda.querySelector('[data-campo="area"]').value = r.area;
            scheda.querySelector('[data-campo="servizio"]').value = r.servizio;
            scheda.querySelector('[data-campo="indirizzo"]').value = r.indirizzo;
            cercaI.value = ""; mostraTrovati([], 0); raccogli(); aggiorna();
          });
          trovati.appendChild(b);
        });
        if (totale > voci.length) trovati.appendChild(crea("div", "rub-n", "Altre " + (totale - voci.length) + " strutture: aggiungi una parola per restringere."));
      }
      cercaI.addEventListener("input", function (evento) {
        evento.stopPropagation();
        var r = cerca(dati.voci, cercaI.value, 6); mostraTrovati(r.trovate, r.totale);
      });
      scheda.addEventListener("input", function (evento) { if (evento.target !== cercaI) raccogli(); });
      casellaPc.addEventListener("change", function () { raccogli(); aggiorna(); });
      via.addEventListener("click", function () { schede.removeChild(scheda); raccogli(); aggiorna(); aggiungi.disabled = false; });
      return scheda;
    }
    function ridisegnaSchede() {
      while (schede.firstChild) schede.removeChild(schede.firstChild);
      altriDa(nascosto.value).forEach(function (a) { schede.appendChild(nuovaScheda(a)); });
      ultimoScritto = nascosto.value;
      aggiungi.disabled = schede.children.length >= MAX_ALTRI;
    }
    aggiungi.addEventListener("click", function () {
      if (schede.children.length >= MAX_ALTRI) return;
      var scheda = nuovaScheda({});
      schede.appendChild(scheda);
      aggiungi.disabled = schede.children.length >= MAX_ALTRI;
      scheda.querySelector("input[type=search]").focus();
    });

    var firma = null;
    function aggiorna() {
      // Una bozza ripresa o "Nuova pratica" cambiano il campo nascosto senza passare da qui.
      if (nascosto.value !== ultimoScritto) ridisegnaSchede();
      var d = window.rubricaDestinatario();
      var abituale = (selUff.options[selUff.selectedIndex] || { value: "|" }).value.split("|");
      var area = d.attivo ? d.area : ((selArea.options[selArea.selectedIndex] || { value: "" }).value || "All'Area Sviluppo Economico");
      var servizio = d.attivo ? d.servizio : (abituale[0] || "");
      var indirizzo = d.attivo ? d.indirizzo : (abituale[1] || "");
      var nuova = [d.attivo, area, servizio, indirizzo, d.nome, nascosto.value].join("\u0001");
      if (nuova === firma) return;
      firma = nuova;
      [selArea, selUff].forEach(function (s) { s.disabled = d.attivo; s.style.opacity = d.attivo ? "0.45" : ""; });
      togli.style.display = d.attivo ? "inline-block" : "none";
      while (righeAnteprima.firstChild) righeAnteprima.removeChild(righeAnteprima.firstChild);
      righeAnteprima.className = "";
      var linee = [];
      if (area) linee.push(area);
      if (servizio) linee.push(servizio);
      if (d.nome) linee.push(d.nome);
      linee.push("Indirizzo di protocollo " + (indirizzo || "—"));
      linee.forEach(function (l) { righeAnteprima.appendChild(crea("div", null, l)); });
      var intestazionePc = false;
      inOrdine(d.altri).forEach(function (a) {
        var primaRiga = true;
        function riga(testo, classe) {
          if (!testo) return;
          righeAnteprima.appendChild(crea("div", ((classe || "") + (primaRiga ? " stacco" : "")).trim() || null, testo));
          primaRiga = false;
        }
        if (a.pc && !intestazionePc) { riga(E_PER_CONOSCENZA, "pc"); intestazionePc = true; primaRiga = false; }
        riga(a.area); riga(a.servizio); riga(a.nome);
        riga(a.indirizzo ? "Indirizzo di protocollo " + a.indirizzo : "");
      });
      if (d.attivo && (!area || !indirizzo)) {
        righeAnteprima.appendChild(crea("div", "manca", "Manca " + (!area ? "l'Area" : "l'indirizzo di protocollo") + ": completa la riga prima di generare."));
      }
    }
    riquadro.addEventListener("input", aggiorna);
    selArea.addEventListener("change", aggiorna);
    selUff.addEventListener("change", aggiorna);
    // Bozze, "Nuova pratica" e ripristini scrivono nei campi senza generare
    // eventi: un controllo periodico tiene allineati anteprima e menu.
    window.setInterval(aggiorna, 600);
    aggiorna();
  }

  if (campo("destA")) avvia();
  else document.addEventListener("DOMContentLoaded", avvia);
})(typeof window !== "undefined" ? window : globalThis);
