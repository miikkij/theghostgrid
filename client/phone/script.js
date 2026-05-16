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
    $stateLabel.textContent = s.toUpperCase();

    // Haptic feedback per state
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

  // Neighbor updates
  socket.on('phone.neighbors', function (data) {
    node.neighbors = data.neighbors || [];
    renderNeighbors();
  });

  // Recent events
  socket.on('phone.event', function (event) {
    node.recentEvents.unshift(event);
    if (node.recentEvents.length > 3) node.recentEvents.length = 3;
    renderEvents();
  });

  // Alerts
  socket.on('alert', function (alert) {
    if (!alertAppliesToUs(alert)) return;
    showAlert(alert);
  });

  // Connection status
  socket.on('connect', setConnected);
  socket.on('disconnect', setDisconnected);
  socket.on('reconnect', setConnected);

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
