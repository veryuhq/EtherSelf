// Serveur minimal : répond son pid, pour vérifier l'équilibrage entre workers.
const http = require('http');

const port = Number(process.env.PORT || 3941);
http
  .createServer((req, res) => res.end(String(process.pid)))
  .listen(port, () => console.log(`http-ready ${process.pid}`));
