'use strict';

(function () {
  // --- Node state ---
  var node = {
    callsign: null,
    role: null,
    state: 'listening',
    neighbors: [],
    recentEvents: [],
    area: null
  };

  // --- DOM refs ---
  var $landing = document.getElementById('landing');
  var $activeNode = document.getElementById('active-node');
  var $alertOverlay = document.getElementById('alert-overlay');
  var $callsign = document.getElementById('callsign');
  var $roleBadge = document.getElementById('role-badge');
  var $stateIndicator = document.getElementById('state-indicator');
  var $stateLabel = document.getElementById('state-label');
  var $countdownValue = document.getElementById('countdown-value');
  var $neighborsList = document.getElementById('neighbors-list');
  var $eventsList = document.getElementById('events-list');
  var $alertMessage = document.getElementById('alert-message');
  var $alertMeta = document.getElementById('alert-meta');
  var $alertCountdown = document.getElementById('alert-countdown');
  var $connectionDot = document.getElementById('connection-dot');
  var $connectionLabel = document.getElementById('connection-label');
  var $stateBadge = document.getElementById('state-badge');
  var $tacMapCanvas = document.getElementById('tac-map-canvas');
  var $queueList = document.getElementById('queue-list');
  var $queueCount = document.getElementById('queue-count');
  var $hqRequestList = document.getElementById('hq-request-list');
  var $syncStatus = document.getElementById('sync-status');

  // --- Outbound queue + HQ requests ---
  var outboundQueue = [];
  var hqRequests = [];
  var syncReady = false;
  var waypoint = null; // target position for movement

  // --- Wake Lock ---
  var wakeLock = null;

  function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (lock) {
      wakeLock = lock;
      lock.addEventListener('release', function () { wakeLock = null; });
    }).catch(function () { /* not critical */ });
  }

  requestWakeLock();
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
  });

  // Tap anywhere re-asserts wake lock (iOS requires user gesture)
  document.addEventListener('touchstart', function () {
    if (!wakeLock) requestWakeLock();
  }, { passive: true, once: false });

  // --- Haptic feedback ---
  function vibrate(pattern) {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(pattern); } catch (e) { /* some browsers throw */ }
    }
  }

  var HAPTIC = {
    SYNC:    20,
    TX:      [10, 20, 10],
    RX:      10,
    JAMMING: [50, 50, 50, 50, 50],
    ALERT:   [100, 50, 100, 50, 100, 50, 200]
  };

  // --- Screen state machine ---
  var currentScreen = 'landing';

  function showScreen(screenId) {
    [$landing, $activeNode, $alertOverlay].forEach(function (el) {
      el.classList.remove('visible');
      el.classList.add('hidden');
    });
    var target = document.getElementById(screenId);
    if (target) {
      target.classList.remove('hidden');
      target.classList.add('visible');
      currentScreen = screenId;
    }
  }

  // --- Neighbor rendering ---
  function renderNeighbors() {
    if (node.neighbors.length === 0) {
      $neighborsList.innerHTML = '<li class="empty-state">Discovering...</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    node.neighbors.slice(0, 5).forEach(function (n) {
      var li = document.createElement('li');
      var name = typeof n === 'string' ? n : n.callsign || n;
      var span = document.createElement('span');
      span.className = 'neighbor-callsign';
      span.textContent = name;
      li.appendChild(span);
      frag.appendChild(li);
    });
    $neighborsList.innerHTML = '';
    $neighborsList.appendChild(frag);
  }

  // --- Event rendering ---
  function renderEvents() {
    if (node.recentEvents.length === 0) {
      $eventsList.innerHTML = '<li class="empty-state">Waiting for events...</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    node.recentEvents.slice(0, 3).forEach(function (e) {
      var li = document.createElement('li');

      var time = document.createElement('span');
      time.className = 'event-time';
      time.textContent = formatTime(e.ts);
      li.appendChild(time);

      var dir = document.createElement('span');
      var isOut = e.direction === 'out';
      dir.className = 'event-direction ' + (isOut ? 'outbound' : 'inbound');
      dir.textContent = isOut ? '↑' : '↓';
      li.appendChild(dir);

      if (e.msgType && e.msgType !== 'RX') {
        var badge = document.createElement('span');
        badge.className = 'event-msg-type';
        badge.textContent = e.msgType;
        li.appendChild(badge);
      }

      if (e.partner) {
        var partner = document.createElement('span');
        partner.className = 'event-partner';
        partner.textContent = e.partner;
        li.appendChild(partner);
      }

      frag.appendChild(li);
    });
    $eventsList.innerHTML = '';
    $eventsList.appendChild(frag);
  }

  function formatTime(ts) {
    if (!ts) return '--:--';
    var d = new Date(ts);
    return d.toTimeString().slice(0, 5);
  }

  // --- Alert system ---
  var alertTimer = null;

  function showAlert(alert) {
    $alertMessage.textContent = alert.message || 'THREAT DETECTED';
    $alertMeta.textContent = alert.meta || '';

    var timeLeft = alert.duration_seconds || 30;
    $alertCountdown.textContent = timeLeft;

    showScreen('alert-overlay');
    vibrate(HAPTIC.ALERT);

    if (alertTimer) clearInterval(alertTimer);
    alertTimer = setInterval(function () {
      timeLeft--;
      $alertCountdown.textContent = Math.max(0, timeLeft);
      if (timeLeft <= 0) {
        clearInterval(alertTimer);
        alertTimer = null;
        showScreen('active-node');
      }
    }, 1000);
  }

  function alertAppliesToUs(alert) {
    if (!alert.affected_area || !node.area) return true;
    var dx = (node.area.x || 0) - (alert.affected_area.center ? alert.affected_area.center.x : 0);
    var dy = (node.area.y || 0) - (alert.affected_area.center ? alert.affected_area.center.y : 0);
    var dist = Math.sqrt(dx * dx + dy * dy);
    return dist < (alert.affected_area.radius || Infinity);
  }

  // --- Burst countdown ---
  var lastCycleData = null;

  function computeMsUntilBurst(cycle) {
    if (!cycle || !cycle.last_alpha_ts) return null;
    var now = Date.now();
    var nextBeta = cycle.last_alpha_ts + (cycle.sync_beta_offset_ms || 215);
    return Math.max(0, nextBeta - now);
  }

  function updateCountdown() {
    if (!lastCycleData) return;
    var ms = computeMsUntilBurst(lastCycleData);
    if (ms !== null) {
      $countdownValue.textContent = (ms / 1000).toFixed(1) + 's';
    }
  }

  // Update countdown every 100ms for smooth display
  setInterval(updateCountdown, 100);

  // --- Connection status helpers ---
  function setConnected() {
    $connectionDot.className = 'connection-dot';
    $connectionLabel.textContent = 'Connected';
  }

  function setDisconnected() {
    $connectionDot.className = 'connection-dot disconnected';
    $connectionLabel.textContent = 'Reconnecting…';
  }

  // --- WebSocket connection ---
  var socket = connectToMesh('phone', function onState(data) {
    // Full state update — used on reconnect
    if (data && data.nodes && node.callsign) {
      var myNode = data.nodes[node.callsign];
      if (myNode && myNode.state) {
        updateNodeState(myNode.state);
      }
    }
  });

  if (!socket) {
    console.error('[phone] Failed to connect. Running in offline mode.');
    // Show the active node screen in demo mode after the landing animation
    setTimeout(function () {
      $callsign.textContent = 'DEMO-1';
      $roleBadge.textContent = 'OFFLINE';
      showScreen('active-node');
    }, 3000);
    return;
  }

  // --- Socket event handlers ---

  // Node identity assignment
  socket.on('identity', function (data) {
    node.callsign = data.callsign;
    node.role = data.role;
    node.area = data.area || null;

    $callsign.textContent = data.callsign;
    $roleBadge.textContent = data.role;

    // Transition from landing after a brief pause for the animation to play
    setTimeout(function () { showScreen('active-node'); }, 2000);
  });

  // Also support phone.assigned event name (spec variant)
  socket.on('phone.assigned', function (data) {
    node.callsign = data.callsign;
    node.role = data.role;
    node.area = data.area || null;

    $callsign.textContent = data.callsign;
    $roleBadge.textContent = data.role;

    setTimeout(function () { showScreen('active-node'); }, 2000);
  });

  // Node state changes
  socket.on('phone.state_change', function (data) {
    updateNodeState(data.state);
  });

  socket.on('node_state_change', function (data) {
    if (data.callsign === node.callsign && data.state) {
      updateNodeState(data.state);
    }
  });

  function updateNodeState(newState) {
    if (!newState) return;
    var s = newState.toLowerCase();
    node.state = s;
    $stateIndicator.dataset.state = s;
    $stateLabel.textContent = '●';
    if ($stateBadge) {
      $stateBadge.textContent = s.toUpperCase();
      $stateBadge.dataset.state = s;
    }

    // Track sync readiness
    if (s === 'sync') {
      syncReady = true;
      if ($syncStatus) { $syncStatus.textContent = 'SYNC OK'; $syncStatus.style.color = 'var(--accent-green)'; }
      drainQueue();
    } else if (s === 'jammed') {
      syncReady = false;
      if ($syncStatus) { $syncStatus.textContent = 'JAMMED'; $syncStatus.style.color = 'var(--accent-red)'; }
    }

    if (s === 'sync')   vibrate(HAPTIC.SYNC);
    if (s === 'tx')     vibrate(HAPTIC.TX);
    if (s === 'rx')     vibrate(HAPTIC.RX);
    if (s === 'jammed') vibrate(HAPTIC.JAMMING);
  }

  // Cycle ticks
  socket.on('cycle_tick', function (data) {
    lastCycleData = data;
    updateCountdown();

    // Vibrate on burst phase
    if (data.phase === 'sync_beta_burst') {
      vibrate(HAPTIC.SYNC);
    }
  });

  // Neighbor updates (server broadcasts to all phones; filter by callsign)
  socket.on('phone.neighbors', function (data) {
    if (data.callsign && data.callsign !== node.callsign) return;
    node.neighbors = data.neighbors || [];
    renderNeighbors();
  });

  // Recent events (filter by callsign)
  socket.on('phone.event', function (event) {
    if (event.callsign && event.callsign !== node.callsign) return;
    node.recentEvents.unshift(event);
    if (node.recentEvents.length > 3) node.recentEvents.length = 3;
    renderEvents();
  });

  // Alerts
  socket.on('alert', function (alert) {
    if (!alertAppliesToUs(alert)) return;
    showAlert(alert);
  });

  // HQ requests — queue a response only when HQ asks
  socket.on('phone.hq_request', function (req) {
    if (req.callsign && req.callsign !== node.callsign) return;
    hqRequests.unshift(req);
    if (hqRequests.length > 5) hqRequests.length = 5;
    renderHQRequests();
    vibrate(HAPTIC.ALERT);
    // Auto-queue response to HQ request
    enqueueMessage('STATUS', 'HQ');
  });

  // Connection status
  socket.on('connect', setConnected);
  socket.on('disconnect', setDisconnected);
  socket.on('reconnect', setConnected);

  // --- Outbound queue ---

  function enqueueMessage(type, dest) {
    outboundQueue.push({ type: type, dest: dest || 'MESH', ts: Date.now(), status: 'QUEUED' });
    renderQueue();
  }

  function drainQueue() {
    if (outboundQueue.length === 0 || !syncReady) return;
    var msg = outboundQueue.shift();
    msg.status = 'SENT';
    renderQueue();
    if (socket) {
      socket.emit('phone.message', { callsign: node.callsign, type: msg.type, dest: msg.dest });
    }
  }

  function renderQueue() {
    if (!$queueList) return;
    if ($queueCount) $queueCount.textContent = outboundQueue.length;

    if (outboundQueue.length === 0) {
      $queueList.innerHTML = '<li class="empty-state">Queue empty — listening</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < outboundQueue.length; i++) {
      var m = outboundQueue[i];
      var li = document.createElement('li');

      var badge = document.createElement('span');
      badge.className = 'queue-item-type';
      badge.textContent = m.type;
      li.appendChild(badge);

      var dest = document.createElement('span');
      dest.textContent = '→ ' + m.dest;
      dest.style.color = 'var(--text-secondary)';
      dest.style.fontSize = '0.6875rem';
      li.appendChild(dest);

      var status = document.createElement('span');
      status.className = 'queue-item-waiting';
      status.textContent = syncReady ? 'READY' : 'WAIT SYNC';
      li.appendChild(status);

      frag.appendChild(li);
    }
    $queueList.innerHTML = '';
    $queueList.appendChild(frag);
  }

  function renderHQRequests() {
    if (!$hqRequestList) return;
    if (hqRequests.length === 0) {
      $hqRequestList.innerHTML = '<li class="empty-state">No pending requests</li>';
      return;
    }
    var frag = document.createDocumentFragment();
    for (var i = 0; i < hqRequests.length; i++) {
      var r = hqRequests[i];
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.className = 'hq-request-item';
      label.textContent = (r.type || 'REQUEST') + ' — ' + formatTime(r.ts);
      li.appendChild(label);
      frag.appendChild(li);
    }
    $hqRequestList.innerHTML = '';
    $hqRequestList.appendChild(frag);
  }

  // --- Tactical map ---

  function initTacMap() {
    if (!$tacMapCanvas) return;
    var ctx = $tacMapCanvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;

    function resizeMap() {
      var rect = $tacMapCanvas.getBoundingClientRect();
      $tacMapCanvas.width = rect.width * dpr;
      $tacMapCanvas.height = rect.height * dpr;
    }
    resizeMap();
    window.addEventListener('resize', resizeMap);

    // Tap to set waypoint — only queues POS when moving to new position
    $tacMapCanvas.addEventListener('click', function (e) {
      var br = $tacMapCanvas.getBoundingClientRect();
      var x = (e.clientX - br.left) / br.width;
      var y = (e.clientY - br.top) / br.height;
      waypoint = { x: Math.max(0.05, Math.min(0.95, x)), y: Math.max(0.05, Math.min(0.95, y)) };
      vibrate(10);
    });

    setInterval(function () { renderTacMap(ctx, dpr); }, 80);
  }

  function renderTacMap(ctx, dpr) {
    var w = $tacMapCanvas.width / dpr;
    var h = $tacMapCanvas.height / dpr;
    if (w === 0 || h === 0) return;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#0A0E1A';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(42, 52, 71, 0.4)';
    ctx.lineWidth = 0.5;
    var step = Math.max(20, Math.min(40, w / 10));
    for (var gx = step; gx < w; gx += step) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke(); }
    for (var gy = step; gy < h; gy += step) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke(); }

    // Move node toward waypoint
    if (waypoint && node.area) {
      var dx = waypoint.x - node.area.x;
      var dy = waypoint.y - node.area.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.005) {
        var speed = 0.004;
        node.area.x += (dx / dist) * speed;
        node.area.y += (dy / dist) * speed;
        if (socket) socket.emit('phone.move', { callsign: node.callsign, position: node.area });
      } else {
        // Arrived at waypoint — queue POS report
        waypoint = null;
        enqueueMessage('POS', 'MESH');
      }
    }

    // Draw neighbors
    for (var i = 0; i < node.neighbors.length; i++) {
      var nid = node.neighbors[i];
      var hash = 0;
      for (var c = 0; c < nid.length; c++) hash = ((hash << 5) - hash + nid.charCodeAt(c)) | 0;
      var nx = (((hash & 0xFF) / 255) * 0.7 + 0.15) * w;
      var ny = (((hash >> 8 & 0xFF) / 255) * 0.7 + 0.15) * h;

      ctx.fillStyle = 'rgba(34, 211, 238, 0.3)';
      ctx.beginPath();
      ctx.arc(nx, ny, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(34, 211, 238, 0.4)';
      ctx.font = '500 6px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(nid, nx, ny + 10);
    }

    // Draw self — prominent pulsing dot with crosshair
    if (node.area) {
      var sx = node.area.x * w;
      var sy = node.area.y * h;
      var pulse = 1 + Math.sin(Date.now() * 0.004) * 0.3;

      // Crosshair
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(sx - 12, sy); ctx.lineTo(sx + 12, sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx, sy - 12); ctx.lineTo(sx, sy + 12); ctx.stroke();

      // Outer ring
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 8 * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // Inner dot
      ctx.fillStyle = '#22D3EE';
      ctx.beginPath();
      ctx.arc(sx, sy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#F8FAFC';
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.callsign || 'YOU', sx, sy - 14);
    }

    // Draw waypoint
    if (waypoint) {
      var wx = waypoint.x * w;
      var wy = waypoint.y * h;
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(wx, wy, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Line from self to waypoint
      if (node.area) {
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.3)';
        ctx.beginPath();
        ctx.moveTo(node.area.x * w, node.area.y * h);
        ctx.lineTo(wx, wy);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  initTacMap();

  // --- Mock mode for standalone testing ---
  if (window.location.search.indexOf('mock') !== -1) {
    runMockMode();
  }

  function runMockMode() {
    // Simulate server assigning identity after 2s
    setTimeout(function () {
      var evt = { callsign: 'ALPHA-7', role: 'RECON', area: { x: 0.5, y: 0.5 } };
      node.callsign = evt.callsign;
      node.role = evt.role;
      node.area = evt.area;
      $callsign.textContent = evt.callsign;
      $roleBadge.textContent = evt.role;
      setTimeout(function () { showScreen('active-node'); }, 2000);
    }, 500);

    // Simulate state cycling
    var states = ['listening', 'sync', 'tx', 'rx', 'listening', 'listening', 'sync', 'tx', 'rx', 'listening'];
    var stateIdx = 0;
    setInterval(function () {
      stateIdx = (stateIdx + 1) % states.length;
      updateNodeState(states[stateIdx]);
    }, 1500);

    // Simulate neighbors
    setTimeout(function () {
      node.neighbors = ['BRAVO-3', 'FOXTROT-1', 'DELTA-9', 'ECHO-2'];
      renderNeighbors();
    }, 4000);

    // Simulate events
    var mockPartners = ['BRAVO-3', 'FOXTROT-1', 'DELTA-9'];
    setInterval(function () {
      var partner = mockPartners[Math.floor(Math.random() * mockPartners.length)];
      var direction = Math.random() > 0.5 ? 'out' : 'in';
      node.recentEvents.unshift({ ts: Date.now(), direction: direction, partner: partner });
      if (node.recentEvents.length > 3) node.recentEvents.length = 3;
      renderEvents();
    }, 3000);

    // Simulate cycle countdown
    lastCycleData = { last_alpha_ts: Date.now(), sync_beta_offset_ms: 1000 };
    setInterval(function () {
      lastCycleData.last_alpha_ts = Date.now();
    }, 1000);

    // Simulate alert after 20s
    setTimeout(function () {
      showAlert({
        message: 'ARTILLERY INCOMING',
        meta: 'Estimated impact 28–45 seconds',
        duration_seconds: 10
      });
    }, 20000);
  }
})();
