'use strict';
/** Rendu terminal : couleurs, tableaux, durées, tailles. */

const CSI = '\u001b[';
const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';

const codes = {
  reset: 0, bold: 1, dim: 2,
  red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, gray: 90,
};

const color = {};
for (const [name, code] of Object.entries(codes)) {
  color[name] = (text) => (useColor ? `${CSI}${code}m${text}${CSI}0m` : String(text));
}

const STATUS_COLORS = {
  online: color.green,
  stopped: color.gray,
  errored: color.red,
  launching: color.cyan,
  building: color.cyan,
  stopping: color.yellow,
  'waiting restart': color.yellow,
};

function colorStatus(status) {
  return (STATUS_COLORS[status] || color.reset)(status);
}

const RUNTIME_COLORS = {
  node: color.yellow,
  typescript: color.blue,
  python: color.cyan,
  rust: color.magenta,
  shell: color.gray,
  binary: color.gray,
};

function colorRuntime(runtime, label) {
  return (RUNTIME_COLORS[runtime] || color.reset)(label || runtime);
}

/** Longueur visible : ignore les séquences ANSI. */
function width(text) {
  // eslint-disable-next-line no-control-regex
  return String(text).replace(/\u001b\[\d+m/g, '').length;
}

function pad(text, size, align = 'left') {
  const missing = Math.max(0, size - width(text));
  return align === 'right' ? ' '.repeat(missing) + text : text + ' '.repeat(missing);
}

/**
 * Tableau encadré.
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 * @param {Array<'left'|'right'>} aligns
 */
function table(headers, rows, aligns = []) {
  const widths = headers.map((header, i) =>
    Math.max(width(header), ...rows.map((row) => width(row[i] ?? '')))
  );
  const line = (left, mid, right) => color.gray(left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right);
  const render = (cells) =>
    color.gray('│') +
    cells.map((cell, i) => ` ${pad(cell ?? '', widths[i], aligns[i])} `).join(color.gray('│')) +
    color.gray('│');

  const out = [line('┌', '┬', '┐'), render(headers.map((h) => color.bold(h))), line('├', '┼', '┤')];
  for (const row of rows) out.push(render(row));
  out.push(line('└', '┴', '┘'));
  return out.join('\n');
}

function bytes(value) {
  if (!value) return '0b';
  const units = ['b', 'kb', 'mb', 'gb', 'tb'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size < 10 && unit > 0 ? 1 : 0)}${units[unit]}`;
}

function duration(ms) {
  if (!ms || ms < 0) return '0s';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}D`;
}

/** Efface l'écran (utilisé par `monit`). */
function clearScreen() {
  process.stdout.write(`${CSI}2J${CSI}H`);
}

module.exports = { color, colorStatus, colorRuntime, table, bytes, duration, width, pad, useColor, clearScreen, CSI };
