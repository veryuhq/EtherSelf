# polypm

Un gestionnaire de processus dans l'esprit de **pm2**, mais qui ne s'arrête pas à
JavaScript : **JS, TypeScript, Python et Rust** sont des citoyens de première classe.
Zéro dépendance, un seul daemon, la même ergonomie que pm2.

```bash
ppm start api.ts          # TypeScript
ppm start worker.py       # Python
ppm start ./engine        # projet Cargo : compilé, puis binaire supervisé
ppm start server.js -i 4  # JavaScript en cluster sur 4 cœurs
ppm list
```

```
┌─────┬──────────────┬─────────┬─────────┬───────┬────────┬─────┬────────┬──────┬────────┐
│  id │ nom          │ runtime │ mode    │   pid │ statut │ rst │ uptime │  cpu │    mem │
├─────┼──────────────┼─────────┼─────────┼───────┼────────┼─────┼────────┼──────┼────────┤
│ 0.0 │ api-js       │ node    │ cluster │ 11808 │ online │   0 │    12m │ 0.4% │ 48.2mb │
│ 0.1 │ api-js       │ node    │ cluster │ 11809 │ online │   0 │    12m │ 0.3% │ 47.9mb │
│   1 │ ticker-ts    │ ts      │ fork    │ 11820 │ online │   0 │    12m │ 0.1% │ 41.0mb │
│   2 │ worker-py    │ python  │ fork    │ 11831 │ online │   0 │    12m │ 0.0% │  8.6mb │
│   3 │ heartbeat-rs │ rust    │ fork    │ 11845 │ online │   0 │    12m │ 0.0% │  2.1mb │
└─────┴──────────────┴─────────┴─────────┴───────┴────────┴─────┴────────┴──────┴────────┘
```

## Installation

Node.js 18+ suffit pour faire tourner polypm (les runtimes des applications
supervisées, eux, doivent être installés séparément).

```bash
cd polypm
npm link          # met `ppm` dans le PATH
# ou, sans installer :
node bin/ppm.js list
```

## Les quatre runtimes

Le runtime est déduit du chemin passé à `ppm start`. `--runtime` ou `--interpreter`
permettent de forcer la main.

| Cible | Runtime | Comment c'est lancé |
|---|---|---|
| `.js` `.mjs` `.cjs` | `node` | l'exécutable Node courant, `cluster` disponible |
| `.ts` `.mts` `.cts` `.tsx` | `typescript` | `tsx` → `node --experimental-strip-types` → `ts-node` → `bun`/`deno` |
| `.py` | `python` | venv local (`.venv`, `venv`, `env`, `$VIRTUAL_ENV`) sinon `python3`, toujours en `-u` |
| `.rs` | `rust` | `rustc` vers le cache de build, puis le binaire produit |
| dossier ou fichier `Cargo.toml` | `rust` | `cargo build`, puis le binaire produit est supervisé **directement** |
| `.sh` `.bash` `.zsh` | `shell` | `bash` |
| tout le reste | `binary` | exécuté tel quel |

### TypeScript

L'ordre de préférence est volontaire : `tsx`, s'il est installé dans le projet,
comprend la syntaxe **non effaçable** (enums, decorators, namespaces, propriétés
de constructeur) que le mode natif de Node refuse. Sans `tsx`, Node ≥ 22.6 fait
le strip de types tout seul, sans rien installer.

```bash
ppm start src/api.ts                       # détection automatique
ppm start src/api.ts --interpreter bun     # ou impose ton loader
```

Le mode cluster fonctionne en TypeScript quand le loader retenu est Node lui-même.

### Python

```bash
ppm start worker.py --env QUEUE=emails --max-memory-restart 300M
ppm start "uvicorn" --python-module --interpreter .venv/bin/python -- --port 8000
```

Le venv du projet est détecté automatiquement, et `PYTHONUNBUFFERED=1` est posé :
sans ça les logs n'apparaîtraient qu'à la mort du process.

### Rust

```bash
ppm start ./engine                 # dossier avec Cargo.toml → profil debug
ppm start ./engine --release       # profil release
ppm start ./engine --bin migrate   # crate à plusieurs binaires
ppm start script.rs                # fichier isolé, compilé par rustc
```

polypm compile **avant** de lancer, puis supervise le binaire produit — pas `cargo run`.
Le pid affiché est donc celui de ton programme, les signaux lui arrivent directement,
et la mémoire mesurée est la sienne. Chaque `restart` recompile : c'est le mode de
travail naturel avec `--watch`.

Un échec de compilation laisse l'application en `errored`, avec la sortie de `cargo`
dans les logs — polypm ne lance jamais un binaire périmé.

## Commandes

| Commande | Effet |
|---|---|
| `ppm start <script\|dossier\|ecosystem\|app>` | démarre (ou redémarre une app connue) |
| `ppm list` · `ls` · `status` | tableau des applications |
| `ppm describe <app>` | détail : commande réelle, logs, instances |
| `ppm stop\|restart\|reload <app>` | cycle de vie (`reload` = sans coupure en cluster) |
| `ppm delete <app>` | arrête et oublie |
| `ppm scale <app> <n>` | change le nombre d'instances à chaud |
| `ppm logs [app] [-l 50]` | affiche puis suit les logs (`--nostream` pour ne pas suivre) |
| `ppm monit` | tableau rafraîchi toutes les 2 s |
| `ppm flush [app]` | vide les fichiers de logs |
| `ppm signal <SIG> [app]` | envoie un signal |
| `ppm save` / `ppm resurrect` | sauvegarde / restaure la liste des applications |
| `ppm startup` | imprime une unité systemd prête à installer |
| `ppm init` | génère un `ecosystem.config.js` d'exemple |
| `ppm ping` / `ppm kill` | état / arrêt du daemon |
| `ppm runtimes` | runtimes supportés |

Une **cible** est un nom, un id, un namespace, un motif (`api-*`) ou `all`.

### Options de `start`

```
-n, --name <nom>              nom de l'application
-i, --instances <n|max>       nombre d'instances (`max` = nombre de cœurs)
    --cluster | --fork        force le mode d'exécution
-w, --watch [chemin]          redémarre quand les fichiers changent
    --ignore-watch <motif>    exclusions supplémentaires (répétable)
    --interpreter <bin>       impose l'interpréteur
    --interpreter-args <a>    arguments de l'interpréteur
    --runtime <nom>           impose le runtime
    --env KEY=VAL             variable d'environnement (répétable)
    --env-file <.env>         charge un fichier d'environnement
    --cwd <dossier>           répertoire de travail
    --max-memory-restart <n>  redémarre au-delà du seuil (ex. 300M)
    --max-restarts <n>        relances instables tolérées (défaut 16)
    --restart-delay <ms>      délai fixe avant relance
    --exp-backoff-restart-delay <ms>  délai exponentiel avant relance
    --min-uptime <ms>         seuil au-delà duquel un démarrage est « stable »
    --no-autorestart          ne pas relancer à la sortie
    --time                    horodate chaque ligne de log
    --release --bin --features        options Rust
    --python-module           le script est un module (`-m paquet`)
    --out <f> --error <f>     fichiers de logs personnalisés
```

Tout ce qui suit `--` est passé à l'application :

```bash
ppm start worker.py --name mailer -- --queue emails --concurrency 4
```

## Fichier ecosystem

Même principe que pm2, et les mêmes noms de clés (`exec_mode`, `max_memory_restart`,
`ignore_watch`…). Un seul fichier peut mélanger les quatre langages :

```js
// ecosystem.config.js
module.exports = {
  apps: [
    { name: 'api-js',       script: './server.js', instances: 2, exec_mode: 'cluster', env: { PORT: '3010' } },
    { name: 'ticker-ts',    script: './ticker.ts', watch: ['./src'] },
    { name: 'worker-py',    script: './worker.py', env: { QUEUE: 'emails' }, max_memory_restart: '200M' },
    { name: 'heartbeat-rs', script: './rust-app',  release: true },
  ],
};
```

```bash
ppm start ecosystem.config.js   # ou simplement `ppm start` dans le dossier
```

Les formats acceptés sont `.js`, `.cjs`, `.mjs` et `.json`, et les chemins relatifs
sont résolus depuis le fichier de configuration.

Le dossier [`examples/`](examples/) contient cet ecosystem en état de marche,
avec une application par langage.

## Comportement de supervision

- **Relance automatique** : un process qui meurt est relancé. Un démarrage qui ne
  tient pas `min_uptime` (1 s par défaut) est compté comme *instable* ; après
  `max_restarts` instabilités consécutives, l'application passe en `errored` et
  polypm cesse d'insister. `--exp-backoff-restart-delay` espace les tentatives.
- **Arrêt propre** : `stop_signal` (défaut `SIGINT`), puis `SIGKILL` après
  `kill_timeout` (3 s). En mode fork, les process sont lancés dans leur propre
  groupe : les enfants qu'ils ont eux-mêmes créés sont tués avec eux.
- **Mémoire et CPU** : échantillonnés toutes les 2 s (`/proc` sous Linux, `ps` ailleurs).
  `max_memory_restart` redémarre l'instance qui dépasse le seuil.
- **Watch** : redémarrage 400 ms après la dernière modification. `node_modules`,
  `.git`, `target`, `__pycache__`, `.venv`, `dist` sont ignorés d'office.
- **Cluster** : réservé aux applications Node/TS exécutables directement par Node.
  Les workers partagent le port via le module `cluster`. Demander `exec_mode: 'cluster'`
  pour du Python ou du Rust n'échoue pas : polypm retombe sur plusieurs process
  indépendants (`fork`) et l'indique dans `describe`.

## Fichiers et daemon

Tout vit dans `$POLYPM_HOME` (défaut `~/.polypm`) :

```
~/.polypm/
├── daemon.sock     socket de contrôle (0600, 127.0.0.1 uniquement)
├── daemon.log      journal du daemon lui-même
├── dump.json       état sauvegardé par `ppm save` (0600)
├── logs/           <app>-out.log et <app>-err.log
└── build/          binaires compilés depuis un .rs isolé
```

Le daemon démarre tout seul à la première commande qui en a besoin. Le CLI lui parle
en JSON par le socket ; il refuse de démarrer si un autre daemon écoute déjà, et ne
supprime que le socket qu'il a lui-même créé.

Pour survivre à un redémarrage de la machine :

```bash
ppm save
ppm startup | sudo tee /etc/systemd/system/polypm.service
sudo systemctl daemon-reload && sudo systemctl enable --now polypm
```

## Différences avec pm2

Ce qui est là : détection multi-langages, mode cluster, watch, relance avec backoff,
`max_memory_restart`, scale à chaud, logs et `monit`, `save`/`resurrect`, fichiers
ecosystem, unité systemd.

Ce qui n'est pas là : pm2 Plus / Keymetrics, le déploiement SSH (`pm2 deploy`),
`pm2-runtime`, la rotation de logs (à confier à `logrotate`), les `cron_restart`,
le module system, l'API programmatique publique.

## Développement

```bash
node test/run.js          # 32 tests bout-en-bout, vrais process dans les 4 langages
node test/run.js --keep   # garde le POLYPM_HOME temporaire pour inspection
```

La suite démarre un vrai daemon dans un `POLYPM_HOME` jetable et supervise de vraies
applications : elle vérifie les quatre runtimes, la relance après crash, le plafond
`max_restarts`, le partage de port en cluster, le scale, le watch, `save`/`resurrect`
et le CLI. Le test Rust est ignoré si `rustc` est absent.

Structure du code :

```
bin/ppm.js        point d'entrée du CLI
src/cli.js        analyse des arguments, commandes, affichage
src/client.js     client IPC (démarre le daemon à la demande)
src/daemon.js     serveur IPC, un process pour tout superviser
src/manager.js    liste des applications, monitoring, save/resurrect
src/app.js        une application : instances, logs, relances, watch
src/runtimes.js   détection des langages et compilation (cargo/rustc)
src/metrics.js    CPU / mémoire
src/config.js     lecture des fichiers ecosystem
src/tail.js       lecture et suivi des logs
src/format.js     tableaux et couleurs
```

## Licence

MIT.
