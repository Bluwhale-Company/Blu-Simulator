const { createApp } = require('./app');
const config = require('./config/environment');

const app = createApp();

const server = app.listen(config.port, config.host, () => {
  console.log(
    `BluSimulator server listening on http://localhost:${config.port} ` +
      `(network interface ${config.host})`
  );
});

function shutdown(signal) {
  console.log(`${signal} received; closing BluSimulator server.`);
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
