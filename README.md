<div align="center">

# 🌙 EtherSelf

**Selfbot français complet controllable via un panel de bot classique en Components V2**

![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-v18+-339933?style=flat-square&logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?style=flat-square&logo=discord&logoColor=white)
![selfbot](https://img.shields.io/badge/selfbot-discord.py--self-ED4245?style=flat-square)
![license](https://img.shields.io/badge/licence-PolyForm%20Noncommercial%201.0.0-yellow?style=flat-square)

</div>

---

> ### ⚠️ Avertissement légal
> L'utilisation d'un selfbot est une violation des [Conditions d'Utilisation de Discord](https://discord.com/terms). Ton compte peut être banni définitivement à tout moment sans préavis. Ce projet est fourni **à des fins éducatives uniquement**. Tu l'utilises à tes **propres risques**, sans aucune responsabilité de la part des contributeurs.

---

> ### 🤖 Vibecodé avec des modèles d'IA
> Ce projet a été **entièrement généré par une IA** (Claude Fable 5, Claude Sonnet 4.6 et 5, Claude Opus 4.8, Codex/GPT-5.4 et Codex/GPT-5.5). Si tu envisages de faire quelque chose de similaire, il est **fortement recommandé de l'implémenter toi-même** sans IA — tu comprendras réellement ce que tu fais tourner sur ton compte Discord, et tu sauras le déboguer quand ça casse. Et ça cassera.

---

> ### 🔀 Migration — le selfbot est passé à `discord.py-self`
> Le selfbot était historiquement écrit en `discord.js-selfbot-v13`, **non maintenu depuis octobre 2025**. Il a été **entièrement réécrit en Python avec [`discord.py-self`](https://github.com/dolfies/discord.py-self)** ([docs](https://discordpy-self.readthedocs.io/en/latest/)), qui est activement maintenu.
>
> - 🟢 Le **bot-controller est écrit en TypeScript** (discord.js v14), compilé en JavaScript avant exécution (`npm run build`).
> - 🟢 Les deux process communiquent toujours via le **même bridge HTTP local signé (HMAC-SHA256)** : le contrat réseau est identique au byte près, donc le controller n'a pas eu à changer.
> - 🔴 Les endpoints non officiels (quêtes, Discord Says, Spotify RPC) restent sensibles aux évolutions de Discord et peuvent casser sans préavis.

---

## 📖 Présentation

EtherSelf est un **monorepo** composé de deux packages qui fonctionnent ensemble :

| Package | Langage | Rôle |
|---|---|---|
| 🤖 **`EtherSelf-SB`** | 🐍 Python | Le selfbot (discord.py-self), expose un bridge HTTP local |
| 🎛️ **`EtherSelf-Bot`** | 🟦 TypeScript | Bot Discord classique (discord.js 14), interface via un panel Components V2 |

Le principe : le bot controller reçoit tes clics et envoie des commandes au selfbot via HTTP sur `localhost`. Ton compte utilisateur n'interagit jamais directement avec Discord depuis l'interface — c'est propre, cloisonné, et facile à déboguer.

**Comment un selfbot Python et un controller TypeScript cohabitent ?** Ce sont **deux process indépendants** qui ne partagent ni mémoire ni runtime : ils dialoguent uniquement par des requêtes HTTP sur `127.0.0.1`, signées avec un secret partagé (`BRIDGE_SECRET`, HMAC-SHA256). Le langage de chaque côté n'a donc aucune importance — Python parle à Node exactement comme Node parlait à Node. `pm2` supervise les deux (voir plus bas), chacun avec son propre interpréteur.

```
Toi  -->  /panel (bot classique)  -->  Bridge HTTP signé  -->  Selfbot  -->  Discord API
          [discord.js v14 / TS+Node]   [HMAC · localhost]      [discord.py-self / Python]
```

---

## ✨ Fonctionnalités

### 🛠️ Utilitaires

| Module | Description |
|---|---|
| 😴 **AFK** | Réponse automatique aux messages avec message personnalisé et mode spécial |
| 🔍 **Snipe / MessageLogger** | Log des messages supprimés et édités, recherche par salon / serveur / utilisateur |
| 📸 **Snapshots** | Export HTML complet d'un salon (messages, embeds, réactions, stickers, pièces jointes) |
| 🏷️ **Tags** | Messages prédéfinis envoyables via commande préfixe ou panel |
| 📌 **Bookmarks salons** | Salons favoris sauvegardés |
| 💬 **Bookmarks messages** | Messages importants sauvegardés avec notes |

### ⚙️ Automatisation

| Module | Description |
|---|---|
| 🔇 **Anti-Group DM** | Quitte automatiquement tout groupe DM entrant — option pour quitter tous les groupes existants |
| ⬆️ **Auto-Bump** | Envoi automatique de `/bump` Disboard toutes les 2h dans les salons que tu veux |
| 🏆 **Discord Quests** | Complétion automatique des quêtes Discord (vidéo, plateforme, activité…) |

### 🎨 Personnalisation

| Module | Description |
|---|---|
| 🎮 **Rich Presence** | Activités Discord personnalisées (playing, streaming, listening…) rotation + boutons cliquables |
| 🎵 **Spotify RPC** | Activité Spotify personnalisable (track, album, artistes, assets, timestamps, extras) |
| 💬 **Custom Status** | Rotation automatique de statuts personnalisés avec emojis |
| 🔊 **Salon vocal** | Rejoindre / quitter / changer de salon avec auto-rejoin au démarrage |

### 🗑️ Gestion

| Module | Description |
|---|---|
| 🗑️ **Purge** | Suppression de tes propres messages : salon, serveur, tous les DMs, tous les serveurs — annulation en temps réel |
| 🔁 **Clone de serveur** | Copie rôles, salons, emojis et paramètres d'un serveur vers un autre |
| 📊 **Infos système** | Ping WebSocket, uptime du processus, CPU / RAM / OS de l'hôte |

### ⌨️ Commandes préfixe

```
[préfixe]mock <texte>     →  tExTe En MoDe MoCk
[préfixe]spoiler <texte>  →  ||texte caché||
[préfixe]tag <nom>        →  envoie le contenu du tag correspondant
```

---

## 🚫 Ce qui n'existera jamais dans ce projet

**Le spam, le raid de serveurs, le mass-DM, le flood de salons et le harcèlement collectif n'auront pas leur place ici.**

Si tu cherches un outil pour nuire à d'autres utilisateurs de Discord — détruire des serveurs, spammer des membres ou autre chose dans ce goût-là — ferme ce README, **sors dehors, et touche de l'herbe**. 🌿

Ces fonctionnalités ne seront **jamais** ajoutées, quelle que soit la demande. Ce n'est pas une question de technique, c'est une question de ne pas être un boulet pour les autres.

---

## 📋 Prérequis

- **Python 3.11+** (pour le selfbot)
- **Node.js v18+** (pour le bot-controller)
- **Deux tokens Discord :**
  - 🔑 Un token de **compte utilisateur** (selfbot) pour `EtherSelf-SB`
  - 🤖 Un token de **bot classique** pour `EtherSelf-Bot`
- Le bot doit pouvoir t'envoyer des DMs **ET** être dans un serveur commun avec toi

---

## 🚀 Installation

### 1️⃣ Cloner le repo

```bash
git clone https://github.com/veryuhq/etherself.git
cd etherself
npm install          # dépendances du bot-controller (Node/TypeScript)
npm run setup:selfbot # crée packages/sb-uhq/.venv et installe discord.py-self
```

> `setup:selfbot` fait l'équivalent de :
> ```bash
> cd packages/sb-uhq && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
> ```
> ⚠️ `discord.py-self` s'importe sous le nom `discord` : ne l'installe **pas** dans le même environnement que le `discord.py` officiel. Le virtualenv dédié règle ce problème.

### 2️⃣ Configurer le selfbot

```bash
cp packages/sb-uhq/.env.example packages/sb-uhq/.env
```

```env
# 🔑 Token de ton compte Discord (selfbot)
TOKEN=ton_token_utilisateur

# 🔒 Secret partagé avec le bot-controller (génère une chaîne aléatoire longue, 32+ octets)
BRIDGE_SECRET=une_chaine_aleatoire_longue_et_secrete

# 🌐 Port du serveur bridge (défaut : 3000)
BRIDGE_PORT=3000

# 🌐 URL du serveur logs/progress/file du controller (défaut : http://127.0.0.1:3001)
BRIDGE_CONTROLLER_URL=http://127.0.0.1:3001

# 👤 Ton ID Discord — requis uniquement pour l'action token.set
OWNER_ID=ton_id_discord
```

### 3️⃣ Configurer le bot controller

```bash
cp packages/bot-controller/.env.example packages/bot-controller/.env
```

```env
# 🤖 Token de ton bot Discord classique
BOT_TOKEN=ton_token_de_bot

# 🆔 Client ID du bot (pour enregistrer les slash commands)
CLIENT_ID=id_de_ton_bot

# 👤 Ton ID Discord (seul toi pourras utiliser le panel)
OWNER_ID=ton_id_discord

# 🔒 Même secret que dans sb-uhq
BRIDGE_SECRET=une_chaine_aleatoire_longue_et_secrete

# 🌐 URL et ports du bridge
BRIDGE_URL=http://127.0.0.1:3000
LOG_PORT=3001
BRIDGE_CONTROLLER_URL=http://127.0.0.1:3001
```

### 4️⃣ Déployer la commande `/panel`

```bash
npm run deploy
```

### 5️⃣ Lancer les deux packages

**En développement** (deux terminaux séparés) :

```bash
# Terminal 1 — selfbot (Python)
npm run start:selfbot          # ou : cd packages/sb-uhq && .venv/bin/python main.py

# Terminal 2 — bot controller (TypeScript, compilé automatiquement avant lancement)
npm run start:controller
```

**En production** avec PM2 — un seul fichier `ecosystem.config.js` gère les deux process (Python + Node). Compile d'abord le controller (PM2 lance le JavaScript émis dans `dist/`) :

```bash
npm run build:controller
pm2 start ecosystem.config.js
pm2 save && pm2 startup
```

PM2 lance chaque app avec son propre interpréteur (`interpreter: "./.venv/bin/python"` pour le selfbot, `node` pour le controller). Tu peux aussi les démarrer à la main :

```bash
pm2 start packages/sb-uhq/main.py                --name EtherSelf-SB --interpreter ./packages/sb-uhq/.venv/bin/python
pm2 start packages/bot-controller/dist/index.js  --name EtherSelf-Bot
```

---

## 🎛️ Utilisation

Une fois les deux processus en ligne, tape **`/panel`** dans n'importe quel salon où ton bot a accès (ou en DM avec lui).

Le panel s'ouvre en éphémère — visible uniquement par toi. La navigation se fait entièrement via le menu déroulant et les boutons, aucune commande texte supplémentaire n'est requise.

Au démarrage, le bot controller t'envoie automatiquement un DM confirmant que tout est en ligne, avec le ping WebSocket et l'uptime du selfbot.

---

## 🔒 Sécurité

> **🚨 Ne partage jamais ton token utilisateur.** Ne le commit jamais. `.env` est dans le `.gitignore` — vérifie avant chaque `git push`.

- **`BRIDGE_SECRET`** — protège la communication entre les deux packages. Utilise un gestionnaire de mots de passe pour générer une chaîne aléatoire solide (32+ caractères).
- **`OWNER_ID`** — seul cet ID Discord peut interagir avec le panel. Toute autre tentative est rejetée silencieusement.
- Le bridge HTTP n'écoute que sur `127.0.0.1` (localhost) — il n'est pas exposé sur le réseau.

---

## 📝 Notes diverses

- 🗃️ **Cache Discord** — certaines fonctionnalités (quitter tous les groupes, purge DMs) effectuent un `fetch()` au préalable pour peupler le cache, mais la couverture dépend de l'état de l'API au moment de l'appel.
- 🏆 **Quests** — les endpoints utilisés sont non officiels et peuvent changer sans préavis à chaque mise à jour de Discord.
- ⏱️ **Purge** — la suppression de messages est intentionnellement ralentie (100ms entre chaque message) pour limiter le risque de rate-limit ou de flag de compte.
- 🐍 **discord.py-self** — le selfbot dépend de `discord.py-self`. Certaines fonctionnalités pointues (Spotify RPC riche, quêtes) dépendent du support de la lib et de l'API Discord ; valide-les sur ton compte avant de compter dessus.

---

## 📄 Licence

**[PolyForm Noncommercial License 1.0.0](./LICENSE)** — usage privé, modification et distribution autorisés **à des fins non commerciales uniquement** (interdiction de se faire de l'argent avec). Fourni **sans aucune garantie ni responsabilité**. Et dans tous les cas : assume les conséquences vis-à-vis de Discord toi-même.