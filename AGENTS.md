# AGENTS.md — EtherSelf

Guide pour les agents IA (Claude Code, Copilot, Codex…) travaillant sur ce repo.
EtherSelf est un monorepo : un selfbot Discord en Python piloté par un bot Discord
classique en Node, les deux communiquant par un bridge HTTP local signé.

## Stack technique

- **`packages/sb-uhq`** — le selfbot : Python 3.11+, [`discord.py-self`](https://discordpy-self.readthedocs.io/en/latest/) épinglé à 2.1.0, aiohttp, python-dotenv, psutil. Virtualenv dédié dans `packages/sb-uhq/.venv`.
- **`packages/bot-controller`** — le bot panel : TypeScript 7 (strict, compilateur natif) sur Node.js 18+, discord.js v14 (**Components V2**), dotenv, `fetch` natif de Node. Compilé avec `tsc` vers `dist/` (gitignoré).
- **Bridge** : HTTP sur `127.0.0.1`, signé HMAC-SHA256 (`BRIDGE_SECRET`). Controller → selfbot sur `BRIDGE_PORT` (3000), selfbot → controller (logs/progress/fichiers) sur `LOG_PORT` (3001).
- **Prod** : pm2 via `ecosystem.config.js` (reste en JS : pm2 charge sa config lui-même, sans support TypeScript).
- ⚠️ `discord.py-self` s'importe sous le nom `discord` : ne jamais installer le `discord.py` officiel dans le même environnement.

## Commandes

```bash
npm install               # dépendances du bot-controller
npm run setup:selfbot     # crée packages/sb-uhq/.venv + pip install
npm run build:controller  # compile le bot panel (tsc → dist/)
npm run start:selfbot     # lance le selfbot (Python)
npm run start:controller  # compile puis lance le bot panel (Node)
npm run deploy            # enregistre les slash commands (/panel, /purgelogs)
npm run clean:data        # supprime packages/sb-uhq/data/ (état runtime)
npm run check:env         # valide la cohérence des .env des deux packages
npm run lines:count       # compte les lignes de code des deux packages
```

Node exécute les scripts utilitaires de `scripts/` en TypeScript via le type
stripping (Node 22.18+ requis pour les lancer) : pas de build, pas de dépendance,
`node scripts/<nom>.ts`. Syntaxe effaçable uniquement (`erasableSyntaxOnly`) ;
typecheck avec `npm run typecheck:scripts`.

Vérifications rapides (pas de suite de tests ni de linter configurés) :

```bash
npm --workspace=packages/bot-controller run typecheck         # tsc --noEmit, tout le package
npm run typecheck:scripts                                     # tsc --noEmit sur scripts/
packages/sb-uhq/.venv/bin/python -m py_compile packages/sb-uhq/app/commands/fun/mock.py
packages/sb-uhq/.venv/bin/python -c "import app"              # depuis packages/sb-uhq/, vérifie tous les imports
```

Le test qui compte est manuel : lancer les deux process et cliquer dans `/panel`.
Un agent n'en a pas les moyens la plupart du temps (il faut deux tokens Discord) :
signale-le dans ta réponse au lieu de prétendre avoir testé.

## Structure du projet

```
packages/sb-uhq/                  # SELFBOT (Python)
├── main.py                       # point d'entrée + TOUT le câblage : dict PREFIX_COMMANDS,
│                                 # hooks on_ready des modules, handlers d'événements Discord
└── app/
    ├── bridge/                   # server.py (reçoit les actions), auth.py (HMAC),
    │                             # controller_client.py (appels sortants vers le controller)
    ├── router/action_router.py   # dict ACTIONS : "module.action" → commands/<cat>/<module>.execute()
    ├── commands/<catégorie>/     # un module par fonctionnalité : execute(client, payload) [+ callback() si commande préfixe]
    └── func/                     # helpers partagés (data_path, fetch de salons, headers Discord, logbus…)

packages/bot-controller/          # BOT PANEL (TypeScript, compilé vers dist/)
├── tsconfig.json                 # strict, module nodenext (émis en CommonJS), src/ → dist/
└── src/
    ├── index.ts                  # point d'entrée + serveur HTTP des callbacks du selfbot
    ├── deploy.ts                 # enregistrement des slash commands
    ├── commands/                 # panel.ts (/panel), purgelogs.ts (/purgelogs)
    ├── panels/<module>.ts        # build(data) → UI Components V2 d'un panel
    ├── interactions/             # buttons.ts / selects.ts / modals.ts : customId → sendAction() → re-render du panel
    │                             # + fetch-and-build.ts (état selfbot → panel : dicts FETCHERS et BUILDERS)
    │                             # + common.ts (NAV_MAP de navigation, makeJobId(), recherches du panel Rôles)
    │                             # + modal-options.ts (options des RadioGroup/CheckboxGroup, `value` alignées sur le bridge)
    ├── bridge/                   # client.ts (sendAction), auth.ts (HMAC)
    ├── store/                    # jobs.ts (jobs purge/clone/snapshot), clone-config.ts, roles-config.ts
    └── utils/components.ts       # helpers Components V2 typés (container, btn, actionRow, replyV2…)

packages/sb-uhq/data/             # état runtime JSON — gitignoré, ne jamais committer
```

### Ajouter une fonctionnalité (workflow type)

Une fonctionnalité traverse presque toujours les deux packages, dans cet ordre :

1. **Python** : créer `app/commands/<catégorie>/<module>.py` avec `async def execute(client, payload)` qui retourne un dict (et `async def callback(client, message, args)` si commande préfixe).
2. **Python** : enregistrer les actions dans `ACTIONS` de `app/router/action_router.py` (clé `"module.action"`).
3. **Python** : câbler le module dans `main.py` si besoin — rien n'y est automatique, chaque point d'entrée hors bridge s'y déclare à la main :
   - commande préfixe → import + entrée dans le dict `PREFIX_COMMANDS` (sans ça le `callback()` ne sera jamais appelé) ;
   - travail au démarrage → `def on_ready(client)` dans le module, appelé depuis le `on_ready` de `main.py` (modèles : `rpc`, `quests`, `snapshot`) ;
   - réaction à un événement Discord → handler exporté par le module, appelé depuis un `@client.event` de `main.py` (modèles : `msglog`, `antigroup`, `afk`).
4. **Node** : créer `src/panels/<module>.ts` avec `build(data)` en s'inspirant d'un panel existant (`afk.ts` est un bon modèle).
5. **Node** : brancher les `customId` (`module:action`) dans `src/interactions/buttons.ts` / `selects.ts` / `modals.ts`.
6. **Node** : rendre le panel atteignable — il faut les **trois** tables, sinon le bouton ne mène nulle part :
   - `NAV_MAP` dans `interactions/common.ts` : `"panel:<module>"` → clé de panel ;
   - `FETCHERS` **et** `BUILDERS` dans `interactions/fetch-and-build.ts` : clé de panel → appel(s) `sendAction()` puis `build(data)` ;
   - entrée dans le menu de `panels/home.ts`.

### Bridge sortant (selfbot → controller) et jobs longs

Le bridge a **deux sens**, tous deux signés avec le même HMAC. Le sens retour part de
`app/bridge/controller_client.py` vers le serveur HTTP de `src/index.ts` (port `LOG_PORT`,
rate-limité à 100 requêtes/minute par IP et par route) :

| Endpoint | Helper Python | Côté controller |
|---|---|---|
| `POST /log` | `post_log(text)` | logs relayés en MP au propriétaire (texte expurgé puis tronqué à 3500 car.) |
| `POST /progress` | `post_progress(job_id, data)` | re-render du panel purge via `purgePanel.buildProgress()` |
| `POST /clone-progress` | `post_clone_progress(job_id, data)` | re-render du panel backups (en cours / résultat) |
| `POST /snapshot-result` | `post_snapshot_result(job_id, result)` | affiche le résultat du snapshot |
| `POST /file` | `post_file(filename, filepath, meta, channel_id)` | envoie le fichier en pièce jointe |

**Toute action longue passe par un `jobId`** — c'est le seul moyen de rendre la main à
Discord sans laisser le panel figé :

1. Côté Node, l'interaction génère l'identifiant avec `makeJobId()` (`interactions/common.ts`),
   l'enregistre (`registerProgressJob` / `registerCloneJob` / `registerSnapshotJob` de
   `store/jobs.ts`) et le passe dans le payload de `sendAction()`.
2. Côté Python, le module reçoit `jobId` dans son payload et pousse l'avancement avec le
   helper correspondant (modèle : `purge.py` et son `_notify()`).
3. Le controller retrouve l'interaction d'origine dans `store/jobs.ts` et édite le panel en
   place. Les mises à jour sont **throttlées** (2 s pour `/progress`, 1,5 s pour
   `/clone-progress`) ; `done: true` force le dernier rendu et nettoie le job.

Un job annulable garde aussi son état côté Python (`register_job` / `is_cancelled` /
`clean_job` dans `purge.py`) et une action `*.cancel` dans `ACTIONS`.

### État runtime : conventions `data/`

Tout passe par `app/func/data_path.py`, jamais par des chemins relatifs (le working
directory change sous pm2) :

- `data_path("config", "afk.json")` → chemin absolu ; l'arborescence est `data/config/`
  (état des fonctionnalités), `data/logs/` (historiques), `data/msg_log_data/` (messages
  snipés), `data/snapshots/` (exports HTML).
- `read_json(path, default)` / `write_json(path, data)` — `write_json` crée les dossiers
  parents et pose `0600` : `data/` contient des données privées (messages supprimés,
  liste d'amis, tokens de session). Ne pas contourner ce mode.
- **`safe_id_segment(value, "label")` est obligatoire** dès qu'un ID venu du payload
  devient un segment de chemin : sans lui un `../..` sort de `data/` (`pathlib` repart de
  zéro sur un segment absolu et conserve les `..`). Utiliser `is_snowflake()` pour un
  simple test booléen. Modèles : `snipe.py`, `msglog.py`.
- Côté controller, `POST /file` confine sa lecture au `data/` du selfbot
  (`assertInSbData`) : ne pas élargir ce périmètre.

## Référence discord.js — Display Components (Components V2) & Modals

Condensé des guides officiels discord.js (« Display Components » et « Modals »).
Dans ce repo on ne passe **pas** par les builders (`ContainerBuilder`, `ModalBuilder`…) :
les panels construisent le JSON brut via les helpers typés de `utils/components.ts`. Cette
section sert à connaître les règles, les limites et les types numériques sous-jacents.

### Display Components (messages du panel)

Activés par le flag `IsComponentsV2` (`1 << 15`) — déjà géré par `ephemeralV2()` / `replyV2()`.

Caveats à respecter :
- Avec ce flag, **interdiction** d'envoyer `content`, `poll`, `embeds` ou `stickers`.
- On ne peut pas revenir en arrière (opt-out) en éditant un message déjà en Components V2.
- **40 composants max** par message (les composants imbriqués comptent), **4000 caractères max** cumulés sur tous les Text Display.
- Un composant doit référencer chaque fichier attaché (`attachment://nom.ext` dans Thumbnail, Media Gallery ou File).
- Les mentions dans un Text Display déclenchent une vraie notification ; contrôler avec `allowedMentions`.

Types de composants (numéro = champ `type` du JSON, helper local s'il existe) :

| Composant | type | Helper | Notes |
|---|---|---|---|
| ActionRow | 1 | `actionRow()` | conteneur de boutons/selects |
| Button | 2 | `btn()` | |
| StringSelect | 3 | `selectMenu()`, ou via `modal()` (champ `options`) | dans un message : enveloppé dans un ActionRow ; dans un modal : enveloppé dans un Label, options figées à l'ouverture |
| TextInput | 4 | via `modal()` | modals uniquement ; style 1 = Short, 2 = Paragraph |
| Text Display | 10 | `textDisplay()` | markdown, remplace `content` |
| Section | 9 | — | 1–3 Text Display + 1 accessoire (bouton **ou** thumbnail) ; sans accessoire, utiliser Text Display |
| Thumbnail | 11 | — | uniquement en accessoire de Section ; alt text + spoiler possibles |
| Media Gallery | 12 | — | grille de 1 à 10 médias, alt text/spoiler par item |
| File | 13 | — | affiche un fichier attaché ; pas d'alt text, spoiler possible |
| Separator | 14 | `separator()` | `spacing` 1 (small) / 2 (large), `divider` bool ; invisible seul |
| Container | 17 | `container()` | boîte arrondie + `accent_color` optionnel, enfants : Text Display / ActionRow / Section / Separator / Media Gallery / File ; spoiler = floute tout |
| Label | 18 | via `modal()` | modals uniquement, enveloppe un composant interactif |
| FileUpload | 19 | via `modal()` | modals uniquement |
| RadioGroup | 21 | via `modal()` | modals uniquement ; choix unique, 2–10 options |
| CheckboxGroup | 22 | via `modal()` | modals uniquement ; cases à cocher, 2–10 options, `min_values`/`max_values` |
| Checkbox | 23 | via `modal()` | modals uniquement ; oui/non, `default` = cochée par défaut |

Le champ `id` (entier 32 bits) est distinct de `custom_id` : il identifie un composant
dans le message (utile pour retrouver/remplacer un composant). Discord l'auto-remplit
à partir de 1 si absent ; `0` = vide.

### Modals

- Un modal = `custom_id` (≤ 100 caractères) + `title` + **max 5 composants top-level**, chacun étant un **Label (18)** ou un **Text Display (10)**.
- Un Label a un `label` (≤ 45 car.), une `description` optionnelle (≤ 100 car.) et **un** composant enfant : TextInput (4), select menu (3, 5–8), FileUpload (19), RadioGroup (21), CheckboxGroup (22) ou Checkbox (23).
- TextInput : `style` 1 (Short) / 2 (Paragraph), `min_length`/`max_length`, `value` (préremplissage), `required` (défaut `true`).
- Select menu en modal : propriété `required` en plus (défaut `true`).
- FileUpload : `min_values` (0–10) / `max_values` (≤ 10), `required` ; impossible de valider taille/extension côté Discord, le fichier se télécharge depuis le CDN (ne jamais exécuter ce qu'un utilisateur upload).
- **`showModal()` doit être la toute première réponse à l'interaction** — un modal ne se défère pas.
- Soumission : `interaction.isModalSubmit()`, puis `interaction.fields.getTextInputValue(id)`, `.getStringSelectValues(id)`, `.getUploadedFiles(id)`, `.getRadioGroup(id)`, `.getCheckboxGroup(id)`, `.getCheckbox(id)`. Champ texte vide → `""`, select sans sélection → `[]`.
- Un `ModalSubmitInteraction` répond comme une commande (`reply`, `deferReply`, `editReply`, `followUp`…) ; si le modal venait d'un bouton/select, `update()` / `deferUpdate()` permettent de modifier le message d'origine (pattern utilisé par les re-renders de panels).

Le helper `modal()` local applique déjà la règle : chaque champ (texte, `file: true`,
`options` = StringSelect, `radio` = RadioGroup, `checkboxes` = CheckboxGroup,
`checkbox: true` = Checkbox) est enveloppé dans un Label (18), le format standard
des modals.

## Style de code

- **Tout en français** : commentaires, docstrings, messages du panel, erreurs, README.
- Suivre les modèles existants : `commands/fun/mock.py` (module selfbot), `panels/afk.ts` (panel), `action_router.py` (enregistrement d'actions).
- Python : modules avec `from __future__ import annotations`, imports relatifs (`...func.discord_util`), erreurs métier via `raise ValueError("message en français")`.
- TypeScript : mode `strict`, syntaxe ESM (`import`/`export`) compilée en CommonJS par `tsc`, interfaces de données optionnelles par panel, UI construite avec les seuls helpers de `utils/components.ts` (jamais d'embeds classiques, Components V2 seulement). Les réponses du bridge restent en `any` côté `data` : le côté Python définit leur forme.
- Les réponses du bridge gardent des clés camelCase identiques des deux côtés.

## Git

- **Conventional Commits obligatoires** ([spécification 1.0.0](https://www.conventionalcommits.org/fr/v1.0.0/)) : chaque commit suit le format `type(scope): description`, et rien d'autre ne passe.
  - Types autorisés : `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `style`, `test`, `build`, `ci`, `revert`.
  - Mets un `scope` dès que tu peux (module ou package concerné : `afk`, `snipe`, `bridge`, `controller`…) ; la description est en français, à l'impératif ou au présent, sans majuscule initiale ni point final.
  - Breaking change : suffixe `!` après le type/scope (ex. `refactor(bridge)!: …`) et/ou footer `BREAKING CHANGE:` expliquant la rupture.
  - Ex. `feat(afk): réponse automatique personnalisable en mode AFK`, `fix(purge): respecter le délai anti rate-limit…`.
- Diffs petits et ciblés ; mettre à jour le README quand une fonctionnalité visible change.
- **Versionnage CalVer `AAAA.M.N`** (ex. `2026.8.1`), dupliqué dans `package.json` racine **et**
  `packages/bot-controller/package.json` : les deux se bumpent ensemble, dans un commit
  `chore(release): …` séparé du travail qu'il publie.
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
- Casser le contrat du bridge (noms d'actions, clés de payload, formes de réponse) d'un seul côté : toute modification doit être synchronisée entre `action_router.py` et les `interactions/` du controller. Le sens retour compte aussi — endpoints de callback et clés de leurs payloads, `controller_client.py` ↔ `index.ts`.
- Exposer le bridge ailleurs que sur `127.0.0.1`, ou affaiblir la signature HMAC.
- Supprimer les délais anti rate-limit existants (ex. 100 ms entre suppressions dans purge).

### ⚠️ Demander d'abord
- Ajouter une dépendance (`requirements.txt` ou `package.json`).
- Modifier `ecosystem.config.js`, les scripts npm racine, ou la structure des fichiers `data/` (migration d'état utilisateur).
- Toucher aux endpoints Discord non officiels (quêtes, Spotify RPC) — fragiles, ils cassent sans préavis.

### ✅ Toujours faire
- Vérifier les fichiers modifiés (`npm --workspace=packages/bot-controller run typecheck`, `py_compile`) avant de committer.
- Préserver la parité bridge : chaque action côté panel doit exister dans `ACTIONS` côté Python.
- Valider avec `safe_id_segment()` tout ID venu d'un payload qui devient un segment de chemin sous `data/`.
- Répercuter toute modification de ce guide dans **`CLAUDE.md` et `AGENTS.md`** : les deux fichiers sont identiques au byte, et maintenus à la main.
- Rester dans l'esprit du projet : outil personnel, un seul utilisateur (`OWNER_ID`), ralenti à dessein pour protéger le compte.
