'use strict';

const express = require('express');
const path = require('path');
const cors = require('cors');
const { state } = require('./state');
const log = require('./log').child({ component: 'http' });

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use((req, _res, next) => {
    log.debug({ method: req.method, url: req.url }, 'request');
    next();
  });

  // --- Page routes ---

  const clientDir = path.join(__dirname, '..', 'client');

  app.get('/', (_req, res) => {
    res.sendFile(path.join(clientDir, 'landing', 'index.html'));
  });

  app.get('/screen', (_req, res) => {
    res.sendFile(path.join(clientDir, 'screen', 'index.html'));
  });

  app.get('/ops', (_req, res) => {
    res.sendFile(path.join(clientDir, 'ops', 'index.html'));
  });

  app.get('/phone', (_req, res) => {
    res.sendFile(path.join(clientDir, 'phone', 'index.html'));
  });

  // --- Static assets from client directory ---

  app.use('/static', express.static(clientDir));

  // --- API routes ---

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime_ms: Date.now() - state._startTime });
  });

  app.get('/api/state', (_req, res) => {
    res.json(state.snapshot());
  });

  app.post('/api/scenario/trigger', (req, res) => {
    const { scenario, parameters } = req.body || {};
    if (!scenario) {
      return res.status(400).json({ error: 'scenario field is required' });
    }
    log.info({ scenario, parameters }, 'scenario triggered via API');
    state.emit('ops.trigger_scenario', { scenario, parameters });
    res.json({ triggered: scenario });
  });

  return app;
}

module.exports = { createApp };
