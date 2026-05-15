'use strict';

const { EventEmitter } = require('events');

const INITIAL_STATE = {
  cycle: {
    number: 0,
    phase: 'idle',
    period_ms: 1000,
    last_alpha_ts: null,
    last_beta_ts: null,
  },
  nodes: {},
  drones: {},
  jamming_zones: [],
  active_patterns: [],
  stats: {
    packets_total: 0,
    packets_dropped: 0,
    sync_drift_ms: 0,
    ai_decisions: 0,
    uptime_ms: 0,
  },
  audit_log: [],
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Resolve a dot-delimited path into an object.
 * Returns { parent, key } so callers can get or set the leaf.
 */
function resolve(root, path) {
  const parts = path.split('.');
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] === undefined) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  return { parent: current, key: parts[parts.length - 1] };
}

class State {
  constructor() {
    this._ee = new EventEmitter();
    this._ee.setMaxListeners(200);
    this._store = deepClone(INITIAL_STATE);
    this._io = null;
    this._startTime = Date.now();
  }

  /**
   * Inject the Socket.IO server instance so broadcast helpers work.
   * Called once during server startup.
   * @param {import('socket.io').Server} io
   */
  attachIO(io) {
    this._io = io;
  }

  // --- EventEmitter delegation ---

  /** Subscribe to a server-side event. */
  on(event, handler) {
    this._ee.on(event, handler);
  }

  /** Unsubscribe from a server-side event. */
  off(event, handler) {
    this._ee.off(event, handler);
  }

  /** Emit a server-side event to all local subscribers. */
  emit(event, payload) {
    this._ee.emit(event, payload);
  }

  // --- State access ---

  /**
   * Read a value from the state store by dot-delimited path.
   * @param {string} path  e.g. 'cycle.number'
   * @returns {*} value at path, or undefined
   */
  get(path) {
    const { parent, key } = resolve(this._store, path);
    return parent[key];
  }

  /**
   * Write a value to the state store by dot-delimited path.
   * Emits a 'state.changed' event with { path, value }.
   * @param {string} path  e.g. 'cycle.phase'
   * @param {*} value
   */
  set(path, value) {
    const { parent, key } = resolve(this._store, path);
    parent[key] = value;
    this._ee.emit('state.changed', { path, value });
  }

  /** Return a deep clone of the full state store (for debugging / snapshots). */
  snapshot() {
    this._store.stats.uptime_ms = Date.now() - this._startTime;
    return deepClone(this._store);
  }

  // --- WebSocket broadcast helpers ---

  /**
   * Push an event to every connected WebSocket client.
   * @param {string} event
   * @param {*} payload
   */
  broadcast(event, payload) {
    if (this._io) {
      this._io.emit(event, payload);
    }
  }

  /**
   * Push an event only to clients that joined a specific role room.
   * @param {'phone'|'screen'|'ops'|'observer'} role
   * @param {string} event
   * @param {*} payload
   */
  broadcastTo(role, event, payload) {
    if (this._io) {
      this._io.to(role).emit(event, payload);
    }
  }
}

const state = new State();

module.exports = { state, INITIAL_STATE };
