'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'phone_sim' });

// Soldiers TX rarely (~15% of cycles) — only when they have data.
// TX reveals position. Most cycles soldiers passively RX the sync
// pulse and listen. Decoys handle the cover traffic.
const SOLDIER_TX_PROBABILITY = 0.15;

const RANKS = ['PVT', 'CPL', 'SGT', 'LT', '1LT', 'CPT'];

// Message types soldiers can send, weighted by frequency
const TX_MSG_TYPES = [
  { type: 'POS',     weight: 5, label: 'Position report' },
  { type: 'STATUS',  weight: 3, label: 'Status update' },
  { type: 'ACK',     weight: 2, label: 'Acknowledge order' },
  { type: 'CONTACT', weight: 1, label: 'Contact report' },
  { type: 'CASEVAC', weight: 0.3, label: 'Casualty evacuation' },
  { type: 'FIRE',    weight: 0.2, label: 'Fire mission request' },
  { type: 'RELAY',   weight: 2, label: 'Relay message' },
];

const TX_TOTAL_WEIGHT = TX_MSG_TYPES.reduce((s, m) => s + m.weight, 0);

function pickMessageType() {
  var r = Math.random() * TX_TOTAL_WEIGHT;
  for (var m of TX_MSG_TYPES) {
    r -= m.weight;
    if (r <= 0) return m;
  }
  return TX_MSG_TYPES[0];
}

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
var forcedTx = new Set();

function initPhoneSim() {
  // Phase 1: SYNC — all soldiers receive the drone sync pulse (passive, safe)
  state.on('cycle.sync_alpha', (_data) => {
    var phones = getPhoneNodes();
    if (phones.length === 0) return;
    txThisCycle.clear();
    // Carry over forced TX from SITREP or manual send
    for (var fid of forcedTx) txThisCycle.add(fid);
    forcedTx.clear();

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

      var neighborIds = computeNeighbors(callsign, nodeData.position, allNodes);
      state.set(`nodes.${callsign}.neighbors`, neighborIds);

      // Send neighbor positions so phone map can render them correctly
      var neighborsWithPos = neighborIds.map(function (nid) {
        var n = allNodes.find(function (e) { return e[0] === nid; });
        return { id: nid, position: n ? n[1].position : null };
      });
      state.broadcastTo('phone', 'phone.neighbors', { callsign, neighbors: neighborIds, positions: neighborsWithPos });

      // Only TX soldiers generate transmission arcs and events
      if (txThisCycle.has(callsign) && neighborIds.length > 0) {
        var msg = pickMessageType();
        var partner = neighborIds[Math.floor(Math.random() * neighborIds.length)];
        // Urgent messages route to HQ via drone
        var dest = (msg.type === 'CONTACT' || msg.type === 'CASEVAC' || msg.type === 'FIRE')
          ? 'HQ' : partner;

        state.broadcastTo('phone', 'phone.event', {
          callsign,
          ts: Date.now(),
          direction: 'out',
          partner: dest,
          msgType: msg.type,
          msgLabel: msg.label,
        });
        state.emit('transmission.frame_transmitted', {
          from: callsign,
          to: dest === 'HQ' ? partner : dest,
          cycle: state.get('cycle.number'),
          msgType: msg.type,
        });

        // Update unit record in state
        updateUnitRecord(callsign, nodeData, msg.type);

      } else if (neighborIds.length > 0) {
        var sender = neighborIds[Math.floor(Math.random() * neighborIds.length)];
        state.broadcastTo('phone', 'phone.event', {
          callsign,
          ts: Date.now(),
          direction: 'in',
          partner: sender,
          msgType: 'RX',
          msgLabel: 'Received data',
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

  // Manual phone message (POS, STATUS, CONTACT etc.) — force TX and update unit
  state.on('phone.force_tx', (data) => {
    forcedTx.add(data.callsign);
  });

  state.on('phone.unit_report', (data) => {
    updateUnitRecord(data.callsign, data.nodeData, data.msgType);
  });

  // HQ info request — triggers all soldiers to send STATUS next cycle
  state.on('ops.trigger_scenario', (data) => {
    if (data.scenario === 'request_sitrep') {
      var phones = getPhoneNodes();
      // Notify phones about HQ request
      state.broadcastTo('phone', 'phone.hq_request', {
        type: 'SITREP',
        ts: Date.now(),
        message: 'HQ requests status report from all units',
      });
      for (var [callsign] of phones) {
        forcedTx.add(callsign);
        state.set(`nodes.${callsign}.state`, 'TX');
        state.broadcastTo('phone', 'node_state_change', { callsign, state: 'TX' });
      }
      log.info({ count: phones.length }, 'SITREP requested — all units responding');
    }
  });

  log.info('phone simulation initialized');
}

function updateUnitRecord(callsign, nodeData, msgType) {
  var units = state.get('units') || {};
  if (!units[callsign]) {
    units[callsign] = {
      callsign,
      rank: RANKS[Math.floor(Math.random() * RANKS.length)],
      role: nodeData.role || 'RECON',
      status: 'NOMINAL',
      lastReport: null,
      lastMsgType: null,
      position: nodeData.position,
      battery: 70 + Math.floor(Math.random() * 30),
      ammo: 60 + Math.floor(Math.random() * 40),
    };
  }

  var unit = units[callsign];
  unit.lastReport = Date.now();
  unit.lastMsgType = msgType;
  unit.position = nodeData.position;

  if (msgType === 'STATUS') {
    unit.battery = Math.max(10, unit.battery - Math.floor(Math.random() * 3));
    unit.ammo = Math.max(5, unit.ammo - Math.floor(Math.random() * 5));
  }
  if (msgType === 'CONTACT') unit.status = 'CONTACT';
  else if (msgType === 'CASEVAC') unit.status = 'CASEVAC';
  else unit.status = 'NOMINAL';

  units[callsign] = unit;
  state.set('units', units);
  state.broadcastTo('ops', 'unit_update', unit);
}

module.exports = { initPhoneSim };
