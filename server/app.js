const express = require('express');
const fs = require('fs');
const helmet = require('helmet');
const path = require('path');
const config = require('./config/environment');
const { createApplicationContainer } = require('./container');
const { createApiRouter } = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { openDatabase } = require("react-mongoose");

function createApp(options = {}) {
  const appConfig = options.config || config;
  const container = options.container || createApplicationContainer({ config: appConfig });
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/api', createApiRouter(container));
  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );

  // openDatabase();

  if (fs.existsSync(appConfig.distPath)) {
    app.use(express.static(appConfig.distPath, { index: false }));
    app.get('*', (_request, response) => {
      response.sendFile(path.join(appConfig.distPath, 'index.html'));
    });
  } else {
    app.get('/', (_request, response) => {
      response
        .status(503)
        .type('text')
        .send('WynnSimulator has not been built. Run "npm run build", then restart the server.');
    });
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
