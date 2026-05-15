'use strict';

/**
 * Shared WebSocket connection helper for all Tactical Mesh UI clients.
 * Loaded via <script> tag after socket.io.js.
 *
 * Usage:
 *   const socket = connectToMesh('screen', onStateUpdate);
 *   socket.on('cycle_tick', (data) => { ... });
 */

// Connection state tracking
let _staleTimer = null;
const STALE_THRESHOLD_MS = 5000;

function _setIndicator(cls) {
  const el = document.getElementById('connection-indicator');
  if (!el) return;
  el.classList.remove('connected', 'stale', 'error');
  if (cls) el.classList.add(cls);
}

function _resetStaleTimer() {
  clearTimeout(_staleTimer);
  _setIndicator('connected');
  _staleTimer = setTimeout(() => _setIndicator('stale'), STALE_THRESHOLD_MS);
}

/**
 * Connect to the server WebSocket with a given role.
 * @param {string} role - 'phone' | 'screen' | 'ops' | 'observer'
 * @param {function} [onState] - callback for state_update events
 * @returns {object} Socket.IO socket instance
 */
function connectToMesh(role, onState) {
  if (typeof io === 'undefined') {
    console.error('[connection] Socket.IO client not loaded. Include /socket.io/socket.io.js before this script.');
    return null;
  }

  const socket = io({
    query: { role },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    console.log(`[connection] Connected as ${role}`);
    _resetStaleTimer();
  });

  socket.on('disconnect', (reason) => {
    console.warn(`[connection] Disconnected: ${reason}`);
    clearTimeout(_staleTimer);
    _setIndicator('error');
  });

  socket.on('reconnect', (attempt) => {
    console.log(`[connection] Reconnected after ${attempt} attempts`);
    _resetStaleTimer();
  });

  socket.on('state_update', (data) => {
    _resetStaleTimer();
    if (onState) onState(data);
  });

  socket.on('cycle_tick', () => {
    _resetStaleTimer();
  });

  return socket;
}
