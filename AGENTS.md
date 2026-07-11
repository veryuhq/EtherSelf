# AGENTS.md — EtherSelf

Guide pour les agents IA (Claude Code, Copilot, Codex…) travaillant sur ce repo.
EtherSelf est un monorepo : un selfbot Discord en Python piloté par un bot Discord
classique en Node, les deux communiquant par un bridge HTTP local signé.

## Stack technique

- **`packages/sb-uhq`** — le selfbot : Python 3.11+, [`discord.py-self`](https://discordpy-self.readthedocs.io/en/latest/) ≥ 2.1 (extra `[voice]`), aiohttp, python-dotenv, psutil. Virtualenv dédié dans `packages/sb-uhq/.venv`.
- **`packages/bot-controller`** — le bot panel : Node.js 18+, discord.js v14 (**Components V2**), node-fetch, dotenv.
- **Bridge** : HTTP sur `127.0.0.1`, signé HMAC-SHA256 (`BRIDGE_SECRET`). Controller → selfbot sur `BRIDGE_PORT` (3000), selfbot → controller (logs/progress/fichiers) sur `LOG_PORT` (3001).
- **Prod** : pm2 via `ecosystem.config.js`. Vocal : nécessite `ffmpeg` sur l'hôte.
- ⚠️ `discord.py-self` s'importe sous le nom `discord` — ne jamais installer le `discord.py` officiel dans le même environnement.

## Commandes

```bash
npm install               # dépendances du bot-controller
npm run setup:selfbot     # crée packages/sb-uhq/.venv + pip install
npm run start:selfbot     # lance le selfbot (Python)
npm run start:controller  # lance le bot panel (Node)
npm run deploy            # enregistre la slash command /panel
npm run clean:data        # supprime packages/sb-uhq/data/ (état runtime)
```

Vérifications rapides (pas de suite de tests ni de linter configurés) :

```bash
node --check packages/bot-controller/src/panels/afk.js        # syntaxe JS, fichier par fichier
packages/sb-uhq/.venv/bin/python -m py_compile packages/sb-uhq/app/commands/fun/mock.py
packages/sb-uhq/.venv/bin/python -c "import app"              # depuis packages/sb-uhq/, vérifie tous les imports
```

Le vrai test est manuel : lancer les deux process et cliquer dans `/panel`.
Un agent ne peut généralement pas le faire (il faut deux tokens Discord) —
signale-le dans ta réponse au lieu de prétendre avoir testé.

## Structure du projet

```
packages/sb-uhq/                  # SELFBOT (Python)
├── main.py                       # point d'entrée, client discord.py-self
└── app/
    ├── bridge/                   # server.py (reçoit les actions), auth.py (HMAC), controller_client.py
    ├── router/action_router.py   # dict ACTIONS : "module.action" → commands/<cat>/<module>.execute()
    ├── commands/<catégorie>/     # un module par fonctionnalité : execute(client, payload) [+ callback() si commande préfixe]
    └── func/                     # helpers partagés (fetch de salons, headers Discord, logbus…)

packages/bot-controller/          # BOT PANEL (Node)
├── index.js                      # point d'entrée + serveur logs/progress
└── src/
    ├── panels/<module>.js        # build(data) → UI Components V2 d'un panel
    ├── interactions/             # buttons.js / selects.js / modals.js : customId → sendAction() → re-render du panel
    ├── bridge/                   # client.js (sendAction), auth.js (HMAC)
    └── utils/components.js       # helpers Components V2 (container, btn, actionRow, replyV2…)

packages/sb-uhq/data/             # état runtime JSON — gitignoré, ne jamais committer
```

### Ajouter une fonctionnalité (workflow type)

Une fonctionnalité traverse presque toujours les deux packages, dans cet ordre :

1. **Python** : créer `app/commands/<catégorie>/<module>.py` avec `async def execute(client, payload)` qui retourne un dict (et `async def callback(client, message, args)` si commande préfixe).
2. **Python** : enregistrer les actions dans `ACTIONS` de `app/router/action_router.py` (clé `"module.action"`).
3. **Node** : créer `src/panels/<module>.js` avec `build(data)` en s'inspirant d'un panel existant (`afk.js` est un bon modèle).
4. **Node** : brancher les `customId` (`module:action`) dans `src/interactions/buttons.js` / `selects.js` / `modals.js`, ajouter l'entrée au menu de `panels/home.js` si besoin.

## Style de code

- **Tout en français** : commentaires, docstrings, messages du panel, erreurs, README.
- Suivre les modèles existants : `commands/fun/mock.py` (module selfbot), `panels/afk.js` (panel), `action_router.py` (enregistrement d'actions).
- Python : modules avec `from __future__ import annotations`, imports relatifs (`...func.discord_util`), erreurs métier via `raise ValueError("message en français")`.
- JS : `"use strict";` en tête de fichier, CommonJS (`require`/`module.exports`), UI construite exclusivement avec les helpers de `utils/components.js` (jamais d'embeds classiques — Components V2 uniquement).
- Les réponses du bridge gardent des clés camelCase identiques des deux côtés.

## Git

- Commits en français, format `type(scope): description` — ex. `feat(vocal): lecture d'un fichier audio dans le salon vocal`, `fix(vocal): ne plus se rendre sourd…`.
- Diffs petits et ciblés ; mettre à jour le README quand une fonctionnalité visible change.
- **Historique linéaire** : pas de commits de merge (`Merge branch …`). Intégrer une branche avec un rebase puis un merge fast-forward, jamais un merge non-ff. Configurer le dépôt en conséquence :
  ```sh
  git config merge.ff only     # refuse de créer un commit de merge
  git config pull.rebase true  # rebase au lieu de merger au pull
  ```
  Pour fusionner une branche de feature dans `main` : `git checkout main && git rebase <branche>` (ou `git merge --ff-only <branche>` après avoir rebasé la branche sur `main`).

## Limites et interdits

### 🚫 Ne jamais faire
- Ajouter du spam, raid, mass-DM, flood ou toute fonctionnalité de nuisance — refus ferme, voir la section « Ce qui n'existera jamais » du README.
- Committer `.env`, un token Discord, `BRIDGE_SECRET`, ou le contenu de `data/`.
- Casser le contrat du bridge (noms d'actions, clés de payload, formes de réponse) d'un seul côté : toute modification doit être synchronisée entre `action_router.py` et les `interactions/` du controller.
- Exposer le bridge ailleurs que sur `127.0.0.1`, ou affaiblir la signature HMAC.
- Supprimer les délais anti rate-limit existants (ex. 100 ms entre suppressions dans purge).

### ⚠️ Demander d'abord
- Ajouter une dépendance (`requirements.txt` ou `package.json`).
- Modifier `ecosystem.config.js`, les scripts npm racine, ou la structure des fichiers `data/` (migration d'état utilisateur).
- Toucher aux endpoints Discord non officiels (quêtes, Spotify RPC) — fragiles, ils cassent sans préavis.

### ✅ Toujours faire
- Vérifier la syntaxe des fichiers modifiés (`node --check`, `py_compile`) avant de committer.
- Préserver la parité bridge : chaque action côté panel doit exister dans `ACTIONS` côté Python.
- Rester dans l'esprit du projet : outil personnel, un seul utilisateur (`OWNER_ID`), ralenti volontairement pour protéger le compte.
