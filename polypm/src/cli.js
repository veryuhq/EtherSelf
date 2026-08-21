'use strict';
/**
 * Le CLI `ppm` : analyse les arguments, parle au daemon, affiche les résultats.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client, withClient } = require('./client');
const paths = require('./paths');
const { loadConfig, findConfig, looksLikeConfig } = require('./config');
const { detectRuntime } = require('./runtimes');
const { follow } = require('./tail');
const fmt = require('./format');

const VERSION = require('../package.json').version;

/* -------------------------------------------------------- arguments */

/**
 * Analyse minimaliste : --clé valeur, --clé=valeur, --drapeau, -n valeur.
 * Tout ce qui suit « -- » est passé tel quel à l'application lancée.
 */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const passthrough = [];
  let afterSeparator = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (afterSeparator) {
      passthrough.push(token);
      continue;
    }
    if (token === '--') {
      afterSeparator = true;
      continue;
    }
    if (token.startsWith('--')) {
      const [rawKey, inlineValue] = splitOnce(token.slice(2), '=');
      const key = camel(rawKey);
      if (inlineValue !== undefined) {
        pushFlag(flags, key, inlineValue);
      } else if (rawKey.startsWith('no-')) {
        flags[camel(rawKey.slice(3))] = false;
      } else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        pushFlag(flags, key, argv[i + 1]);
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
      const key = SHORT[token.slice(1)] || camel(token.slice(1));
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        pushFlag(flags, key, argv[i + 1]);
        i += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(token);
  }
  return { positional, flags, passthrough };
}

const SHORT = { n: 'name', i: 'instances', l: 'lines', f: 'follow', v: 'version', h: 'help', w: 'watch' };

function splitOnce(text, separator) {
  const index = text.indexOf(separator);
  return index === -1 ? [text, undefined] : [text.slice(0, index), text.slice(index + 1)];
}

function camel(text) {
  return text.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

/** Une option répétée (--env A=1 --env B=2) devient un tableau. */
function pushFlag(flags, key, value) {
  if (key in flags) {
    flags[key] = [].concat(flags[key], value);
  } else {
    flags[key] = value;
  }
}

/* ------------------------------------------------------------ rendu */

function printList(apps, { compact = false } = {}) {
  if (!apps.length) {
    console.log(fmt.color.gray('aucune application supervisée — `ppm start <script>` pour commencer'));
    return;
  }
  const rows = [];
  for (const app of apps) {
    const multi = app.instances.length > 1;
    if (!multi || compact) {
      rows.push([
        String(app.id),
        app.name,
        fmt.colorRuntime(app.runtime, app.runtimeLabel || app.runtime),
        app.execMode,
        multi ? `${app.instances.length}` : String(app.instances[0]?.pid ?? '-'),
        fmt.colorStatus(app.status),
        String(app.totalRestarts),
        fmt.duration(app.uptime),
        `${app.cpu.toFixed(1)}%`,
        fmt.bytes(app.memory),
      ]);
    } else {
      for (const instance of app.instances) {
        rows.push([
          `${app.id}.${instance.index}`,
          app.name,
          fmt.colorRuntime(app.runtime, app.runtimeLabel || app.runtime),
          app.execMode,
          String(instance.pid ?? '-'),
          fmt.colorStatus(instance.status),
          String(instance.restarts),
          fmt.duration(instance.uptime),
          `${instance.cpu.toFixed(1)}%`,
          fmt.bytes(instance.memory),
        ]);
      }
    }
  }
  console.log(
    fmt.table(
      ['id', 'nom', 'runtime', 'mode', 'pid', 'statut', 'rst', 'uptime', 'cpu', 'mem'],
      rows,
      ['right', 'left', 'left', 'left', 'right', 'left', 'right', 'right', 'right', 'right']
    )
  );
}

function printDescribe(app) {
  const rows = [
    ['id', String(app.id)],
    ['nom', app.name],
    ['namespace', app.namespace],
    ['runtime', `${app.runtime}${app.runtimeNote ? ` (${app.runtimeNote})` : ''}`],
    ['script', app.script],
    ['commande', app.command || '-'],
    ['arguments', app.args.join(' ') || '-'],
    ['cwd', app.cwd],
    ['mode', app.execMode],
    ['instances', String(app.instances.length)],
    ['statut', fmt.colorStatus(app.status)],
    ['autorestart', app.autorestart ? 'oui' : 'non'],
    ['watch', app.watch.length ? app.watch.join(', ') : 'non'],
    ['max mémoire', app.maxMemoryRestart ? fmt.bytes(app.maxMemoryRestart) : '-'],
    ['logs out', app.outFile],
    ['logs err', app.errorFile],
    ['créée le', new Date(app.createdAt).toLocaleString()],
  ];
  if (app.buildError) rows.push(['erreur build', fmt.color.red(app.buildError)]);
  console.log(fmt.table(['champ', 'valeur'], rows));

  const instanceRows = app.instances.map((instance) => [
    String(instance.index),
    String(instance.pid ?? '-'),
    fmt.colorStatus(instance.status),
    String(instance.restarts),
    fmt.duration(instance.uptime),
    `${instance.cpu.toFixed(1)}%`,
    fmt.bytes(instance.memory),
    instance.exitCode == null ? '-' : String(instance.exitCode),
  ]);
  console.log(
    fmt.table(
      ['#', 'pid', 'statut', 'rst', 'uptime', 'cpu', 'mem', 'exit'],
      instanceRows,
      ['right', 'right', 'left', 'right', 'right', 'right', 'right', 'right']
    )
  );
}

/* ------------------------------------------------- construction d'app */

/** Traduit les options du CLI en configuration d'application. */
function configFromFlags(script, flags, passthrough) {
  const cwd = flags.cwd ? path.resolve(String(flags.cwd)) : process.cwd();
  const instances = flags.instances === 'max' || flags.instances === true
    ? os.cpus().length
    : flags.instances != null ? Number(flags.instances) : 1;

  const env = {};
  for (const pair of [].concat(flags.env || [])) {
    if (typeof pair !== 'string') continue;
    const [key, value] = splitOnce(pair, '=');
    env[key] = value ?? '';
  }
  if (flags.envFile) Object.assign(env, readEnvFile(path.resolve(cwd, String(flags.envFile))));

  const config = {
    name: flags.name ? String(flags.name) : undefined,
    namespace: flags.namespace ? String(flags.namespace) : undefined,
    script,
    cwd,
    args: passthrough.length ? passthrough : flags.args ? String(flags.args).split(/\s+/) : [],
    interpreter: flags.interpreter ? String(flags.interpreter) : undefined,
    interpreter_args: flags.interpreterArgs ? String(flags.interpreterArgs).split(/\s+/) : undefined,
    runtime: flags.runtime ? String(flags.runtime) : undefined,
    instances,
    exec_mode: flags.cluster ? 'cluster' : flags.fork ? 'fork' : undefined,
    env,
    watch: flags.watch === true ? true : flags.watch ? [].concat(flags.watch) : undefined,
    ignore_watch: flags.ignoreWatch ? [].concat(flags.ignoreWatch) : undefined,
    autorestart: flags.autorestart === false ? false : undefined,
    max_restarts: flags.maxRestarts != null ? Number(flags.maxRestarts) : undefined,
    restart_delay: flags.restartDelay != null ? Number(flags.restartDelay) : undefined,
    exp_backoff_restart_delay: flags.expBackoffRestartDelay != null ? Number(flags.expBackoffRestartDelay) : undefined,
    min_uptime: flags.minUptime != null ? Number(flags.minUptime) : undefined,
    max_memory_restart: flags.maxMemoryRestart,
    kill_timeout: flags.killTimeout != null ? Number(flags.killTimeout) : undefined,
    stop_signal: flags.stopSignal ? String(flags.stopSignal) : undefined,
    time: flags.time === true ? true : undefined,
    merge_logs: flags.mergeLogs === false ? false : undefined,
    out_file: flags.out ? String(flags.out) : undefined,
    error_file: flags.error ? String(flags.error) : undefined,
    release: flags.release === true ? true : undefined,
    bin: flags.bin ? String(flags.bin) : undefined,
    features: flags.features ? String(flags.features) : undefined,
    python_module: flags.pythonModule === true ? true : undefined,
  };

  for (const key of Object.keys(config)) {
    if (config[key] === undefined) delete config[key];
  }
  return config;
}

function readEnvFile(file) {
  const env = {};
  if (!fs.existsSync(file)) throw new Error(`fichier d'environnement introuvable : ${file}`);
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, value] = splitOnce(trimmed, '=');
    env[key.trim()] = (value ?? '').trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

/* --------------------------------------------------------- commandes */

const commands = {};

commands.start = async (positional, flags, passthrough) => {
  let target = positional[0];

  if (!target) {
    const found = findConfig(process.cwd());
    if (!found) throw new Error('précise un script, un fichier ecosystem ou un nom d\'application');
    target = found;
  }

  // `--python-module` désigne un module importable (`-m paquet`), pas un fichier.
  const isModule = flags.pythonModule === true || target.startsWith('-m ');
  if (isModule) {
    return withClient(async (client) => {
      const config = configFromFlags(target, flags, passthrough);
      config.python_module = true;
      config.runtime = config.runtime || 'python';
      reportStart(await client.request('start', { config }));
      printList(await client.request('list'));
    });
  }

  const resolved = path.resolve(target);
  const isDir = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  const configFile = looksLikeConfig(target) && fs.existsSync(resolved)
    ? resolved
    : isDir && !fs.existsSync(path.join(resolved, 'Cargo.toml'))
      ? findConfig(resolved)
      : null;

  await withClient(async (client) => {
    if (configFile) {
      const apps = await loadConfig(configFile);
      console.log(fmt.color.gray(`chargement de ${configFile} (${apps.length} application${apps.length > 1 ? 's' : ''})`));
      for (const app of apps) {
        const result = await client.request('start', { config: app });
        reportStart(result);
      }
    } else if (!fs.existsSync(resolved)) {
      // Pas un fichier : c'est peut-être une app déjà connue → on la (re)démarre.
      const known = await client.request('describe', { target });
      if (!known.length) throw new Error(`introuvable : ${target} (ni fichier, ni application connue)`);
      const restarted = await client.request('restart', { target });
      for (const app of restarted) console.log(`${fmt.color.green('redémarrée')} ${app.name}`);
    } else {
      const config = configFromFlags(resolved, flags, passthrough);
      const result = await client.request('start', { config });
      reportStart(result);
    }
    printList(await client.request('list'));
  });
};

function reportStart(result) {
  const { app, action, error } = result;
  if (error || action === 'errored') {
    console.log(`${fmt.color.red('échec')} ${app.name} : ${error || app.buildError}`);
    return;
  }
  const verb = action === 'restarted' ? 'redémarrée' : 'démarrée';
  console.log(
    `${fmt.color.green(verb)} ${fmt.color.bold(app.name)} ` +
    fmt.color.gray(`[${app.runtime}${app.runtimeNote ? `/${app.runtimeNote}` : ''}] ${app.instances.length} instance(s)`)
  );
}

commands.list = async () => {
  await withClient(async (client) => printList(await client.request('list')));
};
commands.ls = commands.list;
commands.status = commands.list;

commands.describe = async (positional) => {
  const target = positional[0];
  if (!target) throw new Error('précise une application');
  await withClient(async (client) => {
    const apps = await client.request('describe', { target });
    if (!apps.length) throw new Error(`application introuvable : ${target}`);
    for (const app of apps) printDescribe(app);
  });
};
commands.show = commands.describe;
commands.info = commands.describe;

const simple = {
  stop: ['stop', 'arrêtée'],
  restart: ['restart', 'redémarrée'],
  reload: ['reload', 'rechargée'],
  delete: ['delete', 'supprimée'],
};
for (const [name, [cmd, verb]] of Object.entries(simple)) {
  commands[name] = async (positional) => {
    const target = positional[0] || 'all';
    await withClient(async (client) => {
      const apps = await client.request(cmd, { target });
      if (!apps.length) return console.log(fmt.color.gray(`aucune application ne correspond à « ${target} »`));
      for (const app of apps) {
        console.log(`${app.error ? fmt.color.red('échec') : fmt.color.green(verb)} ${app.name}${app.error ? ` : ${app.error}` : ''}`);
      }
      if (cmd !== 'delete') printList(await client.request('list'));
    });
  };
}
commands.del = commands.delete;
commands.rm = commands.delete;

commands.scale = async (positional) => {
  const [target, count] = positional;
  if (!target || count == null) throw new Error('usage : ppm scale <app> <nombre>');
  await withClient(async (client) => {
    await client.request('scale', { target, count: Number(count) });
    printList(await client.request('list'));
  });
};

commands.logs = async (positional, flags) => {
  const target = positional[0] || 'all';
  const lines = flags.lines != null ? Number(flags.lines) : 15;
  await withClient(async (client) => {
    const files = await client.request('logfiles', { target });
    if (!files.length) throw new Error(`aucune application ne correspond à « ${target} »`);

    // merge_logs fait pointer plusieurs instances sur le même fichier : on ne le suit qu'une fois.
    const sources = [];
    const seen = new Set();
    for (const entry of files) {
      const sameName = files.filter((f) => f.name === entry.name);
      const label = sameName.length > 1 && sameName[0].out !== entry.out ? `${entry.name}:${entry.index}` : entry.name;
      for (const [kind, file] of [['out', entry.out], ['err', entry.err]]) {
        if (kind === 'out' && flags.err) continue;
        if (kind === 'err' && flags.out) continue;
        if (seen.has(file)) continue;
        seen.add(file);
        sources.push({ file, label, kind });
      }
    }

    const stop = follow(sources, { lines, raw: flags.raw === true });
    if (flags.nostream || flags.follow === false) {
      stop();
      return;
    }
    console.log(fmt.color.gray('— suivi en cours, Ctrl-C pour quitter —'));
    await new Promise((resolve) => {
      process.on('SIGINT', () => {
        stop();
        resolve();
      });
    });
  });
};

commands.monit = async () => {
  const client = new Client();
  await client.connect();
  const render = async () => {
    const apps = await client.request('list');
    fmt.clearScreen();
    console.log(fmt.color.bold(` polypm ${VERSION} `) + fmt.color.gray(`— ${new Date().toLocaleTimeString()} — Ctrl-C pour quitter`));
    printList(apps);
    const total = apps.reduce((acc, app) => ({ cpu: acc.cpu + app.cpu, memory: acc.memory + app.memory }), { cpu: 0, memory: 0 });
    console.log(fmt.color.gray(` total : ${total.cpu.toFixed(1)}% cpu · ${fmt.bytes(total.memory)} · ${os.loadavg().map((n) => n.toFixed(2)).join(' ')} load`));
  };
  await render();
  const timer = setInterval(() => render().catch(() => {}), 2000);
  await new Promise((resolve) => process.on('SIGINT', () => {
    clearInterval(timer);
    client.close();
    resolve();
  }));
};

commands.flush = async (positional) => {
  await withClient(async (client) => {
    const result = await client.request('flush', { target: positional[0] || 'all' });
    console.log(`${fmt.color.green('logs vidés')} ${fmt.color.gray(`(${result.flushed} fichier(s))`)}`);
  });
};

commands.save = async () => {
  await withClient(async (client) => {
    const result = await client.request('save');
    console.log(`${fmt.color.green('état sauvegardé')} ${fmt.color.gray(`${result.saved} application(s) → ${result.file}`)}`);
  });
};

commands.resurrect = async () => {
  await withClient(async (client) => {
    const result = await client.request('resurrect');
    console.log(`${fmt.color.green('état restauré')} ${fmt.color.gray(`${result.restored} application(s)`)}`);
    printList(await client.request('list'));
  });
};

commands.ping = async () => {
  await withClient(async (client) => {
    const result = await client.request('ping');
    console.log(`${fmt.color.green('daemon en ligne')} ${fmt.color.gray(`pid ${result.pid}, version ${result.version}`)}`);
  });
};

commands.kill = async () => {
  await withClient(async (client) => {
    await client.request('kill');
    console.log(`${fmt.color.green('daemon arrêté')} ${fmt.color.gray('(toutes les applications ont été stoppées)')}`);
  }, { autoStart: false }).catch((err) => {
    if (['ENOENT', 'ECONNREFUSED'].includes(err.code)) return console.log(fmt.color.gray('aucun daemon en cours'));
    throw err;
  });
};

commands.signal = async (positional) => {
  const [signal, target] = positional;
  if (!signal) throw new Error('usage : ppm signal <SIGNAL> [app]');
  await withClient(async (client) => {
    const results = await client.request('signal', { target: target || 'all', signal });
    for (const result of results) console.log(`${fmt.color.green(signal)} → ${result.name} (${result.sent} process)`);
  });
};

commands.startup = async () => {
  const cli = path.join(__dirname, '..', 'bin', 'ppm.js');
  const unit = [
    '[Unit]',
    'Description=polypm — gestionnaire de processus multi-langages',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${os.userInfo().username}`,
    `Environment=POLYPM_HOME=${paths.HOME}`,
    `ExecStart=${process.execPath} ${path.join(__dirname, 'daemon.js')}`,
    `ExecStartPost=/bin/sh -c 'sleep 1; exec ${process.execPath} ${cli} resurrect'`,
    `ExecStop=${process.execPath} ${cli} kill`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
  console.log(fmt.color.gray('# à écrire dans /etc/systemd/system/polypm.service puis :'));
  console.log(fmt.color.gray('#   sudo systemctl daemon-reload && sudo systemctl enable --now polypm'));
  console.log(unit);
};

commands.init = async (positional, flags) => {
  const file = path.resolve(process.cwd(), 'ecosystem.config.js');
  if (fs.existsSync(file) && !flags.force) throw new Error(`${file} existe déjà (--force pour écraser)`);
  fs.writeFileSync(file, TEMPLATE);
  console.log(`${fmt.color.green('créé')} ${file}`);
};

commands.runtimes = async () => {
  const { runtimes } = require('./runtimes');
  const rows = Object.entries(runtimes).map(([name, runtime]) => [
    fmt.colorRuntime(name, name),
    runtime.extensions.join(' ') || '(tout exécutable)',
    runtime.clusterable ? 'oui' : 'non',
    runtime.needsBuild ? 'oui' : 'non',
  ]);
  console.log(fmt.table(['runtime', 'extensions', 'cluster', 'build'], rows));
};

commands.help = async () => console.log(HELP);
commands.version = async () => console.log(VERSION);

/* ------------------------------------------------------------- entrée */

async function main(argv) {
  const { positional, flags, passthrough } = parseArgs(argv);
  let name = positional.shift();

  if (flags.version) name = 'version';
  if (flags.help || !name) name = name && !flags.help ? name : 'help';

  const command = commands[name];
  if (!command) {
    console.error(`${fmt.color.red('commande inconnue')} : ${name}\n`);
    console.log(HELP);
    process.exitCode = 1;
    return;
  }

  try {
    await command(positional, flags, passthrough);
  } catch (err) {
    console.error(`${fmt.color.red('erreur')} : ${err.message}`);
    process.exitCode = 1;
  }
}

const TEMPLATE = `// Configuration polypm — un fichier, plusieurs langages.
module.exports = {
  apps: [
    {
      name: 'api',
      script: './src/server.ts',   // TypeScript : tsx / ts-node / node --experimental-strip-types
      instances: 2,
      exec_mode: 'cluster',
      watch: ['./src'],
      env: { NODE_ENV: 'production', PORT: '3000' },
    },
    {
      name: 'worker',
      script: './worker/main.py',  // Python : venv local détecté automatiquement
      args: ['--queue', 'default'],
      max_memory_restart: '300M',
    },
    {
      name: 'engine',
      script: './engine',          // Rust : dossier avec Cargo.toml, compilé puis supervisé
      release: true,
    },
  ],
};
`;

const HELP = `${fmt.color.bold('polypm')} ${fmt.color.gray(VERSION)} — gestionnaire de processus JavaScript · TypeScript · Python · Rust

${fmt.color.bold('USAGE')}
  ppm <commande> [cible] [options] [-- args de l'app]

${fmt.color.bold('DÉMARRAGE')}
  ppm start <script>            lance un script (runtime détecté à l'extension)
  ppm start <dossier-cargo>     compile un projet Rust puis supervise le binaire
  ppm start <ecosystem.js>      lance toutes les apps d'un fichier de configuration
  ppm start                     idem avec le fichier ecosystem trouvé dans le dossier courant
  ppm init                      génère un ecosystem.config.js d'exemple

${fmt.color.bold('CYCLE DE VIE')}
  ppm list | ls | status        tableau des applications
  ppm describe <app>            détail d'une application
  ppm stop|restart|reload <app> arrêt / redémarrage (reload = sans coupure en cluster)
  ppm delete <app>              arrête et oublie l'application
  ppm scale <app> <n>           change le nombre d'instances à chaud
  ppm signal <SIG> [app]        envoie un signal aux process
  ${fmt.color.gray("(cible = nom, id, namespace, motif « api-* » ou « all »)")}

${fmt.color.bold('OBSERVATION')}
  ppm logs [app] [-l 50]        affiche et suit les logs (--nostream pour ne pas suivre)
  ppm monit                     tableau rafraîchi en continu
  ppm flush [app]               vide les fichiers de logs

${fmt.color.bold('DAEMON')}
  ppm save / ppm resurrect      sauvegarde / restaure la liste des applications
  ppm startup                   affiche une unité systemd prête à installer
  ppm ping | ppm kill           état / arrêt du daemon
  ppm runtimes                  runtimes supportés

${fmt.color.bold('OPTIONS DE START')}
  -n, --name <nom>              nom de l'application
  -i, --instances <n|max>       nombre d'instances (cluster pour Node/TS)
      --cluster | --fork        force le mode d'exécution
  -w, --watch [chemin]          redémarre quand les fichiers changent
      --ignore-watch <motif>    exclusions du watch (répétable)
      --interpreter <bin>       force l'interpréteur (ex. python3.12, bun)
      --interpreter-args <a>    arguments de l'interpréteur
      --runtime <nom>           force le runtime (node, typescript, python, rust, shell, binary)
      --env KEY=VAL             variable d'environnement (répétable)
      --env-file <.env>         charge un fichier d'environnement
      --cwd <dossier>           répertoire de travail
      --max-memory-restart <n>  redémarre au-delà de cette mémoire (ex. 300M)
      --max-restarts <n>        relances instables tolérées (défaut 16)
      --restart-delay <ms>      délai fixe avant relance
      --exp-backoff-restart-delay <ms>  délai exponentiel avant relance
      --min-uptime <ms>         durée au-delà de laquelle un démarrage est « stable »
      --no-autorestart          ne pas relancer à la sortie
      --time                    horodate chaque ligne de log
      --release                 Rust : compile en profil release
      --bin <nom>               Rust : choisit le binaire du crate
      --features <liste>        Rust : features cargo
      --python-module           Python : le script est un module (-m paquet)
      --out <fichier> --error <fichier>   fichiers de logs personnalisés
`;

module.exports = { main, parseArgs, configFromFlags };
