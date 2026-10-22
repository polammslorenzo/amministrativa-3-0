// Lettera di trasmissione e finiture comuni a tutti i Word dei moduli.
// I cinque moduli partono dallo stesso modello di lettera: qui si decide come
// si scrivono riferimenti, oggetto, corpo e chiusura, cosi' la lettera e' una
// sola. Le righe del destinatario e della firma restano ai moduli e alla Rubrica.
(function (window) {
  "use strict";

  var PARAGRAFO = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  var RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
  // Ordine degli elementi di <w:rPr> imposto dallo schema OOXML: fuori ordine
  // Word scarta la proprieta' o segnala contenuto illeggibile.
  var ORDINE_RPR = ["rStyle", "rFonts", "b", "bCs", "i", "iCs", "caps", "smallCaps", "strike", "dstrike", "outline", "shadow", "emboss", "imprint", "noProof", "snapToGrid", "vanish", "webHidden", "color", "spacing", "w", "kern", "position", "sz", "szCs", "highlight", "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath"];
  var FIRMA = "Firma autografa sostituita a mezzo stampa ai sensi dell’art. 3, comma 2, del D.Lgs. 39/1993";
  var DATA_IN_CALCE = "Napoli, data del protocollo";
  var CHIUSURA = "Si resta a disposizione per ogni ulteriore chiarimento.";
  var QUALIFICHE = { "A.C.": "A.C.", "AC": "A.C.", "ASS": "Ass.", "ASS.": "Ass.", "AG": "Ag.", "AG.": "Ag." };
  var MINUSCOLE = ["di", "de", "del", "della", "lo", "la"];

  function xe(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function testo(p) {
    return p.replace(/<w:tab\s*\/>/g, " ").replace(/<w:br\s*\/>/g, "\n").replace(/<[^>]+>/g, "")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }

  // gg.mm.aaaa da 16/10/26, 16.10.2026, 16-10-2026 o 2026-10-16. Se il valore
  // non e' una data riconoscibile resta com'e': lo corregge l'operatore.
  function data(valore) {
    var v = String(valore || "").trim();
    var iso = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    var ita = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (iso) return due(iso[3]) + "." + due(iso[2]) + "." + iso[1];
    if (ita) return due(ita[1]) + "." + due(ita[2]) + "." + (ita[3].length === 2 ? "20" + ita[3] : ita[3]);
    return v;
  }

  function due(n) {
    return String(n).padStart(2, "0");
  }

  function oggi() {
    var n = new Date();
    return due(n.getDate()) + "." + due(n.getMonth() + 1) + "." + n.getFullYear();
  }

  // "948424" o "PG/2026/948424" -> "PG/2026/948424". Se il numero non porta
  // l'anno vale quello indicato nel modulo, poi quello della data, poi l'anno in corso.
  function pg(numero, dataProtocollo, anno) {
    var v = String(numero || "").trim();
    if (!v) return "";
    var completo = v.match(/^PG\s*\/\s*(\d{4})\s*\/\s*(\d+)$/i);
    if (completo) return "PG/" + completo[1] + "/" + completo[2];
    var a = /^\d{4}$/.test(String(anno || "").trim()) ? String(anno).trim() : (data(dataProtocollo).match(/\.(\d{4})$/) || [])[1] || String(new Date().getFullYear());
    return "PG/" + a + "/" + v.replace(/^PG\s*\/?\s*/i, "");
  }

  // "PG/2026/948424 del 11.09.2026", oppure il solo PG se la data manca.
  function protocollo(numero, dataProtocollo, anno) {
    var p = pg(numero, dataProtocollo, anno);
    var d = data(dataProtocollo);
    return p ? p + (d ? " del " + d : "") : "";
  }

  // "ASS SEBASTIANO 639S" -> "Ass. Sebastiano": nella lettera bastano qualifica
  // e cognome, la matricola resta nella relazione firmata dagli agenti.
  function agente(voce) {
    var parti = String(voce || "").trim().split(/\s+/).filter(Boolean);
    if (parti.length < 2 || !QUALIFICHE[parti[0].toUpperCase()]) return String(voce || "").trim();
    var qualifica = QUALIFICHE[parti.shift().toUpperCase()];
    if (/\d/.test(parti[parti.length - 1])) parti.pop();
    if (!parti.length) return String(voce).trim();
    return qualifica + " " + parti.map(function (parola, i) {
      var bassa = parola.toLowerCase();
      if (i > 0 && MINUSCOLE.indexOf(bassa) >= 0) return bassa;
      return bassa.charAt(0).toUpperCase() + bassa.slice(1);
    }).join(" ");
  }

  function agenti(elenco) {
    return (elenco || []).filter(function (a) { return a && a !== "--"; }).map(agente).join(" – ");
  }

  // "Si trasmette, in allegato, la relazione di servizio redatta dal personale
  // di questa U.O. (A.C. Ferrara – Ass. Sebastiano) in merito a quanto in oggetto."
  function corpo(allegato, elencoAgenti) {
    var nomi = agenti(elencoAgenti);
    return "Si trasmette, in allegato, " + allegato + " dal personale di questa U.O." + (nomi ? " (" + nomi + ")" : "") + " in merito a quanto in oggetto.";
  }

  // ---- Paragrafi del modello ----

  function conProprieta(rPr, nuove) {
    // nuove: elenco di elementi gia' scritti, es. ['<w:i/>', '<w:iCs/>'].
    var interno = (rPr.match(/^<w:rPr>([\s\S]*)<\/w:rPr>$/) || [null, ""])[1];
    var elementi = [];
    var re = /<w:([A-Za-z]+)\b[^>]*\/>|<w:([A-Za-z]+)\b[^>]*>[\s\S]*?<\/w:\2>/g, m;
    while ((m = re.exec(interno)) !== null) elementi.push({ tag: m[1] || m[2], xml: m[0] });
    nuove.forEach(function (xml) {
      var tag = xml.match(/^<w:([A-Za-z]+)/)[1];
      elementi = elementi.filter(function (e) { return e.tag !== tag; });
      elementi.push({ tag: tag, xml: xml });
    });
    elementi.sort(function (a, b) {
      var ia = ORDINE_RPR.indexOf(a.tag), ib = ORDINE_RPR.indexOf(b.tag);
      return (ia < 0 ? ORDINE_RPR.length : ia) - (ib < 0 ? ORDINE_RPR.length : ib);
    });
    return "<w:rPr>" + elementi.map(function (e) { return e.xml; }).join("") + "</w:rPr>";
  }

  function rPrDi(run) {
    var m = run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
    return m ? m[0] : "<w:rPr></w:rPr>";
  }

  function run(rPr, valore) {
    return "<w:r>" + rPr + '<w:t xml:space="preserve">' + xe(valore) + "</w:t></w:r>";
  }

  // Stesso paragrafo, stessa forma del primo run, testo nuovo.
  function conTesto(p, valore, nuoveProprieta) {
    var runs = p.match(RUN) || [];
    if (!runs.length) return p;
    var rPr = rPrDi(runs[0]);
    if (nuoveProprieta) rPr = conProprieta(rPr, nuoveProprieta);
    var inizio = p.indexOf(runs[0]);
    var fine = p.lastIndexOf(runs[runs.length - 1]) + runs[runs.length - 1].length;
    return p.slice(0, inizio) + run(rPr, valore) + p.slice(fine);
  }

  // Righe "Etichetta: valore" del modello: etichetta grigia nel primo run, valore nel secondo.
  function conEtichetta(p, etichetta, valore) {
    var runs = p.match(RUN) || [];
    if (runs.length < 2) return conTesto(p, etichetta + valore);
    var inizio = p.indexOf(runs[0]);
    var fine = p.lastIndexOf(runs[runs.length - 1]) + runs[runs.length - 1].length;
    return p.slice(0, inizio) + run(rPrDi(runs[0]), etichetta) + run(rPrDi(runs[1]), valore) + p.slice(fine);
  }

  function conSpaziatura(p, prima, dopo) {
    return p.replace(/<w:spacing\b[^>]*\/>/, '<w:spacing w:after="' + dopo + '" w:before="' + prima + '"/>');
  }

  // L'oggetto non contiene piu' "Trasmissione atti": il segnalibro dice alle
  // regole di impaginazione dei moduli di lasciarlo stare.
  function segnaOggetto(p) {
    var segno = '<w:bookmarkStart w:id="9100" w:name="ADMIN3_oggetto"/><w:bookmarkEnd w:id="9100"/>';
    return /<\/w:pPr>/.test(p) ? p.replace("</w:pPr>", "</w:pPr>" + segno) : p.replace(/<w:p(\s[^>]*)?>/, function (a) { return a + segno; });
  }

  function righe(elenco) {
    return (elenco || []).filter(function (r) { return r && String(r[1] || "").trim(); });
  }

  // Compone la lettera sul modello comune.
  // d = { pg, data, riferimenti:[[etichetta, valore]], oggetto, corpo, dati:[[etichetta, valore]] }
  function componi(xml, d) {
    var rif = righe(d.riferimenti), dati = righe(d.dati), corpoModello = "";
    return xml.replace(PARAGRAFO, function (p) {
      var t = testo(p).trim();
      if (/^PG\/\d{4}\/\d+\s+del\s/.test(t)) return conEtichetta(p, d.pg, "   del   " + data(d.data));
      if (t.indexOf("Rif. PG:") === 0) {
        return rif.map(function (r, i) { return conSpaziatura(conEtichetta(p, r[0], r[1]), 0, i === rif.length - 1 ? 0 : 60); }).join("");
      }
      if (t.indexOf("Rif. Prot. SUAP:") === 0) return "";
      if (t.indexOf("Trasmissione atti") === 0) return segnaOggetto(conSpaziatura(conTesto(p, d.oggetto), 120, 200));
      // Il sottotitolo ripeteva l'oggetto: ora l'oggetto dice gia' tutto.
      if (t === "Riscontro accertamento") return "";
      if (t.indexOf("Si trasmette quanto accertato") === 0) {
        corpoModello = p;
        return conTesto(p, d.corpo);
      }
      if (t.indexOf("Utente:") === 0) {
        var chiusura = corpoModello ? conSpaziatura(conTesto(corpoModello, CHIUSURA), dati.length ? 160 : 0, 120) : "";
        return dati.map(function (r) { return conEtichetta(p, r[0], r[1]); }).join("") + chiusura;
      }
      if (t.indexOf("Ubicazione:") === 0) return "";
      return p;
    });
  }

  // Ogni Word: in calce "Napoli, data del protocollo" in corsivo, perche' la data
  // e' quella del PG accanto al protocollo, e la formula corretta sotto le firme.
  function rifinisci(xml) {
    return xml.replace(PARAGRAFO, function (p) {
      var t = testo(p).trim();
      if (/^Napoli,\s*li\b/i.test(t)) return conTesto(p, DATA_IN_CALCE, ["<w:i/>", "<w:iCs/>"]);
      if (t.indexOf("Firma autografa") === 0) return conTesto(p, FIRMA);
      return p;
    });
  }

  window.ADMIN3_LETTERA = {
    data: data,
    oggi: oggi,
    pg: pg,
    protocollo: protocollo,
    agente: agente,
    agenti: agenti,
    corpo: corpo,
    componi: componi,
    rifinisci: rifinisci,
  };
})(window);
