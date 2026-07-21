function notFound(request, response) {
  response.status(404).json({
    error: 'API route not found.',
    path: request.originalUrl,
    requestId: request.requestId,
  });
}

module.exports = { notFound };
