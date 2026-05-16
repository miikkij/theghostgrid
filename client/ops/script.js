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
      var pulse = new SystemPulse(pulseCanvas, { height: 36, scrollSpeed: 50 });
      window.addEventListener('resize', function() { pulse._resize(); });

      sock.on('ai_decision', function() { pulse.push('ai_decision', 0.9); });
      sock.on('event', function(ev) {
        var type = ev.type || 'default';
        var intensity = 0.5;
        if (type.indexOf('honeypot') >= 0) { type = 'honeypot'; intensity = 0.8; }
        else if (type.indexOf('jam') >= 0) { type = 'jamming'; intensity = 0.85; }
        else if (type.indexOf('alert') >= 0) { type = 'alert'; intensity = 1.0; }
        else if (type.indexOf('ai') >= 0) { type = 'ai_decision'; intensity = 0.7; }
        else if (type.indexOf('node_join') >= 0) { type = 'node_join'; intensity = 0.4; }
        else if (type.indexOf('demo') >= 0) { type = 'demo'; intensity = 0.6; }
        else if (type.indexOf('routing') >= 0) { type = 'routing'; intensity = 0.3; }
        else if (type.indexOf('deception') >= 0 || type.indexOf('pattern') >= 0) { type = 'deception'; intensity = 0.5; }
        pulse.push(type, intensity);
      });
      sock.on('cycle_tick', function(data) {
        if (data.phase === 'sync_alpha') pulse.push('cycle', 0.08);
      });
      sock.on('scenario_result', function() { pulse.push('scenario', 0.5); });
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
      if (backend === 'ollama') {
        dom.aiStatus.textContent = 'Ollama';
        dom.aiStatus.style.color = 'var(--accent-green)';
      } else if (backend === 'confidentialmind') {
        dom.aiStatus.textContent = 'HQ.Brain';
        dom.aiStatus.style.color = 'var(--accent-green)';
      } else if (state.adapters.cm === 'ok') {
        dom.aiStatus.textContent = 'Active';
        dom.aiStatus.style.color = 'var(--accent-green)';
      } else {
        dom.aiStatus.textContent = 'Off';
        dom.aiStatus.style.color = 'var(--text-muted)';
      }
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

    // Nodes
    var nodeIds = Object.keys(state.nodes);
    for (var ni = 0; ni < nodeIds.length; ni++) {
      var node = state.nodes[nodeIds[ni]];
      if (!node.position) continue;
      var nx = node.position.x * w;
      var ny = node.position.y * h;

      var color, size;
      switch (node.type) {
        case 'decoy':    color = '#475569'; size = 2;   break;
        case 'honeypot': color = '#FBBF24'; size = 3;   break;
        default:         color = '#22D3EE'; size = 3.5; break;
      }

      if (node.state === 'jammed') color = '#EF4444';

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
