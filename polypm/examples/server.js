// Exemple JavaScript : un serveur HTTP qui partage son port entre instances (mode cluster).
const http = require('http');

const port = Number(process.env.PORT || 3000);
const instance = process.env.POLYPM_INSTANCE_ID ?? '0';

http
  .createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ hello: 'javascript', instance, pid: process.pid }));
  })
  .listen(port, () => console.log(`[js] instance ${instance} écoute sur :${port} (pid ${process.pid})`));

process.on('SIGINT', () => {
  console.log(`[js] instance ${instance} : arrêt propre`);
  process.exit(0);
});
