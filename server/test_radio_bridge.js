'use strict';

const assert = require('assert');
const cryptoUtils = require('./protocol/crypto');
const frame = require('./protocol/frame');
const transmission = require('./protocol/transmission');
const { handleRadioEvent } = require('./radio_bridge');
const { state } = require('./state');

const MASTER_SECRET = 'tactical-mesh-default-secret-change-me';

let passed = 0;
let failed = 0;

function check(label, condition) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
    passed++;
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`);
    failed++;
  }
}

// --- Tests ---

console.log('\n\x1b[1m[radio bridge — encode/decode round-trip]\x1b[0m');
{
  const cycle = 42;
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycle);

  const frameObj = {
    type: 'data',
    cycle,
    slot: 7,
    source_node: 'ALPHA-3',
    sequence: 100,
    mesh: {
      src: 'ALPHA-3',
      dst: 'HQ',
      ttl: 5,
      class: 'urgent',
      sequence: 100,
      app: { type: 'sitrep', content: 'contact north' },
    },
  };

  const encoded = frame.encodeTransmissionFrame(frameObj, cycleKey);
  check('Encoded frame is 256 bytes', encoded.length === 256);

  const payload_b64 = encoded.toString('base64');
  check('Base64 payload is a string', typeof payload_b64 === 'string');

  const decoded_buf = Buffer.from(payload_b64, 'base64');
  check('Decoded buffer matches original', Buffer.compare(encoded, decoded_buf) === 0);

  const decoded = frame.decodeTransmissionFrame(decoded_buf, cycleKey);
  check('Frame decodes successfully via AEAD', decoded !== null);
  check('Decoded type is data', decoded.type === 'data');
  check('Decoded cycle is 42', decoded.cycle === 42);
  check('Decoded slot is 7', decoded.slot === 7);
  check('Decoded sequence is 100', decoded.sequence === 100);
  check('Mesh payload decoded', decoded.mesh !== null);
  check('Mesh destination is HQ', decoded.mesh.dst === 'HQ');
  check('Mesh class is urgent', decoded.mesh.class === 'urgent');
  check('App payload preserved', decoded.mesh.app?.content === 'contact north');

  const wrongKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycle + 1);
  const wrongDecode = frame.decodeTransmissionFrame(decoded_buf, wrongKey);
  check('Wrong key rejects frame', wrongDecode === null);
}

console.log('\n\x1b[1m[radio bridge — inbound: Rust event → state]\x1b[0m');
{
  const cycle = 55;
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycle);

  const frameObj = {
    type: 'data',
    cycle,
    slot: 12,
    source_node: 'BRAVO-7',
    sequence: 42,
    mesh: {
      src: 'BRAVO-7',
      dst: 'CHARLIE-1',
      ttl: 3,
      class: 'routine',
      sequence: 42,
      app: { type: 'position', x: 0.5, y: 0.3 },
    },
  };
  const encoded = frame.encodeTransmissionFrame(frameObj, cycleKey);
  const payload_b64 = encoded.toString('base64');

  let receivedEvent = null;
  const handler = (data) => { receivedEvent = data; };
  state.on('radio.frame_received', handler);

  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan2',
    ts: Date.now(),
    src: 'BRAVO-7',
    payload_b64,
    channel: 6,
  });

  check('radio.frame_received was emitted', receivedEvent !== null);
  check('Event contains raw Buffer', Buffer.isBuffer(receivedEvent?.raw));
  check('Raw buffer is 256 bytes', receivedEvent?.raw?.length === 256);
  check('Event preserves iface', receivedEvent?.iface === 'wlan2');
  check('Event preserves channel', receivedEvent?.channel === 6);

  state.off('radio.frame_received', handler);
}

console.log('\n\x1b[1m[radio bridge — full pipeline: Rust → transmission.parseFrame]\x1b[0m');
{
  const cycle = 10;
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycle);

  state.set('cycle.number', cycle);
  transmission.init(state, { MASTER_SECRET });

  let parsedFrame = null;
  const handler = (data) => { parsedFrame = data; };
  state.on('transmission.frame_received', handler);

  const frameObj = {
    type: 'data',
    cycle,
    slot: 3,
    source_node: 'DELTA-5',
    sequence: 7,
    mesh: {
      src: 'DELTA-5',
      dst: 'HQ',
      ttl: 5,
      class: 'urgent',
      sequence: 7,
      app: { type: 'honeypot_report', sensor: 'acoustic' },
    },
  };
  const encoded = frame.encodeTransmissionFrame(frameObj, cycleKey);

  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan1',
    ts: Date.now(),
    src: 'DELTA-5',
    payload_b64: encoded.toString('base64'),
    channel: 11,
  });

  check('transmission.frame_received was emitted', parsedFrame !== null);
  check('Frame type is data', parsedFrame?.type === 'data');
  check('Frame cycle is 10', parsedFrame?.cycle === cycle);
  check('Frame slot is 3', parsedFrame?.slot === 3);
  check('Mesh payload present', parsedFrame?.mesh !== null);
  check('Mesh destination is HQ', parsedFrame?.mesh?.dst === 'HQ');
  check('Mesh class is urgent', parsedFrame?.mesh?.class === 'urgent');
  check('App payload type is honeypot_report', parsedFrame?.mesh?.app?.type === 'honeypot_report');

  state.off('transmission.frame_received', handler);
}

console.log('\n\x1b[1m[radio bridge — outbound encoding]\x1b[0m');
{
  const cycle = 20;
  const cycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycle);

  const frameObj = {
    type: 'data',
    cycle,
    slot: 15,
    source_node: 'ECHO-2',
    sequence: 33,
    mesh: {
      src: 'ECHO-2',
      dst: 'BRAVO-7',
      ttl: 4,
      class: 'routine',
      sequence: 33,
      app: { type: 'ack' },
    },
  };

  const encoded = frame.encodeTransmissionFrame(frameObj, cycleKey);
  const payload_b64 = encoded.toString('base64');
  const raw = Buffer.from(payload_b64, 'base64');
  const decoded = frame.decodeTransmissionFrame(raw, cycleKey);

  check('Outbound frame encodes to 256 bytes', encoded.length === 256);
  check('Base64 round-trips back to 256 bytes', raw.length === 256);
  check('Receiving end decodes successfully', decoded !== null);
  check('Decoded type matches', decoded?.type === 'data');
  check('Decoded mesh preserved', decoded?.mesh?.dst === 'BRAVO-7');
}

console.log('\n\x1b[1m[radio bridge — rejects garbage from RF]\x1b[0m');
{
  state.set('cycle.number', 30);
  transmission.init(state, { MASTER_SECRET });

  let parsedFrame = null;
  const handler = (data) => { parsedFrame = data; };
  state.on('transmission.frame_received', handler);

  // Random 256 bytes — no valid AEAD tag
  const garbage = require('crypto').randomBytes(256);
  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan2',
    ts: Date.now(),
    src: 'UNKNOWN',
    payload_b64: garbage.toString('base64'),
    channel: 1,
  });
  check('Random garbage rejected (no frame emitted)', parsedFrame === null);

  // Too short
  const short = require('crypto').randomBytes(64);
  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan2',
    ts: Date.now(),
    src: 'UNKNOWN',
    payload_b64: short.toString('base64'),
    channel: 1,
  });
  check('Short payload rejected', parsedFrame === null);

  // Empty payload_b64
  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan2',
    ts: Date.now(),
    src: 'UNKNOWN',
    payload_b64: '',
    channel: 1,
  });
  check('Empty payload rejected', parsedFrame === null);

  // Missing payload_b64 field
  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan2',
    ts: Date.now(),
    src: 'UNKNOWN',
    channel: 1,
  });
  check('Missing payload_b64 handled gracefully', parsedFrame === null);

  state.off('transmission.frame_received', handler);
}

console.log('\n\x1b[1m[radio bridge — cross-cycle drift tolerance]\x1b[0m');
{
  // Frame encoded at cycle 50 should decode when server is at cycle 51
  const senderCycle = 50;
  const senderKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, senderCycle);

  state.set('cycle.number', 51);
  transmission.init(state, { MASTER_SECRET });

  let parsedFrame = null;
  const handler = (data) => { parsedFrame = data; };
  state.on('transmission.frame_received', handler);

  const frameObj = {
    type: 'data',
    cycle: senderCycle,
    slot: 5,
    source_node: 'FOXTROT-1',
    sequence: 1,
    mesh: { src: 'FOXTROT-1', dst: 'HQ', ttl: 5, class: 'urgent', sequence: 1, app: null },
  };
  const encoded = frame.encodeTransmissionFrame(frameObj, senderKey);

  handleRadioEvent({
    type: 'frame_received',
    iface: 'wlan1',
    ts: Date.now(),
    src: 'FOXTROT-1',
    payload_b64: encoded.toString('base64'),
    channel: 6,
  });

  check('Frame from previous cycle accepted (drift tolerance)', parsedFrame !== null);
  check('Drift-tolerant frame has correct cycle', parsedFrame?.cycle === senderCycle);

  state.off('transmission.frame_received', handler);
}

// --- Summary ---

console.log(`\n\x1b[1m═══ Results: ${passed} passed, ${failed} failed ═══\x1b[0m`);
if (failed > 0) {
  console.log('\x1b[31mSome tests failed.\x1b[0m');
  process.exit(1);
}
