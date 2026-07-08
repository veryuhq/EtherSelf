"use strict";

const fs   = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const TARGETS = [
  path.join(ROOT, "packages", "sb-uhq",         "app"),
  path.join(ROOT, "packages", "sb-uhq",         "main.py"),
  path.join(ROOT, "packages", "bot-controller", "src"),
  path.join(ROOT, "packages", "bot-controller", "index.js"),
];

const EXTENSIONS = new Set([".js", ".py"]);

function walkDir(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`  ⚠️  Impossible de lire : ${dir} — ${err.message}`);
    return files;
  }
  for (const entry of entries) {
    if (["node_modules", ".venv", "__pycache__"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, files);
    } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

function collectFiles(targets) {
  const files = [];
  for (const target of targets) {
    if (!fs.existsSync(target)) {
      console.warn(`  ⚠️  Cible introuvable : ${path.relative(ROOT, target)}`);
      continue;
    }
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      walkDir(target, files);
    } else if (stat.isFile() && EXTENSIONS.has(path.extname(target))) {
      files.push(target);
    }
  }
  return files;
}

function countLines(filepath) {
  try {
    return fs.readFileSync(filepath, "utf-8").split("\n").length;
  } catch {
    return 0;
  }
}

function relPath(filepath) {
  return path.relative(ROOT, filepath);
}

console.log(`\n📂  Racine détectée : ${ROOT}`);
console.log("🔍  Analyse en cours…\n");

const files = collectFiles(TARGETS);

if (!files.length) {
  console.error("❌  Aucun fichier .js trouvé. Vérifie les chemins ci-dessus.");
  process.exit(1);
}

const results = files
  .map(f => ({ file: relPath(f), lines: countLines(f) }))
  .sort((a, b) => b.lines - a.lines);

const totalLines = results.reduce((sum, r) => sum + r.lines, 0);
const totalFiles = results.length;

const COL_FILE  = 60;
const COL_LINES =  6;
const hr        = "─".repeat(COL_FILE + COL_LINES + 5);

console.log("📊  Comptage des lignes de code — EtherSelf\n");
console.log(hr);
console.log(`${"Fichier".padEnd(COL_FILE)}  ${"Lignes".padStart(COL_LINES)}`);
console.log(hr);

for (const { file, lines } of results) {
  const truncated = file.length > COL_FILE
    ? "…" + file.slice(-(COL_FILE - 1))
    : file;
  console.log(`${truncated.padEnd(COL_FILE)}  ${String(lines).padStart(COL_LINES)}`);
}

console.log(hr);
console.log(`${"TOTAL".padEnd(COL_FILE)}  ${String(totalLines).padStart(COL_LINES)}`);
console.log(hr);
console.log(`\n✅  ${totalFiles} fichier(s) — ${totalLines} lignes au total.\n`);