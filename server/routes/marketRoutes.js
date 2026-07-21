const express = require('express');
const { createMarketController } = require('../controllers/marketController');

function createMarketRouter(container) {
  const router = express.Router();
  const controller = createMarketController(container);
  router.get('/bootstrap', controller.getBootstrap);
  return router;
}

module.exports = { createMarketRouter };
