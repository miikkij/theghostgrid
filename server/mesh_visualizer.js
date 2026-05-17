'use strict';

const { state } = require('./state');
const mesh = require('./protocol/mesh');
const log = require('./log').child({ component: 'mesh_viz' });

// Tracks in-flight messages hop-by-hop through the mesh.
// Each message advances one hop per burst cycle. When it reaches
// a drone, it flashes the fiber tether to HQ. Broadcasts each
// hop as a 'mesh_hop' event for the big screen to animate.

const _inflight = [];
const MAX_INFLIGHT = 50;

function init() {
  state.on('cycle.sync_beta_burst', advanceMessages);
  log.info('mesh visualizer initialized');
}

function injectMessage(sourceCallsign, msgType) {
  const nodes = state.get('nodes') || {};
  const src = nodes[sourceCallsign];
  if (!src || !src.position) return;

  const route = buildRoute(sourceCallsign, nodes);
  if (route.length < 2) return;

  if (_inflight.length >= MAX_INFLIGHT) _inflight.shift();

  const msg = {
    id: sourceCallsign + '-' + Date.now(),
    msgType: msgType || 'DATA',
    route: route,
    hopIndex: 0,
    startedAt: Date.now(),
  };

  _inflight.push(msg);

  state.broadcastTo('screen', 'mesh_message_start', {
    id: msg.id,
    msgType: msg.msgType,
    route: route.map((r) => ({ id: r.id, position: r.position, type: r.type })),
  });
}

function buildRoute(sourceId, nodes) {
  const route = [];
  const visited = new Set();
  const drones = Object.entries(state.get('drones') || {});
  const maxHops = 8;

  const srcNode = nodes[sourceId];
  if (!srcNode) return route;
  route.push({ id: sourceId, position: srcNode.position, type: srcNode.type || 'ground' });
  visited.add(sourceId);

  // Use the real mesh routing to find path to HQ
  let current = sourceId;
  for (let hop = 0; hop < maxHops; hop++) {
    const nextHop = mesh.routePacket({ src: current, dst: 'HQ', mode: 'routine' });

    if (!nextHop) {
      // Mesh has no route — fall back to geographic nearest toward drone
      const fallback = geographicFallback(current, visited, nodes, drones);
      if (!fallback) break;
      current = fallback.id;
      visited.add(current);
      route.push(fallback);
      if (fallback.type === 'drone') break;
      continue;
    }

    // nextHop could be a single node or an array (flood mode)
    const hop_id = Array.isArray(nextHop) ? nextHop[0] : nextHop;
    if (visited.has(hop_id)) break;
    visited.add(hop_id);

    const hopNode = nodes[hop_id];
    const hopDrone = drones.find(([id]) => id === hop_id);

    if (hopDrone) {
      route.push({ id: hop_id, position: hopDrone[1].position, type: 'drone' });
      break; // Reached drone — next is fiber to HQ
    } else if (hopNode) {
      route.push({ id: hop_id, position: hopNode.position, type: hopNode.type || 'ground' });
      current = hop_id;
    } else {
      break;
    }
  }

  // If last hop is a drone, add HQ as final destination (fiber link)
  if (route.length > 1 && route[route.length - 1].type === 'drone') {
    route.push({ id: 'HQ', position: { x: 0.05, y: 0.95 }, type: 'hq' });
  } else if (route.length > 1) {
    // Try to find any drone in the route's last node's neighbors
    const lastId = route[route.length - 1].id;
    const neighbors = mesh.getNeighbors(lastId);
    const droneNeighbor = neighbors.find((n) => {
      const d = drones.find(([id]) => id === n.nodeId);
      return !!d;
    });
    if (droneNeighbor) {
      const d = drones.find(([id]) => id === droneNeighbor.nodeId);
      route.push({ id: d[0], position: d[1].position, type: 'drone' });
      route.push({ id: 'HQ', position: { x: 0.05, y: 0.95 }, type: 'hq' });
    }
  }

  return route;
}

function geographicFallback(currentId, visited, nodes, drones) {
  const currentNode = nodes[currentId];
  if (!currentNode || !currentNode.position) return null;

  // Find closest drone
  let closestDrone = null;
  let closestDist = Infinity;
  for (const [droneId, drone] of drones) {
    if (visited.has(droneId)) continue;
    const d = dist(currentNode.position, drone.position);
    if (d < closestDist) {
      closestDist = d;
      closestDrone = { id: droneId, position: drone.position, type: 'drone' };
    }
  }

  // If drone is within range, go direct
  if (closestDrone && closestDist < 0.3) return closestDrone;

  // Otherwise find nearest unvisited non-decoy node closer to the drone
  if (!closestDrone) return null;
  let bestId = null;
  let bestDist = dist(currentNode.position, closestDrone.position);

  for (const [nid, n] of Object.entries(nodes)) {
    if (visited.has(nid) || !n.position || n.type === 'decoy') continue;
    if (n.state === 'DEAD' || n.state === 'JAMMED') continue;
    const dToMe = dist(currentNode.position, n.position);
    const dToDrone = dist(n.position, closestDrone.position);
    if (dToMe < 0.3 && dToDrone < bestDist) {
      bestDist = dToDrone;
      bestId = nid;
    }
  }

  if (!bestId) return closestDrone; // try direct even if out of range (visualization only)
  return { id: bestId, position: nodes[bestId].position, type: nodes[bestId].type || 'ground' };
}

function advanceMessages() {
  const toRemove = [];

  for (let i = 0; i < _inflight.length; i++) {
    const msg = _inflight[i];
    msg.hopIndex++;

    if (msg.hopIndex >= msg.route.length - 1) {
      const from = msg.route[msg.hopIndex - 1];
      const to = msg.route[msg.hopIndex];

      state.broadcastTo('screen', 'mesh_hop', {
        id: msg.id,
        msgType: msg.msgType,
        hopIndex: msg.hopIndex,
        from: { id: from.id, position: from.position, type: from.type },
        to: { id: to.id, position: to.position, type: to.type },
        final: true,
      });

      state.emit('transmission.frame_transmitted', {
        from: from.id,
        to: to.id,
        cycle: state.get('cycle.number'),
      });

      toRemove.push(i);
    } else {
      const from = msg.route[msg.hopIndex - 1];
      const to = msg.route[msg.hopIndex];

      state.broadcastTo('screen', 'mesh_hop', {
        id: msg.id,
        msgType: msg.msgType,
        hopIndex: msg.hopIndex,
        from: { id: from.id, position: from.position, type: from.type },
        to: { id: to.id, position: to.position, type: to.type },
        isDroneHop: to.type === 'drone',
        isFiberHop: from.type === 'drone' && to.type === 'hq',
        final: false,
      });

      state.emit('transmission.frame_transmitted', {
        from: from.id,
        to: to.id,
        cycle: state.get('cycle.number'),
      });
    }
  }

  for (let j = toRemove.length - 1; j >= 0; j--) {
    _inflight.splice(toRemove[j], 1);
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getInflight() {
  return _inflight.length;
}

module.exports = { init, injectMessage, getInflight };
