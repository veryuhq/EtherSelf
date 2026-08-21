'use strict';
/**
 * Une application supervisée : sa configuration, ses instances, ses logs.
 */
const fs = require('fs');
const path = require('path');
const cluster = require('cluster');
const { spawn } = require('child_process');
const paths = require('./paths');
const runtimes = require('./runtimes');
const metrics = require('./metrics');

const STATUS = {
  LAUNCHING: 'launching',
  BUILDING: 'building',
  ONLINE: 'online',
  STOPPING: 'stopping',
  STOPPED: 'stopped',
  ERRORED: 'errored',
  WAITING: 'waiting restart',
};

/** Valeurs par défaut, alignées sur les noms de pm2 quand ils existent. */
function normalizeConfig(raw) {
  const cwd = path.resolve(raw.cwd || process.cwd());
  const script = raw.script;
  if (!script) throw new Error('« script » est obligatoire');

  const name = raw.name || path.basename(script).replace(/\.[^.]+$/, '') || 'app';
  const instances = Math.max(1, Number(raw.instances) || 1);
  // En mode module Python (`-m paquet`), le « script » est un nom de module :
  // le résoudre en chemin absolu n'aurait aucun sens.
  const isModule = raw.python_module === true || raw.pythonModule === true || String(script).startsWith('-m ');

  return {
    name,
    namespace: raw.namespace || 'default',
    script: isModule || path.isAbsolute(script) ? script : path.resolve(cwd, script),
    rawScript: script,
    cwd,
    args: toArray(raw.args),
    interpreter: raw.interpreter && raw.interpreter !== 'none' ? raw.interpreter : null,
    interpreterArgs: toArray(raw.interpreter_args || raw.interpreterArgs),
    runtime: raw.runtime || null,
    env: { ...(raw.env || {}) },
    instances,
    execMode: raw.exec_mode || raw.execMode || (instances > 1 ? 'cluster' : 'fork'),
    autorestart: raw.autorestart !== false,
    maxRestarts: raw.max_restarts ?? raw.maxRestarts ?? 16,
    restartDelay: raw.restart_delay ?? raw.restartDelay ?? 0,
    expBackoff: raw.exp_backoff_restart_delay ?? raw.expBackoff ?? 0,
    minUptime: raw.min_uptime ?? raw.minUptime ?? 1000,
    maxMemoryRestart: parseBytes(raw.max_memory_restart ?? raw.maxMemoryRestart),
    watch: raw.watch === true ? [path.resolve(cwd)] : toArray(raw.watch).map((p) => path.resolve(cwd, p)),
    ignoreWatch: toArray(raw.ignore_watch || raw.ignoreWatch),
    killTimeout: raw.kill_timeout ?? raw.killTimeout ?? 3000,
    stopSignal: raw.stop_signal || raw.stopSignal || 'SIGINT',
    mergeLogs: raw.merge_logs ?? raw.mergeLogs ?? true,
    time: raw.time === true,
    outFile: raw.out_file || raw.outFile || null,
    errorFile: raw.error_file || raw.errorFile || null,
    release: raw.release === true,
    binName: raw.bin || raw.binName || null,
    features: raw.features || null,
    pythonModule: raw.python_module === true || raw.pythonModule === true,
  };
}

function toArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value).trim().length ? String(value).split(/\s+/) : [];
}

/** « 300M », « 1.5G », 1048576 → octets. */
function parseBytes(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  const match = String(value).trim().match(/^([\d.]+)\s*([kmgt]?)b?$/i);
  if (!match) return 0;
  const units = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
  return Math.round(Number(match[1]) * units[match[2].toLowerCase()]);
}

const DEFAULT_IGNORE = ['node_modules', '.git', 'target', '__pycache__', '.venv', 'venv', 'dist', '.polypm'];

class Instance {
  constructor(app, index) {
    this.app = app;
    this.index = index;
    this.pid = null;
    this.child = null;
    this.worker = null;
    this.status = STATUS.STOPPED;
    this.restarts = 0;
    this.unstable = 0;
    this.startedAt = null;
    this.exitCode = null;
    this.exitSignal = null;
    this.cpu = 0;
    this.memory = 0;
    this.stopping = false;
    this.restartTimer = null;
    this.killTimer = null;
  }

  get uptime() {
    return this.status === STATUS.ONLINE && this.startedAt ? Date.now() - this.startedAt : 0;
  }
}

class App {
  /**
   * @param {number} id identifiant numérique attribué par le manager
   * @param {object} raw configuration utilisateur
   * @param {(app: App, line: string) => void} logger relais de logs interne
   */
  constructor(id, raw, logger) {
    this.id = id;
    this.config = normalizeConfig(raw);
    this.rawConfig = raw;
    this.log = logger || (() => {});
    this.instances = [];
    this.spec = null;          // commande résolue par le runtime
    this.runtimeName = runtimes.detectRuntime(this.config.script, this.config.runtime);
    this.createdAt = Date.now();
    this.buildError = null;
    this.watchers = [];
    this.watchTimer = null;
    this.streams = new Map();  // chemin → WriteStream
    this.deleted = false;

    for (let i = 0; i < this.config.instances; i += 1) {
      this.instances.push(new Instance(this, i));
    }
  }

  /* ------------------------------------------------------------- logs */

  logPath(kind, index) {
    const custom = kind === 'out' ? this.config.outFile : this.config.errorFile;
    if (custom) return path.resolve(custom);
    const suffix = this.config.mergeLogs || this.config.instances === 1 ? '' : `-${index}`;
    return path.join(paths.LOGS, `${this.config.name}${suffix}-${kind}.log`);
  }

  stream(file) {
    let stream = this.streams.get(file);
    if (!stream) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      stream = fs.createWriteStream(file, { flags: 'a' });
      stream.on('error', () => this.streams.delete(file));
      this.streams.set(file, stream);
    }
    return stream;
  }

  writeLog(kind, index, text) {
    const file = this.logPath(kind, index);
    const stream = this.stream(file);
    if (!this.config.time) return stream.write(text);
    const stamp = new Date().toISOString();
    const prefixed = text
      .split('\n')
      .map((line, i, all) => (i === all.length - 1 && line === '' ? line : `${stamp} ${line}`))
      .join('\n');
    return stream.write(prefixed);
  }

  /** Message émis par polypm lui-même (build, erreurs de spawn…). */
  system(text) {
    const line = `[polypm] ${text}\n`;
    this.writeLog('out', 0, line);
    this.log(this, line);
  }

  closeStreams() {
    for (const stream of this.streams.values()) stream.end();
    this.streams.clear();
  }

  /* ------------------------------------------------------------ cycle */

  async start() {
    if (this.instances.some((i) => i.status === STATUS.ONLINE || i.status === STATUS.LAUNCHING)) {
      return { alreadyRunning: true };
    }
    await this.prepareSpec();
    for (const instance of this.instances) {
      this.launch(instance);
    }
    this.setupWatch();
    return { started: this.instances.length };
  }

  /** Résout (et compile si besoin) la commande à exécuter. */
  async prepareSpec() {
    this.buildError = null;
    const needsBuild = runtimes.runtimes[this.runtimeName]?.needsBuild;
    if (needsBuild) {
      for (const instance of this.instances) instance.status = STATUS.BUILDING;
    }
    try {
      this.spec = await runtimes.prepare(this.config, (chunk) => {
        this.writeLog('out', 0, chunk);
        this.log(this, chunk);
      });
      if (this.spec.note) this.system(`runtime ${this.spec.runtime} (${this.spec.note})`);
    } catch (err) {
      this.buildError = err.message;
      for (const instance of this.instances) {
        instance.status = STATUS.ERRORED;
        instance.pid = null;
      }
      this.writeLog('err', 0, `[polypm] ${err.message}\n`);
      throw err;
    }
  }

  /** Le mode cluster n'est possible que pour du Node exécutable directement. */
  canCluster() {
    if (this.config.execMode !== 'cluster') return false;
    if (!this.spec || !this.spec.clusterable) return false;
    return this.spec.command === process.execPath;
  }

  launch(instance) {
    clearTimeout(instance.restartTimer);
    instance.restartTimer = null;
    instance.stopping = false;
    instance.status = STATUS.LAUNCHING;

    const env = {
      ...process.env,
      ...this.spec.env,
      ...this.config.env,
      POLYPM_APP_NAME: this.config.name,
      POLYPM_INSTANCE_ID: String(instance.index),
      NODE_APP_INSTANCE: String(instance.index),
      INSTANCE_ID: String(instance.index),
    };
    delete env.POLYPM_DAEMON;

    try {
      if (this.canCluster()) {
        this.launchCluster(instance, env);
      } else {
        this.launchFork(instance, env);
      }
    } catch (err) {
      instance.status = STATUS.ERRORED;
      this.writeLog('err', instance.index, `[polypm] échec du lancement : ${err.message}\n`);
      return;
    }

    instance.startedAt = Date.now();
    instance.status = STATUS.ONLINE;
  }

  launchFork(instance, env) {
    const child = spawn(this.spec.command, this.spec.args, {
      cwd: this.config.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // groupe de process : on tue toute la descendance
    });
    instance.child = child;
    instance.pid = child.pid;
    this.pipe(instance, child.stdout, 'out');
    this.pipe(instance, child.stderr, 'err');
    child.on('error', (err) => {
      this.writeLog('err', instance.index, `[polypm] ${err.message}\n`);
      this.onExit(instance, 1, null);
    });
    child.on('exit', (code, signal) => this.onExit(instance, code, signal));
  }

  launchCluster(instance, env) {
    cluster.setupPrimary({
      exec: this.config.script,
      args: this.config.args,
      execArgv: this.spec.args.slice(0, this.spec.args.indexOf(this.config.script)),
      cwd: this.config.cwd,
      silent: true,
    });
    const worker = cluster.fork(env);
    instance.worker = worker;
    instance.child = worker.process;
    instance.pid = worker.process.pid;
    this.pipe(instance, worker.process.stdout, 'out');
    this.pipe(instance, worker.process.stderr, 'err');
    worker.on('exit', (code, signal) => this.onExit(instance, code, signal));
    worker.on('error', (err) => this.writeLog('err', instance.index, `[polypm] ${err.message}\n`));
  }

  pipe(instance, stream, kind) {
    if (!stream) return;
    stream.on('data', (chunk) => {
      const text = chunk.toString();
      this.writeLog(kind, instance.index, text);
      this.log(this, text, kind, instance.index);
    });
  }

  onExit(instance, code, signal) {
    const wasOnline = instance.status === STATUS.ONLINE;
    const uptime = instance.startedAt ? Date.now() - instance.startedAt : 0;
    if (instance.pid) metrics.forget(instance.pid);
    clearTimeout(instance.killTimer);
    instance.killTimer = null;
    instance.pid = null;
    instance.child = null;
    instance.worker = null;
    instance.exitCode = code;
    instance.exitSignal = signal;
    instance.startedAt = null;

    if (instance.stopping || this.deleted) {
      instance.status = STATUS.STOPPED;
      instance.stopping = false;
      if (instance.resolveStop) {
        instance.resolveStop();
        instance.resolveStop = null;
      }
      return;
    }

    if (!this.config.autorestart) {
      instance.status = code === 0 ? STATUS.STOPPED : STATUS.ERRORED;
      return;
    }

    // Un process qui meurt trop vite est « instable » : on compte, et on abandonne
    // après max_restarts pour ne pas boucler indéfiniment sur une erreur de code.
    if (wasOnline && uptime >= this.config.minUptime) {
      instance.unstable = 0;
    } else {
      instance.unstable += 1;
    }

    if (instance.unstable > this.config.maxRestarts) {
      instance.status = STATUS.ERRORED;
      this.writeLog(
        'err',
        instance.index,
        `[polypm] arrêt des relances : ${instance.unstable} démarrages instables d'affilée (max_restarts=${this.config.maxRestarts})\n`
      );
      return;
    }

    instance.restarts += 1;
    instance.status = STATUS.WAITING;
    const delay = this.config.expBackoff
      ? Math.min(this.config.expBackoff * 2 ** Math.min(instance.unstable, 10), 15000)
      : this.config.restartDelay;

    instance.restartTimer = setTimeout(() => {
      if (this.deleted) return;
      this.relaunch(instance).catch((err) => {
        this.writeLog('err', instance.index, `[polypm] ${err.message}\n`);
      });
    }, delay);
  }

  /** Relance une instance seule, en recompilant si le runtime le demande. */
  async relaunch(instance) {
    if (this.spec && this.spec.needsBuild) {
      try {
        await this.prepareSpec();
      } catch {
        return; // prepareSpec a déjà marqué l'app en erreur et loggé
      }
    }
    this.launch(instance);
  }

  stopInstance(instance) {
    return new Promise((resolve) => {
      if (!instance.pid) {
        clearTimeout(instance.restartTimer);
        instance.restartTimer = null;
        instance.status = STATUS.STOPPED;
        return resolve();
      }
      clearTimeout(instance.restartTimer);
      instance.restartTimer = null;
      instance.stopping = true;
      instance.status = STATUS.STOPPING;
      instance.resolveStop = resolve;

      const pid = instance.pid;
      kill(pid, this.config.stopSignal, instance.worker == null);

      instance.killTimer = setTimeout(() => {
        if (instance.pid === pid) {
          this.writeLog('err', instance.index, `[polypm] SIGKILL après ${this.config.killTimeout} ms\n`);
          kill(pid, 'SIGKILL', instance.worker == null);
          // Si le process est déjà un zombie non réclamé, on ne bloque pas l'appelant.
          setTimeout(() => {
            if (instance.resolveStop) {
              instance.status = STATUS.STOPPED;
              instance.pid = null;
              instance.resolveStop();
              instance.resolveStop = null;
            }
          }, 500);
        }
      }, this.config.killTimeout);
    });
  }

  async stop() {
    this.teardownWatch();
    await Promise.all(this.instances.map((instance) => this.stopInstance(instance)));
    return { stopped: this.instances.length };
  }

  async restart() {
    await this.stop();
    for (const instance of this.instances) {
      instance.unstable = 0;
      instance.restarts += 1;
    }
    await this.prepareSpec();
    for (const instance of this.instances) this.launch(instance);
    this.setupWatch();
    return { restarted: this.instances.length };
  }

  /** Redémarrage sans coupure : instance par instance (utile en mode cluster). */
  async reload() {
    if (!this.canCluster()) return this.restart();
    await this.prepareSpec();
    for (const instance of this.instances) {
      await this.stopInstance(instance);
      this.launch(instance);
      await new Promise((r) => setTimeout(r, 200));
    }
    return { reloaded: this.instances.length };
  }

  sendSignal(signal) {
    let sent = 0;
    for (const instance of this.instances) {
      if (instance.pid) {
        kill(instance.pid, signal, instance.worker == null);
        sent += 1;
      }
    }
    return sent;
  }

  /** Ajuste le nombre d'instances à chaud. */
  async scale(count) {
    const target = Math.max(1, Number(count) || 1);
    const current = this.instances.length;
    if (target === current) return { instances: current };

    if (target < current) {
      const removed = this.instances.splice(target);
      await Promise.all(removed.map((instance) => this.stopInstance(instance)));
    } else {
      if (!this.spec) await this.prepareSpec();
      for (let i = current; i < target; i += 1) {
        const instance = new Instance(this, i);
        this.instances.push(instance);
        this.launch(instance);
      }
    }
    this.config.instances = target;
    this.rawConfig.instances = target;
    return { instances: target };
  }

  /* ------------------------------------------------------------ watch */

  setupWatch() {
    this.teardownWatch();
    if (!this.config.watch.length) return;
    const ignore = [...DEFAULT_IGNORE, ...this.config.ignoreWatch];

    for (const dir of this.config.watch) {
      try {
        const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
          if (!filename) return;
          const name = String(filename);
          if (ignore.some((pattern) => name.split(path.sep).includes(pattern) || name.includes(pattern))) return;
          if (name.endsWith('~') || name.endsWith('.swp')) return;
          clearTimeout(this.watchTimer);
          this.watchTimer = setTimeout(() => {
            this.system(`changement détecté (${name}) → redémarrage`);
            this.restart().catch(() => {});
          }, 400);
        });
        watcher.on('error', () => {});
        this.watchers.push(watcher);
      } catch (err) {
        this.system(`watch impossible sur ${dir} : ${err.message}`);
      }
    }
  }

  teardownWatch() {
    clearTimeout(this.watchTimer);
    this.watchTimer = null;
    for (const watcher of this.watchers) {
      try { watcher.close(); } catch { /* déjà fermé */ }
    }
    this.watchers = [];
  }

  /* ----------------------------------------------------------- rendu */

  get status() {
    const statuses = this.instances.map((i) => i.status);
    if (statuses.includes(STATUS.ONLINE)) return STATUS.ONLINE;
    if (statuses.includes(STATUS.BUILDING)) return STATUS.BUILDING;
    if (statuses.includes(STATUS.LAUNCHING)) return STATUS.LAUNCHING;
    if (statuses.includes(STATUS.WAITING)) return STATUS.WAITING;
    if (statuses.includes(STATUS.STOPPING)) return STATUS.STOPPING;
    if (statuses.every((s) => s === STATUS.ERRORED)) return STATUS.ERRORED;
    return STATUS.STOPPED;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.config.name,
      namespace: this.config.namespace,
      script: this.config.script,
      cwd: this.config.cwd,
      args: this.config.args,
      runtime: this.runtimeName,
      runtimeLabel: this.spec ? this.spec.label : (runtimes.runtimes[this.runtimeName] || {}).label,
      runtimeNote: this.spec ? this.spec.note || null : null,
      command: this.spec ? `${this.spec.command} ${this.spec.args.join(' ')}`.trim() : null,
      execMode: this.canCluster() ? 'cluster' : 'fork',
      status: this.status,
      autorestart: this.config.autorestart,
      watch: this.config.watch,
      maxMemoryRestart: this.config.maxMemoryRestart,
      buildError: this.buildError,
      outFile: this.logPath('out', 0),
      errorFile: this.logPath('err', 0),
      createdAt: this.createdAt,
      instances: this.instances.map((instance) => ({
        index: instance.index,
        pid: instance.pid,
        status: instance.status,
        restarts: instance.restarts,
        unstable: instance.unstable,
        uptime: instance.uptime,
        cpu: instance.cpu,
        memory: instance.memory,
        exitCode: instance.exitCode,
        exitSignal: instance.exitSignal,
      })),
      totalRestarts: this.instances.reduce((sum, i) => sum + i.restarts, 0),
      cpu: this.instances.reduce((sum, i) => sum + i.cpu, 0),
      memory: this.instances.reduce((sum, i) => sum + i.memory, 0),
      uptime: Math.max(0, ...this.instances.map((i) => i.uptime)),
      config: this.rawConfig,
    };
  }
}

/** Tue un process — et son groupe quand on l'a créé détaché (fork mode). */
function kill(pid, signal, useGroup) {
  try {
    if (useGroup && process.platform !== 'win32') {
      process.kill(-pid, signal);
    } else {
      process.kill(pid, signal);
    }
  } catch (err) {
    if (err.code === 'ESRCH' && useGroup) {
      try { process.kill(pid, signal); } catch { /* déjà mort */ }
    }
  }
}

module.exports = { App, STATUS, normalizeConfig, parseBytes };
