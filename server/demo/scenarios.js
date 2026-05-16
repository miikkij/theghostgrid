'use strict';

const log = require('../log').child({ component: 'scenarios' });
const deception = require('../deception');
const mesh = require('../protocol/mesh');
const config = require('../config');

let _state = null;
let _cycleTicker = null;

function init(state, cycleTicker) {
  _state = state;
  _cycleTicker = cycleTicker;

  deception.init(state);
  mesh.init(state, config);

  state.on('ops.trigger_scenario', (data) => {
    const { scenario, parameters } = data;
    log.info({ scenario, parameters }, 'scenario received');
    dispatch(scenario, parameters || {});
  });

  log.info('scenario dispatcher initialized');
}

function dispatch(scenario, params) {
  const handler = HANDLERS[scenario];
  if (!handler) {
    log.warn({ scenario }, 'unknown scenario');
    emitResult(scenario, false, 'Unknown scenario: ' + scenario);
    return;
  }
  try {
    handler(params);
    emitResult(scenario, true);
  } catch (err) {
    log.error({ scenario, err: err.message }, 'scenario failed');
    emitResult(scenario, false, err.message);
  }
}

function emitResult(scenario, success, message) {
  if (_state) {
    _state.broadcastTo('ops', 'scenario_result', {
      scenario,
      success,
      message: message || 'OK',
      ts: Date.now(),
    });
  }
}

// --- Scenario handlers ---

const HANDLERS = {
  inject_jamming(params) {
    const area = params.area || {
      center: { x: 0.4 + Math.random() * 0.3, y: 0.3 + Math.random() * 0.3 },
      radius: params.radius || 0.12,
    };

    const zones = _state.get('jamming_zones') || [];
    zones.push({ ...area, since: Date.now() });
    _state.set('jamming_zones', zones);

    const affected = mesh.declareJammed(area);

    // Set affected nodes to JAMMED state
    for (const nodeId of affected) {
      _state.set(`nodes.${nodeId}.state`, 'JAMMED');
    }

    _state.emit('alert', {
      message: 'EW JAMMING DETECTED',
      meta: 'Sector affected — ' + affected.length + ' nodes impacted',
      duration_seconds: 15,
      affected_area: area,
    });

    log.info({ affected: affected.length, area }, 'jamming injected');
  },

  clear_jamming() {
    _state.set('jamming_zones', []);

    // Restore jammed nodes
    const nodes = _state.get('nodes') || {};
    for (const [id, n] of Object.entries(nodes)) {
      if (n.state === 'JAMMED') {
        _state.set(`nodes.${id}.state`, 'LISTENING');
      }
    }

    log.info('jamming cleared');
  },

  drop_drone(params) {
    const drones = _state.get('drones') || {};
    const droneIds = Object.keys(drones);
    if (droneIds.length === 0) {
      // Seed drones if none exist, then drop one
      seedDrones();
      return HANDLERS.drop_drone(params);
    }

    const targetId = params.droneId || droneIds[droneIds.length - 1];
    delete drones[targetId];
    _state.set('drones', drones);

    log.info({ droneId: targetId }, 'drone dropped');
  },

  activate_decoys(params) {
    const count = params.count || config.demo.num_simulated_decoys;
    const area = params.area || { xMin: 0.1, xMax: 0.9, yMin: 0.1, yMax: 0.8 };
    const ids = deception.spawnDecoys(count, area);

    // Spawn a few honeypots too
    for (let i = 0; i < 3; i++) {
      deception.spawnHoneypot(
        { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.5 },
        ['acoustic', 'vibration']
      );
    }

    log.info({ count: ids.length }, 'decoys activated');
  },

  activate_pattern(params) {
    const name = params.patternName || params.name || 'linear_translation';
    const patternParams = params.parameters || getDefaultPatternParams(name);
    const id = deception.activatePattern(name, patternParams);
    log.info({ patternName: name, patternId: id }, 'pattern activated');
  },

  deactivate_pattern(params) {
    const patterns = deception.getActivePatterns();
    if (params.patternId) {
      deception.deactivatePattern(params.patternId);
    } else if (patterns.length > 0) {
      deception.deactivatePattern(patterns[patterns.length - 1].id);
    }
    log.info('pattern deactivated');
  },

  trigger_honeypot(params) {
    const states = deception.getDecoyStates();
    const honeypots = Object.entries(states).filter(([, s]) => s.type === 'honeypot');

    if (honeypots.length === 0) {
      log.warn('no honeypots registered, spawning one');
      deception.spawnHoneypot(
        { x: 0.4 + Math.random() * 0.2, y: 0.3 + Math.random() * 0.3 },
        ['acoustic', 'vibration']
      );
      const newStates = deception.getDecoyStates();
      const newHp = Object.entries(newStates).filter(([, s]) => s.type === 'honeypot');
      if (newHp.length === 0) return;
      deception.triggerHoneypot(newHp[0][0], params.eventType || 'artillery');
      return;
    }

    const [hpId] = honeypots[Math.floor(Math.random() * honeypots.length)];
    deception.triggerHoneypot(hpId, params.eventType || 'artillery');
    log.info({ honeypotId: hpId }, 'honeypot triggered');
  },

  pause_cycles() {
    if (_cycleTicker && _cycleTicker.stop) {
      _cycleTicker.stop();
      _state.set('cycle.phase', 'paused');
      _state.broadcast('cycle_tick', {
        number: _state.get('cycle.number'),
        phase: 'paused',
        ts: Date.now(),
      });
      log.info('cycles paused');
    }
  },

  resume_cycles() {
    if (_cycleTicker && _cycleTicker.start) {
      _cycleTicker.start();
      log.info('cycles resumed');
    }
  },

  reset_state() {
    // Clear jamming
    _state.set('jamming_zones', []);

    // Reset node states (keep nodes but set to LISTENING)
    const nodes = _state.get('nodes') || {};
    for (const [id, n] of Object.entries(nodes)) {
      if (n.type === 'soldier') {
        _state.set(`nodes.${id}.state`, 'LISTENING');
      }
    }

    // Clear active patterns
    const patterns = deception.getActivePatterns();
    for (const p of patterns) {
      deception.deactivatePattern(p.id);
    }

    // Reset drones
    seedDrones();

    _state.set('stats.packets_total', 0);
    _state.set('stats.packets_dropped', 0);

    log.info('state reset');
  },

  // Pattern shortcuts from ops buttons
  pattern_linear(params)  { HANDLERS.activate_pattern({ patternName: 'linear_translation', parameters: params }); },
  pattern_convoy(params)  { HANDLERS.activate_pattern({ patternName: 'phantom_convoy', parameters: params }); },
  pattern_radial(params)  { HANDLERS.activate_pattern({ patternName: 'radial_expansion', parameters: params }); },
};

function seedDrones() {
  _state.set('drones', {
    'DRONE-1': { position: { x: 0.35, y: 0.15 }, status: 'active', role: 'sync' },
    'DRONE-2': { position: { x: 0.65, y: 0.12 }, status: 'active', role: 'sync' },
  });
}

function getDefaultPatternParams(name) {
  const defaults = {
    linear_translation: { velocity: 0.02, direction: 0, bandWidth: 0.15 },
    radial_expansion: { velocity: 0.015, ringWidth: 0.1, center: { x: 0.5, y: 0.4 } },
    random_walk_cluster: { clusterRadius: 0.12, stepSize: 0.03, center: { x: 0.5, y: 0.5 } },
    phantom_convoy: { velocity: 0.02, convoyLength: 0.2, path: [{ x: 0.2, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.3 }] },
  };
  return defaults[name] || {};
}

module.exports = { init, dispatch };
