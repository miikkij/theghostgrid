'use strict';

const pino = require('pino');
const config = require('./config');

const transport = process.stdout.isTTY
  ? { target: 'pino-pretty', options: { colorize: true } }
  : undefined;

const log = pino({
  level: config.log.level,
  transport,
});

module.exports = log;
