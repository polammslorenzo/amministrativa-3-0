(function () {
  "use strict";

  const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const XML = "http://www.w3.org/XML/1998/namespace";
  const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  let active = false;

  function children(parent, name) {
    return Array.from(parent.childNodes).filter((node) => node.nodeType === 1 && node.namespaceURI === WORD && node.localName === name);
  }

  function descendants(parent, name) {
    return Array.from(parent.getElementsByTagNameNS(WORD, name));
  }

  function paragraphText(paragraph) {
    let result = "";
    function visit(node) {
      if (node.nodeType !== 1 || (node.namespaceURI === WORD && node.localName === "pPr")) return;
      if (node.namespaceURI === WORD) {
        if (node.localName === "t") { result += node.textContent; return; }
        if (node.localName === "tab") { result += "\t"; return; }
        if (node.localName === "br" || node.localName === "cr") { result += "\n"; return; }
      }
      Array.from(node.childNodes).forEach(visit);
    }
    Array.from(paragraph.childNodes).forEach(visit);
    return result;
  }

  function editable(paragraph) {
    const allowedParagraph = new Set(["pPr", "r"]);
    const allowedRun = new Set(["rPr", "t", "tab", "br", "cr"]);
    for (const node of Array.from(paragraph.childNodes)) {
      if (node.nodeType !== 1) continue;
      if (node.namespaceURI !== WORD || !allowedParagraph.has(node.localName)) return false;
      if (node.localName === "r") {
        for (const child of Array.from(node.childNodes)) {
          if (child.nodeType === 1 && (child.namespaceURI !== WORD || !allowedRun.has(child.localName))) return false;
        }
      }
    }
    return true;
  }

  function alignment(paragraph) {
    const props = children(paragraph, "pPr")[0];
    const jc = props && children(props, "jc")[0];
    return jc ? jc.getAttributeNS(WORD, "val") || "left" : "left";
  }

  function bold(paragraph) {
    const run = children(paragraph, "r")[0];
    const props = run && children(run, "rPr")[0];
    return Boolean(props && children(props, "b").length);
  }

  function paragraphModel(paragraph, part) {
    const text = paragraphText(paragraph);
    if (!text.trim()) return null;
    return { paragraph, part, originalText: text, text, align: alignment(paragraph), originalAlign: alignment(paragraph), bold: bold(paragraph), originalBold: bold(paragraph), deleted: false, canEdit: editable(paragraph) };
  }

  async function inspect(items) {
    const files = [];
    for (const item of items) {
      if (!item || !item.zip || !item.filename) throw new Error("Documento Word non disponibile per la revisione.");
      const parts = [];
      const names = Object.keys(item.zip.files).filter((name) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name));
      names.sort((a, b) => a === "word/document.xml" ? -1 : b === "word/document.xml" ? 1 : a.localeCompare(b));
      for (const name of names) {
        const source = await item.zip.file(name).async("string");
        const xml = new DOMParser().parseFromString(source, "application/xml");
        if (xml.getElementsByTagName("parsererror").length) throw new Error("Il modello Word contiene XML non valido: " + name);
        const part = { name, xml, paragraphs: [], dirty: false };
        part.paragraphs = descendants(xml, "p").map((paragraph) => paragraphModel(paragraph, part)).filter(Boolean);
        if (part.paragraphs.length) parts.push(part);
      }
      if (!parts.length) throw new Error("Nessun testo leggibile nel documento Word.");
      files.push({ ...item, parts });
    }
    return files;
  }

  function makeNode(doc, name) { return doc.createElementNS(WORD, "w:" + name); }

  function setText(model) {
    const paragraph = model.paragraph;
    const doc = paragraph.ownerDocument;
    const oldRun = children(paragraph, "r")[0];
    const oldProps = oldRun && children(oldRun, "rPr")[0];
    for (const node of Array.from(paragraph.childNodes)) {
      if (node.nodeType === 1 && node.namespaceURI === WORD && node.localName !== "pPr") paragraph.removeChild(node);
    }
    const run = makeNode(doc, "r");
    if (oldProps) run.appendChild(oldProps.cloneNode(true));
    const lines = model.text.replace(/\r\n?/g, "\n").split("\n");
    lines.forEach((line, lineIndex) => {
      if (lineIndex) run.appendChild(makeNode(doc, "br"));
      line.split("\t").forEach((piece, tabIndex) => {
        if (tabIndex) run.appendChild(makeNode(doc, "tab"));
        if (piece) {
          const text = makeNode(doc, "t");
          text.setAttributeNS(XML, "xml:space", "preserve");
          text.textContent = piece;
          run.appendChild(text);
        }
      });
    });
    paragraph.appendChild(run);
  }

  function setAlignment(model) {
    const paragraph = model.paragraph;
    const doc = paragraph.ownerDocument;
    let props = children(paragraph, "pPr")[0];
    if (!props) { props = makeNode(doc, "pPr"); paragraph.insertBefore(props, paragraph.firstChild); }
    let jc = children(props, "jc")[0];
    if (!jc) { jc = makeNode(doc, "jc"); props.appendChild(jc); }
    jc.setAttributeNS(WORD, "w:val", model.align);
  }

  function setBold(model) {
    const doc = model.paragraph.ownerDocument;
    for (const run of descendants(model.paragraph, "r")) {
      let props = children(run, "rPr")[0];
      if (!props) { props = makeNode(doc, "rPr"); run.insertBefore(props, run.firstChild); }
      children(props, "b").forEach((node) => props.removeChild(node));
      if (model.bold) props.appendChild(makeNode(doc, "b"));
    }
  }

  function applyModel(model) {
    if (!model.canEdit) return;
    const paragraph = model.paragraph;
    const parent = paragraph.parentNode;
    if (model.deleted) {
      const siblings = children(parent, "p");
      if (siblings.length > 1 || parent.localName !== "tc") parent.removeChild(paragraph);
      else { model.text = ""; setText(model); }
    } else {
      if (model.text !== model.originalText) setText(model);
      if (model.align !== model.originalAlign) setAlignment(model);
      if (model.bold !== model.originalBold) setBold(model);
    }
  }

  function warnings(files) {
    const problems = [];
    for (const file of files) for (const part of file.parts) for (const model of part.paragraphs) {
      if (model.deleted) continue;
      if (/\b(?:TESTO_ACCERTATO|MOTIVO_PLACEHOLDER|PROVVEDIMENTI_PLACEHOLDER|TESTO_GEN)\b|\{\{[^}]+\}\}/i.test(model.text) || /\bNON\s+NON\s+CONFORME\b/i.test(model.text)) {
        problems.push(file.filename + ": " + model.text.slice(0, 90));
      }
    }
    return problems;
  }

  function styleElement() {
    if (document.getElementById("admin3DocxReviewStyle")) return;
    const style = document.createElement("style");
    style.id = "admin3DocxReviewStyle";
    style.textContent = `
      .a3-review-overlay{position:fixed;inset:0;z-index:100000;background:rgba(5,10,20,.92);display:flex;align-items:center;justify-content:center;padding:12px;font-family:Arial,sans-serif;color:#e9eff8}
      .a3-review-dialog{width:min(960px,100%);height:min(94vh,100%);background:#141b28;border:1px solid #43536c;border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 70px #000a}
      .a3-review-head{padding:16px 18px;border-bottom:1px solid #344259}.a3-review-head h2{font-size:20px;margin:0 0 6px}.a3-review-head p{font-size:12px;color:#adc0d5;margin:0;line-height:1.45}
      .a3-review-tabs,.a3-review-tools,.a3-review-actions{display:flex;gap:7px;flex-wrap:wrap;align-items:center;padding:10px 16px;border-bottom:1px solid #344259}
      .a3-review-tools button,.a3-review-tabs button,.a3-review-actions button{font:inherit;font-size:12px;background:#26354a;color:#e9eff8;border:1px solid #526683;border-radius:8px;padding:8px 10px;cursor:pointer}
      .a3-review-tools button:disabled{opacity:.4;cursor:default}.a3-review-tabs button[aria-selected=true]{background:#2555aa;border-color:#7ea8ff}
      .a3-review-pages{overflow:auto;padding:18px;background:#253044;flex:1}.a3-review-paper{max-width:780px;margin:0 auto;background:white;color:#202020;min-height:60vh;padding:48px 55px;box-shadow:0 3px 20px #0004}
      .a3-review-part{font:700 11px Arial,sans-serif;color:#657286;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #d5dbe3;margin:16px 0 14px;padding-bottom:5px}
      .a3-review-row{padding:3px 6px;margin:3px -6px 12px;border:1px solid transparent;border-radius:4px}.a3-review-row.selected{border-color:#1769d2;background:#edf5ff}.a3-review-row.deleted{opacity:.55;text-decoration:line-through}
      .a3-review-row textarea{display:block;width:100%;min-height:35px;resize:vertical;border:0;outline:0;background:transparent;color:#202020;font:16px/1.45 Georgia,serif;overflow:hidden;padding:0}.a3-review-row.readonly{font:16px/1.45 Georgia,serif;color:#333}.a3-review-row small{display:block;color:#785d21;font:11px Arial,sans-serif;margin-top:3px}
      .a3-review-warnings{padding:9px 16px;color:#f6c977;font-size:12px;max-height:78px;overflow:auto}.a3-review-actions{border-top:1px solid #344259;border-bottom:0;justify-content:flex-end}.a3-review-actions .primary{background:#315dd3;border-color:#7299ff;font-weight:700}
      .a3-review-actions label{margin-right:auto;font-size:12px;color:#f6c977}.a3-review-actions input{vertical-align:middle}
      @media(max-width:650px){.a3-review-paper{padding:25px 18px}.a3-review-pages{padding:8px}.a3-review-tools button{padding:7px}}
    `;
    document.head.appendChild(style);
  }

  function button(text, action) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.addEventListener("click", action);
    return element;
  }

  async function download(files) {
    for (const file of files) {
      for (const part of file.parts) {
        if (!part.dirty) continue;
        part.paragraphs.forEach(applyModel);
        file.zip.file(part.name, new XMLSerializer().serializeToString(part.xml));
        part.dirty = false;
      }
      const blob = await file.zip.generateAsync({ type: "blob", mimeType: MIME });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      if (files.length > 1) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  async function open(items) {
    if (active) throw new Error("È già aperta una revisione Word.");
    active = true;
    let files;
    try { files = await inspect(items); } catch (error) { active = false; throw error; }
    styleElement();
    return new Promise((resolve) => {
      const overlay = document.createElement("div"); overlay.className = "a3-review-overlay";
      const dialog = document.createElement("section"); dialog.className = "a3-review-dialog"; dialog.setAttribute("role", "dialog"); dialog.setAttribute("aria-modal", "true"); dialog.setAttribute("aria-label", "Revisione del documento Word");
      const head = document.createElement("div"); head.className = "a3-review-head";
      const title = document.createElement("h2"); title.textContent = "Controlla e correggi il Word";
      const help = document.createElement("p"); help.textContent = "Modifica il testo, scegli un paragrafo per allinearlo o eliminarlo, poi scarica il Word corretto. Per cambiare dati, esito o protocollo torna alla maschera, così tutti i documenti restano coerenti. Questa è l’anteprima del contenuto: verifica anche l’impaginazione nel file Word prima dell’invio.";
      head.append(title, help);
      const tabs = document.createElement("div"); tabs.className = "a3-review-tabs";
      const tools = document.createElement("div"); tools.className = "a3-review-tools";
      const pages = document.createElement("div"); pages.className = "a3-review-pages";
      const warningsBox = document.createElement("div"); warningsBox.className = "a3-review-warnings";
      const actions = document.createElement("div"); actions.className = "a3-review-actions";
      const confirmLabel = document.createElement("label"); const confirmBox = document.createElement("input"); confirmBox.type = "checkbox"; confirmLabel.append(confirmBox, " Ho verificato gli avvisi"); confirmLabel.hidden = true;
      const cancel = button("Torna alla maschera", () => finish(false));
      const save = button("Scarica Word corretto", async () => {
        const issues = warnings(files);
        if (issues.length && !confirmBox.checked) { warningsBox.scrollIntoView({ block: "nearest" }); return; }
        save.disabled = true; cancel.disabled = true; save.textContent = "Preparazione Word…";
        try { await download(files); finish(true); }
        catch (error) { warningsBox.textContent = "Download non riuscito: " + error.message; save.disabled = false; cancel.disabled = false; save.textContent = "Riprova download"; }
      }); save.className = "primary";
      actions.append(confirmLabel, cancel, save);
      dialog.append(head, tabs, tools, pages, warningsBox, actions); overlay.appendChild(dialog); document.body.appendChild(overlay);
      let selected = null, fileIndex = 0, selectedRow = null;
      const toolButtons = [];
      function refreshTools() {
        for (const entry of toolButtons) entry.element.disabled = !selected || !selected.canEdit || (selected.deleted && entry.name !== "Ripristina");
      }
      function refreshWarnings() {
        const issues = warnings(files);
        warningsBox.textContent = issues.length ? "Controlla questi possibili errori: " + issues.join(" | ") : "Nessun segnaposto o esito duplicato rilevato.";
        confirmLabel.hidden = !issues.length;
        confirmBox.checked = false;
      }
      function currentItem() { return files[fileIndex]; }
      function renderTabs() {
        tabs.textContent = "";
        files.forEach((file, index) => {
          const tab = button(file.filename, () => { fileIndex = index; selected = null; renderTabs(); renderPage(); refreshTools(); });
          tab.setAttribute("aria-selected", String(index === fileIndex)); tabs.appendChild(tab);
        });
      }
      function renderPage() {
        pages.textContent = "";
        const paper = document.createElement("div"); paper.className = "a3-review-paper";
        for (const part of currentItem().parts) {
          const label = document.createElement("div"); label.className = "a3-review-part";
          label.textContent = part.name.includes("header") ? "Intestazione" : part.name.includes("footer") ? "Piè di pagina" : "Documento";
          paper.appendChild(label);
          for (const model of part.paragraphs) {
            const row = document.createElement("div"); row.className = "a3-review-row" + (model.deleted ? " deleted" : "") + (model.canEdit ? "" : " readonly") + (model === selected ? " selected" : "");
            row.dataset.selected = "false";
            const choose = () => { if (selectedRow) { selectedRow.classList.remove("selected"); selectedRow.dataset.selected = "false"; } selected = model; selectedRow = row; row.classList.add("selected"); row.dataset.selected = "true"; refreshTools(); };
            row.addEventListener("click", choose);
            if (model.canEdit) {
              const area = document.createElement("textarea"); area.value = model.text; area.setAttribute("aria-label", "Testo del paragrafo"); area.style.textAlign = model.align === "both" ? "justify" : model.align; area.style.fontWeight = model.bold ? "bold" : "normal"; area.disabled = model.deleted;
              area.addEventListener("focus", choose);
              area.addEventListener("input", () => { model.text = area.value; model.part.dirty = true; refreshWarnings(); area.style.height = "auto"; area.style.height = Math.max(35, area.scrollHeight) + "px"; });
              row.appendChild(area);
              requestAnimationFrame(() => { area.style.height = Math.max(35, area.scrollHeight) + "px"; });
            } else {
              const text = document.createElement("div"); text.textContent = model.text; row.appendChild(text);
              const note = document.createElement("small"); note.textContent = "Elemento del modello non modificabile qui: correggilo nel Word scaricato."; row.appendChild(note);
            }
            paper.appendChild(row);
          }
        }
        pages.appendChild(paper);
      }
      function addTool(name, action) { const element = button(name, () => { if (!selected || !selected.canEdit) return; action(selected); selected.part.dirty = true; renderPage(); refreshWarnings(); refreshTools(); }); toolButtons.push({ name, element }); tools.appendChild(element); }
      addTool("Giustifica", (model) => { model.align = "both"; });
      addTool("Allinea a sinistra", (model) => { model.align = "left"; });
      addTool("Centra", (model) => { model.align = "center"; });
      addTool("Grassetto", (model) => { model.bold = !model.bold; });
      addTool("Elimina paragrafo", (model) => { model.deleted = true; });
      addTool("Ripristina", (model) => { model.deleted = false; model.text = model.originalText; model.align = model.originalAlign; model.bold = model.originalBold; });
      function finish(result) { overlay.remove(); active = false; resolve(result); }
      renderTabs(); renderPage(); refreshWarnings(); refreshTools();
      save.focus();
    });
  }

  window.ADMIN3_DOCX_REVIEW = { open };
})();
