function createMarketController({ marketBootstrapService }) {
  return {
    async getBootstrap(request, response, next) {
      try {
        const payload = await marketBootstrapService.getBootstrap({
          force: request.query.refresh === 'true',
        });
        response.set('Cache-Control', 'no-store');
        response.json(payload);
      } catch (error) {
        next(error);
      }
    },
  };
}

module.exports = { createMarketController };
