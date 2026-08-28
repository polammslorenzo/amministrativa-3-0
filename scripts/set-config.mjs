import fs from "node:fs";
import path from "node:path";

const projectRef = process.argv[2] || "";
if (!/^[a-z0-9]{20}$/.test(projectRef)) {
  console.error("Project ref Supabase non valido.");
  process.exit(1);
}

const root = path.resolve(import.meta.dirname, "..");
const configPath = path.join(root, "config.js");
const contents = fs.readFileSync(configPath, "utf8");
const endpoint = `https://${projectRef}.supabase.co/functions/v1/agent`;
const updated = contents.replace(/AI_AGENT_URL:\s*"[^"]*"/, `AI_AGENT_URL: "${endpoint}"`);
if (updated === contents) {
  console.error("AI_AGENT_URL non trovato in config.js.");
  process.exit(1);
}
fs.writeFileSync(configPath, updated);
console.log(`config.js aggiornato: ${endpoint}`);
