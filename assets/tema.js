// Comportamenti del tema: interruttori usabili da tastiera e lettori di schermo,
// comando distruttivo riconoscibile e protetto da conferma.
(function () {
  "use strict";

  function interruttori() {
    document.querySelectorAll(".tog").forEach(function (interruttore) {
      if (interruttore.dataset.tema) return;
      interruttore.dataset.tema = "1";
      var pomello = interruttore.querySelector(".knob");
      var testo = interruttore.parentNode && interruttore.parentNode.querySelector("span");
      interruttore.setAttribute("role", "switch");
      interruttore.setAttribute("tabindex", "0");
      if (testo) interruttore.setAttribute("aria-label", testo.textContent.trim());
      // I moduli accendono l'interruttore spostando il pomello: lo stato si legge da li.
      function allinea() {
        var acceso = !!pomello && pomello.style.left !== "" && pomello.style.left !== "3px";
        interruttore.setAttribute("aria-checked", acceso ? "true" : "false");
      }
      allinea();
      if (pomello && window.MutationObserver) new MutationObserver(allinea).observe(pomello, { attributes: true, attributeFilter: ["style"] });
      interruttore.addEventListener("keydown", function (evento) {
        if (evento.key === "Enter" || evento.key === " ") { evento.preventDefault(); interruttore.click(); }
      });
    });
  }

  function comandiDistruttivi() {
    var barra = document.querySelector(".toolbar");
    if (!barra) return false;
    barra.querySelectorAll("button").forEach(function (pulsante) {
      if ((pulsante.getAttribute("onclick") || "").indexOf("clearDraft") >= 0) pulsante.classList.add("distruttivo");
    });
    if (typeof window.clearDraft === "function" && !window.clearDraft.temaProtetto) {
      var originale = window.clearDraft;
      window.clearDraft = function () {
        if (!window.confirm("Cancellare la bozza salvata su questo dispositivo? I dati a schermo restano.")) return;
        return originale.apply(this, arguments);
      };
      window.clearDraft.temaProtetto = true;
    }
    return true;
  }

  function avvia() {
    interruttori();
    // La barra delle bozze viene creata dal modulo dopo il caricamento.
    if (!comandiDistruttivi()) {
      var tentativi = 0;
      var attesa = window.setInterval(function () {
        if (comandiDistruttivi() || ++tentativi > 40) window.clearInterval(attesa);
      }, 250);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", avvia);
  else avvia();
})();
