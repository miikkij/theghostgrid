'use strict';

const { state } = require('./state');
const log = require('./log').child({ component: 'mesh_viz' });

// Tracks in-flight messages hop-by-hop through the mesh.
// Each message advances one hop per burst cycle. When it reaches
// a drone, it flashes the fiber tether to HQ. Broadcasts each
// hop as a 'mesh_hop' event for the big screen to animate.

const _inflight = [];
const MAX_INFLIGHT = 50;

function init() {
  // Advance all in-flight messages one hop each burst cycle
  state.on('cycle.sync_beta_burst', advanceMessages);

  log.info('mesh visualizer initialized');
}

// Inject a new message into the mesh from a source node toward HQ
function injectMessage(sourceCallsign, msgType) {
  var nodes = state.get('nodes') || {};
  var src = nodes[sourceCallsign];
  if (!src || !src.position) return;

  // Build the route: source → nearest neighbors → drone → HQ
  var route = buildRoute(sourceCallsign, nodes);
  if (route.length < 2) return;

  if (_inflight.length >= MAX_INFLIGHT) _inflight.shift();

  var msg = {
    id: sourceCallsign + '-' + Date.now(),
    msgType: msgType || 'DATA',
    route: route,
    hopIndex: 0,
    startedAt: Date.now(),
  };

  _inflight.push(msg);

  // Broadcast the full route so big screen can show the planned path
  state.broadcastTo('screen', 'mesh_message_start', {
    id: msg.id,
    msgType: msg.msgType,
    route: route.map(function (r) { return { id: r.id, position: r.position, type: r.type }; }),
  });
}

function buildRoute(sourceId, nodes) {
  var route = [];
  var visited = new Set();
  var current = sourceId;
  var allNodes = Object.entries(nodes);

  // Start with source
  var srcNode = nodes[current];
  route.push({ id: current, position: srcNode.position, type: srcNode.type || 'soldier' });
  visited.add(current);

  // Find path to nearest drone via mesh hops (greedy nearest-neighbor toward drones)
  var drones = Object.entries(state.get('drones') || {});
  if (drones.length === 0) return route;

  // Find closest drone
  var closestDrone = null;
  var closestDist = Infinity;
  for (var [droneId, drone] of drones) {
    var d = dist(srcNode.position, drone.position);
    if (d < closestDist) {
      closestDist = d;
      closestDrone = { id: droneId, position: drone.position };
    }
  }
  if (!closestDrone) return route;

  // Hop through mesh toward the drone (max 5 hops)
  for (var hop = 0; hop < 5; hop++) {
    var currentNode = nodes[current];
    if (!currentNode || !currentNode.position) break;

    // Find nearest unvisited neighbor that's closer to the drone
    var bestId = null;
    var bestDist = dist(currentNode.position, closestDrone.position);

    for (var [nid, n] of allNodes) {
      if (visited.has(nid) || !n.position || n.type === 'decoy') continue;
      var dToMe = dist(currentNode.position, n.position);
      var dToDrone = dist(n.position, closestDrone.position);
      if (dToMe < 0.3 && dToDrone < bestDist) {
        bestDist = dToDrone;
        bestId = nid;
      }
    }

    if (!bestId) break;

    current = bestId;
    visited.add(current);
    route.push({ id: current, position: nodes[current].position, type: nodes[current].type || 'soldier' });

    // Close enough to drone — done with mesh hops
    if (bestDist < 0.15) break;
  }

  // Add drone as final mesh hop
  route.push({ id: closestDrone.id, position: closestDrone.position, type: 'drone' });

  // Add HQ as final destination
  route.push({ id: 'HQ', position: { x: 0.05, y: 0.95 }, type: 'hq' });

  return route;
}

function advanceMessages() {
  var toRemove = [];

  for (var i = 0; i < _inflight.length; i++) {
    var msg = _inflight[i];
    msg.hopIndex++;

    if (msg.hopIndex >= msg.route.length - 1) {
      // Message arrived at HQ
      var from = msg.route[msg.hopIndex - 1];
      var to = msg.route[msg.hopIndex];

      state.broadcastTo('screen', 'mesh_hop', {
        id: msg.id,
        msgType: msg.msgType,
        hopIndex: msg.hopIndex,
        from: { id: from.id, position: from.position, type: from.type },
        to: { id: to.id, position: to.position, type: to.type },
        final: true,
      });

      toRemove.push(i);
    } else {
      var from2 = msg.route[msg.hopIndex - 1];
      var to2 = msg.route[msg.hopIndex];
      var isDroneHop = to2.type === 'drone';
      var isFiberHop = from2.type === 'drone' && to2.type === 'hq';

      state.broadcastTo('screen', 'mesh_hop', {
        id: msg.id,
        msgType: msg.msgType,
        hopIndex: msg.hopIndex,
        from: { id: from2.id, position: from2.position, type: from2.type },
        to: { id: to2.id, position: to2.position, type: to2.type },
        isDroneHop: isDroneHop,
        isFiberHop: isFiberHop,
        final: false,
      });
    }
  }

  // Remove completed messages (reverse order)
  for (var j = toRemove.length - 1; j >= 0; j--) {
    _inflight.splice(toRemove[j], 1);
  }
}

function dist(a, b) {
  var dx = a.x - b.x;
  var dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getInflight() {
  return _inflight.length;
}

module.exports = { init, injectMessage, getInflight };
