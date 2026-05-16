'use strict';

const confidentialmind = require('./confidentialmind_client');
const ollama = require('./ollama_fallback');
const { TACTICAL_LOOP_PROMPT, OPERATIONAL_LOOP_PROMPT } = require('./prompts');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${message}`);
  } else {
    failed++;
    console.error(`  FAIL: ${message}`);
  }
}

async function selectClient() {
  const cmHealth = await confidentialmind.health();
  if (cmHealth.available) {
    console.log('  Using ConfidentialMind backend');
    return { client: confidentialmind, name: 'ConfidentialMind' };
  }

  const ollamaHealth = await ollama.health();
  if (ollamaHealth.available) {
    console.log('  Using Ollama fallback backend');
    return { client: ollama, name: 'Ollama' };
  }

  return null;
}

async function testTacticalHoneypotArtillery(client) {
  console.log('\n=== Live: Tactical — honeypot artillery event ===');

  const context = {
    event: {
      type: 'honeypot_trigger',
      timestamp: Date.now(),
      source_node: 'HP-23',
      sensor: 'acoustic',
      classification: 'artillery_overpressure',
      direction_of_arrival: 287,
      amplitude: -42,
      position: { x: 0.3, y: 0.7 },
    },
    recent_events: [],
    active_patterns: [{ name: 'linear_translation', id: 'pat-001' }],
    jamming_zones: [],
  };

  const userMessage = JSON.stringify(context, null, 2);
  console.log('  Sending to LLM...');
  console.log('  --- USER MESSAGE ---');
  console.log(`  ${userMessage.split('\n').join('\n  ')}`);
  console.log('  --- END ---');
  console.log('  Waiting for response (this may take 30-60s on CPU)...');

  const start = Date.now();
  const response = await client.chat({
    systemPrompt: TACTICAL_LOOP_PROMPT,
    userMessage,
    responseFormat: { type: 'json_object' },
    temperature: 0.3,
  });
  const elapsed = Date.now() - start;

  console.log(`  --- LLM RESPONSE (${elapsed}ms) ---`);
  console.log(`  ${JSON.stringify(response, null, 2).split('\n').join('\n  ')}`);
  console.log('  --- END ---');

  assert(typeof response === 'object', 'Response is an object');
  assert(['HIGH', 'MEDIUM', 'LOW'].includes(response.urgency), `Urgency is valid: ${response.urgency}`);
  assert(typeof response.classification === 'string', `Has classification: ${response.classification}`);
  assert(typeof response.reasoning === 'string', 'Has reasoning trace');
  assert(response.reasoning.length > 20, 'Reasoning is substantive (>20 chars)');
  assert(typeof response.confidence === 'number', `Has confidence: ${response.confidence}`);
  assert(response.confidence >= 0 && response.confidence <= 1, 'Confidence in [0,1]');

  if (response.urgency === 'HIGH') {
    assert(typeof response.broadcast_content === 'string', 'HIGH urgency has broadcast content');
    assert(response.broadcast_content.split(' ').length <= 60, 'Broadcast under ~50 words');
  }

  assert(response.affected_area !== undefined, 'Has affected_area');
  assert(elapsed < 120000, `LLM responded within 120s (took ${elapsed}ms)`);
}

async function testTacticalJamming(client) {
  console.log('\n=== Live: Tactical — jamming event ===');

  const context = {
    event: {
      type: 'jamming_detected',
      timestamp: Date.now(),
      source_node: null,
      affected_nodes: ['SQ-7-B', 'SQ-7-C', 'HP-12'],
      position: null,
    },
    recent_events: [],
    active_patterns: [],
    jamming_zones: [{ center: { x: 0.4, y: 0.5 }, radius: 0.15, since: Date.now() - 5000 }],
  };

  const response = await client.chat({
    systemPrompt: TACTICAL_LOOP_PROMPT,
    userMessage: JSON.stringify(context, null, 2),
    responseFormat: { type: 'json_object' },
    temperature: 0.3,
  });

  assert(typeof response.urgency === 'string', `Urgency: ${response.urgency}`);
  assert(typeof response.reasoning === 'string', 'Has reasoning');
  console.log(`  Classification: ${response.classification}`);
  console.log(`  Urgency: ${response.urgency}`);
}

async function testOperationalCycle(client) {
  console.log('\n=== Live: Operational — deception adaptation ===');

  const summary = {
    window_start: Date.now() - 15 * 60 * 1000,
    window_end: Date.now(),
    tactical_events: [
      { ts: Date.now() - 600000, event_type: 'honeypot_trigger', urgency: 'HIGH', classification: 'artillery_overpressure' },
      { ts: Date.now() - 300000, event_type: 'honeypot_trigger', urgency: 'HIGH', classification: 'multiple_honeypot_cluster' },
    ],
    event_count: 2,
    active_patterns: [
      { name: 'linear_translation', id: 'pat-001', parameters: { direction: 'east', velocity: 0.05 } },
    ],
    jamming_zones: [],
    honeypot_triggers: 2,
    jamming_events: 0,
  };

  const response = await client.chat({
    systemPrompt: OPERATIONAL_LOOP_PROMPT,
    userMessage: JSON.stringify(summary, null, 2),
    responseFormat: { type: 'json_object' },
    temperature: 0.4,
  });

  console.log(`  Response: ${JSON.stringify(response, null, 2).split('\n').join('\n  ')}`);

  assert(typeof response.analysis === 'string', 'Has analysis');
  assert(Array.isArray(response.recommended_changes), 'Has recommended_changes array');
  assert(typeof response.rationale === 'string', 'Has rationale');
  assert(typeof response.confidence === 'number', `Confidence: ${response.confidence}`);

  if (response.recommended_changes.length > 0) {
    const change = response.recommended_changes[0];
    assert(
      ['deactivate', 'activate', 'modify'].includes(change.action),
      `Change action valid: ${change.action}`,
    );
  }
}

// ─── Run ──────────────────────────────────────────────────────────

async function main() {
  console.log('HQ Brain — Live LLM Test');
  console.log('========================');

  const selected = await selectClient();
  if (!selected) {
    console.log('\n  SKIP: No LLM backend available.');
    console.log('  Configure CM_ENDPOINT + CM_API_KEY for ConfidentialMind,');
    console.log('  or run Ollama locally (ollama serve + ollama pull llama3:8b).');
    process.exit(0);
  }

  console.log(`  Backend: ${selected.name}`);

  await testTacticalHoneypotArtillery(selected.client);
  await testTacticalJamming(selected.client);
  await testOperationalCycle(selected.client);

  console.log('\n========================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Live test error:', err);
  process.exit(1);
});
