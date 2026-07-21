const express = require('express');
const { getHealth } = require('../controllers/healthController');

function createHealthRouter() {
  const router = express.Router();
  router.get('/', getHealth);
  return router;
}

module.exports = { createHealthRouter };
