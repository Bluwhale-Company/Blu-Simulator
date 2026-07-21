function getHealth(request, response) {
  response.json({
    ok: true,
    mode: 'paper-trading',
    priceProvider: 'coinbase',
    requestId: request.requestId,
  });
}

module.exports = { getHealth };
