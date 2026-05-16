'use strict';

const log = require('../log').child({ component: 'hq_brain.tactical' });
const { TACTICAL_LOOP_PROMPT } = require('./prompts');
const audit = require('./audit');
const roe = require('./roe');

let state = null;
let llmClient = null;
const queue = [];
let processing = false;

const QUEUE_MAX = 5;

function init(stateRef, client) {
  state = stateRef;
  llmClient = client;

  state.on('deception.honeypot_triggered', (event) => {
    enqueue({ ...event, event_type: 'honeypot_trigger' });
  });
  state.on('mesh.jamming_detected', (event) => {
    enqueue({ ...event, event_type: 'jamming_detected' });
  });
  state.on('protocol.anomaly_detected', (event) => {
    enqueue({ ...event, event_type: 'anomaly' });
  });

  log.info('Tactical loop initialized');
}

function enqueue(event) {
  queue.push(event);

  if (queue.length > QUEUE_MAX) {
    const dropIdx = queue.findIndex((e) => e._estimatedUrgency === 'LOW');
    if (dropIdx >= 0) {
      const dropped = queue.splice(dropIdx, 1)[0];
      log.warn({ event_type: dropped.event_type }, 'Queue overflow: dropped LOW-urgency event');
    } else {
      const dropped = queue.shift();
      log.warn({ event_type: dropped.event_type }, 'Queue overflow: dropped oldest event');
    }
  }

  log.debug({ queueDepth: queue.length }, 'Event queued for tactical processing');
  drain();
}

async function drain() {
  if (processing) return;
  processing = true;

  while (queue.length > 0) {
    const event = queue.shift();
    try {
      await processEvent(event);
    } catch (err) {
      log.error({ err, event_type: event.event_type }, 'Tactical loop processing error');
    }
  }

  processing = false;
}

async function processEvent(event) {
  const startMs = Date.now();

  const context = assembleContext(event);
  const userMessage = JSON.stringify(context, null, 2);

  let llmResponse;
  try {
    llmResponse = await llmClient.chat({
      systemPrompt: TACTICAL_LOOP_PROMPT,
      userMessage,
      responseFormat: { type: 'json_object' },
      maxTokens: 500,
      temperature: 0.3,
    });
  } catch (err) {
    log.warn({ err: err.message, elapsed_ms: Date.now() - startMs }, 'LLM call failed; skipping event');
    audit.log({
      loop: 'tactical',
      event_input: event,
      llm_input: { systemPrompt: '[TACTICAL_LOOP_PROMPT]', userMessage },
      llm_output: null,
      action_taken: { type: 'error', reason: err.message },
    });
    return null;
  }

  const decision = normalizeResponse(llmResponse);
  const actionTaken = { type: 'logged' };

  if (decision.urgency === 'HIGH' && decision.broadcast_content) {
    actionTaken.type = 'broadcast';
    actionTaken.content = decision.broadcast_content;
  } else if (decision.urgency === 'MEDIUM') {
    actionTaken.type = 'recommend';
  }

  const auditEntry = audit.log({
    loop: 'tactical',
    event_input: event,
    llm_input: { systemPrompt: '[TACTICAL_LOOP_PROMPT]', userMessage },
    llm_output: decision,
    action_taken: actionTaken,
  });

  if (actionTaken.type === 'broadcast') {
    state.emit('hq.broadcast_proposed', {
      priority: 'HIGH',
      content: decision.broadcast_content,
      affected_area: decision.affected_area,
      classification: decision.classification,
      confidence: decision.confidence,
      log_id: auditEntry.log_id,
    });
    log.info({ classification: decision.classification }, 'HIGH urgency: auto-broadcast emitted');
  } else if (actionTaken.type === 'recommend') {
    log.info({ classification: decision.classification }, 'MEDIUM urgency: recommendation logged');
  }

  state.emit('ai.decision', {
    loop: 'tactical',
    ...decision,
    summary: decision.classification + ' — ' + decision.urgency,
    event_type: event.event_type,
    elapsed_ms: Date.now() - startMs,
    log_id: auditEntry.log_id,
  });

  const elapsed = Date.now() - startMs;
  log.info({ elapsed_ms: elapsed, urgency: decision.urgency }, 'Tactical event processed');

  const aiDecisions = (state.get('stats.ai_decisions') || 0) + 1;
  state.set('stats.ai_decisions', aiDecisions);

  return decision;
}

function assembleContext(event) {
  const recentAudit = (state.get('audit_log') || []).filter(
    (e) => e.ts > Date.now() - 5 * 60 * 1000,
  );

  return {
    event: {
      type: event.event_type || event.type,
      timestamp: event.timestamp || Date.now(),
      source_node: event.sourceNode || event.source_node || event.nodeId,
      sensor: event.sensor || null,
      classification: event.classification || null,
      direction_of_arrival: event.direction_of_arrival || null,
      amplitude: event.amplitude || null,
      position: event.position || null,
      affected_nodes: event.affected_nodes || null,
      raw: event,
    },
    recent_events: recentAudit.slice(-10).map((e) => ({
      ts: e.ts,
      loop: e.loop,
      event_type: e.event_input?.event_type,
      urgency: e.llm_output?.urgency,
    })),
    active_patterns: state.get('active_patterns') || [],
    jamming_zones: state.get('jamming_zones') || [],
  };
}

function normalizeResponse(raw) {
  let urgency = ['HIGH', 'MEDIUM', 'LOW'].includes(raw.urgency) ? raw.urgency : 'LOW';
  const confidence = typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5;

  // Enforce confidence-based downgrade: low-confidence HIGH decisions become MEDIUM
  if (confidence < 0.5 && urgency === 'HIGH') urgency = 'MEDIUM';
  if (confidence < 0.3 && urgency === 'MEDIUM') urgency = 'LOW';

  const decision = {
    urgency,
    classification: raw.classification || 'unknown',
    affected_area: raw.affected_area || { center: { x: 0.5, y: 0.5 }, radius: 0.1 },
    broadcast_content: typeof raw.broadcast_content === 'string' ? raw.broadcast_content : null,
    reasoning: raw.reasoning || 'No reasoning provided',
    confidence,
  };

  // Enforce ROE constraints
  return roe.enforce(decision);
}

function getQueueDepth() {
  return queue.length;
}

function reset() {
  queue.length = 0;
  processing = false;
  state = null;
  llmClient = null;
}

function setClient(client) { llmClient = client; }

module.exports = { init, processEvent, enqueue, getQueueDepth, reset, setClient };
