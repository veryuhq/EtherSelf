'use strict';
/**
 * Le gestionnaire : garde la liste des apps, exécute les commandes du CLI,
 * surveille CPU/mémoire et sait sauvegarder/restaurer l'état.
 */
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { App, STATUS } = require('./app');
const metrics = require('./metrics');

const MONITOR_INTERVAL = 2000;

class Manager {
  constructor() {
    this.apps = new Map();     // id → App
    this.nextId = 0;
    this.listeners = new Set(); // flux de logs live (clients « logs »)
    this.monitorTimer = setInterval(() => this.monitor(), MONITOR_INTERVAL);
    this.monitorTimer.unref?.();
  }

  /* -------------------------------------------------------- résolution */

  byName(name) {
    return [...this.apps.values()].filter((app) => app.config.name === name);
  }

  /** Résout « all », un id, un nom ou un namespace vers une liste d'apps. */
  resolve(target) {
    const all = [...this.apps.values()];
    if (target == null || target === 'all' || target === '') return all;
    const targets = Array.isArray(target) ? target : [target];
    const found = new Map();
    for (const item of targets) {
      const key = String(item);
      if (/^\d+$/.test(key) && this.apps.has(Number(key))) {
        const app = this.apps.get(Number(key));
        found.set(app.id, app);
        continue;
      }
      let matched = false;
      for (const app of all) {
        if (app.config.name === key || app.config.namespace === key) {
          found.set(app.id, app);
          matched = true;
        }
      }
      if (!matched) {
        // Support d'un motif simple : « api-* »
        if (key.includes('*')) {
          const rx = new RegExp(`^${key.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
          for (const app of all) if (rx.test(app.config.name)) found.set(app.id, app);
        }
      }
    }
    return [...found.values()];
  }

  /* ----------------------------------------------------------- actions */

  async start(config) {
    const existing = this.byName(config.name || '');
    if (existing.length && !config.force) {
      const app = existing[0];
      // Un `start` sur une app déjà connue vaut redémarrage (comportement pm2).
      if (app.status === STATUS.ONLINE) {
        await app.restart();
        return { app: app.toJSON(), action: 'restarted' };
      }
      Object.assign(app.rawConfig, config);
      await app.start();
      return { app: app.toJSON(), action: 'started' };
    }

    const id = this.nextId;
    const app = new App(id, config, (a, text, kind, index) => this.broadcast(a, text, kind, index));
    this.nextId += 1;
    this.apps.set(id, app);
    try {
      await app.start();
    } catch (err) {
      return { app: app.toJSON(), action: 'errored', error: err.message };
    }
    return { app: app.toJSON(), action: 'started' };
  }

  async stop(target) {
    const apps = this.resolve(target);
    for (const app of apps) await app.stop();
    return apps.map((app) => app.toJSON());
  }

  async restart(target) {
    const apps = this.resolve(target);
    const results = [];
    for (const app of apps) {
      try {
        await app.restart();
      } catch (err) {
        results.push({ ...app.toJSON(), error: err.message });
        continue;
      }
      results.push(app.toJSON());
    }
    return results;
  }

  async reload(target) {
    const apps = this.resolve(target);
    for (const app of apps) await app.reload();
    return apps.map((app) => app.toJSON());
  }

  async remove(target) {
    const apps = this.resolve(target);
    for (const app of apps) {
      app.deleted = true;
      await app.stop();
      app.closeStreams();
      this.apps.delete(app.id);
    }
    return apps.map((app) => ({ id: app.id, name: app.config.name }));
  }

  async scale(target, count) {
    const apps = this.resolve(target);
    const out = [];
    for (const app of apps) {
      await app.scale(count);
      out.push(app.toJSON());
    }
    return out;
  }

  signal(target, sig) {
    const apps = this.resolve(target);
    return apps.map((app) => ({ name: app.config.name, sent: app.sendSignal(sig) }));
  }

  list() {
    return [...this.apps.values()].map((app) => app.toJSON());
  }

  flush(target) {
    const apps = this.resolve(target);
    const files = new Set();
    for (const app of apps) {
      app.closeStreams();
      for (const instance of app.instances) {
        files.add(app.logPath('out', instance.index));
        files.add(app.logPath('err', instance.index));
      }
    }
    for (const file of files) {
      try { fs.truncateSync(file, 0); } catch { /* fichier absent */ }
    }
    return { flushed: files.size };
  }

  /* -------------------------------------------------------- monitoring */

  async monitor() {
    const running = [];
    for (const app of this.apps.values()) {
      for (const instance of app.instances) {
        if (!instance.pid) {
          instance.cpu = 0;
          instance.memory = 0;
          continue;
        }
        const sampled = metrics.sample(instance.pid);
        if (sampled) {
          instance.cpu = sampled.cpu;
          instance.memory = sampled.memory;
        } else {
          running.push(instance);
        }
      }
    }

    if (running.length) {
      const table = await metrics.psSample(running.map((i) => i.pid));
      for (const instance of running) {
        const found = table.get(instance.pid);
        if (found) {
          instance.cpu = found.cpu;
          instance.memory = found.memory;
        }
      }
    }

    // max_memory_restart : on relance l'instance qui dépasse le seuil.
    for (const app of this.apps.values()) {
      const limit = app.config.maxMemoryRestart;
      if (!limit) continue;
      for (const instance of app.instances) {
        if (instance.status === STATUS.ONLINE && instance.memory > limit) {
          app.system(`mémoire ${formatBytes(instance.memory)} > ${formatBytes(limit)} → redémarrage de l'instance ${instance.index}`);
          instance.restarts += 1;
          await app.stopInstance(instance);
          await app.relaunch(instance);
        }
      }
    }
  }

  /* ------------------------------------------------------------- logs */

  addListener(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  broadcast(app, text, kind = 'out', index = 0) {
    if (!this.listeners.size) return;
    for (const listener of this.listeners) {
      listener({ name: app.config.name, id: app.id, kind, index, text });
    }
  }

  /* --------------------------------------------------- persistance */

  save() {
    const dump = [...this.apps.values()].map((app) => ({
      ...app.rawConfig,
      name: app.config.name,
      script: app.config.script,
      cwd: app.config.cwd,
      instances: app.config.instances,
    }));
    fs.mkdirSync(path.dirname(paths.DUMP), { recursive: true });
    fs.writeFileSync(paths.DUMP, JSON.stringify(dump, null, 2), { mode: 0o600 });
    return { saved: dump.length, file: paths.DUMP };
  }

  async resurrect() {
    if (!fs.existsSync(paths.DUMP)) return { restored: 0 };
    const dump = JSON.parse(fs.readFileSync(paths.DUMP, 'utf8'));
    let restored = 0;
    for (const config of dump) {
      try {
        await this.start(config);
        restored += 1;
      } catch { /* app invalide dans le dump : on continue */ }
    }
    return { restored };
  }

  async shutdown() {
    clearInterval(this.monitorTimer);
    for (const app of this.apps.values()) {
      app.deleted = true;
      await app.stop();
      app.closeStreams();
    }
  }
}

function formatBytes(bytes) {
  const units = ['o', 'Ko', 'Mo', 'Go'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

module.exports = { Manager, formatBytes };
