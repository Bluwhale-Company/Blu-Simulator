const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const devPort = Number(process.env.DEV_PORT) || 3000;
const apiPort = Number(process.env.API_PORT || process.env.PORT) || 3001;
const apiOrigin = process.env.API_ORIGIN || `http://127.0.0.1:${apiPort}`;

module.exports = {
  entry: path.resolve(__dirname, 'src/index.jsx'),
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'assets/[name].[contenthash].js',
    clean: true,
    publicPath: '/',
  },
  resolve: {
    extensions: ['.js', '.jsx', '.cjs'],
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: 'defaults' }],
              ['@babel/preset-react', { runtime: 'automatic' }],
            ],
          },
        },
      },
      {
        test: /\.css$/i,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
    }),
  ],
  devServer: {
    host: process.env.DEV_HOST || '0.0.0.0',
    port: devPort,
    hot: true,
    historyApiFallback: true,
    client: { overlay: true },
    proxy: [
      {
        context: ['/api'],
        target: apiOrigin,
      },
    ],
  },
  performance: { hints: false },
};
