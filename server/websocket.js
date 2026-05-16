'use strict';

const { Server } = require('socket.io');
const { state } = require('./state');
const log = require('./log').child({ component: 'ws' });

// Callsign generation: NATO phonetic prefix + sequential number
const NATO = [
  'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT',
  'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA',
  'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO',
  'SIERRA', 'TANGO', 'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY',
  'YANKEE', 'ZULU',
];

const ROLES = ['RECON', 'OPS', 'COMMS', 'MEDIC', 'ENGINEER', 'SNIPER'];

let phoneCounter = 0;

function nextCallsign() {
  phoneCounter++;
  const prefix = NATO[phoneCounter % NATO.length];
  const number = Math.ceil(phoneCounter / NATO.length);
  return `${prefix}-${number}`;
}

function randomRole() {
  return ROLES[Math.floor(Math.random() * ROLES.length)];
}

// Client registry: socketId -> { role, callsign?, joinedAt }
const clients = new Map();

/**
 * Attach Socket.IO to an HTTP server and wire up event handling.
 * @param {import('http').Server} httpServer
 * @returns {import('socket.io').Server}
 */
function attachWebSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  state.attachIO(io);

  io.on('connection', (socket) => {
    const requestedRole = socket.handshake.query.role || 'observer';
    const role = ['phone', 'screen', 'ops', 'observer'].includes(requestedRole)
      ? requestedRole
      : 'observer';

    socket.join(role);

    const entry = { role, joinedAt: Date.now() };

    if (role === 'phone') {
      entry.callsign = nextCallsign();
      entry.nodeRole = randomRole();

      // Spread nodes across the operational area (0.15–0.85 range)
      var px = 0.15 + Math.random() * 0.7;
      var py = 0.15 + Math.random() * 0.6;

      socket.emit('identity', {
        callsign: entry.callsign,
        role: entry.nodeRole,
        area: { x: px, y: py },
      });
      state.set(`nodes.${entry.callsign}`, {
        type: 'soldier',
        position: { x: px, y: py },
        state: 'LISTENING',
        neighbors: [],
        lastSeen: Date.now(),
      });

      log.info({ callsign: entry.callsign, nodeRole: entry.nodeRole }, 'phone node joined');
    } else {
      log.info({ role }, 'client connected');
    }

    clients.set(socket.id, entry);

    // Send current state snapshot on connect
    socket.emit('state_update', state.snapshot());

    // --- Inbound events from clients ---

    socket.on('ops.trigger_scenario', (data) => {
      log.info({ scenario: data.scenario, parameters: data.parameters }, 'scenario triggered via WS');
      state.emit('ops.trigger_scenario', data);
    });

    socket.on('ops.set_reasoning', (data) => {
      if (typeof data.enabled === 'boolean') {
        process.env.CM_USE_REASONING = data.enabled ? 'true' : 'false';
        state.set('cm_reasoning_enabled', data.enabled);
        state.broadcast('cm_reasoning_changed', { enabled: data.enabled });
        log.info({ enabled: data.enabled }, 'reasoning mode toggled');
      }
    });

    socket.on('ops.set_cycle_period', (data) => {
      if (data && data.period_ms && typeof data.period_ms === 'number') {
        const period = Math.max(250, Math.min(10000, data.period_ms));
        state.set('cycle.period_ms', period);
        log.info({ period_ms: period }, 'cycle period updated');
      }
    });

    socket.on('phone.move', (data) => {
      const client = clients.get(socket.id);
      if (client && client.callsign && data.position) {
        state.set(`nodes.${client.callsign}.position`, data.position);
      }
    });

    socket.on('phone.message', (data) => {
      const client = clients.get(socket.id);
      const callsign = data.callsign || (client && client.callsign);
      if (!callsign) return;

      log.debug({ callsign, type: data.type, dest: data.dest }, 'phone message');

      // Force this soldier to TX on next burst cycle
      state.emit('phone.force_tx', { callsign, msgType: data.type });

      // Update unit record immediately with current position
      const nodeData = state.get(`nodes.${callsign}`);
      if (nodeData) {
        state.emit('phone.unit_report', { callsign, nodeData, msgType: data.type });
      }
    });

    socket.on('phone.acknowledge', (data) => {
      const client = clients.get(socket.id);
      if (client && client.callsign) {
        state.set(`nodes.${client.callsign}.lastSeen`, Date.now());
      }
      log.debug({ data }, 'phone ack');
    });

    socket.on('disconnect', () => {
      const client = clients.get(socket.id);
      if (client) {
        if (client.callsign) {
          state.set(`nodes.${client.callsign}.state`, 'DEAD');
          log.info({ callsign: client.callsign }, 'phone node disconnected');
        } else {
          log.info({ role: client.role }, 'client disconnected');
        }
        clients.delete(socket.id);
      }
    });
  });

  return io;
}

/** Return the current client registry (for diagnostics). */
function getClients() {
  return Object.fromEntries(clients);
}

module.exports = { attachWebSocket, getClients };
