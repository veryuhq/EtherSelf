'use strict';
/**
 * Lecture des logs côté client : les fichiers sont écrits par le daemon,
 * on les lit directement (pas de streaming inutile dans le socket).
 */
const fs = require('fs');
const { color } = require('./format');

/** Renvoie les `count` dernières lignes d'un fichier, sans le charger entièrement. */
function lastLines(file, count) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return [];
  }
  try {
    const size = fs.fstatSync(fd).size;
    const chunkSize = 64 * 1024;
    let position = size;
    let text = '';
    while (position > 0 && text.split('\n').length <= count + 1) {
      const length = Math.min(chunkSize, position);
      position -= length;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, position);
      text = buffer.toString('utf8') + text;
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines.slice(-count);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Suit plusieurs fichiers façon `tail -f`.
 * @param {Array<{file: string, label: string, kind: 'out'|'err'}>} sources
 */
function follow(sources, { lines = 15, raw = false, onLine } = {}) {
  const emit = (source, line) => {
    if (onLine) return onLine(source, line);
    const tag = source.kind === 'err' ? color.red(`${source.label} (err)`) : color.green(source.label);
    process.stdout.write(raw ? `${line}\n` : `${tag} ${color.gray('|')} ${line}\n`);
  };

  const positions = new Map();

  for (const source of sources) {
    if (lines > 0) {
      for (const line of lastLines(source.file, lines)) emit(source, line);
    }
    try {
      positions.set(source.file, fs.statSync(source.file).size);
    } catch {
      positions.set(source.file, 0);
    }
  }

  const timer = setInterval(() => {
    for (const source of sources) {
      let size;
      try {
        size = fs.statSync(source.file).size;
      } catch {
        continue;
      }
      const previous = positions.get(source.file) ?? 0;
      if (size < previous) {
        // Fichier tronqué (`ppm flush`) : on repart du début.
        positions.set(source.file, 0);
        continue;
      }
      if (size === previous) continue;

      const fd = fs.openSync(source.file, 'r');
      const buffer = Buffer.alloc(size - previous);
      fs.readSync(fd, buffer, 0, buffer.length, previous);
      fs.closeSync(fd);
      positions.set(source.file, size);

      const text = buffer.toString('utf8');
      for (const line of text.split('\n')) {
        if (line !== '') emit(source, line);
      }
    }
  }, 250);

  return () => clearInterval(timer);
}

module.exports = { lastLines, follow };
