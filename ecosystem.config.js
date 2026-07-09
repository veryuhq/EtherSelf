// ─────────────────────────────────────────────────────────────────────────────
//  PM2 — lance ensemble le selfbot Python et le bot-controller Node.
//
//  pm2 gère indifféremment des process Python et Node : c'est le champ
//  `interpreter` qui change. Les deux restent deux process séparés qui
//  communiquent uniquement via le bridge HTTP local (ports BRIDGE_PORT / LOG_PORT).
//
//  Démarrage :   pm2 start ecosystem.config.js
//                pm2 save && pm2 startup
//
//  ⚠️ Crée d'abord le virtualenv du selfbot :
//       npm run setup:selfbot
//     (équivaut à : cd packages/sb-uhq && python3 -m venv .venv
//                   && .venv/bin/pip install -r requirements.txt)
//
//  Les chemins sont résolus en absolu via __dirname (dossier de ce fichier),
//  car pm2 résout `interpreter` par rapport au dossier de LANCEMENT de pm2,
//  pas par rapport au `cwd` de l'app. On évite ainsi l'erreur
//  "Interpreter ./.venv/bin/python is NOT AVAILABLE in PATH".
// ─────────────────────────────────────────────────────────────────────────────

const path = require("path");

const SB_DIR = path.join(__dirname, "packages", "sb-uhq");
const BOT_DIR = path.join(__dirname, "packages", "bot-controller");
const VENV_PYTHON = path.join(SB_DIR, ".venv", "bin", "python");

module.exports = {
  apps: [
    {
      name: "EtherSelf-SB",
      cwd: SB_DIR,
      script: "main.py",
      // Python du virtualenv du package, en chemin absolu (voir note ci-dessus).
      interpreter: VENV_PYTHON,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "EtherSelf-Bot",
      cwd: BOT_DIR,
      script: "index.js",
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
