'use strict';
/**
 * Protocole IPC : JSON délimité par des sauts de ligne sur le socket.
 * Requête  : { id, cmd, args }
 * Réponse  : { id, ok, data } | { id, ok: false, error }
 * Événement: { event, data }   (poussé par le daemon, sans id)
 */

/** Découpe un flux en messages JSON complets. */
function createParser(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) {
        try {
          onMessage(JSON.parse(line));
        } catch {
          // Ligne corrompue : on l'ignore plutôt que de tuer la connexion.
        }
      }
      index = buffer.indexOf('\n');
    }
  };
}

function send(socket, payload) {
  if (socket.destroyed) return;
  socket.write(`${JSON.stringify(payload)}\n`);
}

module.exports = { createParser, send };
