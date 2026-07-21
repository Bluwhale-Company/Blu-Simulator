const express = require('express');
const { createHealthRouter } = require('./healthRoutes');
const { createMarketRouter } = require('./marketRoutes');
const { requestContext } = require('../middleware/requestContext');
const { notFound } = require('../middleware/notFound');

function createApiRouter(container) {
  const router = express.Router();
  router.use(requestContext);
  router.use('/health', createHealthRouter());
  router.use('/market', createMarketRouter(container));
  router.use(notFound);
  return router;
}

module.exports = { createApiRouter };
