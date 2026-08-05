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
> Un selfbot viole les [CGU de Discord](https://discord.com/terms) : ton compte peut être banni sans préavis. Projet **éducatif**, utilisé à tes **propres risques**, sans responsabilité des contributeurs.

---

> ### 🤖 Vibecodé avec des modèles d'IA
> **Tout le code** vient de modèles d'IA (Claude Fable 5, Sonnet 4.6 et 5, Opus 4.8, Codex/GPT-5.4 et 5.5). Pour un projet similaire, **écris-le toi-même** : tu sauras ce qui tourne sur ton compte et comment le déboguer.

---

## 📖 Présentation

EtherSelf est un **monorepo** composé de deux packages qui fonctionnent ensemble :

| Package | Langage | Rôle |
|---|---|---|
| 🤖 **`EtherSelf-SB`** | 🐍 Python | Le selfbot ([discord.py-self](https://discordpy-self.readthedocs.io/en/latest/)), expose un bridge HTTP local |
| 🎛️ **`EtherSelf-Bot`** | 🟦 TypeScript | Bot Discord classique (discord.js 14), interface via un panel Components V2 |

Le principe : le bot controller reçoit tes clics et envoie des commandes au selfbot via HTTP sur `localhost`. Les deux sont des **process indépendants**, sans mémoire ni runtime partagés — ils ne dialoguent que par des requêtes signées (`BRIDGE_SECRET`, HMAC-SHA256) sur `127.0.0.1`. Le langage de chaque côté n'a donc aucune importance, et `pm2` supervise les deux avec leur propre interpréteur (voir plus bas).

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
| 🎭 **Rôles** | Les rôles d'un membre et les membres d'un rôle, à partir des IDs — scan complet optionnel |

### ⚙️ Automatisation

| Module | Description |
|---|---|
| 🔇 **Anti-Group DM** | Quitte tout groupe DM entrant dès sa création — option pour quitter tous les groupes existants |
| 🏆 **Discord Quests** | Complétion automatique des quêtes Discord (vidéo, plateforme, activité…) |

### 🎨 Personnalisation

| Module | Description |
|---|---|
| 🎮 **Rich Presence** | Activités Discord personnalisées (playing, streaming, listening…) rotation + boutons cliquables |
| 🎵 **Spotify RPC** | Activité Spotify personnalisable (track, album, titre et artistes en texte libre, assets, timestamps, extras) |
| 💬 **Custom Status** | Rotation automatique de statuts personnalisés avec emojis |

### 🗑️ Gestion

| Module | Description |
|---|---|
| 🗑️ **Purge** | Suppression de tes propres messages — un salon, un serveur, tous les DMs (conversations fermées comprises) ou tout, avec exclusions et annulation en temps réel |
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

Ces fonctionnalités n'arriveront **jamais** ici, quelle que soit la demande. Si tu cherches un outil pour nuire à d'autres utilisateurs, ferme ce README et **va toucher de l'herbe**. 🌿

---

## 📋 Prérequis

- **Python 3.11+** (pour le selfbot)
- **Node.js v18+** (pour le bot-controller ; **v22.18+** pour lancer les scripts utilitaires de `scripts/`, exécutés en TypeScript natif)
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

# 👤 Ton ID Discord — obligatoire, et identique à celui du bot-controller.
# C'est le second facteur de l'action token.set : sans lui, le selfbot refuse
# toute modification du token.
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

# Terminal 2 — bot controller (TypeScript, compilation incluse avant le lancement)
npm run start:controller
```

**En production** avec PM2, un seul fichier `ecosystem.config.js` gère les deux process (Python + Node). Compile d'abord le controller (PM2 lance le JavaScript émis dans `dist/`) :

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

Le panel s'ouvre en éphémère : toi seul le vois. Tu navigues avec le menu déroulant et les boutons, sans taper la moindre commande.

Au démarrage, le bot controller t'envoie un DM confirmant que tout est en ligne, avec le ping WebSocket et l'uptime du selfbot.

---

## 🔒 Sécurité

> **🚨 Ne partage jamais ton token utilisateur.** Ne le commit jamais. `.env` est dans le `.gitignore` ; vérifie quand même avant chaque `git push`.

- **`BRIDGE_SECRET`** — protège la communication entre les deux packages. Utilise un gestionnaire de mots de passe pour générer une chaîne aléatoire solide (32+ caractères).
- **`OWNER_ID`** — seul cet ID Discord peut interagir avec le panel. Le controller ignore toute autre tentative, sans répondre.
- Le bridge HTTP n'écoute que sur `127.0.0.1` (localhost) et reste hors de portée du réseau.

---

## 📝 Notes diverses

- 🗃️ **Cache Discord** — certaines fonctionnalités (quitter tous les groupes, purge DMs) peuplent le cache par un `fetch()` préalable, dont la couverture dépend de l'API au moment de l'appel.
- 💬 **Purge des DMs & conversations fermées** — un DM fermé reste intact côté serveur mais n'apparaît dans aucune liste de l'API. La purge le retrouve via la recherche globale (`/users/@me/messages/search`) et le lit sans le rouvrir ; les DMs de tes relations et affinités sont rouverts le temps du vidage, puis refermés. Angle mort : l'index de recherche de Discord est incomplet et sa pagination bornée, donc une vieille conversation fermée avec un inconnu peut échapper au balayage — rouvre-la à la main avant la purge.
- 🏆 **Quests** — endpoints non officiels, susceptibles de casser à chaque mise à jour de Discord. `/quests/@me` ne liste que les quêtes déjà rattachées au compte : le panel en réclame donc lui-même la distribution avant de lister, comme le client officiel. Une quête inéligible est comptée à part (`🚫`) plutôt que passée sous silence.
- ⏱️ **Purge** — 100 ms entre deux suppressions, pour limiter le risque de rate-limit ou de flag de compte.
- 🎭 **Rôles** — Discord ne renvoie que les 100 premiers membres d'un rôle ; au-delà, le panel propose un **scan complet** par lots espacés d'une seconde (max 20 000 membres et 4 min, résultat gardé 10 min). Le compte exact dépend de tes permissions.
- 🐍 **discord.py-self** — les fonctionnalités pointues (Spotify RPC riche, quêtes) dépendent du support de la lib ; valide-les sur ton compte avant de compter dessus.

---

## 📄 Licence

**[PolyForm Noncommercial License 1.0.0](./LICENSE)** — usage, modification et distribution **à des fins non commerciales** uniquement. Aucune garantie, aucune responsabilité des contributeurs : les conséquences vis-à-vis de Discord sont pour toi.