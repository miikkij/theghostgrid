'use strict';

const { state } = require('../state');
const config = require('../config');
const log = require('../log').child({ component: 'population' });

// Virtual soldier nodes that behave identically to real phone connections.
// They register in state.nodes as type 'soldier', cycle through states via
// phone_sim.js, appear on big screen and ops minimap, and generate
// transmission arcs between each other.

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

function init() {
  const count = config.demo.num_simulated_soldiers;
  if (count <= 0) {
    log.info('population simulator disabled (NUM_SIMULATED_SOLDIERS=0)');
    return;
  }

  spawn(count);

  // Generate transmission arcs between virtual nodes during burst windows
  state.on('cycle.sync_beta_burst', onBurst);

  // Ambient jamming — one random virtual node jammed every ~40 cycles
  state.on('cycle.sync_alpha', onCycleTick);

  log.info({ count }, 'population simulator initialized');
}

function spawn(count) {
  // Use series starting from 100 to avoid collision with real phone callsigns
  const startIdx = 100;

  for (let i = 0; i < count; i++) {
    const prefix = NATO[i % NATO.length];
    const number = Math.floor(i / NATO.length) + startIdx;
    const callsign = `${prefix}-${number}`;
    const role = ROLES[Math.floor(Math.random() * ROLES.length)];

    // Spread positions in realistic cluster formations
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
  // Create 3-4 squad clusters spread across the operational area
  const numSquads = Math.max(3, Math.ceil(total / 8));
  const squad = index % numSquads;

  // Squad centers — distributed across the area
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
  // Scatter within squad (50-100m equivalent)
  const scatter = 0.06;
  return {
    x: clamp(center.x + (Math.random() - 0.5) * scatter, 0.08, 0.92),
    y: clamp(center.y + (Math.random() - 0.5) * scatter, 0.08, 0.85),
  };
}

function onBurst(_data) {
  if (_spawned.length < 2) return;

  const allNodes = Object.entries(state.get('nodes') || {});

  // Each virtual node has a chance to generate a transmission arc this cycle
  // Not all transmit every cycle — varies for realism
  for (let i = 0; i < _spawned.length; i++) {
    if (Math.random() > 0.4) continue; // ~40% transmit each cycle

    const callsign = _spawned[i];
    const node = state.get(`nodes.${callsign}`);
    if (!node || !node.position || node.state === 'DEAD' || node.state === 'JAMMED') continue;

    // Slow drift — soldiers move slightly each cycle (patrol movement)
    var pos = node.position;
    pos.x = clamp(pos.x + (Math.random() - 0.5) * 0.002, 0.08, 0.92);
    pos.y = clamp(pos.y + (Math.random() - 0.5) * 0.002, 0.08, 0.85);
    state.set(`nodes.${callsign}.position`, pos);

    // Find a nearby neighbor to communicate with
    const neighbors = [];
    for (const [id, n] of allNodes) {
      if (id === callsign || !n.position) continue;
      const dx = node.position.x - n.position.x;
      const dy = node.position.y - n.position.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.3) neighbors.push(id);
    }

    if (neighbors.length === 0) continue;

    const partner = neighbors[Math.floor(Math.random() * neighbors.length)];

    // Emit transmission arc for big screen visualization
    state.emit('transmission.frame_transmitted', {
      from: callsign,
      to: partner,
      cycle: state.get('cycle.number'),
    });
  }
}

function onCycleTick() {
  _cycleCounter++;
  if (_spawned.length < 4 || _cycleCounter % 40 !== 0) return;

  // Randomly jam one virtual node
  const idx = Math.floor(Math.random() * _spawned.length);
  const victim = _spawned[idx];
  const current = state.get(`nodes.${victim}.state`);
  if (current === 'JAMMED' || current === 'DEAD') return;

  state.set(`nodes.${victim}.state`, 'JAMMED');

  // Auto-recover after 3-5 seconds
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
