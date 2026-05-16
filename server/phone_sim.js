'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'phone_sim' });

// Soldiers TX rarely (~15% of cycles) — only when they have data.
// TX reveals position. Most cycles soldiers passively RX the sync
// pulse and listen. Decoys handle the cover traffic.
const SOLDIER_TX_PROBABILITY = 0.15;

function getPhoneNodes() {
  const nodes = state.get('nodes') || {};
  return Object.entries(nodes).filter(([, n]) => n.type === 'soldier' && n.state !== 'DEAD');
}

function distance(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function computeNeighbors(callsign, pos, allNodes) {
  var neighbors = [];
  for (var [id, n] of allNodes) {
    if (id === callsign) continue;
    if (!n.position) continue;
    var d = distance(pos, n.position);
    if (d < 0.5) neighbors.push(id);
  }
  neighbors.sort();
  return neighbors.slice(0, 5);
}

// Track which soldiers are TX-ing this cycle
var txThisCycle = new Set();

function initPhoneSim() {
  // Phase 1: SYNC — all soldiers receive the drone sync pulse (passive, safe)
  state.on('cycle.sync_alpha', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;
    txThisCycle.clear();

    for (var [callsign] of phones) {
      state.set(`nodes.${callsign}.state`, 'SYNC');
      state.broadcastTo('phone', 'node_state_change', { callsign, state: 'SYNC' });
    }
  });

  // Phase 2: PREP — decide who TX vs RX this cycle
  // Real soldiers only TX when they have data (~15%). Otherwise RX (passive).
  state.on('cycle.prep', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    for (var i = 0; i < phones.length; i++) {
      var [callsign] = phones[i];
      var willTx = Math.random() < SOLDIER_TX_PROBABILITY;

      if (willTx) {
        txThisCycle.add(callsign);
        state.set(`nodes.${callsign}.state`, 'TX');
        state.broadcastTo('phone', 'node_state_change', { callsign, state: 'TX' });
      } else {
        state.set(`nodes.${callsign}.state`, 'RX');
        state.broadcastTo('phone', 'node_state_change', { callsign, state: 'RX' });
      }
    }
  });

  // Phase 3: BURST — synchronized transmission window
  // Only soldiers marked TX actually emit. RX soldiers listen passively.
  state.on('cycle.sync_beta_burst', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    var allNodes = Object.entries(state.get('nodes') || {});

    for (var [callsign, nodeData] of phones) {
      if (!nodeData.position) continue;

      var neighbors = computeNeighbors(callsign, nodeData.position, allNodes);
      state.set(`nodes.${callsign}.neighbors`, neighbors);
      state.broadcastTo('phone', 'phone.neighbors', { callsign, neighbors });

      // Only TX soldiers generate transmission arcs and events
      if (txThisCycle.has(callsign) && neighbors.length > 0) {
        var partner = neighbors[Math.floor(Math.random() * neighbors.length)];
        state.broadcastTo('phone', 'phone.event', {
          callsign,
          ts: Date.now(),
          direction: 'out',
          partner,
        });
        // Visible arc on big screen
        state.emit('transmission.frame_transmitted', {
          from: callsign,
          to: partner,
          cycle: state.get('cycle.number'),
        });
      } else if (neighbors.length > 0) {
        // RX soldiers receive data passively
        var sender = neighbors[Math.floor(Math.random() * neighbors.length)];
        state.broadcastTo('phone', 'phone.event', {
          callsign,
          ts: Date.now(),
          direction: 'in',
          partner: sender,
        });
      }
    }
  });

  // Phase 4: IDLE — all back to LISTENING
  state.on('cycle.idle', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    for (var [callsign] of phones) {
      state.set(`nodes.${callsign}.state`, 'LISTENING');
      state.broadcastTo('phone', 'node_state_change', { callsign, state: 'LISTENING' });
    }
  });

  // Ambient jamming — one random soldier every ~30 cycles
  var jammingCounter = 0;
  state.on('cycle.sync_alpha', (_data) => {
    jammingCounter++;
    if (jammingCounter % 30 !== 0) return;

    var phones = getPhoneNodes();
    if (phones.length < 2) return;

    var victim = phones[Math.floor(Math.random() * phones.length)];
    var [callsign] = victim;

    state.set(`nodes.${callsign}.state`, 'JAMMED');
    state.broadcastTo('phone', 'node_state_change', { callsign, state: 'JAMMED' });

    setTimeout(() => {
      if (state.get(`nodes.${callsign}.state`) === 'JAMMED') {
        state.set(`nodes.${callsign}.state`, 'LISTENING');
        state.broadcastTo('phone', 'node_state_change', { callsign, state: 'LISTENING' });
      }
    }, 3000);
  });

  log.info('phone simulation initialized');
}

module.exports = { initPhoneSim };
