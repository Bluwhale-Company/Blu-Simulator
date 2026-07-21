'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createApp } = require('../server/app');

function startTestServer() {
  const payload = {
    market: 'NEXA-SIM',
    currency: 'USD',
    source: 'coinbase',
    provider: 'Coinbase Spot',
    assets: [{ symbol: 'BTC', basePrice: 70000 }],
  };
  const app = createApp({
    config: {
      environment: 'test',
      distPath: path.join(__dirname, 'missing-dist'),
    },
    container: {
      marketBootstrapService: {
        async getBootstrap() {
          return payload;
        },
      },
    },
  });
  const server = app.listen(0);
  return { server, payload };
}

test('health and market bootstrap routes expose the layered API', async (context) => {
  const { server, payload } = startTestServer();
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.has('x-request-id'), true);
  assert.equal((await healthResponse.json()).priceProvider, 'coinbase');

  const marketResponse = await fetch(`http://127.0.0.1:${port}/api/market/bootstrap`);
  assert.equal(marketResponse.status, 200);
  assert.deepEqual(await marketResponse.json(), payload);
});

test('unknown API routes return structured JSON instead of the React document', async (context) => {
  const { server } = startTestServer();
  context.after(() => new Promise((resolve) => server.close(resolve)));
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error, 'API route not found.');
  assert.equal(typeof body.requestId, 'string');
});
