'use strict';

const log = require('../log').child({ component: 'hq_brain.operational' });
const { OPERATIONAL_LOOP_PROMPT } = require('./prompts');
const audit = require('./audit');

let state = null;
let llmClient = null;

function init(stateRef, client) {
  state = stateRef;
  llmClient = client;

  state.on('ops.trigger_ai_adaptation', () => {
    runOperationalCycle().catch((err) => {
      log.error({ err }, 'Operational cycle failed on manual trigger');
    });
  });

  log.info('Operational loop initialized (manual trigger mode)');
}

async function runOperationalCycle() {
  const startMs = Date.now();
  log.info('Operational cycle started');

  const summary = assembleSummary();
  const userMessage = JSON.stringify(summary, null, 2);

  let llmResponse;
  try {
    llmResponse = await llmClient.chat({
      systemPrompt: OPERATIONAL_LOOP_PROMPT,
      userMessage,
      responseFormat: { type: 'json_object' },
      temperature: 0.4,
    });
  } catch (err) {
    log.warn({ err: err.message, elapsed_ms: Date.now() - startMs }, 'Operational LLM call failed; skipping cycle');
    audit.log({
      loop: 'operational',
      event_input: summary,
      llm_input: { systemPrompt: '[OPERATIONAL_LOOP_PROMPT]', userMessage },
      llm_output: null,
      action_taken: { type: 'error', reason: err.message },
    });
    return null;
  }

  const result = normalizeResponse(llmResponse);

  const auditEntry = audit.log({
    loop: 'operational',
    event_input: summary,
    llm_input: { systemPrompt: '[OPERATIONAL_LOOP_PROMPT]', userMessage },
    llm_output: result,
    action_taken: { type: 'choreography_update', changes: result.recommended_changes },
  });

  const roe = require('./roe');
  if (result.recommended_changes.length > 0 && roe.canUpdateChoreography()) {
    state.emit('ops.update_choreography', {
      changes: result.recommended_changes,
      rationale: result.rationale,
      confidence: result.confidence,
      log_id: auditEntry.log_id,
    });
    log.info({ changeCount: result.recommended_changes.length }, 'Choreography update emitted');
  } else if (result.recommended_changes.length > 0) {
    log.info({ roe: roe.getState() }, 'Choreography changes blocked by ROE');
  } else {
    log.info('No choreography changes recommended');
  }

  const changeCount = result.recommended_changes ? result.recommended_changes.length : 0;
  state.emit('ai.decision', {
    loop: 'operational',
    classification: 'choreography_update',
    confidence: typeof result.confidence === 'number' ? result.confidence : 0.5,
    reasoning: result.rationale || result.reasoning || 'Operational analysis complete',
    urgency: changeCount > 0 ? 'MEDIUM' : 'LOW',
    summary: 'Choreography: ' + changeCount + ' change' + (changeCount !== 1 ? 's' : '') + ' recommended',
    elapsed_ms: Date.now() - startMs,
    log_id: auditEntry.log_id,
  });

  const elapsed = Date.now() - startMs;
  log.info({ elapsed_ms: elapsed }, 'Operational cycle completed');

  return result;
}

function assembleSummary() {
  const windowMs = 15 * 60 * 1000;
  const since = Date.now() - windowMs;

  const recentAudit = (state.get('audit_log') || []).filter((e) => e.ts > since);

  const tacticalEvents = recentAudit
    .filter((e) => e.loop === 'tactical')
    .map((e) => ({
      ts: e.ts,
      event_type: e.event_input?.event_type,
      urgency: e.llm_output?.urgency,
      classification: e.llm_output?.classification,
      action: e.action_taken?.type,
    }));

  return {
    window_start: since,
    window_end: Date.now(),
    tactical_events: tacticalEvents,
    event_count: tacticalEvents.length,
    active_patterns: state.get('active_patterns') || [],
    jamming_zones: state.get('jamming_zones') || [],
    honeypot_triggers: tacticalEvents.filter((e) => e.event_type === 'honeypot_trigger').length,
    jamming_events: tacticalEvents.filter((e) => e.event_type === 'jamming_detected').length,
  };
}

function normalizeResponse(raw) {
  const changes = Array.isArray(raw.recommended_changes) ? raw.recommended_changes : [];

  return {
    analysis: raw.analysis || 'No analysis provided',
    recommended_changes: changes.map((c) => ({
      pattern_id: c.pattern_id || null,
      action: ['deactivate', 'activate', 'modify'].includes(c.action) ? c.action : 'activate',
      new_pattern: c.new_pattern || null,
      justification: c.justification || '',
    })),
    rationale: raw.rationale || 'No rationale provided',
    confidence: typeof raw.confidence === 'number' ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
  };
}

// TODO: Strategic loop (hourly) — commander-facing recommendations
// Would aggregate all operational cycles, produce threat assessments,
// recommend crypto rotations and posture changes. Requires commander approval.

// TODO: After-action review loop (post-mission) — offline analysis
// Would consume full mission log, extract lessons learned,
// generate training data for future AI iterations.

function reset() {
  state = null;
  llmClient = null;
}

function setClient(client) { llmClient = client; }

module.exports = { init, runOperationalCycle, reset, setClient };
