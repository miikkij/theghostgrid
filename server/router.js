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
  // Include last_alpha_ts and sync_beta_offset_ms so phone clients can compute countdown
  state.on('cycle.sync_alpha', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'sync_alpha',
      last_alpha_ts: data.ts,
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
    });
  });

  state.on('cycle.prep', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'prep',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
    });
  });

  state.on('cycle.sync_beta_burst', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'sync_beta_burst',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
    });
  });

  state.on('cycle.idle', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'idle',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
    });
  });

  // Forward node state changes to relevant clients
  state.on('state.changed', ({ path, value }) => {
    if (path.startsWith('nodes.')) {
      const parts = path.split('.');
      const nodeId = parts[1];
      const field = parts.slice(2).join('.');

      // Send as { nodeId, [field]: value } so clients can update their state maps
      // When field is empty, the whole node object was set (new node joined)
      const payload = { nodeId };
      if (field) {
        payload[field] = value;
      } else {
        Object.assign(payload, value);
      }
      state.broadcastTo('screen', 'node_state_change', payload);
      state.broadcastTo('ops', 'node_state_change', payload);

      if (field === 'state') {
        state.broadcastTo('phone', 'node_state_change', { callsign: nodeId, state: value });
      }

      // Log new node joins
      if (!field && value && value.type === 'soldier') {
        broadcastEvent('node_join', nodeId + ' joined the mesh');
      }
    }

    // Forward jamming zone changes to big screen and ops
    if (path === 'jamming_zones') {
      state.broadcastTo('screen', 'jamming_zones_update', value);
      state.broadcastTo('ops', 'state_update', { jamming_zones: value });
    }

    // Forward drone changes to big screen and ops
    if (path === 'drones' || path.startsWith('drones.')) {
      const drones = path === 'drones' ? value : state.get('drones');
      state.broadcastTo('screen', 'drones_update', drones);
      state.broadcastTo('ops', 'state_update', { drones });
    }
  });

  // Forward scenario triggers (logged and re-emitted for any listeners)
  state.on('ops.trigger_scenario', (data) => {
    log.info({ scenario: data.scenario }, 'routing scenario trigger');
    state.broadcast('scenario_triggered', data);
    broadcastEvent('scenario', 'Scenario: ' + (data.scenario || 'unknown'));
  });

  // Forward alert events to phones and screen/ops
  state.on('alert', (data) => {
    state.broadcastTo('phone', 'alert', data);
    state.broadcastTo('screen', 'alert', data);
    state.broadcastTo('ops', 'alert', data);
    log.warn(data, 'alert broadcast');
    broadcastEvent('alert', data.message || 'Alert triggered');
  });

  // Forward AI decisions to screen and ops
  state.on('hq.broadcast_proposed', (data) => {
    log.info({ urgency: data.urgency }, 'AI broadcast routed');
  });

  state.on('ai.decision', (data) => {
    state.broadcastTo('screen', 'ai_decision', data);
    state.broadcastTo('ops', 'ai_decision', data);
  });

  // Forward transmission arcs to screen
  state.on('transmission.frame_transmitted', (data) => {
    state.broadcastTo('screen', 'transmission_arc', data);
    state.broadcastTo('ops', 'transmission_arc', data);
  });

  // Forward channel hop sequences when burst window opens
  state.on('transmission.burst_window_open', (data) => {
    const allocs = data.allocations || {};
    const nodeIds = Object.keys(allocs);
    // Pick the first real node's hop sequence as the representative display
    const first = nodeIds.length > 0 ? allocs[nodeIds[0]] : null;
    if (first && first.frequencyHops) {
      state.broadcastTo('screen', 'channel_hops', {
        cycle: data.cycle,
        sequence: first.frequencyHops,
      });
    }
  });

  // Forward deception pattern changes (both event name variants)
  state.on('deception.pattern_activated', (data) => {
    state.broadcast('pattern_update', data);
    state.broadcast('deception.pattern_activated', data);
    broadcastEvent('deception', 'Pattern activated: ' + (data.patternName || data.name || 'unknown'));
  });

  state.on('deception.pattern_deactivated', (data) => {
    state.broadcast('pattern_update', data);
    state.broadcast('deception.pattern_deactivated', data);
    broadcastEvent('deception', 'Pattern deactivated: ' + (data.patternName || data.name || 'unknown'));
  });

  // Forward honeypot triggers as events
  state.on('deception.honeypot_triggered', (data) => {
    broadcastEvent('honeypot', 'Honeypot ' + (data.honeypotId || '') + ' triggered: ' + (data.eventType || data.type || 'contact'));
  });

  // Forward mesh events as ops log entries
  state.on('mesh.routing_converged', (data) => {
    broadcastEvent('routing', 'Mesh routing converged (cycle ' + (state.get('cycle.number') || 0) + ', ' + (data.reason || 'update') + ')');
  });

  // Server-side event buffer so ops dashboard survives refresh
  const MAX_EVENT_BUFFER = 50;
  const eventBuffer = [];

  function broadcastEvent(type, message) {
    const event = { type, ts: Date.now(), message };
    eventBuffer.unshift(event);
    if (eventBuffer.length > MAX_EVENT_BUFFER) eventBuffer.length = MAX_EVENT_BUFFER;
    state.set('recent_events', eventBuffer);
    state.broadcastTo('ops', 'event', event);
  }

  // Broadcast notable node events (joins, deaths)
  state.on('state.changed', ({ path, value }) => {
    if (!path.startsWith('nodes.')) return;
    const parts = path.split('.');
    if (parts[2] !== 'state') return;
    const nodeId = parts[1];
    if (value === 'DEAD') {
      broadcastEvent('node_leave', nodeId + ' disconnected');
    } else if (value === 'JAMMED') {
      broadcastEvent('jamming', nodeId + ' — JAMMED');
    }
  });

  log.info('event router initialized');
}

module.exports = { initRouter };
