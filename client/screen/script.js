'use strict';

/**
 * Big Screen orchestration — state management, WebSocket events, render loop, simulation toggle.
 */

// --- State ---

var EMPTY_STATE = {
  cycle: { number: 0, phase: 'idle', period_ms: 1000, last_alpha_ts: 0, last_beta_ts: 0 },
  nodes: {},
  drones: {},
  jamming_zones: [],
  active_transmissions: [],
  active_alerts: [],
  stats: { packets_total: 0, packets_dropped: 0, sync_drift_ms: 0, ai_decisions: 0 },
  ai_reasoning: null,
};

var state = JSON.parse(JSON.stringify(EMPTY_STATE));

function resetState() {
  Object.assign(state, JSON.parse(JSON.stringify(EMPTY_STATE)));
}

// --- Init ---

var canvas = document.getElementById('battlefield');
var renderer = new BattlefieldRenderer(canvas);

// --- FPS tracking ---

var frameCount = 0;
var lastFpsUpdate = performance.now();
var fpsEl = document.querySelector('[data-fps]');

// --- Overlay DOM refs (cached once) ---

var overlayRefs = {
  utc: document.querySelector('[data-utc]'),
  cycle: document.querySelector('[data-cycle]'),
  phase: document.querySelector('[data-phase]'),
  progressBar: document.querySelector('[data-progress-bar]'),
  packets: document.querySelector('[data-packets]'),
  drift: document.querySelector('[data-drift]'),
  nodes: document.querySelector('[data-nodes]'),
  decoys: document.querySelector('[data-decoys]'),
  aiStatus: document.querySelector('[data-ai-status]'),
};

// --- Render loop ---

function tick(time) {
  renderer.render(state, time);
  frameCount++;

  if (time - lastFpsUpdate > 500) {
    var fps = Math.round(frameCount / ((time - lastFpsUpdate) / 1000));
    if (fpsEl) fpsEl.textContent = fps;
    frameCount = 0;
    lastFpsUpdate = time;
  }

  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

// --- Overlay updates (throttled, outside render path) ---

var lastOverlayUpdate = 0;

function updateOverlays() {
  var now = performance.now();
  if (now - lastOverlayUpdate < 250) return;
  lastOverlayUpdate = now;

  var d = new Date();
  if (overlayRefs.utc) {
    overlayRefs.utc.textContent = d.toISOString().slice(11, 19) + ' UTC';
  }
  if (overlayRefs.cycle) {
    overlayRefs.cycle.textContent = String(state.cycle.number).padStart(4, '0');
  }
  if (overlayRefs.phase) {
    overlayRefs.phase.textContent = (state.cycle.phase || 'IDLE').toUpperCase().replace(/_/g, ' ');
  }
  if (overlayRefs.progressBar && state.cycle.period_ms > 0) {
    var elapsed = Date.now() - (state.cycle.last_alpha_ts || Date.now());
    var pct = Math.min(100, (elapsed / state.cycle.period_ms) * 100);
    overlayRefs.progressBar.style.width = pct + '%';
  }

  var nodeValues = Object.values(state.nodes);
  if (overlayRefs.packets) {
    overlayRefs.packets.textContent = formatNumber(state.stats.packets_total);
  }
  if (overlayRefs.drift) {
    overlayRefs.drift.textContent = state.stats.sync_drift_ms + 'ms';
  }
  if (overlayRefs.nodes) {
    overlayRefs.nodes.textContent = nodeValues.filter(function(n) { return n.type === 'soldier' || n.type === 'real'; }).length;
  }
  if (overlayRefs.decoys) {
    overlayRefs.decoys.textContent = nodeValues.filter(function(n) { return n.type === 'decoy'; }).length;
  }
  if (overlayRefs.aiStatus) {
    var aiText = state.ai_reasoning ? 'ACTIVE' : 'STANDBY';
    overlayRefs.aiStatus.textContent = aiText;
    overlayRefs.aiStatus.style.color = state.ai_reasoning
      ? 'var(--accent-green)' : 'var(--text-muted)';
  }
}

function overlayLoop() {
  updateOverlays();
  requestAnimationFrame(overlayLoop);
}
requestAnimationFrame(overlayLoop);

// --- Number formatting ---

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

// --- AI reasoning panel ---

function showAIReasoning(decision) {
  var panel = document.getElementById('ai-reasoning');
  var content = document.getElementById('reasoning-content');
  if (!panel || !content) return;

  var timeStr = new Date().toISOString().slice(11, 19);
  var timeEl = document.querySelector('[data-ai-time]');
  if (timeEl) timeEl.textContent = timeStr;

  content.innerHTML =
    '<div class="ai-classification">' + escapeHtml(decision.classification || 'UNKNOWN') + '</div>' +
    '<div class="ai-reasoning-text">' + escapeHtml(decision.reasoning || '') + '</div>' +
    '<div class="ai-confidence">Confidence: ' + Math.round((decision.confidence || 0) * 100) + '%</div>';

  panel.classList.remove('hidden');
  panel.classList.add('visible');

  clearTimeout(panel._hideTimer);
  panel._hideTimer = setTimeout(function() {
    panel.classList.remove('visible');
    panel.classList.add('hidden');
  }, 30000);
}

function hideAIReasoning() {
  var panel = document.getElementById('ai-reasoning');
  if (!panel) return;
  clearTimeout(panel._hideTimer);
  panel.classList.remove('visible');
  panel.classList.add('hidden');
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Cursor auto-hide ---

var cursorTimer = null;

function showCursor() {
  document.body.classList.add('cursor-visible');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(function() {
    document.body.classList.remove('cursor-visible');
  }, 5000);
}

document.addEventListener('mousemove', showCursor);
document.addEventListener('mousedown', showCursor);

// --- Disconnect overlay ---

function setDisconnected(disconnected) {
  var overlay = document.getElementById('disconnected-overlay');
  if (!overlay) return;
  if (disconnected) {
    overlay.classList.remove('hidden');
  } else {
    overlay.classList.add('hidden');
  }
}

// ============================================================
// Simulation engine — startable / stoppable
// ============================================================

var _simTimers = [];
var _simRunning = false;

function startSimulation() {
  if (_simRunning) return;
  _simRunning = true;
  resetState();

  var indicator = document.getElementById('connection-indicator');
  if (indicator) indicator.classList.add('connected');

  // Seed drones
  state.drones = {
    'DRONE-1': { position: { x: 0.35, y: 0.25 }, status: 'active', role: 'sync' },
    'DRONE-2': { position: { x: 0.65, y: 0.20 }, status: 'active', role: 'sync' },
    'DRONE-3': { position: { x: 0.50, y: 0.15 }, status: 'active', role: 'relay' },
  };

  var callsigns = [
    'ALPHA-1', 'BRAVO-1', 'CHARLIE-1', 'DELTA-1', 'ECHO-1',
    'FOXTROT-1', 'GOLF-1', 'HOTEL-1', 'INDIA-1', 'JULIET-1',
    'KILO-1', 'LIMA-1', 'MIKE-1', 'NOVEMBER-1', 'OSCAR-1',
  ];

  for (var ci = 0; ci < callsigns.length; ci++) {
    state.nodes[callsigns[ci]] = {
      type: 'soldier',
      position: { x: 0.15 + Math.random() * 0.7, y: 0.3 + Math.random() * 0.55 },
      state: 'LISTENING',
      neighbors: [],
      lastSeen: Date.now(),
    };
  }

  for (var i = 0; i < 50; i++) {
    state.nodes['D-' + String(i).padStart(3, '0')] = {
      type: 'decoy',
      position: { x: 0.1 + Math.random() * 0.8, y: 0.2 + Math.random() * 0.7 },
      state: 'LISTENING',
      neighbors: [],
      lastSeen: Date.now(),
    };
  }

  for (var h = 0; h < 5; h++) {
    state.nodes['HP-' + (20 + h)] = {
      type: 'honeypot',
      position: { x: 0.2 + Math.random() * 0.6, y: 0.3 + Math.random() * 0.5 },
      state: 'LISTENING',
      neighbors: [],
      lastSeen: Date.now(),
    };
  }

  var cycleNum = 0;
  var PERIOD = 1000;

  // Cycle ticker
  _simTimers.push(setInterval(function() {
    cycleNum++;
    state.stats.packets_total += Math.floor(Math.random() * 20) + 10;
    state.stats.sync_drift_ms = Math.floor(Math.random() * 200);

    var phases = ['sync_alpha', 'sync_beta_burst', 'burst_window', 'cover_fill', 'idle'];
    var phaseIdx = 0;

    function advancePhase() {
      if (!_simRunning) return;
      state.cycle.number = cycleNum;
      state.cycle.phase = phases[phaseIdx];
      state.cycle.period_ms = PERIOD;

      if (phases[phaseIdx] === 'sync_alpha') {
        state.cycle.last_alpha_ts = performance.now();
      }
      if (phases[phaseIdx] === 'sync_beta_burst') {
        state.cycle.last_beta_ts = performance.now();
      }

      phaseIdx++;
      if (phaseIdx < phases.length) {
        _simTimers.push(setTimeout(advancePhase, phaseIdx === 1 ? 200 : phaseIdx === 2 ? 150 : 100));
      }
    }
    advancePhase();

    var realNodes = callsigns.filter(function() { return Math.random() > 0.6; });
    for (var ri = 0; ri < realNodes.length; ri++) {
      var toIdx = Math.floor(Math.random() * callsigns.length);
      if (realNodes[ri] !== callsigns[toIdx]) {
        state.active_transmissions.push({
          from: realNodes[ri],
          to: callsigns[toIdx],
          expires_at: Date.now() + 50,
        });
      }
    }

    for (var si = 0; si < callsigns.length; si++) {
      if (Math.random() > 0.85 && state.nodes[callsigns[si]]) {
        var nodeStates = ['LISTENING', 'TX', 'RX', 'SYNC'];
        state.nodes[callsigns[si]].state = nodeStates[Math.floor(Math.random() * nodeStates.length)];
      }
    }

    var decoyKeys = Object.keys(state.nodes);
    for (var di = 0; di < decoyKeys.length; di++) {
      var dn = state.nodes[decoyKeys[di]];
      if (dn && dn.type === 'decoy' && Math.random() > 0.9) {
        dn.position.x = Math.max(0.05, Math.min(0.95, dn.position.x + (Math.random() - 0.5) * 0.01));
        dn.position.y = Math.max(0.1, Math.min(0.95, dn.position.y + (Math.random() - 0.5) * 0.01));
      }
    }
  }, PERIOD));

  // Jamming zone at 5s
  _simTimers.push(setTimeout(function() {
    if (!_simRunning) return;
    state.jamming_zones.push({
      id: 'ez-1',
      polygon: [
        { x: 0.6, y: 0.5 },
        { x: 0.85, y: 0.45 },
        { x: 0.9, y: 0.7 },
        { x: 0.65, y: 0.75 },
      ],
    });
    var keys = Object.keys(state.nodes);
    for (var ji = 0; ji < keys.length; ji++) {
      var n = state.nodes[keys[ji]];
      if (n && n.position.x > 0.6 && n.position.x < 0.9 &&
          n.position.y > 0.45 && n.position.y < 0.75) {
        n.state = 'JAMMED';
      }
    }
  }, 5000));

  // Honeypot alert at 10s
  _simTimers.push(setTimeout(function() {
    if (!_simRunning) return;
    state.active_alerts.push({
      nodeId: 'HP-20',
      caption: 'HP-20 ACOUSTIC | ARTILLERY | DoA 287°',
      expires_at: Date.now() + 5000,
    });
  }, 10000));

  // AI decision at 12s
  _simTimers.push(setTimeout(function() {
    if (!_simRunning) return;
    var decision = {
      classification: 'ARTILLERY BATTERY DETECTED',
      reasoning: 'Acoustic signature from HP-20 correlated with seismic data from HP-22. Pattern consistent with 152mm howitzer battery, estimated 3-4 tubes. Direction of arrival 287° from mesh centroid, range estimated 4-6km.',
      confidence: 0.87,
    };
    state.ai_reasoning = decision;
    state.stats.ai_decisions++;
    showAIReasoning(decision);
  }, 12000));

  // Second jamming zone at 20s
  _simTimers.push(setTimeout(function() {
    if (!_simRunning) return;
    state.jamming_zones.push({
      id: 'ez-2',
      center: { x: 0.25, y: 0.6 },
      radius: 0.1,
    });
  }, 20000));

  // Periodic honeypot alerts
  _simTimers.push(setInterval(function() {
    if (!_simRunning) return;
    var hpIds = Object.keys(state.nodes).filter(function(id) { return id.startsWith('HP-'); });
    if (hpIds.length === 0) return;
    var hpId = hpIds[Math.floor(Math.random() * hpIds.length)];
    var types = ['ACOUSTIC', 'SEISMIC', 'RF'];
    var classes = ['ARTILLERY', 'VEHICLE', 'INFANTRY'];
    var type = types[Math.floor(Math.random() * types.length)];
    var cls = classes[Math.floor(Math.random() * classes.length)];
    var doa = Math.floor(Math.random() * 360);
    state.active_alerts.push({
      nodeId: hpId,
      caption: hpId + ' ' + type + ' | ' + cls + ' | DoA ' + doa + '°',
      expires_at: Date.now() + 5000,
    });
  }, 15000));

  // Scale up to 100+ nodes after 3s
  _simTimers.push(setTimeout(function() {
    if (!_simRunning) return;
    for (var si = 50; si < 90; si++) {
      state.nodes['D-' + String(si).padStart(3, '0')] = {
        type: 'decoy',
        position: { x: 0.05 + Math.random() * 0.9, y: 0.15 + Math.random() * 0.75 },
        state: 'LISTENING',
        neighbors: [],
        lastSeen: Date.now(),
      };
    }
  }, 3000));

  console.log('[sim] Simulation started');
}

function stopSimulation() {
  _simRunning = false;
  for (var i = 0; i < _simTimers.length; i++) {
    clearInterval(_simTimers[i]);
    clearTimeout(_simTimers[i]);
  }
  _simTimers = [];

  resetState();
  hideAIReasoning();

  var indicator = document.getElementById('connection-indicator');
  if (indicator) indicator.classList.remove('connected');

  console.log('[sim] Simulation stopped');
}

// ============================================================
// Simulation toggle UI
// ============================================================

var simToggleBtn = document.getElementById('sim-toggle');
var simBadge = document.getElementById('sim-badge');

function setSimUI(active) {
  if (!simToggleBtn || !simBadge) return;
  if (active) {
    simToggleBtn.classList.add('active');
    simToggleBtn.innerHTML = '<span class="sim-play">&#9632;</span> STOP';
    simBadge.classList.remove('hidden');
    document.getElementById('app').classList.add('sim-active');
  } else {
    simToggleBtn.classList.remove('active');
    simToggleBtn.innerHTML = '<span class="sim-play">&#9654;</span> SIMULATION';
    simBadge.classList.add('hidden');
    document.getElementById('app').classList.remove('sim-active');
  }
}

if (simToggleBtn) {
  simToggleBtn.addEventListener('click', function() {
    if (_simRunning) {
      stopSimulation();
      setSimUI(false);
    } else {
      startSimulation();
      setSimUI(true);
    }
  });
}

// ============================================================
// Startup — WebSocket or auto-start simulation
// ============================================================

var isMock = new URLSearchParams(window.location.search).get('mock') === 'true';

if (isMock) {
  startSimulation();
  setSimUI(true);
} else {
  var socket = connectToMesh('screen', function(fullState) {
    if (fullState.cycle) Object.assign(state.cycle, fullState.cycle);
    if (fullState.nodes) state.nodes = fullState.nodes;
    if (fullState.drones) state.drones = fullState.drones;
    if (fullState.jamming_zones) state.jamming_zones = fullState.jamming_zones;
    if (fullState.stats) Object.assign(state.stats, fullState.stats);
  });

  if (socket) {
    socket.on('cycle_tick', function(data) {
      Object.assign(state.cycle, data);
      if (data.phase === 'sync_alpha') state.cycle.last_alpha_ts = performance.now();
      if (data.phase === 'sync_beta_burst') state.cycle.last_beta_ts = performance.now();
    });

    socket.on('node_state_change', function(data) {
      if (!data.nodeId) return;
      if (!state.nodes[data.nodeId]) state.nodes[data.nodeId] = {};
      Object.assign(state.nodes[data.nodeId], data);
    });

    socket.on('transmission_arc', function(data) {
      state.active_transmissions.push({
        from: data.from,
        to: data.to,
        expires_at: Date.now() + 50,
      });
    });

    socket.on('jamming_zone_added', function(zone) {
      state.jamming_zones.push(zone);
    });

    socket.on('jamming_zone_removed', function(data) {
      state.jamming_zones = state.jamming_zones.filter(function(z) { return z.id !== data.id; });
    });

    socket.on('alert', function(alert) {
      state.active_alerts.push({ expires_at: Date.now() + 5000, nodeId: alert.nodeId, caption: alert.caption });
    });

    socket.on('ai.decision', function(decision) {
      state.ai_reasoning = decision;
      state.stats.ai_decisions++;
      showAIReasoning(decision);
    });

    socket.on('disconnect', function() { setDisconnected(true); });
    socket.on('connect', function() { setDisconnected(false); });
    socket.on('reconnect', function() { setDisconnected(false); });
  }
}
