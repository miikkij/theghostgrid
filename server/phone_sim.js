'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'phone_sim' });

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
    if (d < 0.35) neighbors.push(id);
  }
  neighbors.sort();
  return neighbors.slice(0, 5);
}

function initPhoneSim() {
  // On each sync_alpha: start the phone state cycle
  state.on('cycle.sync_alpha', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    // Phase 1: SYNC — all phones sync
    for (var [callsign] of phones) {
      state.set(`nodes.${callsign}.state`, 'SYNC');
      state.broadcastTo('phone', 'node_state_change', { callsign, state: 'SYNC' });
    }
  });

  state.on('cycle.prep', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    // Phase 2: TX/RX — half transmit, half receive
    for (var i = 0; i < phones.length; i++) {
      var [callsign] = phones[i];
      var txOrRx = i % 2 === 0 ? 'TX' : 'RX';
      state.set(`nodes.${callsign}.state`, txOrRx);
      state.broadcastTo('phone', 'node_state_change', { callsign, state: txOrRx });
    }
  });

  state.on('cycle.sync_beta_burst', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    var allNodes = Object.entries(state.get('nodes') || {});

    // Generate events and neighbors during burst
    for (var [callsign, nodeData] of phones) {
      if (!nodeData.position) continue;

      var neighbors = computeNeighbors(callsign, nodeData.position, allNodes);
      state.set(`nodes.${callsign}.neighbors`, neighbors);
      state.broadcastTo('phone', 'phone.neighbors', { callsign, neighbors });

      // Generate a transmission event with a random neighbor
      if (neighbors.length > 0) {
        var partner = neighbors[Math.floor(Math.random() * neighbors.length)];
        var direction = Math.random() > 0.5 ? 'out' : 'in';
        state.broadcastTo('phone', 'phone.event', {
          callsign,
          ts: Date.now(),
          direction,
          partner,
        });
      }
    }
  });

  state.on('cycle.idle', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;

    // Phase 4: back to LISTENING
    for (var [callsign] of phones) {
      state.set(`nodes.${callsign}.state`, 'LISTENING');
      state.broadcastTo('phone', 'node_state_change', { callsign, state: 'LISTENING' });
    }
  });

  // Occasionally simulate jamming on a random phone (every ~30 cycles)
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

    // Recover after 3 seconds
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
