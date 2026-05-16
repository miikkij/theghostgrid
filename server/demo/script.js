'use strict';

const log = require('../log').child({ component: 'demo' });
const { dispatch } = require('./scenarios');

let _state = null;
let _steps = [];
let _activeTimers = [];
let _running = false;
let _paused = false;
let _startedAt = 0;
let _pausedAt = 0;
let _pausedElapsed = 0;

function init(state) {
  _state = state;

  state.on('ops.trigger_scenario', (data) => {
    if (data.scenario === 'run_full_pitch') start();
    if (data.scenario === 'stop_pitch') stop();
    if (data.scenario === 'pause_pitch') pause();
    if (data.scenario === 'resume_pitch') resume();
  });
}

function buildSteps() {
  return [
    { t: 0,   fn: () => { dispatch('resume_cycles', {}); broadcastStep('Cycles running, drones seeded'); }},
    { t: 10,  fn: () => { broadcastStep('Sync beacon — watch the drone pulse'); }},
    { t: 30,  fn: () => { broadcastStep('Burst protocol active — sub-50ms windows'); }},
    { t: 60,  fn: () => { dispatch('inject_jamming', { area: { center: { x: 0.55, y: 0.45 }, radius: 0.15 } }); broadcastStep('EW ATTACK — jamming injected sector 3'); }},
    { t: 75,  fn: () => { dispatch('clear_jamming', {}); broadcastStep('Mesh reconverged — jamming cleared'); }},
    { t: 90,  fn: () => { dispatch('drop_drone', { droneId: 'DRONE-2' }); broadcastStep('DRONE-2 lost — remaining drones take over'); }},
    { t: 120, fn: () => { dispatch('activate_decoys', { count: 47 }); broadcastStep('47 decoy emitters deployed — EUR 25 each'); }},
    { t: 135, fn: () => { dispatch('activate_pattern', { patternName: 'linear_translation', parameters: { velocity: 0.02, direction: 0, bandWidth: 0.15 } }); broadcastStep('Wave choreography — battalion moving east'); }},
    { t: 150, fn: () => { dispatch('activate_pattern', { patternName: 'phantom_convoy', parameters: { velocity: 0.025, convoyLength: 0.2, path: [{ x: 0.2, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.3 }] } }); broadcastStep('Phantom convoy — second deception axis'); }},
    { t: 180, fn: () => { dispatch('trigger_honeypot', { eventType: 'artillery' }); broadcastStep('HONEYPOT TRIGGERED — artillery detection'); }},
    { t: 195, fn: () => { dispatch('trigger_ai_adaptation', {}); broadcastStep('AI analyzing — choreography update recommended'); }},
    { t: 240, fn: () => { _state.set('drones.DRONE-2', { position: { x: 0.65, y: 0.12 }, status: 'active', role: 'sync' }); broadcastStep('DRONE-2 restored — full redundancy'); }},
    { t: 270, fn: () => { dispatch('reset_state', {}); dispatch('resume_cycles', {}); broadcastStep('Systems nominal — architecture proven'); }},
    { t: 300, fn: () => { broadcastStep('PITCH COMPLETE — 5 minutes'); _running = false; log.info('===== FULL PITCH SEQUENCE COMPLETE ====='); }},
  ];
}

function start() {
  if (_running) {
    log.warn('pitch already running');
    return;
  }
  _running = true;
  _paused = false;
  _pausedElapsed = 0;
  _startedAt = Date.now();
  _steps = buildSteps();
  log.info('===== FULL PITCH SEQUENCE STARTED =====');
  broadcastStep('Pitch sequence started — 5 minutes');
  scheduleRemaining();
}

function stop() {
  if (!_running) return;
  clearAllTimers();
  _running = false;
  _paused = false;
  _steps = [];
  broadcastStep('Pitch sequence stopped');
  log.info('pitch sequence stopped');
}

function pause() {
  if (!_running || _paused) return;
  _paused = true;
  _pausedAt = Date.now();
  clearAllTimers();
  broadcastStep('Pitch PAUSED — press resume to continue');
  log.info('pitch paused');
}

function resume() {
  if (!_running || !_paused) return;
  _pausedElapsed += Date.now() - _pausedAt;
  _paused = false;
  broadcastStep('Pitch RESUMED');
  log.info('pitch resumed');
  scheduleRemaining();
}

function scheduleRemaining() {
  clearAllTimers();
  const elapsed = (Date.now() - _startedAt - _pausedElapsed) / 1000;

  for (const step of _steps) {
    if (step.done) continue;
    const delay = (step.t - elapsed) * 1000;
    if (delay <= 0) {
      // Step should have already fired — run immediately
      runStep(step);
    } else {
      _activeTimers.push(setTimeout(() => {
        if (!_running || _paused) return;
        runStep(step);
      }, delay));
    }
  }
}

function runStep(step) {
  if (step.done) return;
  step.done = true;
  try {
    step.fn();
  } catch (err) {
    log.error({ err: err.message, at: step.t }, 'pitch step failed');
  }
}

function clearAllTimers() {
  for (const t of _activeTimers) clearTimeout(t);
  _activeTimers = [];
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

module.exports = { init, start, stop, pause, resume };
