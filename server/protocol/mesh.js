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
    if (!sourceNode) return;

    const nodes = _state.get('nodes') || {};
    const drones = _state.get('drones') || {};
    const srcNode = nodes[sourceNode];
    const srcDrone = drones[sourceNode];
    const srcPos = srcNode?.position || srcDrone?.position;
    if (!srcPos) return;

    // Decoys emit frames (for deception) but don't participate in mesh routing.
    // Their frames are received by the transmission layer for protocol
    // indistinguishability, but the mesh layer ignores them for routing.
    const srcType = srcNode?.type || (srcDrone ? 'drone' : 'ground');
    if (srcType === 'decoy' || srcType === 'honeypot') return;

    const meshPayload = frameData.mesh;
    const isRoutable = meshPayload && meshPayload.dst && meshPayload.class !== 'cover';

    for (const [nodeId] of _neighbors) {
      if (nodeId === sourceNode) continue;
      const table = _neighbors.get(nodeId);

      if (table.has(sourceNode)) {
        table.get(sourceNode).lastSeen = _currentCycle;
        if (isRoutable) handleReceivedFrame(nodeId, frameData);
      } else {
        const nNode = nodes[nodeId];
        const nDrone = drones[nodeId];
        const nPos = nNode?.position || nDrone?.position;
        if (nPos) {
          const dx = srcPos.x - nPos.x;
          const dy = srcPos.y - nPos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= _config.RADIO_RANGE) {
            const quality = 1.0 - (dist / _config.RADIO_RANGE);
            updateNeighbor(nodeId, sourceNode, quality, _currentCycle);
            if (isRoutable) handleReceivedFrame(nodeId, frameData);
          }
        }
      }
    }

    const allIds = [...Object.keys(nodes), ...Object.keys(drones)];
    for (const nodeId of allIds) {
      if (nodeId === sourceNode) continue;
      if (_neighbors.has(nodeId)) continue;
      const nNode = nodes[nodeId];
      const nDrone = drones[nodeId];
      if (nNode?.state === 'DEAD' || nDrone?.status === 'destroyed') continue;
      // Don't add decoys to the routing graph
      if (nNode?.type === 'decoy' || nNode?.type === 'honeypot') continue;
      const nPos = nNode?.position || nDrone?.position;
      if (!nPos) continue;
      const dx = srcPos.x - nPos.x;
      const dy = srcPos.y - nPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= _config.RADIO_RANGE) {
        const quality = 1.0 - (dist / _config.RADIO_RANGE);
        updateNeighbor(nodeId, sourceNode, quality, _currentCycle);
        if (isRoutable) handleReceivedFrame(nodeId, frameData);
      }
    }
  });

  _state.on('cycle.sync_alpha', (data) => {
    _currentCycle = data.number;
    ageNeighbors(data.number);

    if (data.number % _config.DV_ANNOUNCE_INTERVAL === 0) {
      broadcastRoutingUpdates();
    }

    // Discover new neighbor links from positions every 5 cycles
    if (data.number % 5 === 0) {
      computeNeighborsFromState();
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
  if (nodes[nodeId]?.type) return nodes[nodeId].type;
  const drones = _state.get('drones') || {};
  if (drones[nodeId]) return 'drone';
  return 'ground';
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
    _state.emit('mesh.jamming_detected', {
      timestamp: Date.now(),
      affected_nodes: affected,
      affected_area: area,
      frequency_band: '2.4 GHz',
    });
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
  if (drone) {
    const existing = table.get(_config.HQ_NODE_ID);
    if (!existing || existing.hopCount > 2) {
      table.set(_config.HQ_NODE_ID, {
        nextHop: drone.nodeId,
        hopCount: 2,
        quality: drone.signalQuality,
      });
    }
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

function computeNeighborsFromState() {
  if (!_state) return;
  const nodes = _state.get('nodes') || {};
  const drones = _state.get('drones') || {};
  const range = _config.RADIO_RANGE;

  // Only real nodes and drones participate in mesh routing.
  // Decoys emit their own frames but do not relay real traffic.
  const all = {};
  for (const [id, n] of Object.entries(nodes)) {
    if (!n.position || n.state === 'DEAD') continue;
    if (n.type === 'decoy' || n.type === 'honeypot') continue;
    all[id] = { position: n.position, type: n.type || 'ground' };
  }
  for (const [id, d] of Object.entries(drones)) {
    if (!d.position || d.status === 'destroyed') continue;
    all[id] = { position: d.position, type: 'drone' };
  }

  const ids = Object.keys(all);
  for (let i = 0; i < ids.length; i++) {
    const a = ids[i];
    const posA = all[a].position;
    for (let j = i + 1; j < ids.length; j++) {
      const b = ids[j];
      const posB = all[b].position;
      const dx = posA.x - posB.x;
      const dy = posA.y - posB.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= range) {
        const quality = 1.0 - (dist / range);
        updateNeighbor(a, b, quality, _currentCycle);
      }
    }
  }
}

function pruneMovedNeighbors() {
  if (!_state) return;
  const nodes = _state.get('nodes') || {};
  const drones = _state.get('drones') || {};
  const range = _config.RADIO_RANGE;

  function getPos(id) {
    if (nodes[id] && nodes[id].position) return nodes[id].position;
    if (drones[id] && drones[id].position) return drones[id].position;
    return null;
  }

  for (const [nodeId, table] of _neighbors) {
    const posA = getPos(nodeId);
    if (!posA) continue;
    const stale = [];
    for (const [neighborId] of table) {
      const posB = getPos(neighborId);
      if (!posB) { stale.push(neighborId); continue; }
      const dx = posA.x - posB.x;
      const dy = posA.y - posB.y;
      if (Math.sqrt(dx * dx + dy * dy) > range) {
        stale.push(neighborId);
      }
    }
    for (const id of stale) {
      removeNeighbor(nodeId, id);
    }
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
  computeNeighborsFromState,
  pruneMovedNeighbors,
  reset,
};
