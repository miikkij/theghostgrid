'use strict';

const log = require('../log').child({ component: 'scenarios' });
const deception = require('../deception');
const mesh = require('../protocol/mesh');
const population = require('./population');
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

  state.on('ops.set_roe', (data) => {
    dispatch('set_roe', data);
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
    // Don't activate if same pattern type is already active
    const existing = deception.getActivePatterns().find((p) => p.name === name);
    if (existing) {
      log.info({ patternName: name }, 'pattern already active, skipping');
      return;
    }
    const patternParams = params.parameters || getDefaultPatternParams(name);
    const id = deception.activatePattern(name, patternParams);
    log.info({ patternName: name, patternId: id }, 'pattern activated');
  },

  deactivate_pattern(params) {
    const patterns = deception.getActivePatterns();
    if (params.patternId) {
      deception.deactivatePattern(params.patternId);
    } else if (params.patternName) {
      // Find pattern by name and deactivate it
      const match = patterns.find((p) => p.name === params.patternName);
      if (match) deception.deactivatePattern(match.id);
    } else if (patterns.length > 0) {
      deception.deactivatePattern(patterns[patterns.length - 1].id);
    }
    log.info({ params }, 'pattern deactivated');
  },

  trigger_honeypot(params) {
    // Always spawn a fresh honeypot at a random position so each trigger is visible
    const pos = {
      x: 0.2 + Math.random() * 0.6,
      y: 0.25 + Math.random() * 0.45,
    };
    const hpId = deception.spawnHoneypot(pos, ['acoustic', 'vibration']);

    const eventType = params.eventType || 'artillery';
    deception.triggerHoneypot(hpId, eventType);

    // Push alert to big screen for visual flash
    const nodeData = _state.get(`nodes.${hpId}`);
    _state.broadcastTo('screen', 'alert', {
      nodeId: hpId,
      caption: `${hpId}: ${eventType} detected — DoA ${Math.floor(180 + Math.random() * 180)}°`,
    });

    // Push alert to phones
    _state.emit('alert', {
      message: 'ARTILLERY INCOMING',
      meta: `Honeypot ${hpId} — estimated impact 28–45 seconds`,
      duration_seconds: 15,
      affected_area: nodeData ? { center: nodeData.position, radius: 0.3 } : null,
    });

    log.info({ honeypotId: hpId, eventType }, 'honeypot triggered');
  },

  pause_cycles() {
    if (!_cycleTicker) return;
    _cycleTicker.stop();
    _state.set('cycle.phase', 'paused');
    _state.broadcast('cycle_tick', {
      number: _state.get('cycle.number'),
      phase: 'paused',
      ts: Date.now(),
    });
    log.info('cycles paused');
  },

  resume_cycles() {
    if (!_cycleTicker) return;
    _cycleTicker.start();
    log.info('cycles resumed');
  },

  reset_state() {
    const meshModule = require('../protocol/mesh');
    const roe = require('../hq_brain/roe');

    // Stop pitch if running
    _state.emit('ops.trigger_scenario', { scenario: 'stop_pitch' });

    // Clear jamming
    _state.set('jamming_zones', []);

    // Remove all decoys, honeypots, and reset deception engine
    _state.emit('ops.reset');

    // Remove decoy/honeypot nodes from state
    const nodes = _state.get('nodes') || {};
    for (const [id, n] of Object.entries(nodes)) {
      if (n.type === 'decoy' || n.type === 'honeypot') {
        delete nodes[id];
      } else if (n.type === 'soldier') {
        n.state = 'LISTENING';
      }
    }
    _state.set('nodes', nodes);

    // Reset mesh routing (neighbor tables, routing tables, seen cache)
    meshModule.reset();

    // Reset ROE to default
    roe.setState('ACTIVE');
    _state.set('roe_state', 'ACTIVE');
    _state.broadcast('roe_state_changed', { state: 'ACTIVE' });

    // Reset drones to clean formation
    seedDrones();

    // Reset stats
    _state.set('stats.packets_total', 0);
    _state.set('stats.packets_dropped', 0);
    _state.set('stats.ai_decisions', 0);
    _state.set('audit_log', []);
    _state.set('active_patterns', []);
    _state.set('cycle.number', 0);
    _state.set('recent_events', []);

    // Re-spawn virtual soldiers and recompute mesh
    population.respawn();

    // Tell all clients to reset their state
    _state.broadcast('full_reset', {});

    log.info('full state reset — clean session');
  },

  request_sitrep() {
    _state.emit('sitrep.execute', {});
  },

  run_full_pitch() {
    log.info('Full pitch — handled by demo/script.js');
  },

  stop_pitch() {
    log.info('Stop pitch — handled by demo/script.js');
  },

  pause_pitch() {
    log.info('Pause pitch — handled by demo/script.js');
  },

  resume_pitch() {
    log.info('Resume pitch — handled by demo/script.js');
  },

  trigger_ai_adaptation() {
    _state.emit('ops.trigger_ai_adaptation', {});
    log.info('AI adaptation triggered');
  },

  deploy_drone(params) {
    const drones = _state.get('drones') || {};
    const count = Object.keys(drones).length;
    const id = params.droneId || `DRONE-${count + 1}`;
    const pos = params.position || {
      x: 0.2 + Math.random() * 0.6,
      y: 0.08 + Math.random() * 0.15,
    };
    const role = params.role || 'sync';
    _state.set(`drones.${id}`, { position: pos, status: 'active', role });
    log.info({ droneId: id, role }, 'drone deployed');
  },

  // Pattern shortcuts from ops buttons
  pattern_linear(params)  { HANDLERS.activate_pattern({ patternName: 'linear_translation', parameters: params }); },
  pattern_convoy(params)  { HANDLERS.activate_pattern({ patternName: 'phantom_convoy', parameters: params }); },
  pattern_radial(params)  { HANDLERS.activate_pattern({ patternName: 'radial_expansion', parameters: params }); },
  pattern_cluster(params) { HANDLERS.activate_pattern({ patternName: 'random_walk_cluster', parameters: params }); },

  set_roe(params) {
    const roe = require('../hq_brain/roe');
    const newState = params.state || 'ACTIVE';
    const changed = roe.setState(newState);
    if (changed) {
      _state.set('roe_state', newState);
      _state.broadcast('roe_state_changed', { state: newState });
      log.info({ roe: newState }, 'ROE state changed');
    }
  },

  destroy_node(params) {
    const nodeId = params.nodeId;
    if (!nodeId) {
      log.warn('destroy_node: no nodeId provided');
      return;
    }
    const decoySimulator = require('../deception/decoy_simulator');
    const decoyStates = decoySimulator.getStates();
    if (decoyStates[nodeId]) {
      decoySimulator.destroyNode(nodeId);
    }
    _state.set(`nodes.${nodeId}.state`, 'DEAD');
    log.info({ nodeId }, 'node destroyed');
  },
};

function seedDrones() {
  _state.set('drones', {
    'DRONE-1': { position: { x: 0.25, y: 0.10 }, status: 'active', role: 'sync' },
    'DRONE-2': { position: { x: 0.55, y: 0.08 }, status: 'active', role: 'sync' },
    'DRONE-3': { position: { x: 0.80, y: 0.12 }, status: 'active', role: 'sync' },
    'DRONE-4': { position: { x: 0.40, y: 0.20 }, status: 'active', role: 'decoy' },
    'DRONE-5': { position: { x: 0.70, y: 0.18 }, status: 'active', role: 'decoy' },
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
