function errorHandler(error, request, response, _next) {
  const status = Number.isInteger(error.status) ? error.status : 500;

  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${request.requestId || 'unknown'}]`, error);
  }

  response.status(status).json({
    error: status === 500 ? 'Unexpected server error.' : error.message,
    requestId: request.requestId,
  });
}

module.exports = { errorHandler };
