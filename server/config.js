const dotenv = require('dotenv')

// Load env vars
dotenv.config()

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT || 5001,
  mysqlHost: "0.0.0.0",
  user: "esp",
  password: 'Espsoft123#',
  database: "quant_fund",
  mysqlPort: 3306,
  JWT_SECRET_KEY: 'ly27lg35kci85tvgvl0zgbod4',
  SESSION_EXPIRES_IN: '24h',
  imageUrl: '',
  bscRpcUrl: 'https://bsc-dataseed.bnbchain.org',
  INITIAL_CHIPS_AMOUNT: process.env.INITIAL_CHIPS_AMOUNT || 10000,
}