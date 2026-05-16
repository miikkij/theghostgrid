'use strict';

const DEFAULTS = {
  DEFAULT_TTL: 5,
  NEIGHBOR_TIMEOUT_CYCLES: 3,
  DV_ANNOUNCE_INTERVAL: 3,
  MAX_SEEN_CACHE: 1000,
  RADIO_RANGE: 0.3,
  HQ_NODE_ID: 'HQ',
};

let _state = null;
let _config = { ...DEFAULTS };
let _currentCycle = 0;

const _neighbors = new Map();
const _routingTables = new Map();
const _seenPackets = new Map();

function init(state, config) {
  _state = state;
  if (config) Object.assign(_config, config);

  if (!_state) return;

  _state.on('transmission.frame_received', (frameData) => {
    const sourceNode = frameData.source_node;
    for (const [nodeId] of _neighbors) {
      if (nodeId === sourceNode) continue;
      if (_neighbors.get(nodeId).has(sourceNode)) {
        handleReceivedFrame(nodeId, frameData);
      }
    }
  });

  _state.on('cycle.sync_alpha', (data) => {
    _currentCycle = data.number;
    ageNeighbors(data.number);

    if (data.number % _config.DV_ANNOUNCE_INTERVAL === 0) {
      broadcastRoutingUpdates();
    }
  });
}

function updateNeighbor(nodeId, neighborId, signalQuality, lastSeen) {
  if (!_neighbors.has(nodeId)) _neighbors.set(nodeId, new Map());
  const table = _neighbors.get(nodeId);
  const isNew = !table.has(neighborId);

  const nodeRole = resolveNodeRole(nodeId);
  const neighborRole = resolveNodeRole(neighborId);

  table.set(neighborId, { signalQuality, lastSeen, role: neighborRole });

  if (!_neighbors.has(neighborId)) _neighbors.set(neighborId, new Map());
  _neighbors.get(neighborId).set(nodeId, {
    signalQuality,
    lastSeen,
    role: nodeRole,
  });

  if (isNew) {
    updateRoutingTable(nodeId);
    updateRoutingTable(neighborId);

    if (_state) {
      _state.emit('mesh.neighbor_added', { nodeId, neighborId, signalQuality });
    }
  }
}

function resolveNodeRole(nodeId) {
  if (!_state) return 'ground';
  const nodes = _state.get('nodes') || {};
  return nodes[nodeId]?.type || 'ground';
}

function removeNeighbor(nodeId, neighborId) {
  const table = _neighbors.get(nodeId);
  if (!table || !table.has(neighborId)) return;

  table.delete(neighborId);
  updateRoutingTable(nodeId);

  if (_state) {
    _state.emit('mesh.neighbor_removed', { nodeId, neighborId });
  }
}

function getNeighbors(nodeId) {
  const table = _neighbors.get(nodeId);
  if (!table) return [];
  return Array.from(table.entries()).map(([id, info]) => ({
    nodeId: id,
    ...info,
  }));
}

function routePacket({ src, dst, payload: _payload, mode, ttl: _ttl }) {
  mode = mode || 'routine';

  if (mode === 'urgent') {
    return floodRoute(src, dst);
  }
  return dvRoute(src, dst);
}

function floodRoute(src, dst) {
  const neighbors = getNeighbors(src);
  if (neighbors.length === 0) return null;

  const direct = neighbors.find((n) => n.nodeId === dst);
  if (direct) return dst;

  if (dst === _config.HQ_NODE_ID) {
    const drone = neighbors.find((n) => n.role === 'drone');
    if (drone) return drone.nodeId;
  }

  // True flood: return ALL neighbors (caller retransmits to each)
  return neighbors.map((n) => n.nodeId);
}

function dvRoute(src, dst) {
  let table = _routingTables.get(src);
  if (!table) {
    updateRoutingTable(src);
    table = _routingTables.get(src);
  }

  if (table) {
    const route = table.get(dst);
    if (route) return route.nextHop;
  }

  if (dst === _config.HQ_NODE_ID) {
    const neighbors = getNeighbors(src);
    const drone = neighbors.find((n) => n.role === 'drone');
    if (drone) return drone.nodeId;
  }

  return null;
}

function handleReceivedFrame(receiverNodeId, frameData) {
  const source = frameData.source_node;
  const mesh = frameData.mesh;

  if (!mesh) return { action: 'drop', reason: 'no_mesh_payload' };

  updateNeighbor(receiverNodeId, source, 1.0, _currentCycle);

  const packetId = `${mesh.src}:${mesh.sequence}`;
  if (!_seenPackets.has(receiverNodeId)) {
    _seenPackets.set(receiverNodeId, new Set());
  }
  const seen = _seenPackets.get(receiverNodeId);

  if (seen.has(packetId)) {
    return { action: 'drop', reason: 'duplicate' };
  }
  seen.add(packetId);

  if (seen.size > _config.MAX_SEEN_CACHE) {
    const arr = Array.from(seen);
    const trimTo = Math.floor(_config.MAX_SEEN_CACHE / 2);
    for (let i = 0; i < arr.length - trimTo; i++) {
      seen.delete(arr[i]);
    }
  }

  if (mesh.dst === receiverNodeId || mesh.dst === 'BROADCAST') {
    if (_state) {
      _state.emit('mesh.packet_delivered', {
        src: mesh.src,
        dst: mesh.dst,
        receiver: receiverNodeId,
        payload: mesh.app,
      });
    }
    if (mesh.dst !== 'BROADCAST') {
      return { action: 'consume', frame: frameData };
    }
  }

  const receiverRole = resolveNodeRole(receiverNodeId);
  if (mesh.dst === _config.HQ_NODE_ID && receiverRole === 'drone') {
    if (_state) {
      _state.emit('mesh.packet_delivered', {
        src: mesh.src,
        dst: mesh.dst,
        receiver: receiverNodeId,
        via: 'fiber',
        payload: mesh.app,
      });
    }
    return { action: 'deliver_to_hq', frame: frameData };
  }

  if (mesh.ttl <= 1) {
    return { action: 'drop', reason: 'ttl_exhausted' };
  }

  const forwarded = {
    ...frameData,
    mesh: { ...mesh, ttl: mesh.ttl - 1 },
  };

  if (mesh.class === 'urgent') {
    if (_state) {
      _state.emit('transmission.frame_to_send', forwarded);
    }
    return { action: 'forward_flood', frame: forwarded };
  }

  const nextHop = dvRoute(receiverNodeId, mesh.dst);
  if (nextHop) {
    if (_state) {
      _state.emit('transmission.frame_to_send', forwarded);
    }
    return { action: 'forward', nextHop, frame: forwarded };
  }

  return { action: 'drop', reason: 'no_route' };
}

function declareJammed(area) {
  const allNodes = _state ? _state.get('nodes') || {} : {};
  const affected = [];

  for (const [nodeId, info] of Object.entries(allNodes)) {
    if (!info.position) continue;
    const dx = info.position.x - area.center.x;
    const dy = info.position.y - area.center.y;
    if (Math.sqrt(dx * dx + dy * dy) <= area.radius) {
      affected.push(nodeId);
    }
  }

  for (const jammed of affected) {
    for (const [nodeId] of _neighbors) {
      if (!affected.includes(nodeId)) {
        removeNeighbor(nodeId, jammed);
      }
    }
    _neighbors.delete(jammed);
  }

  for (const [nodeId] of _neighbors) {
    if (!affected.includes(nodeId)) {
      updateRoutingTable(nodeId);
    }
  }

  if (_state) {
    _state.emit('mesh.routing_converged', { reason: 'jamming', affected, area });
  }

  return affected;
}

function updateRoutingTable(nodeId) {
  const neighbors = getNeighbors(nodeId);
  const table = new Map();

  for (const n of neighbors) {
    table.set(n.nodeId, {
      nextHop: n.nodeId,
      hopCount: 1,
      quality: n.signalQuality,
    });
  }

  for (const n of neighbors) {
    const neighborTable = _routingTables.get(n.nodeId);
    if (!neighborTable) continue;

    for (const [dest, route] of neighborTable) {
      if (dest === nodeId) continue;
      const newHopCount = route.hopCount + 1;
      const existing = table.get(dest);

      if (
        !existing ||
        newHopCount < existing.hopCount ||
        (newHopCount === existing.hopCount && n.signalQuality > existing.quality)
      ) {
        table.set(dest, {
          nextHop: n.nodeId,
          hopCount: newHopCount,
          quality: Math.min(n.signalQuality, route.quality),
        });
      }
    }
  }

  const drone = neighbors.find((n) => n.role === 'drone');
  if (drone && !table.has(_config.HQ_NODE_ID)) {
    table.set(_config.HQ_NODE_ID, {
      nextHop: drone.nodeId,
      hopCount: 2,
      quality: drone.signalQuality,
    });
  }

  _routingTables.set(nodeId, table);
}

function getRoutingTable(nodeId) {
  const table = _routingTables.get(nodeId);
  if (!table) return {};
  return Object.fromEntries(table);
}

function ageNeighbors(currentCycle) {
  for (const [nodeId, table] of _neighbors) {
    const stale = [];
    for (const [neighborId, info] of table) {
      if (currentCycle - info.lastSeen > _config.NEIGHBOR_TIMEOUT_CYCLES) {
        stale.push(neighborId);
      }
    }
    for (const neighborId of stale) {
      removeNeighbor(nodeId, neighborId);
    }
  }
}

function broadcastRoutingUpdates() {
  for (const [nodeId] of _neighbors) {
    updateRoutingTable(nodeId);
  }

  if (_state) {
    _state.emit('mesh.routing_converged', { reason: 'periodic' });
  }
}

function reset() {
  _neighbors.clear();
  _routingTables.clear();
  _seenPackets.clear();
  _currentCycle = 0;
}

module.exports = {
  init,
  updateNeighbor,
  removeNeighbor,
  getNeighbors,
  routePacket,
  handleReceivedFrame,
  declareJammed,
  getRoutingTable,
  reset,
};
