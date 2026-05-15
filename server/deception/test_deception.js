'use strict';

const { EventEmitter } = require('events');
const cryptoUtils = require('../protocol/crypto');
const transmission = require('../protocol/transmission');
const deception = require('./index');
const wavePatterns = require('./wave_patterns');
const fakeData = require('./fake_data');
const honeypot = require('./honeypot');
const decoySimulator = require('./decoy_simulator');
const frame = require('../protocol/frame');

const MASTER_SECRET = 'tactical-mesh-default-secret-change-me';

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
  const store = { cycle: { number: 0 }, nodes: {} };

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
    _ee: ee,
    _store: store,
  };
}

// ─── Test Suite ────────────────────────────────────────────────────

function testWavePatterns() {
  console.log('\n=== Wave Patterns ===');

  wavePatterns.reset();
  wavePatterns.init(null);

  // linear_translation
  const ltId = wavePatterns.activate({
    patternName: 'linear_translation',
    parameters: { direction: 'east', velocity: 0.05, band_width: 0.2, start_position: 0, period: 1.0 },
  });
  assert(typeof ltId === 'string', 'linear_translation returns pattern ID');

  const ltHit = wavePatterns.shouldTransmit('test', { x: 0.04, y: 0.5 }, 0);
  assert(ltHit === true, 'linear_translation: node in band at cycle 0');

  const ltMiss = wavePatterns.shouldTransmit('test', { x: 0.8, y: 0.5 }, 0);
  assert(ltMiss === false, 'linear_translation: node outside band at cycle 0');

  wavePatterns.deactivate(ltId);

  // radial_expansion
  const reId = wavePatterns.activate({
    patternName: 'radial_expansion',
    parameters: { center: { x: 0.5, y: 0.5 }, expansion_rate: 0.02, ring_width: 0.1, start_radius: 0 },
  });
  assert(typeof reId === 'string', 'radial_expansion returns pattern ID');

  const reHit10 = wavePatterns.shouldTransmit('test', { x: 0.7, y: 0.5 }, 10);
  assert(reHit10 === true, 'radial_expansion: node on ring at cycle 10 (radius=0.2, dist=0.2)');

  wavePatterns.deactivate(reId);

  // random_walk_cluster
  const rwId = wavePatterns.activate({
    patternName: 'random_walk_cluster',
    parameters: { seed: 42, cluster_radius: 0.1, velocity: 0.01, initial_position: { x: 0.5, y: 0.5 } },
  });
  assert(typeof rwId === 'string', 'random_walk_cluster returns pattern ID');

  const rwHit = wavePatterns.shouldTransmit('test', { x: 0.5, y: 0.5 }, 0);
  assert(rwHit === true, 'random_walk_cluster: node at initial position hit at cycle 0');

  wavePatterns.deactivate(rwId);

  // phantom_convoy
  const pcId = wavePatterns.activate({
    patternName: 'phantom_convoy',
    parameters: {
      path: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
      velocity: 0.05,
      convoy_length: 0.2,
      loop: true,
    },
  });
  assert(typeof pcId === 'string', 'phantom_convoy returns pattern ID');

  const pcHit = wavePatterns.shouldTransmit('test', { x: 0.05, y: 0.5 }, 1);
  assert(pcHit === true, 'phantom_convoy: node on path near head at cycle 1');

  wavePatterns.deactivate(pcId);

  // composite: multiple active patterns (union)
  wavePatterns.activate({
    patternName: 'linear_translation',
    parameters: { direction: 'east', velocity: 0.05, band_width: 0.2, start_position: 0, period: 1.0 },
  });
  wavePatterns.activate({
    patternName: 'radial_expansion',
    parameters: { center: { x: 0.5, y: 0.5 }, expansion_rate: 0.05, ring_width: 0.1, start_radius: 0 },
  });
  const active = wavePatterns.getActivePatterns();
  assert(active.length === 2, 'composite: two patterns active simultaneously');

  wavePatterns.reset();
  assert(wavePatterns.getActivePatterns().length === 0, 'reset clears all patterns');
}

function testFakeData() {
  console.log('\n=== Fake Data ===');

  fakeData.init(null);

  const payload = fakeData.generatePayload('DECOY-0001', 1);
  assert(payload !== null && payload !== undefined, 'generatePayload returns non-null');
  assert(payload.encrypted === true, 'payload marked as encrypted');
  assert(typeof payload.data === 'string', 'payload data is base64 string');
  assert(payload.size === frame.MAX_MESH_PAYLOAD, `payload size matches frame MAX_MESH_PAYLOAD (${frame.MAX_MESH_PAYLOAD})`);

  const p1 = fakeData.generatePayload('DECOY-0001', 1);
  const p2 = fakeData.generatePayload('DECOY-0001', 1);
  assert(p1.data !== p2.data, 'two payloads for same node/cycle differ (random noise)');

  fakeData.setStrategy('encrypted_noise');
  assert(fakeData.getStrategy() === 'encrypted_noise', 'strategy setter/getter works');

  let threw = false;
  try {
    fakeData.setStrategy('invalid');
  } catch {
    threw = true;
  }
  assert(threw, 'setStrategy rejects unknown strategy');
}

function testHoneypot() {
  console.log('\n=== Honeypot ===');

  const state = createMockState();
  honeypot.reset();
  honeypot.init(state);

  honeypot.registerHoneypot('HP-001', { x: 0.3, y: 0.7 }, ['acoustic', 'ir']);

  const hps = honeypot.getHoneypots();
  assert(hps.length === 1, 'one honeypot registered');
  assert(hps[0].nodeId === 'HP-001', 'honeypot ID correct');
  assert(hps[0].sensors.length === 2, 'honeypot has two sensors');

  let triggeredEvent = null;
  state.on('deception.honeypot_triggered', (data) => {
    triggeredEvent = data;
  });

  let simulatedFrame = null;
  state.on('radio.frame_received_simulated', (data) => {
    simulatedFrame = data;
  });

  const report = honeypot.trigger('HP-001', 'artillery', {
    direction_of_arrival: 270,
    amplitude: -35,
    certainty: 0.92,
  });

  assert(report.type === 'honeypot_report', 'report type is honeypot_report');
  assert(report.honeypot_id === 'HP-001', 'report has correct honeypot ID');
  assert(report.sensor === 'acoustic', 'report uses first sensor');
  assert(report.classification === 'artillery_overpressure', 'classification correct for acoustic+artillery');

  assert(triggeredEvent !== null, 'deception.honeypot_triggered event emitted');
  assert(triggeredEvent.eventType === 'artillery', 'triggered event has correct type');

  assert(simulatedFrame !== null, 'radio.frame_received_simulated emitted');
  assert(simulatedFrame.mesh.class === 'urgent', 'honeypot frame uses urgent class');
  assert(simulatedFrame.mesh.dst === 'HQ', 'honeypot frame routed to HQ');

  // Verify MAC on the honeypot frame
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, simulatedFrame.cycle);
  const content = Buffer.from(
    JSON.stringify({
      type: simulatedFrame.type,
      cycle: simulatedFrame.cycle,
      slot: simulatedFrame.slot,
      source_node: simulatedFrame.source_node,
      sequence: simulatedFrame.sequence,
      mesh: simulatedFrame.mesh,
    }),
  );
  const macValid = cryptoUtils.verifyMac(content, cycleKey, Buffer.from(simulatedFrame.mac, 'hex'));
  assert(macValid, 'honeypot frame MAC verifies');

  honeypot.reset();
}

function testDecoySimulatorSpawn() {
  console.log('\n=== Decoy Simulator: Spawn ===');

  const state = createMockState();
  decoySimulator.reset();
  decoySimulator.init(state);

  const ids = decoySimulator.spawnDecoys(47, { x: [0, 1], y: [0, 1] });
  assert(ids.length === 47, 'spawned 47 decoys');
  assert(ids[0].startsWith('DECOY-'), 'decoy IDs start with DECOY-');

  const states = decoySimulator.getStates();
  assert(Object.keys(states).length === 47, 'getStates returns 47 entries');

  const first = states[ids[0]];
  assert(first.type === 'decoy', 'type is decoy');
  assert(first.position.x >= 0 && first.position.x <= 1, 'x position in range');
  assert(first.position.y >= 0 && first.position.y <= 1, 'y position in range');

  const hpId = decoySimulator.spawnHoneypot({ x: 0.5, y: 0.5 }, ['acoustic']);
  assert(hpId.startsWith('HP-'), 'honeypot ID starts with HP-');

  const allStates = decoySimulator.getStates();
  assert(Object.keys(allStates).length === 48, '48 total nodes after adding honeypot');

  decoySimulator.destroyNode(ids[0]);
  assert(Object.keys(decoySimulator.getStates()).length === 47, 'destroy removes one node');

  decoySimulator.reset();
}

function testDecoyBurstCycle() {
  console.log('\n=== Decoy Burst Cycle (20 cycles with linear_translation) ===');

  const state = createMockState();
  decoySimulator.reset();
  decoySimulator.init(state);

  const ids = decoySimulator.spawnDecoys(47, { x: [0, 1], y: [0, 1] });

  wavePatterns.activate({
    patternName: 'linear_translation',
    parameters: {
      direction: 'east',
      velocity: 0.05,
      band_width: 0.2,
      start_position: 0,
      period: 1.0,
    },
  });

  const frames = [];
  state.on('radio.frame_received_simulated', (data) => {
    frames.push(data);
  });

  const txCountsPerCycle = [];
  for (let cycle = 0; cycle < 20; cycle++) {
    state._store.cycle.number = cycle;
    const count = decoySimulator.onCycleBurst({ number: cycle });
    txCountsPerCycle.push(count);
  }

  assert(frames.length > 0, `frames emitted across 20 cycles: ${frames.length}`);

  const someTransmit = txCountsPerCycle.some((c) => c > 0);
  assert(someTransmit, 'at least some cycles have transmitting decoys');

  const notAllSame = new Set(txCountsPerCycle).size > 1;
  assert(notAllSame, 'transmit count varies across cycles (pattern sweeps)');

  console.log(`  INFO: transmit counts per cycle: [${txCountsPerCycle.join(', ')}]`);

  // Verify frames are valid (MAC check)
  let macPassCount = 0;
  for (const f of frames) {
    const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, f.cycle);
    const content = Buffer.from(
      JSON.stringify({
        type: f.type,
        cycle: f.cycle,
        slot: f.slot,
        source_node: f.source_node,
        sequence: f.sequence,
        mesh: f.mesh,
      }),
    );
    if (cryptoUtils.verifyMac(content, cycleKey, Buffer.from(f.mac, 'hex'))) {
      macPassCount++;
    }
  }
  assert(macPassCount === frames.length, `all ${frames.length} frames pass MAC verification`);

  // Frame format check
  const sample = frames[0];
  assert(typeof sample.type === 'string', 'frame has type string');
  assert(typeof sample.cycle === 'number', 'frame has cycle number');
  assert(typeof sample.slot === 'number', 'frame has slot number');
  assert(typeof sample.source_node === 'string', 'frame has source_node string');
  assert(typeof sample.sequence === 'number', 'frame has sequence number');
  assert(typeof sample.mac === 'string', 'frame has MAC string');
  assert(sample.mesh !== null, 'frame has mesh payload');

  // Verify frame size equivalence via binary encoding
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, sample.cycle);
  const encoded = frame.encodeTransmissionFrame(sample, cycleKey);
  assert(encoded.length === frame.TRANSMISSION_FRAME_SIZE, `binary frame is ${frame.TRANSMISSION_FRAME_SIZE} bytes (same as real nodes)`);

  // Verify pattern sweep: nodes near x=0 transmit early, nodes near x=0.5 transmit mid
  const earlyTxPositions = [];
  const lateTxPositions = [];
  for (const f of frames) {
    const nodeState = decoySimulator.getStates()[f.source_node];
    if (!nodeState) continue;
    if (f.cycle < 5) earlyTxPositions.push(nodeState.position.x);
    if (f.cycle >= 15) lateTxPositions.push(nodeState.position.x);
  }
  if (earlyTxPositions.length > 0 && lateTxPositions.length > 0) {
    const earlyMean = earlyTxPositions.reduce((a, b) => a + b, 0) / earlyTxPositions.length;
    const lateMean = lateTxPositions.reduce((a, b) => a + b, 0) / lateTxPositions.length;
    assert(
      lateMean > earlyMean,
      `pattern sweep: late cycle mean x (${lateMean.toFixed(3)}) > early cycle mean x (${earlyMean.toFixed(3)})`,
    );
  }

  decoySimulator.reset();
}

function testAllPatternDistinctness() {
  console.log('\n=== Pattern Distinctness ===');

  const patterns = [
    {
      name: 'linear_translation',
      params: { direction: 'east', velocity: 0.05, band_width: 0.2, start_position: 0, period: 1.0 },
    },
    {
      name: 'radial_expansion',
      params: { center: { x: 0.5, y: 0.5 }, expansion_rate: 0.02, ring_width: 0.1, start_radius: 0 },
    },
    {
      name: 'random_walk_cluster',
      params: { seed: 42, cluster_radius: 0.1, velocity: 0.01, initial_position: { x: 0.5, y: 0.5 } },
    },
    {
      name: 'phantom_convoy',
      params: {
        path: [{ x: 0, y: 0.5 }, { x: 0.5, y: 0.3 }, { x: 1, y: 0.5 }],
        velocity: 0.04,
        convoy_length: 0.15,
        loop: true,
      },
    },
  ];

  const testNodes = [];
  for (let i = 0; i < 100; i++) {
    testNodes.push({ x: Math.random(), y: Math.random() });
  }

  const signatures = [];

  for (const pat of patterns) {
    wavePatterns.reset();
    wavePatterns.activate({ patternName: pat.name, parameters: pat.params });

    const sig = [];
    for (let cycle = 0; cycle < 20; cycle++) {
      let txCount = 0;
      for (const node of testNodes) {
        if (wavePatterns.shouldTransmit('test', node, cycle)) txCount++;
      }
      sig.push(txCount);
    }
    signatures.push({ name: pat.name, sig });
    console.log(`  INFO: ${pat.name} tx/cycle: [${sig.join(', ')}]`);
  }

  for (let i = 0; i < signatures.length; i++) {
    for (let j = i + 1; j < signatures.length; j++) {
      const same = signatures[i].sig.every((v, k) => v === signatures[j].sig[k]);
      assert(!same, `${signatures[i].name} differs from ${signatures[j].name}`);
    }
  }

  wavePatterns.reset();
}

function testPerformance() {
  console.log('\n=== Performance ===');

  const state = createMockState();
  decoySimulator.reset();
  decoySimulator.init(state);

  decoySimulator.spawnDecoys(50, { x: [0, 1], y: [0, 1] });

  wavePatterns.activate({
    patternName: 'linear_translation',
    parameters: { direction: 'east', velocity: 0.05, band_width: 0.3, start_position: 0, period: 1.0 },
  });

  state._store.cycle.number = 10;

  const times = [];
  for (let i = 0; i < 100; i++) {
    const start = process.hrtime.bigint();
    decoySimulator.onCycleBurst({ number: 10 + i });
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    times.push(elapsed);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const max = Math.max(...times);

  console.log(`  INFO: avg cycle time: ${avg.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
  assert(avg < 50, `average cycle time ${avg.toFixed(2)}ms < 50ms target`);
  assert(max < 100, `max cycle time ${max.toFixed(2)}ms < 100ms`);

  decoySimulator.reset();
}

function testIntegrationWithTransmission() {
  console.log('\n=== Integration: Transmission Module Parse ===');

  const state = createMockState();
  decoySimulator.reset();
  decoySimulator.init(state);
  transmission.init(state, { MASTER_SECRET });

  decoySimulator.spawnDecoys(5, { x: [0, 1], y: [0, 1] });

  wavePatterns.activate({
    patternName: 'linear_translation',
    parameters: { direction: 'east', velocity: 0.5, band_width: 1.0, start_position: 0, period: 2.0 },
  });

  const parsedFrames = [];
  state.on('transmission.frame_received', (data) => {
    parsedFrames.push(data);
  });

  state._store.cycle.number = 1;
  state.emit('cycle.sync_beta_burst', { number: 1 });

  assert(parsedFrames.length > 0, `transmission module parsed ${parsedFrames.length} decoy frames`);

  if (parsedFrames.length > 0) {
    assert(parsedFrames[0].simulated === true, 'parsed frame marked as simulated');
  }

  decoySimulator.reset();
}

function testFacadeAPI() {
  console.log('\n=== Facade API (index.js) ===');

  const state = createMockState();
  decoySimulator.reset();
  deception.init(state);

  const ids = deception.spawnDecoys(10, { x: [0, 1], y: [0, 1] });
  assert(ids.length === 10, 'spawnDecoys via facade returns 10 IDs');

  const hpId = deception.spawnHoneypot({ x: 0.5, y: 0.5 }, ['acoustic']);
  assert(hpId.startsWith('HP-'), 'spawnHoneypot via facade returns HP ID');

  const patId = deception.activatePattern('linear_translation', {
    direction: 'east', velocity: 0.05, band_width: 0.2,
  });
  assert(typeof patId === 'string', 'activatePattern returns ID');

  const active = deception.getActivePatterns();
  assert(active.length === 1, 'one active pattern');

  deception.deactivatePattern(patId);
  assert(deception.getActivePatterns().length === 0, 'pattern deactivated');

  const states = deception.getDecoyStates();
  assert(Object.keys(states).length === 11, '11 nodes in decoy states (10 decoys + 1 honeypot)');

  const report = deception.triggerHoneypot(hpId, 'drone', {});
  assert(report.type === 'honeypot_report', 'triggerHoneypot returns report');

  decoySimulator.reset();
}

// ─── Run ───────────────────────────────────────────────────────────

console.log('Deception Engine — Test Harness');
console.log('================================');

testWavePatterns();
testFakeData();
testHoneypot();
testDecoySimulatorSpawn();
testDecoyBurstCycle();
testAllPatternDistinctness();
testPerformance();
testIntegrationWithTransmission();
testFacadeAPI();

console.log('\n================================');
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
