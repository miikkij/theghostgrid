'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'router' });

/**
 * Wire up the event router: forward server-side events to WebSocket clients
 * and log key events. Other components subscribe/publish directly on state;
 * the router handles cross-cutting fan-out to the browser layer.
 */
function initRouter() {
  // --- Packets-per-second tracking ---
  let _prevPackets = 0;
  let _pps = 0;
  setInterval(() => {
    const current = state.get('stats.packets_total') || 0;
    _pps = current - _prevPackets;
    _prevPackets = current;
    state.set('stats.pps', _pps);
  }, 1000);

  function currentStats() {
    const s = state.get('stats') || {};
    return { packets_total: s.packets_total || 0, sync_drift_ms: s.sync_drift_ms || 0, pps: s.pps || _pps, ai_decisions: s.ai_decisions || 0 };
  }

  // Forward cycle phase changes to all WS clients
  // Include stats so screens/ops get live telemetry every phase change
  state.on('cycle.sync_alpha', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'sync_alpha',
      last_alpha_ts: data.ts,
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
      stats: currentStats(),
    });
  });

  state.on('cycle.prep', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'prep',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
      stats: currentStats(),
    });
  });

  state.on('cycle.sync_beta_burst', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'sync_beta_burst',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
      stats: currentStats(),
    });
  });

  state.on('cycle.idle', (data) => {
    state.broadcast('cycle_tick', {
      ...data,
      phase: 'idle',
      last_alpha_ts: state.get('cycle.last_alpha_ts'),
      sync_beta_offset_ms: state.get('cycle.period_ms') || 1000,
      stats: currentStats(),
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

      // Ops gets fog-of-war: strip real-time position for soldiers
      // HQ only learns position when soldier explicitly reports (via unit_update)
      const nodeData = state.get(`nodes.${nodeId}`);
      if (nodeData && nodeData.type === 'soldier' && (field === 'position' || field === '')) {
        const opsPayload = { ...payload };
        delete opsPayload.position;
        state.broadcastTo('ops', 'node_state_change', opsPayload);
      } else {
        state.broadcastTo('ops', 'node_state_change', payload);
      }

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

  // Forward transmission arcs to screen and count packets
  state.on('transmission.frame_transmitted', (data) => {
    state.set('stats.packets_total', (state.get('stats.packets_total') || 0) + 1);
    state.broadcastTo('screen', 'transmission_arc', data);
    state.broadcastTo('ops', 'transmission_arc', data);
  });

  state.on('transmission.frame_received', () => {
    state.set('stats.packets_total', (state.get('stats.packets_total') || 0) + 1);
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
