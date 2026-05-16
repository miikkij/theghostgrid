'use strict';

const log = require('../log').child({ component: 'demo' });
const { dispatch } = require('./scenarios');

let _state = null;
let _timers = [];
let _running = false;

function init(state) {
  _state = state;

  state.on('ops.trigger_scenario', (data) => {
    if (data.scenario === 'run_full_pitch') start();
    if (data.scenario === 'stop_pitch') stop();
  });
}

function start() {
  if (_running) {
    log.warn('pitch already running');
    return;
  }
  _running = true;
  _timers = [];
  log.info('===== FULL PITCH SEQUENCE STARTED =====');

  broadcastStep('Pitch sequence started — 5 minutes');

  // T+0s: Ensure cycles running, drones visible
  at(0, () => {
    dispatch('resume_cycles', {});
    broadcastStep('Cycles running, drones seeded');
  });

  // T+10s: Sync beacon visual emphasis (cycles are already producing sync pulses)
  at(10, () => {
    broadcastStep('Sync beacon — watch the drone pulse');
  });

  // T+30s: Burst cycle visualization (already running, just a narrative marker)
  at(30, () => {
    broadcastStep('Burst protocol active — sub-50ms windows');
  });

  // T+60s: Inject EW jamming
  at(60, () => {
    dispatch('inject_jamming', {
      area: { center: { x: 0.55, y: 0.45 }, radius: 0.15 },
    });
    broadcastStep('EW ATTACK — jamming injected sector 3');
  });

  // T+75s: Jamming should have reconverged by now — clear it
  at(75, () => {
    dispatch('clear_jamming', {});
    broadcastStep('Mesh reconverged — jamming cleared');
  });

  // T+90s: Drop a drone
  at(90, () => {
    dispatch('drop_drone', { droneId: 'DRONE-2' });
    broadcastStep('DRONE-2 lost — remaining drone takes over');
  });

  // T+120s: Activate decoy population
  at(120, () => {
    dispatch('activate_decoys', { count: 47 });
    broadcastStep('47 decoy emitters deployed — EUR 25 each');
  });

  // T+135s: Start wave choreography
  at(135, () => {
    dispatch('activate_pattern', {
      patternName: 'linear_translation',
      parameters: { velocity: 0.02, direction: 0, bandWidth: 0.15 },
    });
    broadcastStep('Wave choreography — battalion moving east');
  });

  // T+150s: Add phantom convoy
  at(150, () => {
    dispatch('activate_pattern', {
      patternName: 'phantom_convoy',
      parameters: {
        velocity: 0.025,
        convoyLength: 0.2,
        path: [{ x: 0.2, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.3 }],
      },
    });
    broadcastStep('Phantom convoy — second deception axis');
  });

  // T+180s: Trigger honeypot engagement
  at(180, () => {
    dispatch('trigger_honeypot', { eventType: 'artillery' });
    broadcastStep('HONEYPOT TRIGGERED — artillery detection');
  });

  // T+195s: AI adaptation
  at(195, () => {
    dispatch('trigger_ai_adaptation', {});
    broadcastStep('AI analyzing — choreography update recommended');
  });

  // T+240s: Restore drone, show recovery
  at(240, () => {
    _state.set('drones.DRONE-2', { position: { x: 0.65, y: 0.12 }, status: 'active', role: 'sync' });
    broadcastStep('DRONE-2 restored — full redundancy');
  });

  // T+270s: Clean up patterns for final visual
  at(270, () => {
    dispatch('reset_state', {});
    dispatch('resume_cycles', {});
    broadcastStep('Systems nominal — architecture proven');
  });

  // T+300s: Pitch complete
  at(300, () => {
    broadcastStep('PITCH COMPLETE — 5 minutes');
    _running = false;
    log.info('===== FULL PITCH SEQUENCE COMPLETE =====');
  });
}

function stop() {
  if (!_running) return;
  for (const t of _timers) clearTimeout(t);
  _timers = [];
  _running = false;
  broadcastStep('Pitch sequence stopped');
  log.info('pitch sequence stopped');
}

function at(seconds, fn) {
  _timers.push(setTimeout(() => {
    if (!_running) return;
    try {
      fn();
    } catch (err) {
      log.error({ err: err.message, at: seconds }, 'pitch step failed');
    }
  }, seconds * 1000));
}

function broadcastStep(message) {
  if (_state) {
    _state.broadcastTo('ops', 'event', {
      type: 'demo',
      ts: Date.now(),
      message: '[PITCH] ' + message,
    });
    _state.broadcastTo('screen', 'demo_step', {
      ts: Date.now(),
      message: message,
    });
  }
  log.info({ message }, 'pitch step');
}

module.exports = { init, start, stop };
