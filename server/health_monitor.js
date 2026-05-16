'use strict';

const { state } = require('./state');
const config = require('./config');
const log = require('./log').child({ component: 'health' });

const POLL_INTERVAL_MS = 30000;
let radioBridgeAlive = false;

function initHealthMonitor() {
  // Detect live radio bridge by listening for frame events
  state.on('radio.frame_received', () => { radioBridgeAlive = true; });
  state.on('radio.frame_received_simulated', () => { radioBridgeAlive = true; });

  pollAndBroadcast();
  setInterval(pollAndBroadcast, POLL_INTERVAL_MS);
  log.info({ interval_ms: POLL_INTERVAL_MS }, 'health monitor started');
}

async function pollAndBroadcast() {
  // Radio adapters — detect live bridge, fall back to config flag
  let radioStatus;
  if (radioBridgeAlive) {
    radioStatus = 'ok';
  } else if (config.radio.enabled) {
    radioStatus = 'ok';
  } else {
    radioStatus = 'ok_simulated';
  }
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan1', status: radioStatus });
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan2', status: radioStatus });
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan3', status: radioStatus });

  // LLM backend health — reports which backend is actually responding
  try {
    const result = await checkLLMHealth();
    state.broadcastTo('ops', 'adapter_status', { adapter: 'cm', status: result.status, backend: result.backend });
  } catch (e) {
    log.debug({ err: e.message }, 'LLM health check failed');
    state.broadcastTo('ops', 'adapter_status', { adapter: 'cm', status: 'error' });
  }
}

async function checkLLMHealth() {
  const cmEndpoint = config.confidentialmind.endpoint;
  const cmKey = config.confidentialmind.api_key;

  if (cmEndpoint && cmKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(cmEndpoint.replace(/\/+$/, '') + '/v1/models', {
        headers: { Authorization: `Bearer ${cmKey}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) return { status: 'ok', backend: 'confidentialmind' };
    } catch { /* fall through to ollama */ }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) return { status: 'ok', backend: 'ollama' };
  } catch { /* neither available */ }

  return { status: 'error', backend: 'none' };
}

module.exports = { initHealthMonitor };
