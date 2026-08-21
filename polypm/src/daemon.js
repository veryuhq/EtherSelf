'use strict';
/**
 * Le daemon : un seul process qui détient toutes les apps supervisées.
 * Il écoute sur un socket unix (ou un named pipe sous Windows) et n'est
 * jamais lancé à la main — le CLI le démarre à la demande.
 */
const fs = require('fs');
const net = require('net');
const paths = require('./paths');
const { Manager } = require('./manager');
const { createParser, send } = require('./protocol');

function startDaemon() {
  paths.ensureDirs();
  const manager = new Manager();
  const clients = new Set();

  const handlers = {
    ping: () => ({ pong: true, pid: process.pid, version: require('../package.json').version }),
    start: (args) => manager.start(args.config),
    list: () => manager.list(),
    describe: (args) => manager.resolve(args.target).map((app) => app.toJSON()),
    stop: (args) => manager.stop(args.target),
    restart: (args) => manager.restart(args.target),
    reload: (args) => manager.reload(args.target),
    delete: (args) => manager.remove(args.target),
    scale: (args) => manager.scale(args.target, args.count),
    signal: (args) => manager.signal(args.target, args.signal),
    flush: (args) => manager.flush(args.target),
    save: () => manager.save(),
    resurrect: () => manager.resurrect(),
    logfiles: (args) => manager.resolve(args.target).flatMap((app) =>
      app.instances.map((instance) => ({
        name: app.config.name,
        index: instance.index,
        out: app.logPath('out', instance.index),
        err: app.logPath('err', instance.index),
      }))
    ),
    kill: async () => {
      // On ferme l'écoute tout de suite : plus aucun client ne peut arriver
      // pendant l'arrêt des applications, et le socket est libéré sans attendre.
      setTimeout(async () => {
        server.close();
        await manager.shutdown();
        cleanup();
        process.exit(0);
      }, 50);
      return { killed: true };
    },
  };

  const server = net.createServer((socket) => {
    clients.add(socket);
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      clients.delete(socket);
      if (socket.unsubscribe) socket.unsubscribe();
    });

    const parse = createParser(async (message) => {
      const { id, cmd, args = {} } = message;

      if (cmd === 'subscribe') {
        // Flux de logs live : le daemon pousse chaque ligne au client.
        const wanted = args.target && args.target !== 'all' ? new Set(manager.resolve(args.target).map((a) => a.id)) : null;
        socket.unsubscribe = manager.addListener((event) => {
          if (wanted && !wanted.has(event.id)) return;
          send(socket, { event: 'log', data: event });
        });
        return send(socket, { id, ok: true, data: { subscribed: true } });
      }

      const handler = handlers[cmd];
      if (!handler) return send(socket, { id, ok: false, error: `commande inconnue : ${cmd}` });
      try {
        const data = await handler(args);
        send(socket, { id, ok: true, data });
      } catch (err) {
        send(socket, { id, ok: false, error: err && err.message ? err.message : String(err) });
      }
    });

    socket.on('data', parse);
  });

  // On ne nettoie que ce qu'on a soi-même créé : un daemon en train de s'éteindre
  // ne doit jamais supprimer le socket d'un daemon plus récent.
  let owned = false;

  function cleanup() {
    try {
      if (fs.readFileSync(paths.DAEMON_PID, 'utf8').trim() === String(process.pid)) {
        fs.unlinkSync(paths.DAEMON_PID);
      }
    } catch { /* fichier absent ou appartenant à un autre daemon */ }
    if (owned && process.platform !== 'win32') {
      try { fs.unlinkSync(paths.SOCKET); } catch { /* déjà supprimé */ }
    }
    owned = false;
  }

  /** Un socket peut survivre à un crash : on vérifie s'il répond avant de le retirer. */
  function socketAlive() {
    return new Promise((resolve) => {
      if (process.platform !== 'win32' && !fs.existsSync(paths.SOCKET)) return resolve(false);
      const probe = net.createConnection(paths.SOCKET);
      const settle = (alive) => {
        probe.destroy();
        resolve(alive);
      };
      probe.once('connect', () => settle(true));
      probe.once('error', () => settle(false));
      const timer = setTimeout(() => settle(false), 1000);
      timer.unref();
    });
  }

  (async () => {
    if (await socketAlive()) {
      process.stdout.write('[polypm] un daemon écoute déjà, celui-ci s\'arrête\n');
      process.exit(0);
    }
    if (process.platform !== 'win32' && fs.existsSync(paths.SOCKET)) {
      try { fs.unlinkSync(paths.SOCKET); } catch { /* socket mort, ignoré */ }
    }
    server.listen(paths.SOCKET, () => {
      owned = true;
      fs.writeFileSync(paths.DAEMON_PID, String(process.pid));
      if (process.platform !== 'win32') fs.chmodSync(paths.SOCKET, 0o600);
      process.stdout.write(`[polypm] daemon prêt (pid ${process.pid}) sur ${paths.SOCKET}\n`);
      if (process.send) process.send('ready');
    });
  })();

  server.on('error', (err) => {
    process.stderr.write(`[polypm] erreur du daemon : ${err.message}\n`);
    process.exit(1);
  });

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, async () => {
      await manager.shutdown();
      cleanup();
      process.exit(0);
    });
  }

  process.on('uncaughtException', (err) => {
    process.stderr.write(`[polypm] exception non gérée : ${err.stack || err}\n`);
  });

  return { server, manager };
}

if (require.main === module) startDaemon();

module.exports = { startDaemon };
