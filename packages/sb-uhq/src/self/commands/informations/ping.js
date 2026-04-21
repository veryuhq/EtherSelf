"use strict";

async function execute(client) {
  return { ping: client.ws.ping };
}

module.exports = { name: "ping", execute };
