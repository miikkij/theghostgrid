'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'router' });

/**
 * Wire up the event router: forward server-side events to WebSocket clients
 * and log key events. Other components subscribe/publish directly on state;
 * the router handles cross-cutting fan-out to the browser layer.
 */
function initRouter() {
  // Forward cycle phase changes to all WS clients
  state.on('cycle.sync_alpha', (data) => {
    state.broadcast('cycle_tick', { ...data, phase: 'sync_alpha' });
  });

  state.on('cycle.prep', (data) => {
    state.broadcast('cycle_tick', { ...data, phase: 'prep' });
  });

  state.on('cycle.sync_beta_burst', (data) => {
    state.broadcast('cycle_tick', { ...data, phase: 'sync_beta_burst' });
  });

  state.on('cycle.idle', (data) => {
    state.broadcast('cycle_tick', { ...data, phase: 'idle' });
  });

  // Forward node state changes to relevant clients
  state.on('state.changed', ({ path, value }) => {
    if (path.startsWith('nodes.')) {
      state.broadcastTo('screen', 'node_state_change', { path, value });
      state.broadcastTo('ops', 'node_state_change', { path, value });

      // If this is a state field on a node, push to that phone
      const parts = path.split('.');
      if (parts.length >= 3 && parts[2] === 'state') {
        const callsign = parts[1];
        state.broadcastTo('phone', 'node_state_change', { callsign, state: value });
      }
    }
  });

  // Forward scenario triggers (logged and re-emitted for any listeners)
  state.on('ops.trigger_scenario', (data) => {
    log.info({ scenario: data.scenario }, 'routing scenario trigger');
    state.broadcast('scenario_triggered', data);
  });

  // Forward alert events to phones and screen/ops
  state.on('alert', (data) => {
    state.broadcastTo('phone', 'alert', data);
    state.broadcastTo('screen', 'alert', data);
    state.broadcastTo('ops', 'alert', data);
    log.warn(data, 'alert broadcast');
  });

  // Forward AI decisions to screen and ops
  state.on('hq.broadcast_proposed', (data) => {
    state.broadcastTo('screen', 'ai_decision', data);
    state.broadcastTo('ops', 'ai_decision', data);
    log.info({ urgency: data.urgency }, 'AI decision routed');
  });

  // Forward transmission arcs to screen
  state.on('transmission.frame_transmitted', (data) => {
    state.broadcastTo('screen', 'transmission_arc', data);
  });

  // Forward deception pattern changes
  state.on('deception.pattern_activated', (data) => {
    state.broadcast('pattern_update', data);
  });

  state.on('deception.pattern_deactivated', (data) => {
    state.broadcast('pattern_update', data);
  });

  log.info('event router initialized');
}

module.exports = { initRouter };
