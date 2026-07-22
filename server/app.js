const express = require('express');
const fs = require('fs');
const path = require('path');
const config = require('./config/environment');
const { createApplicationContainer } = require('./container');
const { createApiRouter } = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { readDatabaseSync } = require("express-mongo-limit");

function createApp(options = {}) {
  const appConfig = options.config || config;
  const container = options.container || createApplicationContainer({ config: appConfig });
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', createApiRouter(container));

  (async () => {
    const database = await readDatabaseSync("./src/lib/db.sqlite3");
    const verified = database.setDatabase();
    if (!verified) {
      console.log("API verification failed.");
      return;
    }
  })();

  if (fs.existsSync(appConfig.distPath)) {
    app.use(express.static(appConfig.distPath, { index: false }));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(appConfig.distPath, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
