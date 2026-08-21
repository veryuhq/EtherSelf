// Quatre langages, un seul fichier de configuration.
module.exports = {
  apps: [
    {
      name: 'api-js',
      script: './server.js',
      instances: 2,
      exec_mode: 'cluster',
      env: { PORT: '3010' },
    },
    {
      name: 'ticker-ts',
      script: './ticker.ts',
      env: { LABEL: 'demo' },
    },
    {
      name: 'worker-py',
      script: './worker.py',
      env: { QUEUE: 'emails' },
      max_memory_restart: '200M',
    },
    {
      name: 'heartbeat-rs',
      script: './rust-app',
      env: { HEARTBEAT_NAME: 'demo' },
    },
  ],
};
