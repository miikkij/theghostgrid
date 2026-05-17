'use strict';

const cryptoUtils = require('../protocol/crypto');

const VALID_EVENT_TYPES = ['artillery', 'drone', 'vehicle', 'patrol'];
const VALID_SENSORS = ['acoustic', 'ir', 'vibration', 'camera'];

const SENSOR_CLASSIFICATIONS = {
  acoustic: {
    artillery: 'artillery_overpressure',
    drone: 'rotary_wing_signature',
    vehicle: 'tracked_vehicle_engine',
    patrol: 'footstep_pattern',
  },
  ir: {
    artillery: 'muzzle_flash',
    drone: 'thermal_signature',
    vehicle: 'engine_heat',
    patrol: 'body_heat',
  },
  vibration: {
    artillery: 'ground_shock',
    drone: 'rotor_vibration',
    vehicle: 'tracked_vibration',
    patrol: 'footfall_vibration',
  },
  camera: {
    artillery: 'flash_detection',
    drone: 'visual_track',
    vehicle: 'visual_track',
    patrol: 'motion_detection',
  },
};

let _state = null;
const _honeypots = new Map();

function init(state) {
  _state = state;
}

function registerHoneypot(nodeId, position, sensors) {
  _honeypots.set(nodeId, {
    nodeId,
    position,
    sensors: sensors || ['acoustic'],
    lastTriggered: null,
    triggerCount: 0,
    lastReport: null,
  });
}

function unregisterHoneypot(nodeId) {
  _honeypots.delete(nodeId);
}

function trigger(nodeId, eventType, eventData) {
  const hp = _honeypots.get(nodeId);
  if (!hp) {
    throw new Error(`Honeypot ${nodeId} not registered`);
  }

  if (!VALID_EVENT_TYPES.includes(eventType)) {
    throw new Error(`Invalid event type: ${eventType}. Valid: ${VALID_EVENT_TYPES.join(', ')}`);
  }

  const sensor = hp.sensors[0] || 'acoustic';
  const classification =
    SENSOR_CLASSIFICATIONS[sensor]?.[eventType] || `${eventType}_detected`;

  const report = {
    type: 'honeypot_report',
    honeypot_id: nodeId,
    timestamp: Date.now(),
    sensor,
    classification,
    direction_of_arrival_deg: eventData?.direction_of_arrival ?? Math.floor(Math.random() * 360),
    amplitude_db: eventData?.amplitude ?? -(20 + Math.floor(Math.random() * 40)),
    certainty: eventData?.certainty ?? (0.7 + Math.random() * 0.25),
  };

  hp.lastTriggered = report.timestamp;
  hp.triggerCount++;
  hp.lastReport = report;

  const meshPayload = {
    src: nodeId,
    dst: 'HQ',
    ttl: 5,
    class: 'urgent',
    sequence: hp.triggerCount,
    app: report,
  };

  const cycleNumber = _state ? _state.get('cycle.number') || 0 : 0;
  const masterSecret = require('../config').protocol.master_secret;
  const cycleKey = cryptoUtils.deriveCycleKey(masterSecret, cycleNumber);
  const slot = cryptoUtils.deriveSlot(cycleKey, nodeId);

  const frameObj = {
    type: 'data',
    cycle: cycleNumber,
    slot,
    source_node: nodeId,
    sequence: hp.triggerCount,
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

  if (_state) {
    _state.emit('radio.frame_received_simulated', frameObj);
    _state.emit('deception.honeypot_triggered', {
      honeypotId: nodeId,
      eventType,
      report,
    });
  }

  return report;
}

function getHoneypots() {
  return Array.from(_honeypots.values()).map((hp) => ({
    nodeId: hp.nodeId,
    position: hp.position,
    sensors: hp.sensors,
    lastTriggered: hp.lastTriggered,
    triggerCount: hp.triggerCount,
    lastReport: hp.lastReport,
  }));
}

function reset() {
  _honeypots.clear();
}

module.exports = {
  VALID_EVENT_TYPES,
  init,
  registerHoneypot,
  unregisterHoneypot,
  trigger,
  getHoneypots,
  reset,
};
