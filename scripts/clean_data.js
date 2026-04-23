"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "packages", "sb-uhq", "data");

console.log(`\n🧹 Nettoyage du dossier data`);
console.log(`📂 Cible : ${DATA_DIR}`);

if (!fs.existsSync(DATA_DIR)) {
  console.log("ℹ️  Le dossier data n'existe pas, rien à supprimer.\n");
  process.exit(0);
}

fs.rmSync(DATA_DIR, { recursive: true, force: true });

console.log("✅ Dossier data supprimé entièrement.\n");
