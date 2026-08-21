// Exemple volontairement instable : sert à observer les relances et max_restarts.
console.log(`[crash] démarrage (pid ${process.pid})`);
setTimeout(() => {
  console.error('[crash] boom');
  process.exit(1);
}, Number(process.env.CRASH_AFTER || 3000));
