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
//       cd packages/sb-uhq
//       python3 -m venv .venv
//       .venv/bin/pip install -r requirements.txt
//     puis pointe `interpreter` vers .venv/bin/python (voir ci-dessous).
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  apps: [
    {
      name: "EtherSelf-SB",
      cwd: "./packages/sb-uhq",
      script: "main.py",
      // Utilise le python du virtualenv du package (recommandé) :
      interpreter: "./.venv/bin/python",
      // Sans venv, remplace la ligne ci-dessus par : interpreter: "python3",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
    {
      name: "EtherSelf-Bot",
      cwd: "./packages/bot-controller",
      script: "index.js",
      interpreter: "node",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
    },
  ],
};
