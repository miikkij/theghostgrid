'use strict';

const { state } = require('./state');
const config = require('./config');
const log = require('./log').child({ component: 'health' });

const POLL_INTERVAL_MS = 30000;

function initHealthMonitor() {
  pollAndBroadcast();
  setInterval(pollAndBroadcast, POLL_INTERVAL_MS);
  log.info({ interval_ms: POLL_INTERVAL_MS }, 'health monitor started');
}

async function pollAndBroadcast() {
  // Radio adapters — report simulated status when not enabled
  const radioStatus = config.radio.enabled ? 'ok' : 'ok_simulated';
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan1', status: radioStatus });
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan2', status: radioStatus });
  state.broadcastTo('ops', 'adapter_status', { adapter: 'wlan3', status: radioStatus });

  // LLM backend health
  try {
    const cmStatus = await checkLLMHealth();
    state.broadcastTo('ops', 'adapter_status', { adapter: 'cm', status: cmStatus });
  } catch (e) {
    log.debug({ err: e.message }, 'LLM health check failed');
    state.broadcastTo('ops', 'adapter_status', { adapter: 'cm', status: 'error' });
  }
}

async function checkLLMHealth() {
  // Try ConfidentialMind first
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
      if (res.ok) return 'ok';
    } catch { /* fall through to ollama */ }
  }

  // Try Ollama
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) return 'ok';
  } catch { /* neither available */ }

  return 'error';
}

module.exports = { initHealthMonitor };
