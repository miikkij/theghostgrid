'use strict';

const http = require('http');
const config = require('./config');
const log = require('./log').child({ component: 'core' });
const { state } = require('./state');
const { createApp } = require('./http');
const { attachWebSocket } = require('./websocket');
const { initRouter } = require('./router');
const { initPhoneSim } = require('./phone_sim');

// --- Cycle ticker ---
// Fires four phase events per cycle using chained setTimeout to avoid drift.

let cycleTimer = null;

function startCycleTicker() {
  const { period_ms, sync_alpha_offset_ms, sync_beta_offset_ms, burst_window_ms } = config.cycle;

  // Phase offsets within one cycle (relative to cycle start)
  const prepOffset = sync_alpha_offset_ms + 15;
  const betaBurstOffset = sync_beta_offset_ms;
  const idleOffset = sync_beta_offset_ms + burst_window_ms;

  function runCycle() {
    const cycleNumber = state.get('cycle.number') + 1;
    const cycleStart = Date.now();
    state.set('cycle.number', cycleNumber);

    // Phase 1: SYNC-alpha at cycle start
    state.set('cycle.phase', 'sync_alpha');
    state.set('cycle.last_alpha_ts', cycleStart);
    state.emit('cycle.sync_alpha', { number: cycleNumber, ts: cycleStart });

    // Phase 2: PREP
    cycleTimer = setTimeout(() => {
      state.set('cycle.phase', 'prep');
      state.emit('cycle.prep', { number: cycleNumber, ts: Date.now() });
    }, prepOffset);

    // Phase 3: SYNC-beta + BURST
    setTimeout(() => {
      state.set('cycle.phase', 'sync_beta_burst');
      state.set('cycle.last_beta_ts', Date.now());
      state.emit('cycle.sync_beta_burst', { number: cycleNumber, ts: Date.now() });
    }, betaBurstOffset);

    // Phase 4: IDLE
    setTimeout(() => {
      state.set('cycle.phase', 'idle');
      state.emit('cycle.idle', { number: cycleNumber, ts: Date.now() });
    }, idleOffset);

    // Schedule next cycle aligned to period
    const elapsed = Date.now() - cycleStart;
    const nextDelay = Math.max(0, period_ms - elapsed);
    cycleTimer = setTimeout(runCycle, nextDelay);
  }

  runCycle();
  log.info({ period_ms }, 'cycle ticker started');
}

function stopCycleTicker() {
  if (cycleTimer) {
    clearTimeout(cycleTimer);
    cycleTimer = null;
  }
}

// --- Server lifecycle ---

const app = createApp();
const server = http.createServer(app);
attachWebSocket(server);
initRouter();
initPhoneSim();

state.set('cycle.period_ms', config.cycle.period_ms);

const { port, host } = config.server;

server.listen(port, host, () => {
  log.info('===========================================');
  log.info('  TACTICAL MESH — Server Core');
  log.info(`  http://${host}:${port}`);
  log.info(`  http://localhost:${port}`);
  log.info(`  Cycle period: ${config.cycle.period_ms}ms`);
  log.info(`  Radios: ${config.radio.enabled ? 'enabled' : 'simulated'}`);
  log.info('===========================================');

  startCycleTicker();
});

// --- Graceful shutdown ---

function shutdown(signal) {
  log.info({ signal }, 'shutting down');
  stopCycleTicker();
  server.close(() => {
    log.info('server closed');
    process.exit(0);
  });
  // Force exit after 5s if connections don't drain
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
