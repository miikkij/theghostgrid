'use strict';

const log = require('../log').child({ component: 'hq_brain' });
const confidentialmind = require('./confidentialmind_client');
const ollama = require('./ollama_fallback');
const tacticalLoop = require('./tactical_loop');
const operationalLoop = require('./operational_loop');
const audit = require('./audit');

let activeClient = null;
let lastReasoning = null;
let state = null;

async function selectClient() {
  const cmHealth = await confidentialmind.health();
  if (cmHealth.available) {
    log.info('Using ConfidentialMind as LLM backend');
    return confidentialmind;
  }

  log.info('ConfidentialMind unavailable, checking Ollama fallback');
  const ollamaHealth = await ollama.health();
  if (ollamaHealth.available) {
    log.info('Using Ollama as LLM fallback');
    return ollama;
  }

  log.warn('No LLM backend available; HQ Brain will operate in degraded mode');
  return createDegradedClient();
}

function createDegradedClient() {
  return {
    _degraded: true,
    async chat() {
      return {
        urgency: 'LOW',
        classification: 'llm_unavailable',
        affected_area: { center: { x: 0.5, y: 0.5 }, radius: 0.1 },
        broadcast_content: null,
        reasoning: 'LLM backend unavailable; event logged for manual review',
        confidence: 0,
      };
    },
    async health() {
      return { available: false, reason: 'degraded mode' };
    },
  };
}

async function init(stateRef) {
  state = stateRef;

  audit.init(state);
  activeClient = await selectClient();
  tacticalLoop.init(state, activeClient);
  operationalLoop.init(state, activeClient);

  state.on('ai.decision', (decision) => {
    lastReasoning = decision;
    state.broadcast('ai_decision', decision);
  });

  state.on('hq.broadcast_proposed', (broadcast) => {
    state.broadcast('hq_broadcast', broadcast);
    state.broadcastTo('phone', 'threat_alert', {
      content: broadcast.content,
      affected_area: broadcast.affected_area,
      priority: broadcast.priority,
    });
  });

  // Retry LLM backend selection every 30s if stuck in degraded mode
  setInterval(async () => {
    if (activeClient && activeClient._degraded) {
      const newClient = await selectClient();
      if (!newClient._degraded) {
        activeClient = newClient;
        tacticalLoop.setClient(newClient);
        operationalLoop.setClient(newClient);
        log.info('LLM backend recovered from degraded mode');
      }
    }
  }, 30000);

  log.info('HQ Brain initialized');
}

function ingestEvent(event) {
  tacticalLoop.enqueue(event);
}

function getAuditTrail({ since, limit } = {}) {
  return audit.query({ since, limit });
}

function getLastReasoning() {
  return lastReasoning;
}

async function triggerOperationalLoop() {
  return operationalLoop.runOperationalCycle();
}

function reset() {
  tacticalLoop.reset();
  operationalLoop.reset();
  audit.reset();
  activeClient = null;
  lastReasoning = null;
  state = null;
}

module.exports = {
  init,
  ingestEvent,
  getAuditTrail,
  getLastReasoning,
  triggerOperationalLoop,
  reset,
};
