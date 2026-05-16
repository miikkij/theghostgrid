'use strict';

const http = require('http');
const config = require('./config');
const log = require('./log').child({ component: 'core' });
const { state } = require('./state');
const { createApp } = require('./http');
const { attachWebSocket } = require('./websocket');
const { initRouter } = require('./router');
const { initPhoneSim } = require('./phone_sim');
const { initHealthMonitor } = require('./health_monitor');
const scenarios = require('./demo/scenarios');
const demoScript = require('./demo/script');
const population = require('./demo/population');
const hqBrain = require('./hq_brain');
const radioBridge = require('./radio_bridge');

// --- Cycle ticker ---
// Fires four phase events per cycle using chained setTimeout to avoid drift.

let cycleTimer = null;
let cycleRunning = false;

function startCycleTicker() {
  if (cycleRunning) return;
  cycleRunning = true;

  function runCycle() {
    if (!cycleRunning) return;

    // Read period dynamically so ops can change it at runtime
    const period = state.get('cycle.period_ms') || config.cycle.period_ms;
    const alphaOffset = config.cycle.sync_alpha_offset_ms;
    const betaOffset = config.cycle.sync_beta_offset_ms;
    const burstWindow = config.cycle.burst_window_ms;

    // Scale sub-phase offsets proportionally when period changes
    const scale = period / config.cycle.period_ms;
    const prepMs = (alphaOffset + 15) * scale;
    const betaMs = betaOffset * scale;
    const idleMs = (betaOffset + burstWindow) * scale;

    const cycleNumber = state.get('cycle.number') + 1;
    const cycleStart = Date.now();
    state.set('cycle.number', cycleNumber);

    // Phase 1: SYNC-alpha at cycle start
    state.set('cycle.phase', 'sync_alpha');
    state.set('cycle.last_alpha_ts', cycleStart);
    state.emit('cycle.sync_alpha', { number: cycleNumber, ts: cycleStart });

    // Phase 2: PREP
    setTimeout(() => {
      if (!cycleRunning) return;
      state.set('cycle.phase', 'prep');
      state.emit('cycle.prep', { number: cycleNumber, ts: Date.now() });
    }, prepMs);

    // Phase 3: SYNC-beta + BURST
    setTimeout(() => {
      if (!cycleRunning) return;
      state.set('cycle.phase', 'sync_beta_burst');
      state.set('cycle.last_beta_ts', Date.now());
      state.emit('cycle.sync_beta_burst', { number: cycleNumber, ts: Date.now() });
    }, betaMs);

    // Phase 4: IDLE
    setTimeout(() => {
      if (!cycleRunning) return;
      state.set('cycle.phase', 'idle');
      state.emit('cycle.idle', { number: cycleNumber, ts: Date.now() });
    }, idleMs);

    // Schedule next cycle aligned to period
    const elapsed = Date.now() - cycleStart;
    const nextDelay = Math.max(0, period - elapsed);
    cycleTimer = setTimeout(runCycle, nextDelay);
  }

  runCycle();
  log.info({ period_ms: config.cycle.period_ms }, 'cycle ticker started');
}

function stopCycleTicker() {
  cycleRunning = false;
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }
}

// Expose as object for scenario dispatcher
const cycleTicker = { start: startCycleTicker, stop: stopCycleTicker };

// --- Server lifecycle ---

const app = createApp();
const server = http.createServer(app);
attachWebSocket(server);
initRouter();
initPhoneSim();
scenarios.init(state, cycleTicker);
demoScript.init(state);

state.set('cycle.period_ms', config.cycle.period_ms);

const { port, host } = config.server;

server.listen(port, host, async () => {
  log.info('===========================================');
  log.info('  TACTICAL MESH — Server Core');
  log.info(`  http://${host}:${port}`);
  log.info(`  http://localhost:${port}`);
  log.info(`  Cycle period: ${config.cycle.period_ms}ms`);
  log.info(`  Radios: ${config.radio.enabled ? 'enabled' : 'simulated'}`);
  log.info('===========================================');

  startCycleTicker();
  initHealthMonitor();
  radioBridge.init();
  population.init();

  // Init HQ Brain (async — selects LLM backend)
  try {
    await hqBrain.init(state);
    log.info('HQ Brain initialized');
  } catch (err) {
    log.warn({ err: err.message }, 'HQ Brain init failed — running without AI');
  }

  // Seed initial drones — 3 sync + 2 decoy
  if (Object.keys(state.get('drones') || {}).length === 0) {
    state.set('drones', {
      'DRONE-1': { position: { x: 0.25, y: 0.10 }, status: 'active', role: 'sync' },
      'DRONE-2': { position: { x: 0.55, y: 0.08 }, status: 'active', role: 'sync' },
      'DRONE-3': { position: { x: 0.80, y: 0.12 }, status: 'active', role: 'sync' },
      'DRONE-4': { position: { x: 0.40, y: 0.20 }, status: 'active', role: 'decoy' },
      'DRONE-5': { position: { x: 0.70, y: 0.18 }, status: 'active', role: 'decoy' },
    });
  }
});

// --- Graceful shutdown ---

function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  stopCycleTicker();
  radioBridge.shutdown();
  server.close(() => {
    log.info('server closed');
    process.exit(0);
  });
  // Force exit after 5s if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
