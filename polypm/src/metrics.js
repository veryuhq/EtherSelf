'use strict';
/**
 * Mesure CPU / mémoire d'un processus supervisé.
 * Linux : lecture directe de /proc (rapide, sans fork).
 * Ailleurs : repli sur `ps`, échantillonné moins souvent.
 */
const fs = require('fs');
const { execFile } = require('child_process');

const CLOCK_TICK = 100; // getconf CLK_TCK vaut 100 sur toutes les plateformes courantes
const previous = new Map(); // pid → { ticks, at }

function readProcLinux(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
  // Le nom du process peut contenir des espaces ou des parenthèses : on coupe après le dernier ')'.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
  const utime = Number(fields[11]);
  const stime = Number(fields[12]);
  const rssPages = Number(fields[21]);
  return {
    ticks: utime + stime,
    memory: rssPages * 4096,
  };
}

/** Renvoie { cpu, memory } — cpu en %, memory en octets. Jamais d'exception. */
function sample(pid) {
  if (!pid) return { cpu: 0, memory: 0 };
  try {
    if (process.platform === 'linux') {
      const now = Date.now();
      const current = readProcLinux(pid);
      const last = previous.get(pid);
      previous.set(pid, { ticks: current.ticks, at: now });
      let cpu = 0;
      if (last && now > last.at) {
        const elapsedTicks = ((now - last.at) / 1000) * CLOCK_TICK;
        cpu = elapsedTicks > 0 ? ((current.ticks - last.ticks) / elapsedTicks) * 100 : 0;
      }
      return { cpu: Math.max(0, Math.round(cpu * 10) / 10), memory: current.memory };
    }
  } catch {
    previous.delete(pid);
  }
  return null; // signale à l'appelant qu'il faut passer par psSample()
}

/** Repli asynchrone via `ps` (macOS, BSD…). */
function psSample(pids) {
  return new Promise((resolve) => {
    if (!pids.length || process.platform === 'win32') return resolve(new Map());
    execFile('ps', ['-o', 'pid=,rss=,%cpu=', '-p', pids.join(',')], (err, stdout) => {
      const out = new Map();
      if (err || !stdout) return resolve(out);
      for (const line of stdout.trim().split('\n')) {
        const [pid, rss, cpu] = line.trim().split(/\s+/);
        out.set(Number(pid), { cpu: Number(cpu) || 0, memory: (Number(rss) || 0) * 1024 });
      }
      resolve(out);
    });
  });
}

function forget(pid) {
  previous.delete(pid);
}

module.exports = { sample, psSample, forget };
