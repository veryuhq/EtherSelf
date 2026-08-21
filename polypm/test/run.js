'use strict';
/**
 * Suite de tests bout-en-bout : elle démarre un vrai daemon dans un POLYPM_HOME
 * temporaire et supervise de vraies applications dans les quatre langages.
 *
 *   node test/run.js            (ajoute --keep pour conserver le dossier de travail)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'polypm-test-'));
process.env.POLYPM_HOME = HOME;

const paths = require('../src/paths');
const { Client } = require('../src/client');
const { which } = require('../src/runtimes');
const { lastLines } = require('../src/tail');

const FIXTURES = path.join(__dirname, 'fixtures');
const CLI = path.join(__dirname, '..', 'bin', 'ppm.js');

let client;
let passed = 0;
let failed = 0;
const skipped = [];

/* ------------------------------------------------------------- outils */

async function test(title, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${title}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${title}`);
    console.log(`       ${err.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attend qu'une condition devienne vraie, sinon échoue avec un message parlant. */
async function waitFor(description, predicate, timeout = 20000, interval = 150) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await predicate();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`délai dépassé en attendant : ${description}`);
    await sleep(interval);
  }
}

async function app(name) {
  const apps = await client.request('describe', { target: name });
  return apps[0];
}

/** Attend qu'un texte apparaisse dans les logs d'une application. */
function waitForLog(name, needle, timeout = 20000) {
  return waitFor(`« ${needle} » dans les logs de ${name}`, async () => {
    const files = await client.request('logfiles', { target: name });
    for (const entry of files) {
      for (const file of [entry.out, entry.err]) {
        if (lastLines(file, 200).some((line) => line.includes(needle))) return true;
      }
    }
    return false;
  }, timeout);
}

function cli(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...process.env, NO_COLOR: '1' } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr });
    });
  });
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    // agent: false → une connexion neuve par requête, sinon le keep-alive de Node
    // renverrait tout le trafic vers le même worker et masquerait l'équilibrage.
    http.get(url, { agent: false }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

/* -------------------------------------------------------------- suites */

async function runtimeTests() {
  console.log('\nruntimes');

  await test('JavaScript : démarre et journalise', async () => {
    await client.request('start', { config: { name: 't-js', script: path.join(FIXTURES, 'hello.js') } });
    await waitForLog('t-js', 'hello-from-js');
    assert.strictEqual((await app('t-js')).runtime, 'node');
    assert.ok((await app('t-js')).instances[0].pid > 0, 'pid attendu');
  });

  await test('TypeScript : démarre via le loader disponible', async () => {
    await client.request('start', { config: { name: 't-ts', script: path.join(FIXTURES, 'hello.ts') } });
    await waitForLog('t-ts', 'hello-from-ts', 30000);
    assert.strictEqual((await app('t-ts')).runtime, 'typescript');
  });

  await test('Python : démarre avec sortie non bufferisée', async () => {
    await client.request('start', { config: { name: 't-py', script: path.join(FIXTURES, 'hello.py') } });
    await waitForLog('t-py', 'hello-from-python');
    assert.strictEqual((await app('t-py')).runtime, 'python');
  });

  if (!which('rustc')) {
    skipped.push('Rust (rustc absent)');
  } else {
    await test('Rust : compile un .rs isolé puis supervise le binaire', async () => {
      await client.request('start', { config: { name: 't-rs', script: path.join(FIXTURES, 'hello.rs') } });
      await waitForLog('t-rs', 'hello-from-rust', 60000);
      const started = await app('t-rs');
      assert.strictEqual(started.runtime, 'rust');
      // Le process supervisé est le binaire compilé, pas rustc ni cargo.
      assert.ok(started.command.includes(paths.BUILD), `binaire attendu dans le cache : ${started.command}`);
    });
  }

  await test('runtime forcé : --interpreter court-circuite la détection', async () => {
    await client.request('start', {
      config: { name: 't-interp', script: path.join(FIXTURES, 'hello.py'), interpreter: which('python3') },
    });
    await waitForLog('t-interp', 'hello-from-python');
  });
}

async function lifecycleTests() {
  console.log('\ncycle de vie');

  await test('env et arguments arrivent jusqu\'au process', async () => {
    await client.request('start', {
      config: {
        name: 't-env',
        script: path.join(FIXTURES, 'env-echo.js'),
        env: { MY_VALUE: 'quarante-deux' },
        args: ['a', 'b'],
      },
    });
    await waitForLog('t-env', 'env:quarante-deux:args:a,b');
  });

  await test('restart incrémente le compteur et change le pid', async () => {
    const before = await app('t-js');
    await client.request('restart', { target: 't-js' });
    const after = await waitFor('t-js de nouveau en ligne', async () => {
      const current = await app('t-js');
      return current.status === 'online' ? current : null;
    });
    assert.notStrictEqual(after.instances[0].pid, before.instances[0].pid, 'nouveau pid attendu');
    assert.ok(after.totalRestarts > before.totalRestarts, 'compteur de redémarrages attendu');
  });

  await test('stop laisse l\'application arrêtée, sans process', async () => {
    await client.request('stop', { target: 't-py' });
    const stopped = await app('t-py');
    assert.strictEqual(stopped.status, 'stopped');
    assert.strictEqual(stopped.instances[0].pid, null);
  });

  await test('start relance une application arrêtée', async () => {
    await client.request('start', { config: { name: 't-py', script: path.join(FIXTURES, 'hello.py') } });
    await waitFor('t-py en ligne', async () => (await app('t-py')).status === 'online');
  });

  await test('delete arrête et oublie l\'application', async () => {
    await client.request('start', { config: { name: 't-temp', script: path.join(FIXTURES, 'hello.js') } });
    const pid = (await app('t-temp')).instances[0].pid;
    await client.request('delete', { target: 't-temp' });
    assert.strictEqual(await app('t-temp'), undefined);
    await waitFor('process réellement tué', () => !isAlive(pid));
  });

  await test('signal envoie bien le signal demandé', async () => {
    const results = await client.request('signal', { target: 't-js', signal: 'SIGUSR2' });
    assert.strictEqual(results[0].sent, 1);
  });
}

async function restartPolicyTests() {
  console.log('\npolitique de relance');

  await test('autorestart relance un process qui plante', async () => {
    await client.request('start', {
      config: { name: 't-crash', script: path.join(FIXTURES, 'crasher.js'), min_uptime: 5000, max_restarts: 3, restart_delay: 50 },
    });
    await waitFor('au moins 2 relances', async () => (await app('t-crash')).totalRestarts >= 2);
  });

  await test('max_restarts finit par mettre l\'application en erreur', async () => {
    const errored = await waitFor('t-crash en erreur', async () => {
      const current = await app('t-crash');
      return current.status === 'errored' ? current : null;
    }, 20000);
    assert.strictEqual(errored.status, 'errored');
    assert.ok(errored.totalRestarts >= 3, `relances attendues, vu ${errored.totalRestarts}`);
  });

  await test('--no-autorestart laisse le process mort', async () => {
    await client.request('start', {
      config: { name: 't-once', script: path.join(FIXTURES, 'crasher.js'), autorestart: false },
    });
    await waitFor('t-once terminé', async () => (await app('t-once')).status === 'errored');
    await sleep(600);
    assert.strictEqual((await app('t-once')).totalRestarts, 0, 'aucune relance attendue');
  });

  await test('un script inexistant remonte une erreur claire', async () => {
    const result = await client.request('start', {
      config: { name: 't-missing', script: path.join(FIXTURES, 'nope.js'), autorestart: false },
    });
    await waitFor('t-missing en erreur', async () => (await app('t-missing')).status === 'errored');
    assert.ok(result.app, 'une app est tout de même enregistrée');
  });
}

async function clusterTests() {
  console.log('\ncluster et scale');

  const port = 3941;
  const server = path.join(FIXTURES, 'http.js');

  await test('mode cluster : plusieurs workers partagent le port', async () => {
    await client.request('start', {
      config: { name: 't-cluster', script: server, instances: 2, exec_mode: 'cluster', env: { PORT: String(port) } },
    });
    await waitFor('2 instances en ligne', async () => {
      const current = await app('t-cluster');
      return current.instances.filter((i) => i.status === 'online' && i.pid).length === 2;
    });
    assert.strictEqual((await app('t-cluster')).execMode, 'cluster');
    // « online » veut dire « lancé » : on attend que les deux workers écoutent vraiment.
    await waitFor('les 2 workers écoutent', async () => {
      const files = await client.request('logfiles', { target: 't-cluster' });
      const ready = new Set();
      for (const line of lastLines(files[0].out, 200)) {
        if (line.includes('http-ready')) ready.add(line.trim());
      }
      return ready.size >= 2;
    });

    const seen = new Set();
    for (let i = 0; i < 12; i += 1) seen.add(await httpGet(`http://127.0.0.1:${port}/`));
    assert.ok(seen.size >= 2, `le trafic doit toucher plusieurs workers (vu ${seen.size})`);
  });

  await test('scale ajoute puis retire des instances à chaud', async () => {
    await client.request('scale', { target: 't-cluster', count: 3 });
    await waitFor('3 instances', async () => (await app('t-cluster')).instances.length === 3);
    await client.request('scale', { target: 't-cluster', count: 1 });
    const scaled = await app('t-cluster');
    assert.strictEqual(scaled.instances.length, 1);
    const answer = await waitFor('le worker restant répond', async () => {
      try {
        return await httpGet(`http://127.0.0.1:${port}/`);
      } catch {
        return null;
      }
    });
    assert.strictEqual(answer, String(scaled.instances[0].pid));
  });

  await test('reload redémarre sans laisser le port sans écouteur', async () => {
    await client.request('reload', { target: 't-cluster' });
    await waitFor('service de nouveau joignable', async () => {
      try {
        return Boolean(await httpGet(`http://127.0.0.1:${port}/`));
      } catch {
        return false;
      }
    });
  });

  await test('un runtime non clusterisable retombe en fork', async () => {
    await client.request('start', {
      config: { name: 't-py-cluster', script: path.join(FIXTURES, 'hello.py'), instances: 2, exec_mode: 'cluster' },
    });
    const forked = await waitFor('2 process python', async () => {
      const current = await app('t-py-cluster');
      return current.instances.every((i) => i.pid) ? current : null;
    });
    assert.strictEqual(forked.execMode, 'fork');
    assert.strictEqual(forked.instances.length, 2);
  });
}

async function watchTests() {
  console.log('\nwatch');

  await test('une modification de fichier déclenche un redémarrage', async () => {
    const dir = fs.mkdtempSync(path.join(HOME, 'watch-'));
    const script = path.join(dir, 'watched.js');
    fs.copyFileSync(path.join(FIXTURES, 'watched.js'), script);

    await client.request('start', { config: { name: 't-watch', script, watch: [dir] } });
    await waitFor('t-watch en ligne', async () => (await app('t-watch')).status === 'online');
    const before = (await app('t-watch')).instances[0].pid;

    await sleep(300);
    fs.appendFileSync(script, '\n// touch\n');

    const after = await waitFor('redémarrage après modification', async () => {
      const current = await app('t-watch');
      const pid = current.instances[0].pid;
      return pid && pid !== before ? pid : null;
    }, 15000);
    assert.notStrictEqual(after, before);
  });
}

async function persistenceTests() {
  console.log('\npersistance et logs');

  await test('save écrit un dump réutilisable', async () => {
    const result = await client.request('save');
    assert.ok(result.saved > 0);
    const dump = JSON.parse(fs.readFileSync(paths.DUMP, 'utf8'));
    assert.ok(dump.some((entry) => entry.name === 't-js'));
    assert.strictEqual(fs.statSync(paths.DUMP).mode & 0o777, 0o600, 'le dump doit rester privé');
  });

  await test('resurrect relance les applications du dump', async () => {
    await client.request('delete', { target: 'all' });
    assert.strictEqual((await client.request('list')).length, 0);
    const result = await client.request('resurrect');
    assert.ok(result.restored > 0);
    await waitFor('t-js de nouveau en ligne', async () => (await app('t-js')).status === 'online');
  });

  await test('flush vide les fichiers de logs', async () => {
    await waitForLog('t-js', 'hello-from-js');
    await client.request('flush', { target: 't-js' });
    const files = await client.request('logfiles', { target: 't-js' });
    assert.strictEqual(fs.statSync(files[0].out).size, 0);
  });

  await test('les logs sont horodatés avec time: true', async () => {
    await client.request('start', {
      config: { name: 't-time', script: path.join(FIXTURES, 'hello.js'), time: true },
    });
    await waitForLog('t-time', 'hello-from-js');
    const files = await client.request('logfiles', { target: 't-time' });
    const line = lastLines(files[0].out, 20).find((l) => l.includes('hello-from-js'));
    assert.match(line, /^\d{4}-\d{2}-\d{2}T/, `ligne horodatée attendue, vu : ${line}`);
  });
}

async function cliTests() {
  console.log('\ninterface en ligne de commande');

  await test('ppm list affiche les applications', async () => {
    const result = await cli(['list']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /t-js/);
  });

  await test('ppm describe détaille une application', async () => {
    const result = await cli(['describe', 't-js']);
    assert.match(result.stdout, /runtime/);
    assert.match(result.stdout, /node/);
  });

  await test('ppm logs --nostream rend la main', async () => {
    const result = await cli(['logs', 't-py', '--nostream', '-l', '5']);
    assert.strictEqual(result.code, 0);
    assert.match(result.stdout, /hello-from-python/);
  });

  await test('ppm start accepte un fichier ecosystem', async () => {
    const config = path.join(HOME, 'ecosystem.config.json');
    fs.writeFileSync(config, JSON.stringify({
      apps: [{ name: 't-eco', script: path.join(FIXTURES, 'hello.js') }],
    }));
    const result = await cli(['start', config]);
    assert.match(result.stdout, /t-eco/);
    await waitFor('t-eco en ligne', async () => (await app('t-eco')).status === 'online');
  });

  await test('ppm runtimes liste les langages supportés', async () => {
    const result = await cli(['runtimes']);
    for (const runtime of ['node', 'typescript', 'python', 'rust']) {
      assert.match(result.stdout, new RegExp(runtime));
    }
  });

  await test('une commande inconnue échoue proprement', async () => {
    const result = await cli(['pouet']);
    assert.strictEqual(result.code, 1);
    assert.match(result.stderr + result.stdout, /commande inconnue/);
  });

  await test('ppm --version affiche la version', async () => {
    const result = await cli(['--version']);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
  });
}

async function shutdownTests() {
  console.log('\narrêt');

  await test('ppm kill arrête le daemon et tous les process', async () => {
    const apps = await client.request('list');
    const pids = apps.flatMap((a) => a.instances.map((i) => i.pid)).filter(Boolean);
    assert.ok(pids.length > 0, 'des process doivent tourner avant le kill');
    client.close();

    await cli(['kill']);
    await waitFor('tous les process arrêtés', () => pids.every((pid) => !isAlive(pid)), 15000);
    await waitFor('socket libéré', () => !fs.existsSync(paths.SOCKET), 10000);
  });
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/* ---------------------------------------------------------------- main */

(async () => {
  console.log(`polypm — tests bout-en-bout (POLYPM_HOME=${HOME})`);
  client = new Client();
  await client.connect();

  try {
    await runtimeTests();
    await lifecycleTests();
    await restartPolicyTests();
    await clusterTests();
    await watchTests();
    await persistenceTests();
    await cliTests();
    await shutdownTests();
  } finally {
    try {
      client.close();
    } catch { /* déjà fermé */ }
    await cli(['kill']).catch(() => {});
    if (!process.argv.includes('--keep')) fs.rmSync(HOME, { recursive: true, force: true });
  }

  console.log(`\n${passed} réussis, ${failed} échoués${skipped.length ? `, ignorés : ${skipped.join(', ')}` : ''}`);
  process.exit(failed ? 1 : 0);
})();
