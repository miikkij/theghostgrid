'use strict';

let _state = null;
let _nextPatternId = 1;
const _activePatterns = new Map();

const PATTERNS = [
  'linear_translation',
  'radial_expansion',
  'random_walk_cluster',
  'phantom_convoy',
];

const DIRECTION_VECTORS = {
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
};

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeDirection(dir) {
  if (typeof dir === 'string') return DIRECTION_VECTORS[dir] || DIRECTION_VECTORS.east;
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
  if (len === 0) return { x: 1, y: 0 };
  return { x: dir.x / len, y: dir.y / len };
}

function toroidalDistance(a, b, period) {
  const diff = Math.abs(a - b);
  return Math.min(diff, period - diff);
}

// Linear band sweeping across area in a direction
function evaluateLinearTranslation(params, position, cycleNumber) {
  const dir = normalizeDirection(params.direction || 'east');
  const velocity = params.velocity || 0.01;
  const bandWidth = params.band_width || 0.15;
  const startPos = params.start_position || 0;
  const period = params.period || 1.5;

  const projected = position.x * dir.x + position.y * dir.y;
  const bandCenter = (startPos + velocity * cycleNumber) % period;
  const dist = toroidalDistance(projected, bandCenter, period);

  return dist < bandWidth / 2;
}

// Expanding ring from center
function evaluateRadialExpansion(params, position, cycleNumber) {
  const cx = params.center?.x ?? 0.5;
  const cy = params.center?.y ?? 0.5;
  const rate = params.expansion_rate || 0.005;
  const ringWidth = params.ring_width || 0.05;
  const startRadius = params.start_radius || 0;
  const maxRadius = params.max_radius || 0.8;

  const currentRadius = startRadius + rate * cycleNumber;
  if (currentRadius > maxRadius) return false;

  const dx = position.x - cx;
  const dy = position.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  return Math.abs(dist - currentRadius) < ringWidth / 2;
}

// Meandering cluster following seeded random walk
function evaluateRandomWalkCluster(params, position, cycleNumber) {
  const seed = params.seed || 12345;
  const clusterRadius = params.cluster_radius || 0.08;
  const velocity = params.velocity || 0.008;
  const initial = params.initial_position || { x: 0.3, y: 0.5 };

  const rng = mulberry32(seed);
  let cx = initial.x;
  let cy = initial.y;
  for (let i = 0; i < cycleNumber; i++) {
    const angle = rng() * 2 * Math.PI;
    cx = Math.max(0, Math.min(1, cx + Math.cos(angle) * velocity));
    cy = Math.max(0, Math.min(1, cy + Math.sin(angle) * velocity));
  }

  const dx = position.x - cx;
  const dy = position.y - cy;
  return Math.sqrt(dx * dx + dy * dy) < clusterRadius;
}

// Activation propagating along a waypoint path
function evaluatePhantomConvoy(params, position, cycleNumber) {
  const path = params.path;
  if (!path || path.length < 2) return false;
  const velocity = params.velocity || 0.015;
  const convoyLength = params.convoy_length || 0.1;
  const loop = params.loop !== false;

  const segments = [];
  let totalLength = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    segments.push({ start: path[i - 1], end: path[i], length: len, cumulative: totalLength });
    totalLength += len;
  }
  if (totalLength === 0) return false;

  let headDist = velocity * cycleNumber;
  if (loop) {
    headDist = headDist % totalLength;
  } else if (headDist > totalLength) {
    return false;
  }

  const tailDist = Math.max(0, headDist - convoyLength);

  const headPoint = pointAlongPath(segments, totalLength, headDist);
  const tailPoint = pointAlongPath(segments, totalLength, tailDist);

  return distanceToSegment(position, tailPoint, headPoint) < 0.03;
}

function pointAlongPath(segments, totalLength, dist) {
  for (const seg of segments) {
    if (dist <= seg.cumulative + seg.length) {
      const t = seg.length > 0 ? (dist - seg.cumulative) / seg.length : 0;
      return {
        x: seg.start.x + (seg.end.x - seg.start.x) * t,
        y: seg.start.y + (seg.end.y - seg.start.y) * t,
      };
    }
  }
  const last = segments[segments.length - 1];
  return last.end;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const px = point.x - a.x;
    const py = point.y - a.y;
    return Math.sqrt(px * px + py * py);
  }
  let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  const px = point.x - projX;
  const py = point.y - projY;
  return Math.sqrt(px * px + py * py);
}

const EVALUATORS = {
  linear_translation: evaluateLinearTranslation,
  radial_expansion: evaluateRadialExpansion,
  random_walk_cluster: evaluateRandomWalkCluster,
  phantom_convoy: evaluatePhantomConvoy,
};

function init(state) {
  _state = state;
}

function activate({ patternName, parameters }) {
  if (!PATTERNS.includes(patternName)) {
    throw new Error(`Unknown pattern: ${patternName}. Valid: ${PATTERNS.join(', ')}`);
  }

  const patternId = `PAT-${_nextPatternId++}`;
  _activePatterns.set(patternId, {
    id: patternId,
    name: patternName,
    parameters: { ...parameters },
    activatedAt: Date.now(),
  });

  if (_state) {
    _state.emit('deception.pattern_activated', {
      patternId,
      patternName,
      parameters,
    });
  }

  return patternId;
}

function deactivate(patternId) {
  const removed = _activePatterns.delete(patternId);
  if (removed && _state) {
    _state.emit('deception.pattern_deactivated', { patternId });
  }
  return removed;
}

// Union of all active patterns: transmit if ANY pattern says so
function shouldTransmit(nodeId, position, cycleNumber) {
  for (const pattern of _activePatterns.values()) {
    const evaluator = EVALUATORS[pattern.name];
    if (evaluator && evaluator(pattern.parameters, position, cycleNumber)) {
      return true;
    }
  }
  return false;
}

function getActivePatterns() {
  return Array.from(_activePatterns.values());
}

function reset() {
  _activePatterns.clear();
  _nextPatternId = 1;
}

module.exports = {
  PATTERNS,
  init,
  activate,
  deactivate,
  shouldTransmit,
  getActivePatterns,
  reset,
};
