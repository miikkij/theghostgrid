'use strict';

const cryptoUtils = require('./crypto');
const frame = require('./frame');

const serverConfig = require('../config');

const DEFAULTS = {
  MASTER_SECRET: serverConfig.protocol.master_secret,
  SUB_SLOTS: 50,
  CHANNELS: [1, 6, 11],
  HOPS_PER_SLOT: 10,
};

let _state = null;
let _config = { ...DEFAULTS };
const _cycleAllocations = new Map();

function init(state, config) {
  _state = state;
  if (config) Object.assign(_config, config);

  if (!_state) return;

  _state.on('cycle.sync_alpha', (data) => {
    scheduleNextCycle(data.number);
  });

  _state.on('cycle.sync_beta_burst', (data) => {
    _state.emit('transmission.burst_window_open', {
      cycle: data.number,
      allocations: getAllocationsForCycle(data.number),
    });
  });

  _state.on('cycle.idle', (data) => {
    for (const cn of _cycleAllocations.keys()) {
      if (cn < data.number - 5) _cycleAllocations.delete(cn);
    }
  });

  _state.on('radio.frame_received', (data) => {
    const parsed = parseFrame(data.raw || data);
    if (parsed) {
      _state.emit('transmission.frame_received', parsed);
    }
  });

  _state.on('radio.frame_received_simulated', (data) => {
    const parsed = parseFrame(data.raw || data);
    if (parsed) {
      _state.emit('transmission.frame_received', { ...parsed, simulated: true });
    }
  });
}

function getAllocationsForCycle(cycleNumber) {
  const allocs = _cycleAllocations.get(cycleNumber);
  if (!allocs) return {};
  return Object.fromEntries(allocs);
}

function scheduleNextCycle(cycleNumber) {
  const nodes = _state ? _state.get('nodes') || {} : {};
  const allocations = new Map();

  for (const nodeId of Object.keys(nodes)) {
    const slotInfo = allocateSlot(nodeId, cycleNumber);
    allocations.set(nodeId, slotInfo);

    if (_state) {
      _state.emit('transmission.slot_allocated', {
        nodeId,
        cycle: cycleNumber,
        ...slotInfo,
      });
    }
  }

  _cycleAllocations.set(cycleNumber, allocations);
  return allocations;
}

function allocateSlot(nodeId, cycleNumber) {
  const cycleKey = cryptoUtils.deriveCycleKey(_config.MASTER_SECRET, cycleNumber);
  const slotIndex = cryptoUtils.deriveSlot(cycleKey, nodeId, _config.SUB_SLOTS);
  const frequencyHops = getHopSequence(nodeId, cycleNumber, slotIndex);
  return { slotIndex, frequencyHops };
}

function composeFrame({ sourceNode, sequenceNumber, cycle, slot, meshPayload }) {
  const cycleKey = cryptoUtils.deriveCycleKey(_config.MASTER_SECRET, cycle);
  const isCoverFill = !meshPayload;

  const meshData = meshPayload || {
    src: sourceNode,
    dst: 'BROADCAST',
    ttl: 0,
    class: 'cover',
    sequence: 0,
    app: null,
  };

  const resolvedSlot = slot ?? allocateSlot(sourceNode, cycle).slotIndex;

  const frameObj = {
    type: isCoverFill ? 'cover_fill' : 'data',
    cycle,
    slot: resolvedSlot,
    source_node: sourceNode,
    sequence: sequenceNumber || 0,
    mesh: meshData,
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

  if (_state) {
    _state.emit('transmission.frame_to_send', frameObj);
  }

  return frameObj;
}

function parseFrame(raw) {
  if (Buffer.isBuffer(raw) && raw.length === frame.TRANSMISSION_FRAME_SIZE) {
    const currentCycle = _state ? _state.get('cycle.number') || 0 : 0;
    for (let c = currentCycle; c >= Math.max(0, currentCycle - 1); c--) {
      const key = cryptoUtils.deriveCycleKey(_config.MASTER_SECRET, c);
      const decoded = frame.decodeTransmissionFrame(raw, key);
      if (decoded) return decoded;
    }
    return null;
  }

  let frameObj = raw;
  if (typeof raw === 'string') {
    try {
      frameObj = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!frameObj || !frameObj.type || frameObj.cycle === undefined) return null;

  if (frameObj.mac) {
    const cycleKey = cryptoUtils.deriveCycleKey(_config.MASTER_SECRET, frameObj.cycle);
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
    const expectedMac = Buffer.from(frameObj.mac, 'hex');
    if (!cryptoUtils.verifyMac(content, cycleKey, expectedMac)) {
      return null;
    }
  }

  return frameObj;
}

function getHopSequence(nodeId, cycleNumber, slotIndex) {
  return cryptoUtils.deriveHopSequence(
    _config.MASTER_SECRET,
    nodeId,
    cycleNumber,
    slotIndex,
    _config.CHANNELS,
    _config.HOPS_PER_SLOT,
  );
}

function getConfig() {
  return { ..._config };
}

module.exports = {
  init,
  scheduleNextCycle,
  allocateSlot,
  composeFrame,
  parseFrame,
  getHopSequence,
  getConfig,
};
