'use strict';

const { state } = require('../state');
const config = require('../config');
const log = require('../log').child({ component: 'population' });
const meshViz = require('../mesh_visualizer');

const NATO = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT',
  'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA',
  'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO',
  'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY',
  'YANKEE', 'ZULU',
];

const ROLES = ['RECON', 'OPS', 'COMMS', 'MEDIC', 'ENGINEER', 'SNIPER'];

let _spawned = [];
let _cycleCounter = 0;

// Controllable settings — defaults to idle (no arcs, no movement)
var _settings = {
  movementEnabled: false,
  txEnabled: false,
  txRate: 0.15,
  movementSpeed: 0.002,
  jammingEnabled: false,
  jammingInterval: 40,
};

function init() {
  const count = config.demo.num_simulated_soldiers;
  if (count <= 0) {
    log.info('population simulator disabled (NUM_SIMULATED_SOLDIERS=0)');
    return;
  }

  spawn(count);

  state.on('cycle.sync_beta_burst', onBurst);
  state.on('cycle.sync_alpha', onCycleTick);

  // Listen for settings changes from ops
  state.on('population.settings', (data) => {
    if (data.movementEnabled != null) _settings.movementEnabled = data.movementEnabled;
    if (data.txEnabled != null) _settings.txEnabled = data.txEnabled;
    if (data.txRate != null) _settings.txRate = Math.max(0, Math.min(1, data.txRate));
    if (data.movementSpeed != null) _settings.movementSpeed = Math.max(0, Math.min(0.01, data.movementSpeed));
    if (data.jammingEnabled != null) _settings.jammingEnabled = data.jammingEnabled;
    if (data.jammingInterval != null) _settings.jammingInterval = Math.max(5, data.jammingInterval);
    state.set('population_settings', { ..._settings });
    log.info({ settings: _settings }, 'population settings updated');
  });

  // Store initial settings in state so ops can read them on connect
  state.set('population_settings', { ..._settings });

  log.info({ count }, 'population simulator initialized (idle — activate from ops)');
}

function spawn(count) {
  const startIdx = 100;

  for (let i = 0; i < count; i++) {
    const prefix = NATO[i % NATO.length];
    const number = Math.floor(i / NATO.length) + startIdx;
    const callsign = `${prefix}-${number}`;
    const role = ROLES[Math.floor(Math.random() * ROLES.length)];
    const pos = generatePosition(i, count);

    state.set(`nodes.${callsign}`, {
      type: 'soldier',
      position: pos,
      state: 'LISTENING',
      neighbors: [],
      lastSeen: Date.now(),
      virtual: true,
      role,
    });

    _spawned.push(callsign);
  }

  log.info({ count: _spawned.length }, 'virtual soldiers spawned');
}

function generatePosition(index, total) {
  const numSquads = Math.max(3, Math.ceil(total / 8));
  const squad = index % numSquads;
  const squadCenters = [];
  for (let s = 0; s < numSquads; s++) {
    const angle = (s / numSquads) * Math.PI * 2 + 0.3;
    const radius = 0.2 + (s % 2) * 0.1;
    squadCenters.push({
      x: 0.5 + Math.cos(angle) * radius,
      y: 0.45 + Math.sin(angle) * radius * 0.8,
    });
  }
  const center = squadCenters[squad];
  const scatter = 0.06;
  return {
    x: clamp(center.x + (Math.random() - 0.5) * scatter, 0.08, 0.92),
    y: clamp(center.y + (Math.random() - 0.5) * scatter, 0.08, 0.85),
  };
}

function onBurst() {
  if (_spawned.length < 2) return;

  const allNodes = Object.entries(state.get('nodes') || {});

  for (let i = 0; i < _spawned.length; i++) {
    const callsign = _spawned[i];
    const node = state.get(`nodes.${callsign}`);
    if (!node || !node.position || node.state === 'DEAD' || node.state === 'JAMMED') continue;

    // Movement — only if enabled
    if (_settings.movementEnabled) {
      var pos = node.position;
      pos.x = clamp(pos.x + (Math.random() - 0.5) * _settings.movementSpeed, 0.08, 0.92);
      pos.y = clamp(pos.y + (Math.random() - 0.5) * _settings.movementSpeed, 0.08, 0.85);
      state.set(`nodes.${callsign}.position`, pos);
    }

    // TX arcs — only if enabled, at configured rate
    if (_settings.txEnabled && Math.random() < _settings.txRate) {
      const neighbors = [];
      for (const [id, n] of allNodes) {
        if (id === callsign || !n.position) continue;
        const dx = node.position.x - n.position.x;
        const dy = node.position.y - n.position.y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.3) neighbors.push(id);
      }

      if (neighbors.length > 0) {
        // Inject into mesh visualizer for hop-by-hop routing
        var msgTypes = ['POS', 'STATUS', 'ACK', 'RELAY'];
        var msgType = msgTypes[Math.floor(Math.random() * msgTypes.length)];
        meshViz.injectMessage(callsign, msgType);
      }
    }
  }
}

function onCycleTick() {
  _cycleCounter++;
  if (!_settings.jammingEnabled) return;
  if (_spawned.length < 4 || _cycleCounter % _settings.jammingInterval !== 0) return;

  const idx = Math.floor(Math.random() * _spawned.length);
  const victim = _spawned[idx];
  const current = state.get(`nodes.${victim}.state`);
  if (current === 'JAMMED' || current === 'DEAD') return;

  state.set(`nodes.${victim}.state`, 'JAMMED');

  const recoveryMs = 3000 + Math.floor(Math.random() * 2000);
  setTimeout(() => {
    if (state.get(`nodes.${victim}.state`) === 'JAMMED') {
      state.set(`nodes.${victim}.state`, 'LISTENING');
    }
  }, recoveryMs);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = { init, spawn };
