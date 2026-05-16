'use strict';

const { EventEmitter } = require('events');
const cryptoUtils = require('./crypto');
const frame = require('./frame');
const transmission = require('./transmission');
const mesh = require('./mesh');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Stub state — mimics server/state.js without requiring it
// ---------------------------------------------------------------------------

function createStubState() {
  const ee = new EventEmitter();
  ee.setMaxListeners(200);
  const store = {
    cycle: { number: 0, phase: 'idle' },
    nodes: {},
    drones: {},
    jamming_zones: [],
  };

  function resolve(root, path) {
    const parts = path.split('.');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) current[parts[i]] = {};
      current = current[parts[i]];
    }
    return { parent: current, key: parts[parts.length - 1] };
  }

  return {
    on: (e, h) => ee.on(e, h),
    off: (e, h) => ee.off(e, h),
    emit: (e, p) => ee.emit(e, p),
    get: (path) => {
      const { parent, key } = resolve(store, path);
      return parent[key];
    },
    set: (path, value) => {
      const { parent, key } = resolve(store, path);
      parent[key] = value;
    },
    broadcast: () => {},
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Test 1: Crypto primitives
// ---------------------------------------------------------------------------

function testCrypto() {
  console.log('\n\x1b[1m[crypto.js]\x1b[0m');

  const secret = 'test-master-secret-256bit-value!';
  const key1 = cryptoUtils.deriveCycleKey(secret, 1);
  const key2 = cryptoUtils.deriveCycleKey(secret, 2);
  const key1b = cryptoUtils.deriveCycleKey(secret, 1);

  assert(key1.length === 32, 'Cycle key is 32 bytes');
  assert(!key1.equals(key2), 'Different cycles produce different keys');
  assert(key1.equals(key1b), 'Same cycle produces same key (deterministic)');

  const slot1 = cryptoUtils.deriveSlot(key1, 'N1');
  const slot2 = cryptoUtils.deriveSlot(key1, 'N2');
  const slot1b = cryptoUtils.deriveSlot(key1, 'N1');
  assert(slot1 >= 0 && slot1 < 50, `Slot in range [0,50): got ${slot1}`);
  assert(slot1 === slot1b, 'Slot derivation is deterministic');
  assert(typeof slot2 === 'number', 'Second node gets a numeric slot');

  const plaintext = Buffer.from('hello tactical mesh');
  const nonce = cryptoUtils.generateNonce();
  const { ciphertext, tag } = cryptoUtils.encrypt(plaintext, key1, nonce);
  assert(ciphertext.length === plaintext.length, 'Ciphertext same length as plaintext');
  assert(tag.length === 16, 'Auth tag is 16 bytes');

  const decrypted = cryptoUtils.decrypt(ciphertext, key1, nonce, tag);
  assert(decrypted.equals(plaintext), 'Decrypt recovers original plaintext');

  let tamperRejected = false;
  try {
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;
    cryptoUtils.decrypt(tampered, key1, nonce, tag);
  } catch {
    tamperRejected = true;
  }
  assert(tamperRejected, 'Tampered ciphertext is rejected');

  const data = Buffer.from('mac test data');
  const macVal = cryptoUtils.mac(data, key1);
  assert(macVal.length === 16, 'MAC is 16 bytes');
  assert(cryptoUtils.verifyMac(data, key1, macVal), 'MAC verification succeeds');
  assert(!cryptoUtils.verifyMac(Buffer.from('wrong'), key1, macVal), 'MAC rejects wrong data');

  const hops = cryptoUtils.deriveHopSequence(secret, 'N1', 1, 5, [1, 6, 11], 10);
  assert(hops.length === 10, `Hop sequence has 10 entries: got ${hops.length}`);
  assert(hops.every((h) => [1, 6, 11].includes(h)), 'All hops are valid channels');
}

// ---------------------------------------------------------------------------
// Test 2: Frame encode / decode
// ---------------------------------------------------------------------------

function testFrame() {
  console.log('\n\x1b[1m[frame.js]\x1b[0m');

  const secret = 'test-master-secret-256bit-value!';
  const key = cryptoUtils.deriveCycleKey(secret, 1);

  const frameObj = {
    type: 'data',
    cycle: 42,
    slot: 7,
    source_node: 'N1',
    sequence: 100,
    mesh: { src: 'N1', dst: 'N5', ttl: 5, class: 'routine', sequence: 1, app: { msg: 'hello' } },
  };

  const encoded = frame.encodeTransmissionFrame(frameObj, key);
  assert(encoded.length === 256, `Encoded frame is 256 bytes: got ${encoded.length}`);

  const decoded = frame.decodeTransmissionFrame(encoded, key);
  assert(decoded !== null, 'Frame decodes successfully');
  assert(decoded.type === 'data', `Frame type is data: got ${decoded.type}`);
  assert(decoded.cycle === 42, `Cycle is 42: got ${decoded.cycle}`);
  assert(decoded.slot === 7, `Slot is 7: got ${decoded.slot}`);
  assert(decoded.sequence === 100, `Sequence is 100: got ${decoded.sequence}`);
  assert(decoded.mesh !== null, 'Mesh payload decoded');
  assert(decoded.mesh.dst === 'N5', `Mesh destination is N5: got ${decoded.mesh.dst}`);

  const wrongKey = cryptoUtils.deriveCycleKey(secret, 999);
  const badDecode = frame.decodeTransmissionFrame(encoded, wrongKey);
  assert(badDecode === null, 'Wrong key produces null decode');

  const coverFrame = {
    type: 'cover_fill',
    cycle: 42,
    slot: 7,
    source_node: 'N1',
    sequence: 100,
    mesh: null,
  };
  const coverEncoded = frame.encodeTransmissionFrame(coverFrame, key);
  assert(coverEncoded.length === 256, 'Cover-fill frame is also 256 bytes (indistinguishable size)');

  const padded = frame.padPayload(Buffer.from('short'), 100);
  assert(padded.length === 100, `Padded to target size: got ${padded.length}`);
  assert(padded.subarray(0, 5).toString() === 'short', 'Original content preserved in padding');
}

// ---------------------------------------------------------------------------
// Test 3: Transmission layer — slot assignment & frame composition
// ---------------------------------------------------------------------------

function testTransmission() {
  console.log('\n\x1b[1m[transmission.js]\x1b[0m');

  const state = createStubState();
  const secret = 'test-master-secret-256bit-value!';

  const nodeIds = ['N1', 'N2', 'N3', 'N4', 'N5'];
  for (const id of nodeIds) {
    state.set(`nodes.${id}`, { type: 'ground', position: { x: 0, y: 0 }, state: 'active' });
  }

  transmission.init(state, { MASTER_SECRET: secret });

  const slotsPerCycle = new Map();
  for (let cycle = 1; cycle <= 10; cycle++) {
    const slots = new Set();
    for (const id of nodeIds) {
      const { slotIndex, frequencyHops } = transmission.allocateSlot(id, cycle);
      assert(slotIndex >= 0 && slotIndex < 50, `Cycle ${cycle} ${id}: slot ${slotIndex} in range`);
      assert(frequencyHops.length === 10, `Cycle ${cycle} ${id}: 10 frequency hops`);
      slots.add(`${id}:${slotIndex}`);
    }
    slotsPerCycle.set(cycle, slots);
  }

  const cycle1Slots = [];
  for (const id of nodeIds) {
    cycle1Slots.push(transmission.allocateSlot(id, 1).slotIndex);
  }
  const uniqueSlots = new Set(cycle1Slots);
  assert(uniqueSlots.size === nodeIds.length, `All 5 nodes get unique slots in cycle 1: ${[...uniqueSlots]}`);

  const slot1a = transmission.allocateSlot('N1', 1).slotIndex;
  const slot1b = transmission.allocateSlot('N1', 1).slotIndex;
  assert(slot1a === slot1b, 'Slot assignment is deterministic');

  const composed = transmission.composeFrame({
    sourceNode: 'N1',
    sequenceNumber: 1,
    cycle: 1,
    slot: 5,
    meshPayload: { src: 'N1', dst: 'N3', ttl: 5, class: 'routine', sequence: 1, app: { data: 'test' } },
  });
  assert(composed.type === 'data', 'Composed frame type is data');
  assert(composed.mac !== undefined, 'Composed frame has MAC');

  const parsed = transmission.parseFrame(composed);
  assert(parsed !== null, 'MAC-valid frame parses successfully');
  assert(parsed.source_node === 'N1', 'Parsed frame has correct source');

  const tampered = { ...composed, mesh: { ...composed.mesh, dst: 'TAMPERED' } };
  const parsedTampered = transmission.parseFrame(tampered);
  assert(parsedTampered === null, 'Tampered frame rejected by MAC validation');

  const coverFill = transmission.composeFrame({
    sourceNode: 'N2',
    sequenceNumber: 2,
    cycle: 1,
    slot: 10,
    meshPayload: null,
  });
  assert(coverFill.type === 'cover_fill', 'Null payload produces cover_fill frame');
  assert(coverFill.mac !== undefined, 'Cover-fill frame also has MAC');

  const hops = transmission.getHopSequence('N1', 1, 5);
  assert(Array.isArray(hops) && hops.length === 10, 'getHopSequence returns array of 10');
}

// ---------------------------------------------------------------------------
// Test 4: Mesh layer — neighbors, routing, jamming
// ---------------------------------------------------------------------------

function testMesh() {
  console.log('\n\x1b[1m[mesh.js]\x1b[0m');

  mesh.reset();
  const state = createStubState();

  // Linear topology: N1 -- N2 -- N3 -- N4 -- N5
  const nodes = {
    N1: { type: 'ground', position: { x: 0.1, y: 0.5 }, state: 'active' },
    N2: { type: 'ground', position: { x: 0.3, y: 0.5 }, state: 'active' },
    N3: { type: 'ground', position: { x: 0.5, y: 0.5 }, state: 'active' },
    N4: { type: 'ground', position: { x: 0.7, y: 0.5 }, state: 'active' },
    N5: { type: 'ground', position: { x: 0.9, y: 0.5 }, state: 'active' },
  };

  for (const [id, info] of Object.entries(nodes)) {
    state.set(`nodes.${id}`, info);
  }

  mesh.init(state, { DV_ANNOUNCE_INTERVAL: 1, NEIGHBOR_TIMEOUT_CYCLES: 1000 });

  // Build linear topology via neighbor registration
  const baseCycle = 100;
  mesh.updateNeighbor('N1', 'N2', 0.9, baseCycle);
  mesh.updateNeighbor('N2', 'N3', 0.85, baseCycle);
  mesh.updateNeighbor('N3', 'N4', 0.8, baseCycle);
  mesh.updateNeighbor('N4', 'N5', 0.75, baseCycle);

  const n1Neighbors = mesh.getNeighbors('N1');
  assert(n1Neighbors.length === 1, `N1 has 1 neighbor: got ${n1Neighbors.length}`);
  assert(n1Neighbors[0].nodeId === 'N2', 'N1 neighbor is N2');

  const n3Neighbors = mesh.getNeighbors('N3');
  assert(n3Neighbors.length === 2, `N3 has 2 neighbors: got ${n3Neighbors.length}`);

  // Run DV convergence rounds (need >= 4 for a 5-node linear chain)
  for (let i = 0; i < 6; i++) {
    state.emit('cycle.sync_alpha', { number: baseCycle + i });
  }

  // Routine routing: N1 → N5 should go through N2
  const nextHop = mesh.routePacket({ src: 'N1', dst: 'N5', mode: 'routine' });
  assert(nextHop === 'N2', `N1 → N5 routine routes via N2: got ${nextHop}`);

  // Urgent routing: N1 → N5 should also produce a next-hop
  const urgentHops = mesh.routePacket({ src: 'N1', dst: 'N5', mode: 'urgent' });
  const urgentArr = Array.isArray(urgentHops) ? urgentHops : [urgentHops];
  assert(urgentArr.includes('N2'), `N1 → N5 urgent flood includes N2: got [${urgentArr}]`);

  // Full hop path from N1 to N5
  const path = [];
  let current = 'N1';
  for (let step = 0; step < 10; step++) {
    const hop = mesh.routePacket({ src: current, dst: 'N5', mode: 'routine' });
    if (!hop || hop === 'N5') {
      if (hop === 'N5') path.push(hop);
      break;
    }
    path.push(hop);
    current = hop;
  }
  assert(path.length > 0 && path[path.length - 1] === 'N5', `Path from N1 → N5: [${path.join(' → ')}]`);

  // Frame handling: receive at N3 destined for N5, should forward
  const testFrame = {
    type: 'data',
    cycle: 1,
    slot: 5,
    source_node: 'N2',
    sequence: 1,
    mesh: { src: 'N1', dst: 'N5', ttl: 5, class: 'routine', sequence: 42, app: { msg: 'test' } },
  };

  const result = mesh.handleReceivedFrame('N3', testFrame);
  assert(
    result.action === 'forward' || result.action === 'forward_flood',
    `N3 forwards frame toward N5: got ${result.action}`,
  );

  // Duplicate suppression
  const dupResult = mesh.handleReceivedFrame('N3', testFrame);
  assert(dupResult.action === 'drop' && dupResult.reason === 'duplicate', 'Duplicate frame is dropped');

  // Delivery to destination
  const deliverFrame = {
    type: 'data',
    cycle: 1,
    slot: 5,
    source_node: 'N4',
    sequence: 1,
    mesh: { src: 'N1', dst: 'N5', ttl: 3, class: 'routine', sequence: 99, app: { msg: 'arrived' } },
  };
  let delivered = false;
  state.on('mesh.packet_delivered', () => {
    delivered = true;
  });
  const deliverResult = mesh.handleReceivedFrame('N5', deliverFrame);
  assert(deliverResult.action === 'consume', `Frame consumed at destination: got ${deliverResult.action}`);
  assert(delivered, 'mesh.packet_delivered event emitted');

  // TTL exhaustion
  const ttlFrame = {
    type: 'data',
    cycle: 1,
    slot: 5,
    source_node: 'N2',
    sequence: 1,
    mesh: { src: 'N1', dst: 'N5', ttl: 1, class: 'routine', sequence: 200, app: null },
  };
  const ttlResult = mesh.handleReceivedFrame('N3', ttlFrame);
  assert(ttlResult.action === 'drop' && ttlResult.reason === 'ttl_exhausted', 'TTL exhausted drops frame');
}

// ---------------------------------------------------------------------------
// Test 5: Jamming and reconvergence
// ---------------------------------------------------------------------------

function testJamming() {
  console.log('\n\x1b[1m[mesh.js — jamming]\x1b[0m');

  mesh.reset();
  const state = createStubState();

  const nodes = {
    N1: { type: 'ground', position: { x: 0.1, y: 0.5 }, state: 'active' },
    N2: { type: 'ground', position: { x: 0.3, y: 0.5 }, state: 'active' },
    N3: { type: 'ground', position: { x: 0.5, y: 0.5 }, state: 'active' },
    N4: { type: 'ground', position: { x: 0.7, y: 0.5 }, state: 'active' },
    N5: { type: 'ground', position: { x: 0.9, y: 0.5 }, state: 'active' },
    DRONE1: { type: 'drone', position: { x: 0.5, y: 0.3 }, state: 'active' },
  };

  for (const [id, info] of Object.entries(nodes)) {
    state.set(`nodes.${id}`, info);
  }

  mesh.init(state, { DV_ANNOUNCE_INTERVAL: 1, NEIGHBOR_TIMEOUT_CYCLES: 1000 });

  const baseCycle = 100;
  mesh.updateNeighbor('N1', 'N2', 0.9, baseCycle);
  mesh.updateNeighbor('N2', 'N3', 0.85, baseCycle);
  mesh.updateNeighbor('N3', 'N4', 0.8, baseCycle);
  mesh.updateNeighbor('N4', 'N5', 0.75, baseCycle);
  mesh.updateNeighbor('N1', 'DRONE1', 0.95, baseCycle);
  mesh.updateNeighbor('N5', 'DRONE1', 0.9, baseCycle);

  // Converge routing
  for (let i = 0; i < 6; i++) {
    state.emit('cycle.sync_alpha', { number: baseCycle + i });
  }

  // DV routing picks shortest path: N1 → DRONE1 → N5 (2 hops) beats ground path (4 hops)
  const preJamRoute = mesh.routePacket({ src: 'N1', dst: 'N5', mode: 'routine' });
  assert(preJamRoute === 'DRONE1', `Pre-jam route N1 → N5 via DRONE1 (shortest): got ${preJamRoute}`);

  // Jam N3 area
  let convergeEmitted = false;
  state.on('mesh.routing_converged', (data) => {
    if (data.reason === 'jamming') convergeEmitted = true;
  });

  const affected = mesh.declareJammed({ center: { x: 0.5, y: 0.5 }, radius: 0.15 });
  assert(affected.includes('N3'), `N3 affected by jamming: affected = [${affected}]`);
  assert(convergeEmitted, 'mesh.routing_converged emitted on jamming');

  const n2Neighbors = mesh.getNeighbors('N2');
  const n2HasN3 = n2Neighbors.some((n) => n.nodeId === 'N3');
  assert(!n2HasN3, 'N2 no longer has N3 as neighbor after jamming');

  // Post-jam: N1 should route via DRONE1 if N2 → N3 is broken
  const postJamRoute = mesh.routePacket({ src: 'N1', dst: 'N5', mode: 'routine' });
  assert(postJamRoute !== null, `Post-jam route exists: got ${postJamRoute}`);
}

// ---------------------------------------------------------------------------
// Test 6: Cross-domain forwarding
// ---------------------------------------------------------------------------

function testCrossDomain() {
  console.log('\n\x1b[1m[mesh.js — cross-domain]\x1b[0m');

  mesh.reset();
  const state = createStubState();

  state.set('nodes.N1', { type: 'ground', position: { x: 0.1, y: 0.5 }, state: 'active' });
  state.set('nodes.DRONE1', { type: 'drone', position: { x: 0.3, y: 0.3 }, state: 'active' });

  mesh.init(state, { DV_ANNOUNCE_INTERVAL: 1, NEIGHBOR_TIMEOUT_CYCLES: 1000 });

  const baseCycle = 100;
  mesh.updateNeighbor('N1', 'DRONE1', 0.95, baseCycle);

  for (let i = 0; i < 3; i++) {
    state.emit('cycle.sync_alpha', { number: baseCycle + i });
  }

  const hqRoute = mesh.routePacket({ src: 'N1', dst: 'HQ', mode: 'routine' });
  assert(hqRoute === 'DRONE1', `N1 → HQ routes via DRONE1: got ${hqRoute}`);

  // Drone receives HQ-bound frame — should deliver to fiber
  let fiberDelivery = false;
  state.on('mesh.packet_delivered', (data) => {
    if (data.via === 'fiber') fiberDelivery = true;
  });

  mesh.handleReceivedFrame('DRONE1', {
    type: 'data',
    cycle: 1,
    slot: 5,
    source_node: 'N1',
    sequence: 1,
    mesh: { src: 'N1', dst: 'HQ', ttl: 5, class: 'urgent', sequence: 1, app: { report: 'contact' } },
  });

  assert(fiberDelivery, 'HQ-bound frame delivered via fiber at drone');
}

// ---------------------------------------------------------------------------
// Test 7: Full integration — 10-cycle simulation
// ---------------------------------------------------------------------------

function testIntegration() {
  console.log('\n\x1b[1m[integration — 10-cycle simulation]\x1b[0m');

  mesh.reset();
  const state = createStubState();
  const secret = 'integration-test-secret-value!!';

  const nodeIds = ['N1', 'N2', 'N3', 'N4', 'N5'];
  for (const id of nodeIds) {
    state.set(`nodes.${id}`, { type: 'ground', position: { x: 0, y: 0 }, state: 'active' });
  }

  transmission.init(state, { MASTER_SECRET: secret });
  mesh.init(state, { DV_ANNOUNCE_INTERVAL: 1, NEIGHBOR_TIMEOUT_CYCLES: 1000 });

  const baseCycle = 100;
  mesh.updateNeighbor('N1', 'N2', 0.9, baseCycle);
  mesh.updateNeighbor('N2', 'N3', 0.85, baseCycle);
  mesh.updateNeighbor('N3', 'N4', 0.8, baseCycle);
  mesh.updateNeighbor('N4', 'N5', 0.75, baseCycle);

  const allFrames = [];
  state.on('transmission.frame_to_send', (f) => allFrames.push(f));

  let deliveredCount = 0;
  state.on('mesh.packet_delivered', () => deliveredCount++);

  for (let cycle = baseCycle; cycle < baseCycle + 10; cycle++) {
    state.set('cycle.number', cycle);
    state.emit('cycle.sync_alpha', { number: cycle });

    for (const id of nodeIds) {
      const hasPayload = cycle % 3 === 0;
      transmission.composeFrame({
        sourceNode: id,
        sequenceNumber: cycle * 100 + nodeIds.indexOf(id),
        cycle,
        meshPayload: hasPayload
          ? {
              src: id,
              dst: id === 'N1' ? 'N5' : 'N1',
              ttl: 5,
              class: 'routine',
              sequence: cycle * 100 + nodeIds.indexOf(id),
              app: { sitrep: `cycle ${cycle}` },
            }
          : null,
      });
    }

    state.emit('cycle.sync_beta_burst', { number: cycle });
    state.emit('cycle.idle', { number: cycle });
  }

  assert(allFrames.length >= 50, `Generated ${allFrames.length} frames over 10 cycles (≥50 expected)`);

  const dataFrames = allFrames.filter((f) => f.type === 'data');
  const coverFrames = allFrames.filter((f) => f.type === 'cover_fill');
  assert(dataFrames.length > 0, `Data frames composed: ${dataFrames.length}`);
  assert(coverFrames.length > 0, `Cover-fill frames composed: ${coverFrames.length}`);

  let encodeDecodeOk = true;
  for (const f of dataFrames.slice(0, 5)) {
    const key = cryptoUtils.deriveCycleKey(secret, f.cycle);
    const encoded = frame.encodeTransmissionFrame(f, key);
    const decoded = frame.decodeTransmissionFrame(encoded, key);
    if (!decoded || decoded.cycle !== f.cycle) {
      encodeDecodeOk = false;
      break;
    }
  }
  assert(encodeDecodeOk, 'All sampled data frames survive encode → decode roundtrip');

  // DV convergence already happened during the 10 cycles above
  const routeN1toN5 = mesh.routePacket({ src: 'N1', dst: 'N5', mode: 'routine' });
  assert(routeN1toN5 !== null, `End-to-end route N1 → N5 exists: via ${routeN1toN5}`);

  console.log(
    `\n  Integration: ${allFrames.length} frames, ${dataFrames.length} data, ${coverFrames.length} cover-fill`,
  );
}

// ---------------------------------------------------------------------------
// Run all tests
// ---------------------------------------------------------------------------

console.log('\x1b[1m\n═══ Tactical Mesh Protocol — Test Harness ═══\x1b[0m');

testCrypto();
testFrame();
testTransmission();
testMesh();
testJamming();
testCrossDomain();
testIntegration();

console.log(`\n\x1b[1m═══ Results: ${passed} passed, ${failed} failed ═══\x1b[0m`);

if (failed > 0) {
  console.log('\x1b[31mSome tests failed.\x1b[0m');
  process.exit(1);
} else {
  console.log('\x1b[32mAll tests passed.\x1b[0m');
}
