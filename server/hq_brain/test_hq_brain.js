'use strict';

const { EventEmitter } = require('events');
const tacticalLoop = require('./tactical_loop');
const operationalLoop = require('./operational_loop');
const audit = require('./audit');

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

function createMockState() {
  const ee = new EventEmitter();
  ee.setMaxListeners(200);
  const store = {
    cycle: { number: 0 },
    nodes: {},
    audit_log: [],
    active_patterns: [],
    jamming_zones: [],
    stats: { ai_decisions: 0 },
  };

  return {
    on: (event, handler) => ee.on(event, handler),
    off: (event, handler) => ee.off(event, handler),
    emit: (event, payload) => ee.emit(event, payload),
    get: (path) => {
      const parts = path.split('.');
      let current = store;
      for (const part of parts) {
        if (current === undefined) return undefined;
        current = current[part];
      }
      return current;
    },
    set: (path, value) => {
      const parts = path.split('.');
      let current = store;
      for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
    },
    broadcast: () => {},
    broadcastTo: () => {},
    _ee: ee,
    _store: store,
  };
}

function createStubLLM(responses) {
  let callIndex = 0;
  return {
    calls: [],
    async chat(params) {
      this.calls.push(params);
      const response = responses[callIndex % responses.length];
      callIndex++;
      return response;
    },
    async health() {
      return { available: true };
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────

async function testTacticalLoopProcessesThreeEvents() {
  console.log('\n=== Tactical Loop: 3 honeypot events ===');

  const state = createMockState();
  tacticalLoop.reset();
  audit.reset();
  audit.init(state);

  const stubLLM = createStubLLM([
    {
      urgency: 'HIGH',
      classification: 'artillery_overpressure',
      affected_area: { center: { x: 0.3, y: 0.7 }, radius: 0.15 },
      broadcast_content: 'Artillery detected sector 3; take cover immediately',
      reasoning: 'HP-23 acoustic sensor triggered with artillery signature at -42dBA. High confidence.',
      confidence: 0.92,
    },
    {
      urgency: 'HIGH',
      classification: 'multiple_honeypot_cluster',
      affected_area: { center: { x: 0.4, y: 0.6 }, radius: 0.2 },
      broadcast_content: 'Multiple sensors confirm incoming fire sector 3-4; evacuate',
      reasoning: 'HP-23 and HP-24 triggered within 5 seconds. Correlated threat.',
      confidence: 0.95,
    },
    {
      urgency: 'LOW',
      classification: 'single_vibration_noise',
      affected_area: { center: { x: 0.5, y: 0.5 }, radius: 0.05 },
      broadcast_content: null,
      reasoning: 'Single vibration sensor on HP-12. Likely vehicle traffic, not hostile.',
      confidence: 0.35,
    },
  ]);

  tacticalLoop.init(state, stubLLM);

  const broadcasts = [];
  state.on('hq.broadcast_proposed', (data) => broadcasts.push(data));

  const decisions = [];
  state.on('ai.decision', (data) => decisions.push(data));

  // Inject three honeypot trigger events
  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-23',
    eventType: 'artillery',
    sensor: 'acoustic',
    classification: 'artillery_overpressure',
    position: { x: 0.3, y: 0.7 },
    timestamp: Date.now(),
  });

  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-24',
    eventType: 'artillery',
    sensor: 'acoustic',
    classification: 'artillery_overpressure',
    position: { x: 0.4, y: 0.6 },
    timestamp: Date.now(),
  });

  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-12',
    eventType: 'vibration',
    sensor: 'vibration',
    classification: 'ground_vibration',
    position: { x: 0.5, y: 0.5 },
    timestamp: Date.now(),
  });

  // Wait for async processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert(stubLLM.calls.length === 3, `LLM called 3 times (got ${stubLLM.calls.length})`);
  assert(audit.count() === 3, `Audit log has 3 entries (got ${audit.count()})`);
  assert(broadcasts.length === 2, `2 broadcasts emitted for HIGH urgency (got ${broadcasts.length})`);
  assert(decisions.length === 3, `3 ai.decision events emitted (got ${decisions.length})`);

  // Verify broadcast content
  assert(
    broadcasts[0].content.includes('Artillery'),
    'First broadcast mentions artillery',
  );
  assert(broadcasts[0].log_id !== null, 'Broadcast has audit log_id');

  // Verify reasoning traces
  assert(
    decisions[0].reasoning.includes('HP-23'),
    'First decision reasoning references source node',
  );
  assert(decisions[2].urgency === 'LOW', 'Third decision is LOW urgency');

  // Verify audit entries have complete structure
  const entries = audit.query({});
  assert(entries[0].loop === 'tactical', 'Audit entry has loop field');
  assert(entries[0].event_input !== undefined, 'Audit entry has event_input');
  assert(entries[0].llm_input !== undefined, 'Audit entry has llm_input');
  assert(entries[0].llm_output !== undefined, 'Audit entry has llm_output');
  assert(entries[0].action_taken !== undefined, 'Audit entry has action_taken');
  assert(typeof entries[0].log_id === 'string', 'Audit entry has UUID log_id');
  assert(typeof entries[0].ts === 'number', 'Audit entry has timestamp');

  tacticalLoop.reset();
  audit.reset();
}

async function testTacticalLoopTimingBudget() {
  console.log('\n=== Tactical Loop: Timing budget ===');

  const state = createMockState();
  tacticalLoop.reset();
  audit.reset();
  audit.init(state);

  const stubLLM = createStubLLM([{
    urgency: 'HIGH',
    classification: 'test_timing',
    affected_area: { center: { x: 0.5, y: 0.5 }, radius: 0.1 },
    broadcast_content: 'Timing test alert',
    reasoning: 'Test',
    confidence: 0.9,
  }]);

  tacticalLoop.init(state, stubLLM);

  let elapsed = null;
  state.on('ai.decision', (data) => {
    elapsed = data.elapsed_ms;
  });

  const start = Date.now();
  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-01',
    eventType: 'test',
    sensor: 'acoustic',
    timestamp: Date.now(),
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  const totalElapsed = Date.now() - start;
  assert(totalElapsed < 5000, `End-to-end under 5s (took ${totalElapsed}ms)`);
  assert(elapsed !== null && elapsed < 5000, `Reported elapsed under 5s (${elapsed}ms)`);

  tacticalLoop.reset();
  audit.reset();
}

async function testOperationalLoop() {
  console.log('\n=== Operational Loop: Manual trigger ===');

  const state = createMockState();
  operationalLoop.reset();
  audit.reset();
  audit.init(state);

  const stubLLM = createStubLLM([{
    analysis: 'Enemy appears to be targeting sector 3 based on 2 honeypot triggers. Current linear sweep is likely being tracked.',
    recommended_changes: [
      {
        pattern_id: null,
        action: 'activate',
        new_pattern: {
          name: 'random_walk_cluster',
          parameters: { seed: 99, cluster_radius: 0.15, velocity: 0.02, initial_position: { x: 0.4, y: 0.6 } },
        },
        justification: 'Switch from predictable linear to random walk to disrupt enemy tracking',
      },
    ],
    rationale: 'Two correlated honeypot triggers suggest enemy is actively scanning sector 3. Current linear pattern may be learned.',
    confidence: 0.78,
  }]);

  operationalLoop.init(state, stubLLM);

  const choreographyUpdates = [];
  state.on('ops.update_choreography', (data) => choreographyUpdates.push(data));

  const decisions = [];
  state.on('ai.decision', (data) => decisions.push(data));

  const result = await operationalLoop.runOperationalCycle();

  assert(result !== null, 'Operational cycle returns result');
  assert(result.recommended_changes.length === 1, 'One change recommended');
  assert(result.recommended_changes[0].action === 'activate', 'Change action is activate');
  assert(choreographyUpdates.length === 1, 'ops.update_choreography emitted');
  assert(decisions.length === 1, 'ai.decision emitted for operational loop');
  assert(decisions[0].loop === 'operational', 'Decision tagged as operational loop');

  operationalLoop.reset();
  audit.reset();
}

async function testOperationalLoopManualTrigger() {
  console.log('\n=== Operational Loop: Event-based trigger ===');

  const state = createMockState();
  operationalLoop.reset();
  audit.reset();
  audit.init(state);

  const stubLLM = createStubLLM([{
    analysis: 'Quiet period, no significant enemy activity detected.',
    recommended_changes: [],
    rationale: 'No changes needed during low-activity window.',
    confidence: 0.85,
  }]);

  operationalLoop.init(state, stubLLM);

  const updates = [];
  state.on('ops.update_choreography', (data) => updates.push(data));

  state.emit('ops.trigger_ai_adaptation');
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert(stubLLM.calls.length === 1, 'LLM called once on manual trigger');
  assert(updates.length === 0, 'No choreography update when no changes recommended');
  assert(audit.count() === 1, 'Audit entry recorded even with no changes');

  operationalLoop.reset();
  audit.reset();
}

async function testAuditQueryAndExport() {
  console.log('\n=== Audit: Query and export ===');

  audit.reset();

  const state = createMockState();
  audit.init(state);

  const now = Date.now();
  audit.log({ loop: 'tactical', event_input: {}, llm_input: {}, llm_output: {}, action_taken: {} });
  audit.log({ loop: 'tactical', event_input: {}, llm_input: {}, llm_output: {}, action_taken: {} });
  audit.log({ loop: 'operational', event_input: {}, llm_input: {}, llm_output: {}, action_taken: {} });

  assert(audit.count() === 3, 'Count is 3');

  const tactical = audit.query({ loop: 'tactical' });
  assert(tactical.length === 2, 'Query by loop returns 2 tactical entries');

  const limited = audit.query({ limit: 1 });
  assert(limited.length === 1, 'Query with limit returns 1 entry');

  const sinceQuery = audit.query({ since: now - 1 });
  assert(sinceQuery.length === 3, 'Query with since returns all recent entries');

  // Export
  const fs = require('fs');
  const path = require('path');
  const exportPath = path.join(__dirname, '..', '..', 'logs', 'test_export.log');
  audit.exportToFile(exportPath);
  const content = fs.readFileSync(exportPath, 'utf-8');
  const lines = content.trim().split('\n');
  assert(lines.length === 3, `Export file has 3 lines (got ${lines.length})`);

  const parsed = JSON.parse(lines[0]);
  assert(typeof parsed.log_id === 'string', 'Exported entry has log_id');
  assert(typeof parsed.ts === 'number', 'Exported entry has timestamp');

  fs.unlinkSync(exportPath);
  audit.reset();
}

async function testResponseNormalization() {
  console.log('\n=== Tactical Loop: Response normalization ===');

  const state = createMockState();
  tacticalLoop.reset();
  audit.reset();
  audit.init(state);

  const stubLLM = createStubLLM([{
    urgency: 'INVALID',
    classification: null,
    confidence: 2.5,
  }]);

  tacticalLoop.init(state, stubLLM);

  const decisions = [];
  state.on('ai.decision', (data) => decisions.push(data));

  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-01',
    eventType: 'test',
    timestamp: Date.now(),
  });

  await new Promise((resolve) => setTimeout(resolve, 100));

  assert(decisions.length === 1, 'Decision emitted for malformed response');
  assert(decisions[0].urgency === 'LOW', 'Invalid urgency normalized to LOW');
  assert(decisions[0].classification === 'unknown', 'Null classification normalized to unknown');
  assert(decisions[0].confidence === 1.0, 'Confidence clamped to 1.0');
  assert(decisions[0].reasoning === 'No reasoning provided', 'Missing reasoning gets default');

  tacticalLoop.reset();
  audit.reset();
}

async function testQueueOverflow() {
  console.log('\n=== Tactical Loop: Queue overflow ===');

  const state = createMockState();
  tacticalLoop.reset();
  audit.reset();
  audit.init(state);

  let resolveBlock;
  const blockPromise = new Promise((r) => { resolveBlock = r; });
  let firstCall = true;

  const slowLLM = {
    calls: [],
    async chat(params) {
      this.calls.push(params);
      if (firstCall) {
        firstCall = false;
        await blockPromise;
      }
      return {
        urgency: 'LOW',
        classification: 'test',
        affected_area: { center: { x: 0.5, y: 0.5 }, radius: 0.1 },
        broadcast_content: null,
        reasoning: 'test',
        confidence: 0.5,
      };
    },
    async health() { return { available: true }; },
  };

  tacticalLoop.init(state, slowLLM);

  // First event starts processing (blocks on LLM)
  state.emit('deception.honeypot_triggered', { nodeId: 'HP-01', eventType: 'test', timestamp: Date.now() });
  await new Promise((r) => setTimeout(r, 10));

  // Queue 6 more events while first is blocked
  for (let i = 0; i < 6; i++) {
    state.emit('deception.honeypot_triggered', { nodeId: `HP-${i + 10}`, eventType: 'test', timestamp: Date.now() });
  }

  const depth = tacticalLoop.getQueueDepth();
  assert(depth <= 5, `Queue depth capped at 5 (got ${depth})`);

  resolveBlock();
  await new Promise((r) => setTimeout(r, 200));

  tacticalLoop.reset();
  audit.reset();
}

async function testLLMErrorHandling() {
  console.log('\n=== Tactical Loop: LLM error handling ===');

  const state = createMockState();
  tacticalLoop.reset();
  audit.reset();
  audit.init(state);

  const failingLLM = {
    calls: [],
    async chat() {
      this.calls.push({});
      throw new Error('Connection refused');
    },
    async health() { return { available: false }; },
  };

  tacticalLoop.init(state, failingLLM);

  const decisions = [];
  state.on('ai.decision', (data) => decisions.push(data));

  state.emit('deception.honeypot_triggered', {
    nodeId: 'HP-01',
    eventType: 'test',
    timestamp: Date.now(),
  });

  await new Promise((r) => setTimeout(r, 100));

  assert(decisions.length === 0, 'No ai.decision emitted on LLM failure');
  assert(audit.count() === 1, 'Error still logged to audit');

  const entry = audit.query({})[0];
  assert(entry.action_taken.type === 'error', 'Audit records error action');
  assert(entry.llm_output === null, 'Audit records null LLM output');

  tacticalLoop.reset();
  audit.reset();
}

// ─── Run ──────────────────────────────────────────────────────────

async function main() {
  console.log('HQ Brain — Test Harness (Stub LLM)');
  console.log('====================================');

  await testTacticalLoopProcessesThreeEvents();
  await testTacticalLoopTimingBudget();
  await testOperationalLoop();
  await testOperationalLoopManualTrigger();
  await testAuditQueryAndExport();
  await testResponseNormalization();
  await testQueueOverflow();
  await testLLMErrorHandling();

  console.log('\n====================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
