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

      socket.emit('identity', {
        callsign: entry.callsign,
        role: entry.nodeRole,
      });

      state.set(`nodes.${entry.callsign}`, {
        type: 'soldier',
        position: { x: Math.random(), y: Math.random() },
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
