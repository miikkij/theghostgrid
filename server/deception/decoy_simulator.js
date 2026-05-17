'use strict';

const crypto = require('node:crypto');
const cryptoUtils = require('../protocol/crypto');
const mesh = require('../protocol/mesh');
const wavePatterns = require('./wave_patterns');
const fakeData = require('./fake_data');
const honeypot = require('./honeypot');

const MASTER_SECRET = require('../config').protocol.master_secret;

const NODE_STATES = {
  LISTENING: 'LISTENING',
  SYNC: 'SYNC',
  TX: 'TX',
  RX: 'RX',
  DEAD: 'DEAD',
};

let _state = null;
let _nextDecoyId = 1;
let _nextHoneypotId = 1;
const _decoys = new Map();
const _sequences = new Map();
let _lastCycleKey = null;
let _lastCycleNumber = -1;

function init(state) {
  _state = state;
  wavePatterns.init(state);
  fakeData.init(state);
  honeypot.init(state);

  if (!_state) return;

  _state.on('cycle.sync_beta_burst', onCycleBurst);

  _state.on('ops.reset', () => {
    reset();
  });
}

function spawnDecoys(count, area) {
  const xMin = area?.x?.[0] ?? 0;
  const xMax = area?.x?.[1] ?? 1;
  const yMin = area?.y?.[0] ?? 0;
  const yMax = area?.y?.[1] ?? 1;

  const ids = [];

  for (let i = 0; i < count; i++) {
    const nodeId = `DECOY-${String(_nextDecoyId++).padStart(4, '0')}`;
    const seed = crypto.randomBytes(4).readUInt32LE(0);
    const position = {
      x: xMin + Math.random() * (xMax - xMin),
      y: yMin + Math.random() * (yMax - yMin),
    };

    _decoys.set(nodeId, {
      nodeId,
      type: 'decoy',
      position,
      state: NODE_STATES.LISTENING,
      seed,
      spawnedAt: Date.now(),
    });
    _sequences.set(nodeId, 0);

    if (_state) {
      _state.set(`nodes.${nodeId}`, {
        type: 'decoy',
        position,
        state: NODE_STATES.LISTENING,
        lastSeen: Date.now(),
      });

      _state.emit('deception.decoy_spawned', { nodeId, position, type: 'decoy' });
    }

    ids.push(nodeId);
  }

  // Wire decoys into the mesh neighbor graph
  mesh.computeNeighborsFromState();

  return ids;
}

function spawnHoneypot(position, sensors) {
  const nodeId = `HP-${String(_nextHoneypotId++).padStart(3, '0')}`;
  const seed = crypto.randomBytes(4).readUInt32LE(0);

  _decoys.set(nodeId, {
    nodeId,
    type: 'honeypot',
    position,
    state: NODE_STATES.LISTENING,
    seed,
    sensors: sensors || ['acoustic'],
    spawnedAt: Date.now(),
  });
  _sequences.set(nodeId, 0);

  honeypot.registerHoneypot(nodeId, position, sensors);

  if (_state) {
    _state.set(`nodes.${nodeId}`, {
      type: 'honeypot',
      position,
      state: NODE_STATES.LISTENING,
      lastSeen: Date.now(),
    });

    _state.emit('deception.decoy_spawned', { nodeId, position, type: 'honeypot' });
  }

  return nodeId;
}

function destroyNode(nodeId) {
  const decoy = _decoys.get(nodeId);
  if (!decoy) return false;

  decoy.state = NODE_STATES.DEAD;
  _decoys.delete(nodeId);
  _sequences.delete(nodeId);

  if (decoy.type === 'honeypot') {
    honeypot.unregisterHoneypot(nodeId);
  }

  if (_state) {
    const nodes = _state.get('nodes') || {};
    if (nodes[nodeId]) {
      nodes[nodeId].state = NODE_STATES.DEAD;
      _state.set('nodes', nodes);
    }
    _state.emit('deception.decoy_destroyed', { nodeId });
  }

  return true;
}

function getCycleKey(cycleNumber) {
  if (cycleNumber !== _lastCycleNumber) {
    _lastCycleKey = cryptoUtils.deriveCycleKey(MASTER_SECRET, cycleNumber);
    _lastCycleNumber = cycleNumber;
  }
  return _lastCycleKey;
}

function composeDecoyFrame(decoy, cycleNumber) {
  const cycleKey = getCycleKey(cycleNumber);
  const slot = cryptoUtils.deriveSlot(cycleKey, decoy.nodeId);
  const seq = (_sequences.get(decoy.nodeId) || 0) + 1;
  _sequences.set(decoy.nodeId, seq);

  const payload = fakeData.generatePayload(decoy.nodeId, cycleNumber);

  // Statistical equivalence: vary routing class and destination to match real traffic patterns
  const classWeights = ['routine', 'routine', 'routine', 'cover', 'cover', 'urgent'];
  const msgClass = classWeights[Math.floor(Math.random() * classWeights.length)];

  // Pick a plausible destination from known nodes or use BROADCAST
  const allNodes = _state ? Object.keys(_state.get('nodes') || {}) : [];
  const candidates = allNodes.filter((id) => id !== decoy.nodeId);
  const dst = candidates.length > 0
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : 'BROADCAST';

  const meshPayload = {
    src: decoy.nodeId,
    dst,
    ttl: 3 + Math.floor(Math.random() * 3),
    class: msgClass,
    sequence: seq,
    app: payload,
  };

  const frameObj = {
    type: 'cover_fill',
    cycle: cycleNumber,
    slot,
    source_node: decoy.nodeId,
    sequence: seq,
    mesh: meshPayload,
  };

  const content = Buffer.from(
    JSON.stringify({
      type: frameObj.type,
      cycle: frameObj.cycle,
      slot: frameObj.slot,
      source_node: frameObj.source_node,
      sequence: frameObj.sequence,
      mesh: frameObj.mesh,
    }),
  );
  frameObj.mac = cryptoUtils.mac(content, cycleKey).toString('hex');

  return frameObj;
}

function onCycleBurst(data) {
  const cycleNumber = data?.number ?? 0;
  let transmitCount = 0;

  for (const decoy of _decoys.values()) {
    if (decoy.state === NODE_STATES.DEAD) continue;
    if (decoy.type === 'honeypot') continue;

    const shouldTx = wavePatterns.shouldTransmit(
      decoy.nodeId,
      decoy.position,
      cycleNumber,
    );

    if (shouldTx) {
      decoy.state = NODE_STATES.TX;
      const frame = composeDecoyFrame(decoy, cycleNumber);

      if (_state) {
        _state.emit('radio.frame_received_simulated', frame);
        _state.set(`nodes.${decoy.nodeId}.state`, 'TX');
      }

      transmitCount++;
    } else {
      if (decoy.state === NODE_STATES.TX && _state) {
        _state.set(`nodes.${decoy.nodeId}.state`, 'LISTENING');
      }
      decoy.state = NODE_STATES.LISTENING;
    }
  }

  // Generate transmission arcs between nearby transmitting decoys for big screen
  if (_state && transmitCount > 1) {
    const txDecoys = [..._decoys.values()].filter((d) => d.state === NODE_STATES.TX);
    const arcCount = Math.min(txDecoys.length, 8);
    for (let i = 0; i < arcCount; i++) {
      const a = txDecoys[i];
      const b = txDecoys[(i + 1) % txDecoys.length];
      _state.emit('transmission.frame_transmitted', {
        from: a.nodeId,
        to: b.nodeId,
        cycle: cycleNumber,
      });
    }
  }

  return transmitCount;
}

function getStates() {
  const result = {};
  for (const [nodeId, decoy] of _decoys) {
    result[nodeId] = {
      nodeId: decoy.nodeId,
      type: decoy.type,
      position: decoy.position,
      state: decoy.state,
      seed: decoy.seed,
      sensors: decoy.sensors,
      sequence: _sequences.get(nodeId) || 0,
    };
  }
  return result;
}

function reset() {
  _decoys.clear();
  _sequences.clear();
  _nextDecoyId = 1;
  _nextHoneypotId = 1;
  _lastCycleKey = null;
  _lastCycleNumber = -1;
  wavePatterns.reset();
  honeypot.reset();
}

module.exports = {
  NODE_STATES,
  init,
  spawnDecoys,
  spawnHoneypot,
  destroyNode,
  onCycleBurst,
  getStates,
  reset,
};
