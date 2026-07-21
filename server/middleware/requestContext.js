const { randomUUID } = require('crypto');

function requestContext(request, response, next) {
  request.requestId = request.get('x-request-id') || randomUUID();
  response.set('x-request-id', request.requestId);
  next();
}

module.exports = { requestContext };
