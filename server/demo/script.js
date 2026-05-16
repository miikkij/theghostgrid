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
    // Minute 0: Sync beacon — the architectural anchor
    { t: 0,   fn: () => { dispatch('resume_cycles', {}); broadcastStep('Sync beacon active — fiber-tethered drones provide time discipline'); }},
    { t: 8,   fn: () => { broadcastStep('GPS jammed? Doesn\'t matter. The drone on fiber replaces GPS with a local sync pulse no jammer can reach'); }},
    { t: 18,  fn: () => { broadcastStep('Position data flows to HQ inside the sync pulse — drone fiber replaces GPS for the entire mesh'); }},
    { t: 25,  fn: () => { dispatch('request_sitrep', {}); broadcastStep('Initial SITREP — all units report position to HQ via drone mesh relay'); }},

    // Minute 1: Troops moving + burst protocol
    { t: 35,  fn: () => { popSettings({ movementEnabled: true, movementSpeed: 0.003 }); broadcastStep('Squads deploying — watch them move across the operational area'); }},
    { t: 45,  fn: () => { broadcastStep('Sub-50ms burst windows — soldiers emit only when they have data, then go silent'); }},
    { t: 55,  fn: () => { dispatch('request_sitrep', {}); broadcastStep('HQ requests SITREP — positions updated hop-by-hop through the mesh'); }},

    // Minute 2: Resilience under attack
    { t: 70,  fn: () => { dispatch('inject_jamming', { area: { center: { x: 0.55, y: 0.45 }, radius: 0.15 } }); broadcastStep('EW ATTACK — enemy jams sector 3'); }},
    { t: 80,  fn: () => { broadcastStep('Mesh routing reconverges around the dead zone — no GPS in this chain'); }},
    { t: 85,  fn: () => { dispatch('clear_jamming', {}); broadcastStep('Jamming cleared — mesh self-healed'); }},
    { t: 95,  fn: () => { dispatch('drop_drone', { droneId: 'DRONE-2' }); broadcastStep('DRONE-2 lost — remaining drones continue providing sync'); }},
    { t: 105, fn: () => { dispatch('request_sitrep', {}); broadcastStep('SITREP after attack — HQ confirms all units still reporting'); }},

    // Minute 3: Deception capability
    { t: 120, fn: () => { dispatch('activate_decoys', { count: 47 }); broadcastStep('47 decoy emitters deployed — EUR 25 each, protocol-identical to real soldiers'); }},
    { t: 130, fn: () => { popSettings({ txEnabled: true, txRate: 0.1 }); broadcastStep('Decoys and soldiers transmitting — enemy SIGINT sees uniform traffic, can\'t distinguish'); }},
    { t: 140, fn: () => { dispatch('activate_pattern', { patternName: 'linear_translation', parameters: { velocity: 0.02, direction: 0, bandWidth: 0.15 } }); broadcastStep('Wave choreography — enemy sees a battalion moving east'); }},
    { t: 155, fn: () => { dispatch('activate_pattern', { patternName: 'phantom_convoy', parameters: { velocity: 0.025, convoyLength: 0.3, path: [{ x: 0.2, y: 0.7 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.3 }] } }); broadcastStep('Phantom convoy — second deception axis, same protocol'); }},

    // Minute 4: Honeypot + AI
    { t: 175, fn: () => { dispatch('trigger_honeypot', { eventType: 'artillery' }); broadcastStep('HONEYPOT triggered — acoustic sensor detects artillery overpressure'); }},
    { t: 182, fn: () => { broadcastStep('Alert reaches every phone in 5 seconds — sensor to warning, through the mesh'); }},
    { t: 195, fn: () => { dispatch('trigger_ai_adaptation', {}); broadcastStep('AI on ConfidentialMind analyzes enemy reaction — updates choreography'); }},

    // Minute 5: Recovery + final proof
    { t: 215, fn: () => { _state.set('drones.DRONE-2', { position: { x: 0.65, y: 0.12 }, status: 'active', role: 'sync' }); broadcastStep('DRONE-2 restored — full sync redundancy'); }},
    { t: 225, fn: () => { broadcastStep('Watch the gap between real positions and HQ-known rings — that\'s fog of war, updated only by soldier reports'); }},
    { t: 240, fn: () => { dispatch('request_sitrep', {}); broadcastStep('Final SITREP — rings snap to soldiers, HQ picture complete'); }},
    { t: 260, fn: () => { popSettings({ movementEnabled: false, txEnabled: false }); broadcastStep('Architecture proven — sync beacon anchors everything'); }},
    { t: 270, fn: () => { dispatch('reset_state', {}); dispatch('resume_cycles', {}); }},
    { t: 300, fn: () => { broadcastStep('The architecture is anchored in a sync beacon you cannot jam. Everything else is built on that.'); _running = false; log.info('===== FULL PITCH SEQUENCE COMPLETE ====='); }},
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

function popSettings(settings) {
  _state.emit('population.settings', settings);
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
