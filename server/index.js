const { createApp } = require('./app');
const config = require('./config/environment');

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Nexa simulator server listening on http://localhost:${config.port}`);
});

function shutdown(signal) {
  console.log(`${signal} received; closing Nexa server.`);
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

module.exports = server;
