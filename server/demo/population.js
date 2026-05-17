'use strict';

const { state } = require('../state');
const config = require('../config');
const log = require('../log').child({ component: 'population' });
const meshViz = require('../mesh_visualizer');
const mesh = require('../protocol/mesh');

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

// Squad waypoint system — each squad moves toward a target area
var _squads = {};  // squadId → { members: [callsign], target: {x,y}, arrived: false }

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
  const numSquads = Math.max(3, Math.ceil(count / 8));

  // Initialize squads with initial targets
  for (let s = 0; s < numSquads; s++) {
    _squads[s] = {
      members: [],
      target: randomTarget(),
    };
  }

  for (let i = 0; i < count; i++) {
    const prefix = NATO[i % NATO.length];
    const number = Math.floor(i / NATO.length) + startIdx;
    const callsign = `${prefix}-${number}`;
    const role = ROLES[Math.floor(Math.random() * ROLES.length)];
    const squadId = i % numSquads;
    const pos = generatePosition(i, count);

    state.set(`nodes.${callsign}`, {
      type: 'soldier',
      position: pos,
      state: 'LISTENING',
      neighbors: [],
      lastSeen: Date.now(),
      virtual: true,
      role,
      squad: squadId,
    });

    _spawned.push(callsign);
    _squads[squadId].members.push(callsign);
  }

  // Seed mesh neighbor relationships from spawned positions
  mesh.computeNeighborsFromState();

  log.info({ count: _spawned.length, squads: numSquads }, 'virtual soldiers spawned');
}

function randomTarget() {
  return {
    x: 0.15 + Math.random() * 0.7,
    y: 0.15 + Math.random() * 0.6,
  };
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
  // Spread soldiers in a grid-like pattern within the squad area
  const memberIdx = Math.floor(index / numSquads);
  const cols = 3;
  const col = memberIdx % cols;
  const row = Math.floor(memberIdx / cols);
  const spacing = 0.035;
  return {
    x: clamp(center.x + (col - 1) * spacing + (Math.random() - 0.5) * 0.01, 0.08, 0.92),
    y: clamp(center.y + (row - 1) * spacing + (Math.random() - 0.5) * 0.01, 0.08, 0.85),
  };
}

function onBurst() {
  if (_spawned.length < 2) return;

  const allNodes = Object.entries(state.get('nodes') || {});

  for (let i = 0; i < _spawned.length; i++) {
    const callsign = _spawned[i];
    const node = state.get(`nodes.${callsign}`);
    if (!node || !node.position || node.state === 'DEAD' || node.state === 'JAMMED') continue;

    // Movement — squad-based waypoint movement
    if (_settings.movementEnabled) {
      var squadId = node.squad;
      var squad = squadId != null ? _squads[squadId] : null;
      var pos = node.position;

      if (squad && squad.target) {
        // Move toward squad target with some scatter
        var dx = squad.target.x - pos.x;
        var dy = squad.target.y - pos.y;
        var dist2 = Math.sqrt(dx * dx + dy * dy);

        if (dist2 > 0.02) {
          // Move toward target + slight random wander
          var speed = _settings.movementSpeed;
          pos.x = clamp(pos.x + (dx / dist2) * speed + (Math.random() - 0.5) * speed * 0.3, 0.08, 0.92);
          pos.y = clamp(pos.y + (dy / dist2) * speed + (Math.random() - 0.5) * speed * 0.3, 0.08, 0.85);
        }
      }

      // Repel from nearby squad members to prevent overlap
      var minDist = 0.025;
      for (var si = 0; si < _spawned.length; si++) {
        if (_spawned[si] === callsign) continue;
        var other = state.get('nodes.' + _spawned[si]);
        if (!other || !other.position) continue;
        var rdx = pos.x - other.position.x;
        var rdy = pos.y - other.position.y;
        var rd = Math.sqrt(rdx * rdx + rdy * rdy);
        if (rd < minDist && rd > 0.001) {
          pos.x = clamp(pos.x + (rdx / rd) * 0.005, 0.08, 0.92);
          pos.y = clamp(pos.y + (rdy / rd) * 0.005, 0.08, 0.85);
        }
      }

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

        // POS and STATUS reports update HQ's knowledge (unit record + ops position)
        if (msgType === 'POS' || msgType === 'STATUS') {
          state.emit('phone.unit_report', { callsign, nodeData: node, msgType });
        }
      }
    }
  }

  // Check if squads have arrived at their targets — pick new targets
  if (_settings.movementEnabled) {
    for (var sid in _squads) {
      var sq = _squads[sid];
      if (!sq.target || sq.members.length === 0) continue;

      // Check average distance of squad to target
      var totalDist = 0;
      var count = 0;
      for (var mi = 0; mi < sq.members.length; mi++) {
        var mn = state.get('nodes.' + sq.members[mi]);
        if (!mn || !mn.position) continue;
        var ddx = mn.position.x - sq.target.x;
        var ddy = mn.position.y - sq.target.y;
        totalDist += Math.sqrt(ddx * ddx + ddy * ddy);
        count++;
      }

      if (count > 0 && totalDist / count < 0.05) {
        // Squad arrived — pick new target on opposite side
        sq.target = {
          x: clamp(1 - sq.target.x + (Math.random() - 0.5) * 0.3, 0.15, 0.85),
          y: clamp(1 - sq.target.y + (Math.random() - 0.5) * 0.3, 0.15, 0.75),
        };
        log.debug({ squad: sid, target: sq.target }, 'squad reached target, new waypoint');
      }
    }
  }
}

function onCycleTick() {
  _cycleCounter++;

  // Prune out-of-range mesh links every 10 cycles when movement is active
  if (_settings.movementEnabled && _cycleCounter % 10 === 0) {
    mesh.pruneMovedNeighbors();
  }

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
