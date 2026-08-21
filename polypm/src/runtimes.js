'use strict';
/**
 * Détection et préparation des runtimes.
 *
 * Chaque runtime sait répondre à deux questions :
 *   - « ce script est-il pour moi ? »            → detect()
 *   - « quelle commande dois-je lancer ? »        → prepare()
 *
 * prepare() peut compiler (Rust) avant de rendre la commande finale.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const paths = require('./paths');

const IS_WIN = process.platform === 'win32';

/* ------------------------------------------------------------------ utils */

/** Cherche un exécutable dans les node_modules/.bin en remontant, puis dans le PATH. */
function findBin(name, fromDir) {
  const exts = IS_WIN ? ['.cmd', '.exe', ''] : [''];
  let dir = path.resolve(fromDir || process.cwd());
  for (;;) {
    for (const ext of exts) {
      const candidate = path.join(dir, 'node_modules', '.bin', name + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return which(name);
}

/** Équivalent minimal de `which`. */
function which(name) {
  const exts = IS_WIN ? (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch { /* suivant */ }
    }
  }
  return null;
}

/** Exécute une commande de build et renvoie { code, output }. */
function run(command, args, options, onOutput) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const collect = (chunk) => {
      const text = chunk.toString();
      output += text;
      if (onOutput) onOutput(text);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (err) => resolve({ code: -1, output: output + String(err.message) }));
    child.on('close', (code) => resolve({ code, output }));
  });
}

function nodeMajorMinor() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return { major, minor };
}

/* --------------------------------------------------------------- runtimes */

const runtimes = {
  /* ---------------------------------------------------------- JavaScript */
  node: {
    label: 'node',
    extensions: ['.js', '.mjs', '.cjs'],
    clusterable: true,
    detect: (script) => ['.js', '.mjs', '.cjs'].includes(path.extname(script)),
    async prepare(app) {
      return {
        command: app.interpreter || process.execPath,
        args: [...(app.interpreterArgs || []), app.script, ...(app.args || [])],
        env: {},
      };
    },
  },

  /* ---------------------------------------------------------- TypeScript */
  typescript: {
    label: 'ts',
    extensions: ['.ts', '.mts', '.cts', '.tsx'],
    clusterable: true,
    detect: (script) => ['.ts', '.mts', '.cts', '.tsx'].includes(path.extname(script)),
    async prepare(app) {
      if (app.interpreter) {
        return {
          command: app.interpreter,
          args: [...(app.interpreterArgs || []), app.script, ...(app.args || [])],
          env: {},
        };
      }
      const loader = resolveTsLoader(app.cwd, app.script);
      return { command: loader.command, args: [...loader.args, ...(app.args || [])], env: {}, note: loader.note };
    },
  },

  /* -------------------------------------------------------------- Python */
  python: {
    label: 'python',
    extensions: ['.py'],
    clusterable: false,
    detect: (script) => path.extname(script) === '.py',
    async prepare(app) {
      const python = app.interpreter || findPython(app.cwd);
      if (!python) throw new Error('aucun interpréteur Python trouvé (python3 / python absent du PATH)');
      const flags = app.interpreterArgs && app.interpreterArgs.length ? app.interpreterArgs : ['-u'];
      const isModule = app.script.startsWith('-m ') || app.pythonModule;
      const target = isModule
        ? ['-m', app.script.replace(/^-m\s+/, '')]
        : [app.script];
      return {
        command: python,
        args: [...flags, ...target, ...(app.args || [])],
        // Sorties non bufferisées : sans ça les logs n'arrivent qu'à la fin du processus.
        env: { PYTHONUNBUFFERED: '1' },
      };
    },
  },

  /* ---------------------------------------------------------------- Rust */
  rust: {
    label: 'rust',
    extensions: ['.rs'],
    clusterable: false,
    detect: (script) => path.extname(script) === '.rs' || path.basename(script) === 'Cargo.toml',
    needsBuild: true,
    async prepare(app, onOutput) {
      const isCargo = path.basename(app.script) === 'Cargo.toml' || fs.existsSync(path.join(app.script, 'Cargo.toml'));
      if (isCargo) return buildCargo(app, onOutput);
      return buildSingleRustFile(app, onOutput);
    },
  },

  /* --------------------------------------------------------------- shell */
  shell: {
    label: 'shell',
    extensions: ['.sh', '.bash', '.zsh'],
    clusterable: false,
    detect: (script) => ['.sh', '.bash', '.zsh'].includes(path.extname(script)),
    async prepare(app) {
      return {
        command: app.interpreter || which('bash') || '/bin/sh',
        args: [...(app.interpreterArgs || []), app.script, ...(app.args || [])],
        env: {},
      };
    },
  },

  /* -------------------------------------------------------------- binaire */
  binary: {
    label: 'bin',
    extensions: [],
    clusterable: false,
    detect: () => false, // choisi seulement en dernier recours
    async prepare(app) {
      return {
        command: app.interpreter || app.script,
        args: app.interpreter ? [app.script, ...(app.args || [])] : [...(app.args || [])],
        env: {},
      };
    },
  },
};

/* ------------------------------------------------------- TypeScript tools */

/**
 * Choisit comment exécuter du TypeScript, par ordre de préférence :
 *   1. tsx      — installé dans le projet : gère aussi la syntaxe non effaçable
 *                 (enums, decorators, namespaces, propriétés de constructeur)
 *   2. node --experimental-strip-types — Node >= 22.6, zéro dépendance, mais
 *                 refuse la syntaxe non effaçable
 *   3. ts-node  — repli historique
 *   4. bun / deno — savent lire le .ts nativement
 *
 * `--interpreter` court-circuite tout ça si tu veux imposer ton loader.
 */
function resolveTsLoader(cwd, script) {
  const tsx = findBin('tsx', cwd);
  if (tsx) return { command: tsx, args: [script], note: 'tsx' };

  const { major, minor } = nodeMajorMinor();
  const stripsTypes = major > 22 || (major === 22 && minor >= 6);
  if (stripsTypes) {
    // Node >= 23.6 le fait par défaut, mais le flag reste accepté et explicite.
    return {
      command: process.execPath,
      args: ['--experimental-strip-types', '--no-warnings=ExperimentalWarning', script],
      note: 'node --experimental-strip-types',
    };
  }

  const tsNode = findBin('ts-node', cwd);
  if (tsNode) return { command: tsNode, args: [script], note: 'ts-node' };

  const bun = which('bun');
  if (bun) return { command: bun, args: ['run', script], note: 'bun' };

  const deno = which('deno');
  if (deno) return { command: deno, args: ['run', '-A', script], note: 'deno' };

  throw new Error(
    'aucun runtime TypeScript disponible : installe tsx (`npm i -D tsx`) ou passe à Node >= 22.6'
  );
}

/* -------------------------------------------------------------- Python venv */

/** Préfère un virtualenv local au Python global. */
function findPython(cwd) {
  const binDir = IS_WIN ? 'Scripts' : 'bin';
  const exe = IS_WIN ? 'python.exe' : 'python';
  for (const venv of ['.venv', 'venv', 'env']) {
    const candidate = path.join(cwd, venv, binDir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  if (process.env.VIRTUAL_ENV) {
    const candidate = path.join(process.env.VIRTUAL_ENV, binDir, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return which('python3') || which('python');
}

/* ---------------------------------------------------------------- Rust build */

/** Projet Cargo : `cargo build`, puis on supervise le binaire produit (pas cargo). */
async function buildCargo(app, onOutput) {
  const cargo = which('cargo');
  if (!cargo) throw new Error('cargo introuvable dans le PATH');

  const manifest = path.basename(app.script) === 'Cargo.toml'
    ? path.resolve(app.script)
    : path.join(path.resolve(app.script), 'Cargo.toml');
  const profile = app.release ? 'release' : 'debug';
  const buildArgs = ['build', '--manifest-path', manifest];
  if (app.release) buildArgs.push('--release');
  if (app.binName) buildArgs.push('--bin', app.binName);
  if (app.features) buildArgs.push('--features', app.features);

  if (onOutput) onOutput(`[polypm] cargo build (${profile})\n`);
  const built = await run(cargo, buildArgs, { cwd: path.dirname(manifest), env: process.env }, onOutput);
  if (built.code !== 0) throw new Error(`échec de \`cargo build\` (code ${built.code})`);

  const meta = await run(cargo, ['metadata', '--no-deps', '--format-version', '1', '--manifest-path', manifest], {
    cwd: path.dirname(manifest),
    env: process.env,
  });
  if (meta.code !== 0) throw new Error('impossible de lire `cargo metadata`');

  const parsed = JSON.parse(meta.output);
  const pkg = parsed.packages[0];
  const bins = (pkg.targets || []).filter((t) => (t.kind || []).includes('bin'));
  if (!bins.length) throw new Error(`le crate « ${pkg.name} » ne produit aucun binaire`);
  const target = app.binName ? bins.find((b) => b.name === app.binName) : bins[0];
  if (!target) throw new Error(`binaire « ${app.binName} » introuvable dans le crate`);

  const binary = path.join(parsed.target_directory, profile, target.name + (IS_WIN ? '.exe' : ''));
  if (!fs.existsSync(binary)) throw new Error(`binaire compilé introuvable : ${binary}`);

  return {
    command: binary,
    args: [...(app.args || [])],
    env: { RUST_BACKTRACE: process.env.RUST_BACKTRACE || '1' },
    note: `cargo:${target.name}:${profile}`,
  };
}

/** Fichier .rs isolé : compilation rustc dans le cache, recompilée si le source a changé. */
async function buildSingleRustFile(app, onOutput) {
  const rustc = which('rustc');
  if (!rustc) throw new Error('rustc introuvable dans le PATH');

  const source = path.resolve(app.cwd, app.script);
  const hash = crypto.createHash('sha1').update(source).digest('hex').slice(0, 10);
  const out = path.join(paths.BUILD, `${path.basename(source, '.rs')}-${hash}${IS_WIN ? '.exe' : ''}`);

  const sourceStat = fs.statSync(source);
  const fresh = fs.existsSync(out) && fs.statSync(out).mtimeMs >= sourceStat.mtimeMs;
  if (!fresh) {
    if (onOutput) onOutput(`[polypm] rustc ${path.basename(source)}\n`);
    const args = [source, '-o', out];
    if (app.release) args.push('-O');
    const built = await run(rustc, args, { cwd: app.cwd, env: process.env }, onOutput);
    if (built.code !== 0) throw new Error(`échec de \`rustc\` (code ${built.code})`);
  }

  return {
    command: out,
    args: [...(app.args || [])],
    env: { RUST_BACKTRACE: process.env.RUST_BACKTRACE || '1' },
    note: 'rustc',
  };
}

/* ------------------------------------------------------------------- API */

/** Devine le runtime d'un script (nom du runtime, jamais null : « binary » en dernier). */
function detectRuntime(script, explicit) {
  if (explicit) {
    if (!runtimes[explicit]) throw new Error(`runtime inconnu : ${explicit}`);
    return explicit;
  }
  const resolved = path.resolve(script);
  // Un dossier contenant un Cargo.toml est un projet Rust.
  try {
    if (fs.statSync(resolved).isDirectory()) {
      if (fs.existsSync(path.join(resolved, 'Cargo.toml'))) return 'rust';
      if (fs.existsSync(path.join(resolved, 'package.json'))) return 'node';
    }
  } catch { /* le script peut ne pas exister encore (build) */ }

  for (const [name, runtime] of Object.entries(runtimes)) {
    if (runtime.detect(script)) return name;
  }
  return 'binary';
}

/** Prépare la commande de lancement d'une app (compile si nécessaire). */
async function prepare(app, onOutput) {
  const name = detectRuntime(app.script, app.runtime);
  const runtime = runtimes[name];
  const spec = await runtime.prepare(app, onOutput);
  return {
    runtime: name,
    label: runtime.label,
    clusterable: Boolean(runtime.clusterable),
    needsBuild: Boolean(runtime.needsBuild),
    ...spec,
  };
}

module.exports = { runtimes, detectRuntime, prepare, which, findBin, findPython, run };
