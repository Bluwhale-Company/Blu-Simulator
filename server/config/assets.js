const MARKET_ASSETS = Object.freeze([
  Object.freeze({
    symbol: 'BTC',
    pair: 'BTC-USD',
    name: 'Bitcoin',
    fallbackPrice: 68342.18,
    color: '#f5b74f',
  }),
  Object.freeze({
    symbol: 'ETH',
    pair: 'ETH-USD',
    name: 'Ethereum',
    fallbackPrice: 3648.91,
    color: '#8b9cff',
  }),
  Object.freeze({
    symbol: 'SOL',
    pair: 'SOL-USD',
    name: 'Solana',
    fallbackPrice: 172.64,
    color: '#75e6c4',
  }),
  Object.freeze({
    symbol: 'AVAX',
    pair: 'AVAX-USD',
    name: 'Avalanche',
    fallbackPrice: 38.27,
    color: '#f47178',
  }),
  Object.freeze({
    symbol: 'LINK',
    pair: 'LINK-USD',
    name: 'Chainlink',
    fallbackPrice: 17.82,
    color: '#5c8dff',
  }),
]);

module.exports = { MARKET_ASSETS };
