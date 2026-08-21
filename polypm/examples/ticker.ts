// Exemple TypeScript : types réels, exécuté par tsx / ts-node / node --experimental-strip-types.
interface Tick {
  readonly seq: number;
  readonly at: string;
}

const label: string = process.env.LABEL ?? 'ticker';
let seq = 0;

function emit(): Tick {
  const tick: Tick = { seq: (seq += 1), at: new Date().toISOString() };
  console.log(`[ts] ${label} #${tick.seq} à ${tick.at}`);
  return tick;
}

emit();
const timer = setInterval(emit, 2000);

process.on('SIGINT', () => {
  clearInterval(timer);
  console.log(`[ts] ${label} : arrêt propre après ${seq} ticks`);
  process.exit(0);
});
