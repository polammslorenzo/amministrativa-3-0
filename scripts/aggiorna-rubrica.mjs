// Rigenera assets/rubrica-dati.js a partire dal file "Rubrica_Egrammata.html".
// Uso:  node scripts/aggiorna-rubrica.mjs /percorso/Rubrica_Egrammata.html
//
// Dal file HTML viene letto soltanto l'elenco delle strutture, come dato: nessuna
// parte del suo codice viene eseguita ne copiata nel progetto. Ogni voce e
// ricostruita campo per campo, e una voce malformata ferma tutto.
import fs from "node:fs";
import path from "node:path";

const sorgente = process.argv[2];
if (!sorgente) {
  console.error("Indicare il file: node scripts/aggiorna-rubrica.mjs /percorso/Rubrica_Egrammata.html");
  process.exit(1);
}
const html = fs.readFileSync(sorgente, "utf8");
const blocco = /const D=(\[[\s\S]*?\]);\s*\n/.exec(html);
if (!blocco) {
  console.error("Elenco delle strutture non trovato: il file non sembra una Rubrica Egrammata.");
  process.exit(1);
}
const grezze = JSON.parse(blocco[1]);
const estratto = (/estratto del (\d{4}-\d{2}-\d{2})/.exec(html) || [])[1] || "";

const testo = (v) => typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f<>]/.test(v);
const voci = grezze.map((g, i) => {
  const dove = `voce ${i + 1} (${JSON.stringify(g).slice(0, 80)})`;
  if (!["A", "S", "U"].includes(g.t)) throw new Error(`tipo non valido: ${dove}`);
  if (!testo(g.n)) throw new Error(`nome non valido: ${dove}`);
  if (!Array.isArray(g.c) || g.c.length !== 5 || !g.c.every((x) => Number.isInteger(x) && x >= 0 && x < 1000)) {
    throw new Error(`indirizzo di protocollo non valido: ${dove}`);
  }
  if (!Array.isArray(g.p) || g.p.length > 4 || !g.p.every(testo)) throw new Error(`gerarchia non valida: ${dove}`);
  const sigla = typeof g.o === "string" && /^[A-Z0-9]{0,12}$/.test(g.o) ? g.o : "";
  return { t: g.t, n: g.n, c: g.c.join("."), o: sigla, p: g.p, x: g.x === true };
});
const codici = new Set(voci.map((v) => v.c));
if (codici.size !== voci.length) throw new Error("ci sono indirizzi di protocollo duplicati");
if (voci.length < 50) throw new Error(`solo ${voci.length} voci: il file sembra incompleto`);

const uscita = path.resolve(import.meta.dirname, "..", "assets", "rubrica-dati.js");
fs.writeFileSync(
  uscita,
  "// File generato da scripts/aggiorna-rubrica.mjs: non modificare a mano.\n" +
    "window.ADMIN3_RUBRICA = " +
    JSON.stringify({ estratto, voci }) +
    ";\n",
);
console.log(`Rubrica aggiornata: ${voci.length} strutture, estratto del ${estratto || "data non indicata"}.`);
