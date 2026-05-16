'use strict';

/**
 * Operator Dashboard — Main orchestration.
 * Creates the socket, binds events, drives rendering and mock mode.
 */
(function () {
  var MOCK_MODE = new URLSearchParams(window.location.search).has('mock');
  var MINIMAP_FPS = 10;
  var MAX_EVENTS = 50;
  var MAX_AI_HISTORY = 10;

  // --- Local state cache ---

  var state = {
    cycle: { number: 0, phase: 'idle', period_ms: 1000 },
    nodes: {},
    drones: {},
    jamming_zones: [],
    stats: { packets_total: 0, packets_dropped: 0, sync_drift_ms: 0, pps: 0 },
    events: [],
    ai_reasoning: null,
    ai_history: [],
    adapters: {},
    active_patterns: [],
    units: {},
    connected: false,
    paused: false,
  };

  // --- DOM references ---

  var dom = {
    cycle: document.querySelector('[data-cycle]'),
    nodes: document.querySelector('[data-nodes]'),
    pps: document.querySelector('[data-pps]'),
    drift: document.querySelector('[data-drift]'),
    aiStatus: document.querySelector('[data-ai-status]'),
    systemStatus: document.querySelector('[data-system-status]'),
    systemLabel: document.querySelector('[data-system-label]'),
    minimapCanvas: document.getElementById('minimap-canvas'),
    eventLogContent: document.querySelector('.event-log-content'),
    unitsContent: document.querySelector('.units-content'),
    aiContent: document.querySelector('.ai-content'),
    aiHistoryList: document.querySelector('.ai-history-list'),
    patternsList: document.querySelector('.patterns-list'),
    banner: document.getElementById('disconnected-banner'),
  };

  var minimapCtx = dom.minimapCanvas ? dom.minimapCanvas.getContext('2d') : null;

  // --- Socket connection ---

  var socket;

  if (MOCK_MODE) {
    socket = createMockSocket();
    console.log('[ops] Mock mode — append ?mock to URL');
  } else {
    socket = connectToMesh('ops');
  }

  if (socket) {
    Controls.init(socket);
    bindSocketEvents(socket);
  }

  // --- Socket event bindings ---

  function bindSocketEvents(sock) {
    sock.on('cycle_tick', function (data) {
      Object.assign(state.cycle, data);
      if (data.phase === 'paused') {
        state.paused = true;
        Controls.setPaused(true);
      } else if (state.paused && data.phase !== 'paused') {
        state.paused = false;
        Controls.setPaused(false);
      }
      updateStatusBar();
    });

    sock.on('state_update', function (data) {
      onStateUpdate(data);
    });

    // Incremental node state changes (keeps minimap and status bar live)
    sock.on('node_state_change', function (data) {
      if (!data.nodeId) return;
      var isNew = !state.nodes[data.nodeId];
      if (isNew) state.nodes[data.nodeId] = {};
      Object.assign(state.nodes[data.nodeId], data);
      updateStatusBar();
      // Enable pattern buttons when first decoy/honeypot appears
      if (isNew && (data.type === 'decoy' || data.type === 'honeypot')) {
        Controls.setDecoysActive(true);
      }
    });

    sock.on('event', function (event) {
      addEvent(event);
    });

    // AI decisions — deduplicate by log_id
    var seenDecisionIds = {};
    function handleAIDecision(decision) {
      if (decision.log_id && seenDecisionIds[decision.log_id]) return;
      if (decision.log_id) seenDecisionIds[decision.log_id] = true;
      state.ai_reasoning = decision;
      state.ai_history.unshift(decision);
      if (state.ai_history.length > MAX_AI_HISTORY) state.ai_history.length = MAX_AI_HISTORY;
      renderAIPanel();
      addEvent({
        type: 'ai_decision',
        severity: 'ai',
        message: decision.summary || decision.classification || 'AI decision rendered',
      });
    }
    sock.on('ai.decision', handleAIDecision);
    sock.on('ai_decision', handleAIDecision);

    sock.on('adapter_status', function (data) {
      state.adapters[data.adapter] = data.status;
      if (data.backend) state.adapters[data.adapter + '_backend'] = data.backend;
      renderAdapterStatus();
    });

    // Pattern events — listen for both name variants
    // Track pattern IDs to avoid duplicate additions from multiple event names
    var knownPatternIds = {};

    function handlePatternActivated(data) {
      var pid = data.patternId || data.id;
      if (pid && knownPatternIds[pid]) return;
      if (pid) knownPatternIds[pid] = true;
      state.active_patterns.push(data);
      renderActivePatterns();
      var trigger = patternNameToTrigger(data.patternName || data.name);
      if (trigger) Controls.setPatternActive(trigger, true);
    }
    function handlePatternDeactivated(data) {
      var pid = data.patternId || data.id;
      if (pid) delete knownPatternIds[pid];
      state.active_patterns = state.active_patterns.filter(function (p) {
        return (p.patternId || p.id) !== pid;
      });
      renderActivePatterns();
      var trigger = patternNameToTrigger(data.patternName || data.name);
      if (trigger) Controls.setPatternActive(trigger, false);
    }
    sock.on('deception.pattern_activated', handlePatternActivated);
    sock.on('pattern_update', function (data) {
      if (data.patternName && !data.action) handlePatternActivated(data);
      else if (data.action === 'deactivated') handlePatternDeactivated(data);
    });
    sock.on('deception.pattern_deactivated', handlePatternDeactivated);

    sock.on('scenario_result', function (data) {
      var severity = data.success ? 'routine' : 'alert';
      addEvent({
        type: 'scenario_result',
        severity: severity,
        message: data.scenario + ': ' + (data.message || (data.success ? 'OK' : 'FAILED')),
      });
    });

    sock.on('unit_update', function (unit) {
      if (!state.units) state.units = {};
      state.units[unit.callsign] = unit;
      renderUnits();
    });

    sock.on('cm_reasoning_changed', function (data) {
      state._reasoningEnabled = data.enabled;
      updateStatusBar();
    });

    sock.on('connect', function () {
      state.connected = true;
      state.active_patterns = [];
      Controls.resetPatterns();
      updateSystemState('ACTIVE', 'connected');
      hideBanner();
      setControlsEnabled(true);
      Controls.setPaused(false);
      Controls.setDecoysActive(hasDecoys());
      Controls.setPitchRunning(false);
    });

    sock.on('disconnect', function () {
      state.connected = false;
      updateSystemState('DISCONNECTED', 'error');
      showBanner();
      setControlsEnabled(false);
    });

    sock.on('reconnect', function () {
      state.connected = true;
      updateSystemState('ACTIVE', 'connected');
      hideBanner();
    });

    // System pulse graph
    var pulseCanvas = document.getElementById('pulse-canvas');
    if (pulseCanvas && typeof SystemPulse !== 'undefined') {
      var pulse = new SystemPulse(pulseCanvas, { height: 28, scrollSpeed: 30, maxAge: 20000 });
      window.addEventListener('resize', function() { pulse._resize(); });

      // Same event sources as big screen — no duplicates
      sock.on('ai_decision', function() { pulse.push('ai_decision', 0.9); });
      sock.on('node_state_change', function(data) {
        if (data.type === 'honeypot') pulse.push('honeypot', 0.75);
        else if (data.state === 'JAMMED') pulse.push('jamming', 0.7);
      });
      sock.on('transmission_arc', function() { pulse.push('burst', 0.15); });
      sock.on('cycle_tick', function(data) {
        if (data.phase === 'sync_alpha') pulse.push('cycle', 0.1);
      });
      sock.on('scenario_triggered', function() { pulse.push('scenario', 0.5); });
    }
  }

  // --- State update handler ---

  function onStateUpdate(data) {
    if (data.nodes) state.nodes = data.nodes;
    if (data.drones) state.drones = data.drones;
    if (data.jamming_zones) state.jamming_zones = data.jamming_zones;
    if (data.stats) Object.assign(state.stats, data.stats);
    if (data.cycle) Object.assign(state.cycle, data.cycle);
    if (data.active_patterns) {
      state.active_patterns = data.active_patterns;
      renderActivePatterns();
      // Restore button toggle states from server-side pattern list
      Controls.resetPatterns();
      for (var pi = 0; pi < data.active_patterns.length; pi++) {
        var trigger = patternNameToTrigger(data.active_patterns[pi].patternName || data.active_patterns[pi].name);
        if (trigger) Controls.setPatternActive(trigger, true);
      }
    }
    if (data.cm_reasoning_enabled != null) {
      state._reasoningConfigured = true;
      state._reasoningEnabled = data.cm_reasoning_enabled;
    }
    if (data.units) {
      state.units = data.units;
      renderUnits();
    }
    // Restore event log from server buffer on reconnect
    if (data.recent_events && data.recent_events.length > 0) {
      for (var i = data.recent_events.length - 1; i >= 0; i--) {
        addEvent(data.recent_events[i]);
      }
    }
    updateStatusBar();
  }

  // --- Pattern name ↔ trigger button mapping ---

  function patternNameToTrigger(name) {
    var map = {
      linear_translation: 'pattern_linear',
      phantom_convoy: 'pattern_convoy',
      radial_expansion: 'pattern_radial',
    };
    return map[name] || null;
  }

  // --- Status bar ---

  function updateStatusBar() {
    if (dom.cycle) dom.cycle.textContent = state.cycle.number;
    if (dom.nodes) dom.nodes.textContent = Object.keys(state.nodes).length;
    if (dom.pps) dom.pps.textContent = state.stats.pps || 0;
    if (dom.drift) dom.drift.textContent = (state.stats.sync_drift_ms || 0) + 'ms';
    if (dom.aiStatus) {
      var backend = state.adapters.cm_backend;
      var label = 'Off';
      var color = 'var(--text-muted)';
      if (backend === 'ollama') { label = 'Ollama'; color = 'var(--accent-green)'; }
      else if (backend === 'confidentialmind') { label = 'HQ.Brain'; color = 'var(--accent-green)'; }
      else if (state.adapters.cm === 'ok') { label = 'Active'; color = 'var(--accent-green)'; }

      // Reasoning toggle — only shown when reasoning was configured
      if (state._reasoningConfigured) {
        var reasoningOn = state._reasoningEnabled !== false;
        var tag = document.getElementById('reasoning-toggle');
        if (!tag) {
          tag = document.createElement('span');
          tag.id = 'reasoning-toggle';
          tag.style.cursor = 'pointer';
          tag.style.marginLeft = '4px';
          tag.style.fontSize = '0.6875rem';
          tag.addEventListener('click', function () {
            state._reasoningEnabled = !(state._reasoningEnabled !== false);
            if (socket) socket.emit('ops.set_reasoning', { enabled: state._reasoningEnabled });
            updateStatusBar();
          });
          dom.aiStatus.parentNode.appendChild(tag);
        }
        tag.textContent = reasoningOn ? '(+reasoning)' : '(-reasoning)';
        tag.style.color = reasoningOn ? 'var(--accent-cyan)' : 'var(--text-muted)';
      }

      dom.aiStatus.textContent = label;
      dom.aiStatus.style.color = color;
    }
  }

  function updateSystemState(label, dotClass) {
    if (dom.systemLabel) dom.systemLabel.textContent = label;
    if (dom.systemStatus) {
      dom.systemStatus.classList.remove('connected', 'stale', 'error');
      dom.systemStatus.classList.add(dotClass);
    }
  }

  // --- Event log ---

  function addEvent(event) {
    var entry = {
      ts: event.ts || Date.now(),
      severity: event.severity || classifyEvent(event),
      message: event.message || event.type || 'unknown',
    };
    state.events.unshift(entry);
    if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
    renderEventLog();
  }

  function classifyEvent(event) {
    if (!event.type) return 'routine';
    var t = event.type.toLowerCase();
    if (t.indexOf('jam') >= 0 || t.indexOf('warn') >= 0 || t.indexOf('degrade') >= 0) return 'warning';
    if (t.indexOf('honeypot') >= 0 || t.indexOf('alert') >= 0 || t.indexOf('fail') >= 0 || t.indexOf('drop') >= 0) return 'alert';
    if (t.indexOf('ai') >= 0) return 'ai';
    return 'routine';
  }

  function renderEventLog() {
    if (!dom.eventLogContent) return;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.events.length; i++) {
      var ev = state.events[i];
      var row = document.createElement('div');
      row.className = 'event-entry ' + ev.severity;

      var dot = document.createElement('span');
      dot.className = 'event-dot ' + ev.severity;

      var ts = document.createElement('span');
      ts.className = 'event-ts';
      ts.textContent = formatTime(ev.ts);

      var text = document.createElement('span');
      text.className = 'event-text';
      text.textContent = ev.message;

      row.appendChild(dot);
      row.appendChild(ts);
      row.appendChild(text);
      frag.appendChild(row);
    }
    dom.eventLogContent.innerHTML = '';
    dom.eventLogContent.appendChild(frag);
  }

  // --- AI Reasoning panel ---

  function renderAIPanel() {
    if (!dom.aiContent) return;

    if (!state.ai_reasoning) {
      dom.aiContent.innerHTML = '<div class="ai-no-data">No recent AI decisions</div>';
    } else {
      var d = state.ai_reasoning;
      var conf = typeof d.confidence === 'number' ? d.confidence : 0;
      var isDegraded = conf === 0 && d.classification === 'llm_unavailable';
      var confLabel = isDegraded ? 'N/A' : (conf * 100).toFixed(0) + '%';
      var confClass = isDegraded ? 'low' : (conf >= 0.7 ? 'high' : (conf >= 0.4 ? 'medium' : 'low'));

      var html = '<div class="ai-decision">'
        + '<div class="ai-decision-header">'
        + '<span class="ai-decision-ts">' + formatTime(d.ts || Date.now()) + '</span>'
        + '<span class="ai-confidence ' + confClass + '">' + confLabel + '</span>'
        + '</div>';

      if (isDegraded) {
        html += '<div class="ai-classification" style="color:var(--accent-amber)">LLM unavailable — degraded mode</div>';
      } else if (d.classification) {
        html += '<div class="ai-classification">' + esc(d.classification) + '</div>';
      }

      if (!isDegraded && d.reasoning) {
        html += '<div class="ai-reasoning-text">' + esc(d.reasoning) + '</div>';
      }

      if (d.urgency) {
        html += '<div class="ai-action">Urgency: ' + esc(d.urgency) + '</div>';
      }

      html += '</div>';
      dom.aiContent.innerHTML = html;
    }

    if (!dom.aiHistoryList) return;
    var histHtml = '';
    for (var i = 1; i < state.ai_history.length; i++) {
      var h = state.ai_history[i];
      histHtml += '<div class="ai-history-entry">'
        + formatTime(h.ts || Date.now()) + ' — '
        + esc(h.summary || h.classification || 'decision')
        + '</div>';
    }
    dom.aiHistoryList.innerHTML = histHtml || '';
  }

  // --- Adapter status ---

  function renderAdapterStatus() {
    var ids = ['wlan1', 'wlan2', 'wlan3', 'cm'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.querySelector('[data-adapter="' + ids[i] + '"]');
      if (!el) continue;
      var status = state.adapters[ids[i]];
      el.classList.remove('ok', 'degraded', 'error', 'unknown');
      if (!status) {
        el.textContent = '—';
        el.classList.add('unknown');
      } else if (status === 'ok' || status === 'ok_simulated') {
        el.textContent = status === 'ok_simulated' ? '✓ SIM' : '✓ OK';
        el.classList.add('ok');
        // Update LLM label to show which backend is active
        if (ids[i] === 'cm' && state.adapters.cm_backend) {
          var label = document.querySelector('[data-adapter-label="cm"]');
          if (label) label.textContent = state.adapters.cm_backend === 'ollama' ? 'Ollama' : 'ConfidentialMind';
        }
      } else if (status === 'degraded') {
        el.textContent = '⚠ DEG';
        el.classList.add('degraded');
      } else {
        el.textContent = '✕ ERR';
        el.classList.add('error');
      }
    }
  }

  // --- Active patterns list ---

  function renderActivePatterns() {
    if (!dom.patternsList) return;
    if (state.active_patterns.length === 0) {
      dom.patternsList.innerHTML = '<li class="no-patterns">No active patterns</li>';
      return;
    }
    var html = '';
    for (var i = 0; i < state.active_patterns.length; i++) {
      var p = state.active_patterns[i];
      html += '<li><span class="pattern-dot"></span> '
        + esc(p.patternName || p.name || 'unknown') + '</li>';
    }
    dom.patternsList.innerHTML = html;
  }

  // --- Mini-map rendering ---

  function resizeMinimap() {
    if (!dom.minimapCanvas) return;
    var rect = dom.minimapCanvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    dom.minimapCanvas.width = rect.width * dpr;
    dom.minimapCanvas.height = rect.height * dpr;
  }

  resizeMinimap();
  window.addEventListener('resize', resizeMinimap);

  function renderMinimap() {
    if (!minimapCtx || !dom.minimapCanvas) return;

    var dpr = window.devicePixelRatio || 1;
    var w = dom.minimapCanvas.width / dpr;
    var h = dom.minimapCanvas.height / dpr;
    if (w === 0 || h === 0) return;

    minimapCtx.save();
    minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    minimapCtx.fillStyle = '#0A0E1A';
    minimapCtx.fillRect(0, 0, w, h);

    // Subtle grid
    minimapCtx.strokeStyle = 'rgba(42, 52, 71, 0.4)';
    minimapCtx.lineWidth = 0.5;
    var step = 40;
    for (var gx = step; gx < w; gx += step) {
      minimapCtx.beginPath();
      minimapCtx.moveTo(gx, 0);
      minimapCtx.lineTo(gx, h);
      minimapCtx.stroke();
    }
    for (var gy = step; gy < h; gy += step) {
      minimapCtx.beginPath();
      minimapCtx.moveTo(0, gy);
      minimapCtx.lineTo(w, gy);
      minimapCtx.stroke();
    }

    // Jamming zones (red overlay)
    for (var jz = 0; jz < state.jamming_zones.length; jz++) {
      var zone = state.jamming_zones[jz];
      if (!zone.center || !zone.radius) continue;
      minimapCtx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      minimapCtx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      minimapCtx.lineWidth = 1;
      minimapCtx.setLineDash([4, 4]);
      minimapCtx.beginPath();
      minimapCtx.arc(
        zone.center.x * w,
        zone.center.y * h,
        zone.radius * Math.min(w, h),
        0, Math.PI * 2
      );
      minimapCtx.fill();
      minimapCtx.stroke();
      minimapCtx.setLineDash([]);
    }

    // HQ (bottom-left corner)
    minimapCtx.fillStyle = '#F8FAFC';
    minimapCtx.beginPath();
    minimapCtx.arc(18, h - 18, 5, 0, Math.PI * 2);
    minimapCtx.fill();
    minimapCtx.font = '8px "JetBrains Mono", monospace';
    minimapCtx.fillText('HQ', 10, h - 28);

    // Drones (green triangles with tethers)
    var droneIds = Object.keys(state.drones);
    for (var di = 0; di < droneIds.length; di++) {
      var drone = state.drones[droneIds[di]];
      if (!drone.position) continue;
      var dx = drone.position.x * w;
      var dy = drone.position.y * h;

      // Fiber tether
      minimapCtx.strokeStyle = 'rgba(74, 222, 128, 0.25)';
      minimapCtx.lineWidth = 1;
      minimapCtx.beginPath();
      minimapCtx.moveTo(18, h - 18);
      minimapCtx.lineTo(dx, dy);
      minimapCtx.stroke();

      // Triangle
      minimapCtx.fillStyle = '#4ADE80';
      minimapCtx.beginPath();
      minimapCtx.moveTo(dx, dy - 5);
      minimapCtx.lineTo(dx - 4, dy + 3);
      minimapCtx.lineTo(dx + 4, dy + 3);
      minimapCtx.closePath();
      minimapCtx.fill();
    }

    // Nodes — ops shows LAST REPORTED position (fog of war)
    // HQ only knows where a soldier IS if they've reported in
    var nodeIds = Object.keys(state.nodes);
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var nodeId = nodeIds[ni];
      var node = state.nodes[nodeId];
      if (!node.position) continue;

      // For soldiers: use last reported position from units table if available
      var pos = node.position;
      var unit = state.units ? state.units[nodeId] : null;
      if (node.type === 'soldier' && unit && unit.position) {
        pos = unit.position;
      }

      var nx = pos.x * w;
      var ny = pos.y * h;

      var color, size;
      switch (node.type) {
        case 'decoy':    color = '#475569'; size = 2;   break;
        case 'honeypot': color = '#FBBF24'; size = 3;   break;
        default:         color = '#22D3EE'; size = 3.5; break;
      }

      // Stale data indicator — dim soldiers that haven't reported recently
      if (node.type === 'soldier' && unit && unit.lastReport) {
        var age = Date.now() - unit.lastReport;
        if (age > 15000) { color = '#64748B'; } // >15s stale → muted
      } else if (node.type === 'soldier' && !unit) {
        color = '#475569'; // never reported → gray
      }

      if (node.state === 'jammed' || node.state === 'JAMMED') color = '#EF4444';

      minimapCtx.fillStyle = color;
      minimapCtx.beginPath();
      minimapCtx.arc(nx, ny, size, 0, Math.PI * 2);
      minimapCtx.fill();
    }

    minimapCtx.restore();
  }

  setInterval(renderMinimap, 1000 / MINIMAP_FPS);

  // --- Banner ---

  function showBanner() {
    if (dom.banner) dom.banner.classList.add('visible');
  }

  function hideBanner() {
    if (dom.banner) dom.banner.classList.remove('visible');
  }

  function setControlsEnabled(enabled) {
    var buttons = document.querySelectorAll('#controls button[data-trigger]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !enabled;
    }
  }

  // --- Units panel ---

  function renderUnits() {
    if (!dom.unitsContent) return;
    var ids = Object.keys(state.units || {}).sort();
    if (ids.length === 0) {
      dom.unitsContent.innerHTML = '<div style="color:var(--text-muted);padding:8px;">No unit reports received</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < ids.length; i++) {
      var u = state.units[ids[i]];
      var row = document.createElement('div');
      row.className = 'unit-row';

      var cs = document.createElement('span');
      cs.className = 'unit-callsign';
      cs.textContent = u.callsign;

      var rank = document.createElement('span');
      rank.className = 'unit-rank';
      rank.textContent = u.rank || '';

      var role = document.createElement('span');
      role.className = 'unit-role';
      role.textContent = u.role || '';

      var status = document.createElement('span');
      var st = (u.status || 'NOMINAL').toLowerCase();
      status.className = 'unit-status ' + st;
      status.textContent = u.status || 'NOMINAL';

      var msg = document.createElement('span');
      msg.className = 'unit-msg';
      msg.textContent = u.lastMsgType || '';

      var detail = document.createElement('span');
      detail.className = 'unit-detail';
      var parts = [];
      if (u.battery != null) parts.push('⚡' + u.battery + '%');
      if (u.ammo != null) parts.push('◆' + u.ammo + '%');
      if (u.lastReport) parts.push(formatTime(u.lastReport));
      detail.textContent = parts.join('  ');

      row.appendChild(cs);
      row.appendChild(rank);
      row.appendChild(role);
      row.appendChild(status);
      row.appendChild(msg);
      row.appendChild(detail);
      frag.appendChild(row);
    }
    dom.unitsContent.innerHTML = '';
    dom.unitsContent.appendChild(frag);
  }

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function (c) { c.classList.remove('active'); });
      btn.classList.add('active');
      var tab = document.getElementById('tab-' + btn.dataset.tab);
      if (tab) tab.classList.add('active');
    });
  });

  function hasDecoys() {
    for (var id in state.nodes) {
      var t = state.nodes[id].type;
      if (t === 'decoy' || t === 'honeypot') return true;
    }
    return false;
  }

  // --- Utilities ---

  function formatTime(ts) {
    var d = new Date(ts);
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    var ss = String(d.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  function esc(s) {
    if (typeof s !== 'string') return String(s);
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // =============================================
  // =============================================
  // Help modals
  // =============================================

  var HELP = {
    adversarial: {
      title: 'Adversarial Scenarios',
      body: '<p><strong>Inject Jamming</strong> <span class="help-key">J</span> — Simulates an enemy EW (electronic warfare) attack. Creates a red jamming zone on the big screen. Nodes inside the zone lose connectivity and show JAMMED state. The mesh routing reconverges around the dead zone automatically.</p>'
        + '<p><strong>Drop Drone</strong> <span class="help-key">D</span> — Removes one sync drone from the battlefield. Remaining drones continue providing time discipline. Tests redundancy of the sync beacon architecture.</p>'
        + '<p><strong>Deploy Drone</strong> — Adds a new drone at a random position. Use after dropping one to demonstrate recovery, or to add more sync/decoy drones.</p>'
        + '<p><strong>Trigger Honeypot</strong> <span class="help-key">H</span> — Spawns a honeypot sensor node and triggers it with an artillery detection event. The AI tactical loop processes the event, and if urgency is HIGH, an alert is broadcast to all phones in the affected area.</p>'
    },
    deception: {
      title: 'Deception Choreography',
      body: '<p>Decoy emitters (EUR 25 each) are statistically indistinguishable from real soldiers at the protocol level. These controls manage their spatial-temporal choreography.</p>'
        + '<p><strong>Activate Decoys</strong> <span class="help-key">A</span> — Spawns 47 decoy nodes + 3 honeypots. Decoys appear as small gray dots on the big screen. Required before activating wave patterns.</p>'
        + '<p><strong>Linear Wave</strong> — Decoys emit in a band sweeping across the area. Looks like a battalion moving in one direction.</p>'
        + '<p><strong>Phantom Convoy</strong> — Activation propagates along a path, simulating a convoy or patrol route.</p>'
        + '<p><strong>Radial Expansion</strong> — Expanding ring of activity from a center point, simulating forces deploying outward.</p>'
        + '<p>Pattern buttons toggle — click once to activate (green border), click again to deactivate. Multiple patterns can run simultaneously.</p>'
    },
    ai: {
      title: 'AI / HQ Brain',
      body: '<p>The HQ Brain is an AI running on ConfidentialMind\'s sovereign infrastructure (or Ollama locally). It processes tactical events and makes decisions.</p>'
        + '<p><strong>Force AI Adaptation</strong> — Triggers the operational AI loop, which analyzes the last 15 minutes of activity and recommends changes to the deception choreography. The AI reasoning appears in the AI panel on the right.</p>'
        + '<p><strong>Request SITREP</strong> — HQ requests a status report from ALL soldiers simultaneously. Every unit transmits their STATUS on the next sync pulse. The big screen lights up with transmission arcs as all units report in. The Units tab updates with battery, ammo, and position data.</p>'
        + '<p>The AI status in the top bar shows which backend is active (HQ.Brain = ConfidentialMind, Ollama = local). The (+reasoning) toggle enables/disables the model\'s thinking mode.</p>'
    },
    system: {
      title: 'System Controls',
      body: '<p><strong>Pause Cycles</strong> <span class="help-key">Space</span> — Stops the burst cycle ticker. All nodes freeze in their current state. Useful for explaining what\'s happening during the demo.</p>'
        + '<p><strong>Resume</strong> <span class="help-key">Space</span> — Restarts the cycle ticker from where it paused.</p>'
        + '<p><strong>Reset State</strong> <span class="help-key">R</span> — Clears all jamming zones, resets node states, deactivates all wave patterns, restores drones. Returns the system to a clean starting state.</p>'
    },
    demo: {
      title: 'Demo Sequence',
      body: '<p><strong>Run Full Pitch (5 min)</strong> — Automated 5-minute demo sequence following the hackathon pitch script. Steps through: sync beacon → burst protocol → EW attack → drone loss → decoy activation → wave choreography → honeypot trigger → AI adaptation → recovery.</p>'
        + '<p><strong>Pause / Continue Pitch</strong> — Freezes the pitch timeline. Use during Q&A — the sequence resumes exactly where it left off.</p>'
        + '<p><strong>Stop Pitch</strong> — Aborts the pitch sequence entirely. All pending steps are cancelled.</p>'
        + '<p>Each pitch step is logged in the Event Log with a [PITCH] prefix so you can track progress.</p>'
    },
  };

  var helpModal = document.getElementById('help-modal');
  var helpTitle = document.getElementById('help-modal-title');
  var helpBody = document.getElementById('help-modal-body');

  document.querySelectorAll('.help-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var key = btn.dataset.help;
      var info = HELP[key];
      if (!info) return;
      helpTitle.textContent = info.title;
      helpBody.innerHTML = info.body;
      helpModal.classList.remove('hidden');
    });
  });

  if (helpModal) {
    helpModal.querySelector('.help-modal-close').addEventListener('click', function () {
      helpModal.classList.add('hidden');
    });
    helpModal.addEventListener('click', function (e) {
      if (e.target === helpModal) helpModal.classList.add('hidden');
    });
  }

  // =============================================
  // Mock mode — standalone testing without server
  // =============================================

  function createMockSocket() {
    var handlers = {};
    var mock = {
      on: function (event, fn) {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(fn);
      },
      emit: function (event, data) {
        console.log('[mock] emit:', event, data);
        setTimeout(function () {
          fire('scenario_result', {
            scenario: data && data.scenario,
            success: true,
            message: 'Mock OK',
          });
        }, 80);
      },
    };

    function fire(event, data) {
      var fns = handlers[event];
      if (fns) for (var i = 0; i < fns.length; i++) fns[i](data);
    }

    // Simulate connection
    setTimeout(function () { fire('connect'); }, 150);

    // Initial node population
    var mockNodes = {};
    var names = [
      'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA',
      'ECHO', 'FOXTROT', 'GOLF', 'HOTEL',
    ];
    for (var i = 0; i < names.length; i++) {
      mockNodes[names[i] + '-1'] = {
        type: 'soldier',
        position: { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 },
        state: 'listening',
        callsign: names[i] + '-1',
      };
    }

    // Decoy population
    for (var d = 0; d < 25; d++) {
      mockNodes['DECOY-' + (d + 1)] = {
        type: 'decoy',
        position: { x: 0.08 + Math.random() * 0.84, y: 0.08 + Math.random() * 0.84 },
        state: 'active',
      };
    }

    // Honeypots
    for (var hp = 0; hp < 3; hp++) {
      mockNodes['HP-' + (hp + 1)] = {
        type: 'honeypot',
        position: { x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6 },
        state: 'listening',
      };
    }

    var mockDrones = {
      'drone-1': { position: { x: 0.3, y: 0.22 }, status: 'active', role: 'sync' },
      'drone-2': { position: { x: 0.7, y: 0.18 }, status: 'active', role: 'sync' },
    };

    var cycleNum = 0;

    // Cycle tick every second
    setInterval(function () {
      cycleNum++;
      fire('cycle_tick', { number: cycleNum, phase: 'burst' });

      // State update every 4 cycles
      if (cycleNum % 4 === 0) {
        var ids = Object.keys(mockNodes);
        for (var k = 0; k < ids.length; k++) {
          var n = mockNodes[ids[k]];
          if (n.type !== 'decoy') {
            n.position.x = clamp(n.position.x + (Math.random() - 0.5) * 0.008, 0.05, 0.95);
            n.position.y = clamp(n.position.y + (Math.random() - 0.5) * 0.008, 0.05, 0.95);
          }
        }

        fire('state_update', {
          nodes: mockNodes,
          drones: mockDrones,
          jamming_zones: cycleNum > 15
            ? [{ center: { x: 0.55, y: 0.5 }, radius: 0.12, since: Date.now() - 5000 }]
            : [],
          stats: {
            packets_total: cycleNum * 14,
            packets_dropped: Math.floor(cycleNum * 0.2),
            sync_drift_ms: Math.floor(Math.random() * 180),
            pps: 28 + Math.floor(Math.random() * 25),
          },
        });
      }
    }, 1000);

    // Random events
    setInterval(function () {
      var pool = [
        { type: 'burst_complete', severity: 'routine', message: 'Burst cycle ' + cycleNum + ' — 8 frames' },
        { type: 'node_join', severity: 'routine', message: 'INDIA-1 joined mesh via drone-1' },
        { type: 'sync_pulse', severity: 'routine', message: 'Sync-α broadcast from drone-1' },
        { type: 'routing_converged', severity: 'routine', message: 'Mesh routing converged in 2 cycles' },
      ];
      if (cycleNum > 15) {
        pool.push({ type: 'jamming_detected', severity: 'warning', message: 'EW interference sector 3 — power +12dB' });
      }
      fire('event', pool[Math.floor(Math.random() * pool.length)]);
    }, 2500);

    // AI decisions
    setInterval(function () {
      var decisions = [
        {
          ts: Date.now(),
          classification: 'tactical_assessment',
          confidence: 0.6 + Math.random() * 0.35,
          reasoning: 'Detected pattern consistent with EW probing in sector 3. Recommend shifting decoy density to adjacent sectors to dilute enemy targeting.',
          summary: 'EW probing detected — recommend decoy shift',
          action: 'Increase decoy density sectors 2, 4 by 30%',
        },
        {
          ts: Date.now(),
          classification: 'threat_warning',
          confidence: 0.82,
          reasoning: 'Honeypot HP-2 registered acoustic event consistent with artillery ranging. Direction of arrival 283°. Estimated battery position: grid 42N 7E.',
          summary: 'Artillery battery detected via HP-2',
          action: 'BROADCAST HIGH: Artillery warning sector 5',
        },
      ];
      fire('ai.decision', decisions[Math.floor(Math.random() * decisions.length)]);
    }, 10000);

    // Adapter status
    setTimeout(function () {
      fire('adapter_status', { adapter: 'wlan1', status: 'ok' });
      fire('adapter_status', { adapter: 'wlan2', status: 'ok' });
      fire('adapter_status', { adapter: 'wlan3', status: 'degraded' });
      fire('adapter_status', { adapter: 'cm', status: 'ok' });
    }, 800);

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    return mock;
  }
})();
