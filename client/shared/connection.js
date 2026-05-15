'use strict';

/**
 * Shared WebSocket connection helper.
 * @param {string} role - 'phone' | 'screen' | 'ops' | 'observer'
 * @param {function} onState - callback for state_update events
 * @returns {object} socket instance
 */
function connectToMesh(role, onState) {
  const socket = io({ query: { role } });

  socket.on('connect', () => {
    const indicator = document.getElementById('conn-status');
    if (indicator) indicator.style.background = 'var(--green)';
  });

  socket.on('disconnect', () => {
    const indicator = document.getElementById('conn-status');
    if (indicator) indicator.style.background = 'var(--red)';
  });

  socket.on('state_update', (data) => {
    if (onState) onState(data);
  });

  return socket;
}
