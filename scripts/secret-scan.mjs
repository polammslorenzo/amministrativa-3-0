import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const ignoredNames = new Set([".git", "node_modules", ".env.local", ".env", "_site"]);
const textExtensions = new Set([".html", ".js", ".mjs", ".ts", ".json", ".md", ".toml", ".yml", ".yaml", ".txt", ".sh", ""]);
const findings = [];
const openAiPrefix = "sk" + "-";
const projectPrefix = "sk" + "-proj-";

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name)) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name))) continue;
    const text = fs.readFileSync(fullPath, "utf8");
    if (text.includes(projectPrefix) || new RegExp(openAiPrefix.replace("-", "\\-") + "[A-Za-z0-9_-]{20,}").test(text)) {
      findings.push(path.relative(root, fullPath) + ": possibile chiave OpenAI");
    }
    if (/^\s*OPENAI_API_KEY\s*=\s*\S+/m.test(text) && entry.name !== ".env.example") {
      findings.push(path.relative(root, fullPath) + ": OPENAI_API_KEY valorizzata");
    }
  }
}

walk(root);
if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log("Controllo segreti superato: nessuna chiave rilevata nei file del progetto.");
