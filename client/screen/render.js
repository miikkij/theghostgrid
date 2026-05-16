'use strict';

/**
 * BattlefieldRenderer — pure Canvas rendering module.
 * Takes state + timestamp, draws one frame. No DOM manipulation, no WebSocket logic.
 */

// eslint-disable-next-line no-unused-vars
class BattlefieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Offscreen canvas for cached grid
    this._gridCache = null;
    this._gridCacheKey = '';

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._gridCache = null;
  }

  render(state, time) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    this._drawGrid();
    this._drawJammingZones(state.jamming_zones, time);
    this._drawHQ();
    this._drawFiberTethers(state.drones);
    this._drawDroneLinks(state.drones, time);
    this._drawDrones(state.drones, time);
    this._drawSyncPulses(state.cycle, state.drones, time);
    this._drawTransmissionArcs(state.active_transmissions, state.nodes, time);
    this._drawMeshHops(state.mesh_hops, time);
    this._drawNodes(state.nodes, time);
    this._drawAlerts(state.active_alerts, state.nodes, time);
  }

  // --- Grid ---

  _drawGrid() {
    const key = `${this.width}x${this.height}`;
    if (this._gridCache && this._gridCacheKey === key) {
      this.ctx.drawImage(this._gridCache, 0, 0, this.width, this.height);
      return;
    }

    const offscreen = document.createElement('canvas');
    offscreen.width = this.width * this.dpr;
    offscreen.height = this.height * this.dpr;
    const oc = offscreen.getContext('2d');
    oc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const spacing = 50;
    oc.strokeStyle = 'rgba(42, 52, 71, 0.3)';
    oc.lineWidth = 1;
    oc.beginPath();
    for (let x = spacing; x < this.width; x += spacing) {
      oc.moveTo(x + 0.5, 0);
      oc.lineTo(x + 0.5, this.height);
    }
    for (let y = spacing; y < this.height; y += spacing) {
      oc.moveTo(0, y + 0.5);
      oc.lineTo(this.width, y + 0.5);
    }
    oc.stroke();

    this._gridCache = offscreen;
    this._gridCacheKey = key;
    this.ctx.drawImage(offscreen, 0, 0, this.width, this.height);
  }

  // --- HQ icon ---

  _drawHQ() {
    const ctx = this.ctx;
    const x = 80;
    const y = this.height - 80;
    const s = 18;

    ctx.save();
    ctx.shadowColor = 'rgba(248, 250, 252, 0.5)';
    ctx.shadowBlur = 16;

    // Castle shape
    ctx.fillStyle = '#F8FAFC';
    ctx.beginPath();
    ctx.rect(x - s, y - s, s * 2, s * 2);
    ctx.fill();

    // Battlements
    ctx.fillStyle = '#0A0E1A';
    const bw = s * 0.4;
    ctx.fillRect(x - s, y - s, bw, bw * 0.7);
    ctx.fillRect(x - s + s * 0.8, y - s, bw, bw * 0.7);
    ctx.fillRect(x + s - bw, y - s, bw, bw * 0.7);

    // Door
    ctx.fillRect(x - bw * 0.5, y, bw, s);

    ctx.shadowBlur = 0;
    ctx.shadowColor = 'transparent';

    // Label
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.fillText('HQ', x, y + s + 16);

    // Connection indicator dot below HQ label
    var connected = this._connected !== false;
    ctx.beginPath();
    ctx.arc(x, y + s + 26, 4, 0, Math.PI * 2);
    ctx.fillStyle = connected ? '#4ADE80' : '#EF4444';
    ctx.fill();

    ctx.restore();
  }

  // --- Drones ---

  _drawDrones(drones, time) {
    const ctx = this.ctx;
    const entries = Object.entries(drones || {});
    for (const [id, drone] of entries) {
      const px = drone.position.x * this.width;
      const bob = this.reducedMotion ? 0 : Math.sin(time * 0.001 + id.charCodeAt(0)) * 2;
      const py = drone.position.y * this.height + bob;

      ctx.save();

      // Triangle pointing up
      const w = 12;
      const h = 10;
      ctx.fillStyle = '#4ADE80';
      ctx.shadowColor = 'rgba(74, 222, 128, 0.6)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(px, py - h);
      ctx.lineTo(px - w, py + h);
      ctx.lineTo(px + w, py + h);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';

      // Label
      ctx.font = '500 9px "JetBrains Mono", monospace';
      ctx.fillStyle = '#4ADE80';
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.8;
      ctx.fillText(id, px, py + h + 14);
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  // --- Drone optical inter-links ---

  _drawDroneLinks(drones, time) {
    const ctx = this.ctx;
    const entries = Object.entries(drones || {});
    if (entries.length < 2) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(74, 222, 128, 0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);

    // Connect each drone to its nearest neighbors
    for (let i = 0; i < entries.length; i++) {
      const [, a] = entries[i];
      const ax = a.position.x * this.width;
      const ay = a.position.y * this.height;

      for (let j = i + 1; j < entries.length; j++) {
        const [, b] = entries[j];
        const bx = b.position.x * this.width;
        const by = b.position.y * this.height;

        // Animated pulse along the link
        const phase = (time * 0.0008 + i * 0.3 + j * 0.7) % 1;
        const px = ax + (bx - ax) * phase;
        const py = ay + (by - ay) * phase;

        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // Traveling dot (optical data)
        ctx.fillStyle = 'rgba(74, 222, 128, 0.5)';
        ctx.beginPath();
        ctx.arc(px, py, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  // --- Fiber tethers (drone → HQ) ---

  _drawFiberTethers(drones) {
    const ctx = this.ctx;
    const hqX = 80;
    const hqY = this.height - 80;
    const entries = Object.entries(drones || {});

    for (const [, drone] of entries) {
      const dx = drone.position.x * this.width;
      const dy = drone.position.y * this.height;

      const midX = (hqX + dx) / 2;
      const midY = (hqY + dy) / 2 - 30;

      const grad = ctx.createLinearGradient(hqX, hqY, dx, dy);
      grad.addColorStop(0, 'rgba(74, 222, 128, 0.0)');
      grad.addColorStop(0.2, 'rgba(74, 222, 128, 0.35)');
      grad.addColorStop(0.8, 'rgba(74, 222, 128, 0.35)');
      grad.addColorStop(1, 'rgba(74, 222, 128, 0.0)');

      ctx.save();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hqX, hqY);
      ctx.quadraticCurveTo(midX, midY, dx, dy);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Sync pulses ---

  _drawSyncPulses(cycle, drones, time) {
    if (!cycle || !drones) return;
    const ctx = this.ctx;
    const entries = Object.values(drones);
    if (entries.length === 0) return;

    // SYNC-alpha pulses
    if (cycle.phase === 'sync_alpha' && cycle.last_alpha_ts) {
      const elapsed = time - cycle.last_alpha_ts;
      if (elapsed > 0 && elapsed < 400) {
        for (const drone of entries) {
          const px = drone.position.x * this.width;
          const py = drone.position.y * this.height;
          const progress = Math.min(elapsed / 200, 1);
          const radius = Math.max(0.1, progress * 60);
          const alpha = (1 - progress) * 0.8;

          ctx.save();
          ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // SYNC-beta burst pulses
    if (cycle.phase === 'sync_beta_burst' && cycle.last_beta_ts) {
      const elapsed = time - cycle.last_beta_ts;
      if (elapsed > 0 && elapsed < 600) {
        for (const drone of entries) {
          const px = drone.position.x * this.width;
          const py = drone.position.y * this.height;
          const progress = Math.min(elapsed / 400, 1);
          const radius = Math.max(0.1, progress * 150);
          const alpha = (1 - progress) * 1.0;

          ctx.save();
          ctx.strokeStyle = `rgba(34, 211, 238, ${alpha})`;
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  // --- Transmission arcs ---

  _drawTransmissionArcs(transmissions, nodes, time) {
    if (!transmissions || !nodes) return;
    const ctx = this.ctx;
    const now = Date.now();

    for (let i = transmissions.length - 1; i >= 0; i--) {
      const tx = transmissions[i];
      if (now > tx.expires_at) {
        transmissions.splice(i, 1);
        continue;
      }

      const fromNode = nodes[tx.from];
      const toNode = nodes[tx.to];
      if (!fromNode || !toNode) continue;

      const x1 = fromNode.position.x * this.width;
      const y1 = fromNode.position.y * this.height;
      const x2 = toNode.position.x * this.width;
      const y2 = toNode.position.y * this.height;

      const duration = 50;
      const elapsed = duration - (tx.expires_at - now);
      const progress = Math.max(0, Math.min(elapsed / duration, 1));

      ctx.save();

      // Line
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      // Traveling dot
      const dotX = x1 + (x2 - x1) * progress;
      const dotY = y1 + (y2 - y1) * progress;
      ctx.fillStyle = '#22D3EE';
      ctx.shadowColor = 'rgba(34, 211, 238, 0.8)';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // --- Mesh hop-by-hop visualization ---

  _drawMeshHops(hops, time) {
    if (!hops || hops.length === 0) return;
    const ctx = this.ctx;
    const now = Date.now();

    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i];
      if (now > hop.expires_at) {
        hops.splice(i, 1);
        continue;
      }

      const x1 = hop.from.position.x * this.width;
      const y1 = hop.from.position.y * this.height;
      const x2 = hop.to.position.x * this.width;
      const y2 = hop.to.position.y * this.height;

      const age = now - hop.ts;
      const duration = 800;
      const progress = Math.min(1, age / duration);

      ctx.save();

      // Color based on hop type
      var color, glowColor;
      if (hop.isFiberHop) {
        color = '#4ADE80';
        glowColor = 'rgba(74, 222, 128, 0.8)';
      } else if (hop.isDroneHop) {
        color = '#4ADE80';
        glowColor = 'rgba(74, 222, 128, 0.6)';
      } else {
        color = '#FBBF24';
        glowColor = 'rgba(251, 191, 36, 0.6)';
      }

      // Trail line (fades in)
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress);
      ctx.stroke();

      // Traveling packet dot
      var dotX = x1 + (x2 - x1) * progress;
      var dotY = y1 + (y2 - y1) * progress;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.shadowColor = glowColor;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Message type label near the dot
      if (hop.msgType && progress < 0.8) {
        ctx.shadowBlur = 0;
        ctx.font = '500 7px "JetBrains Mono", monospace';
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.7;
        ctx.textAlign = 'center';
        ctx.fillText(hop.msgType, dotX, dotY - 8);
      }

      // Flash at destination when arriving
      if (progress > 0.9 && hop.final) {
        ctx.globalAlpha = 1 - (progress - 0.9) * 10;
        ctx.fillStyle = '#4ADE80';
        ctx.shadowColor = 'rgba(74, 222, 128, 0.8)';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(x2, y2, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // --- Nodes ---

  _drawNodes(nodes, time) {
    if (!nodes) return;
    const ctx = this.ctx;

    for (const [id, node] of Object.entries(nodes)) {
      const px = node.position.x * this.width;
      const py = node.position.y * this.height;
      const type = node.type || 'soldier';
      const nodeState = node.state || 'LISTENING';

      ctx.save();

      if (type === 'decoy') {
        // Gray dot, 8px diameter, no label
        ctx.fillStyle = '#475569';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'honeypot') {
        // Amber dot, 10px diameter, subtle pulse
        const pulse = this.reducedMotion ? 0 : Math.sin(time * 0.003) * 0.3;
        ctx.fillStyle = '#FBBF24';
        ctx.globalAlpha = 0.7 + pulse;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        // Real soldier — cyan dot, 12px diameter
        ctx.fillStyle = '#22D3EE';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();

        // Callsign label
        ctx.font = '400 10px "JetBrains Mono", monospace';
        ctx.fillStyle = 'rgba(34, 211, 238, 0.8)';
        ctx.textAlign = 'center';
        ctx.fillText(id, px, py + 16);
      }

      // Active ring (currently transmitting)
      if (nodeState === 'TX' || nodeState === 'RX') {
        ctx.strokeStyle = '#F8FAFC';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Jammed overlay
      if (nodeState === 'JAMMED') {
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 9, 0, Math.PI * 2);
        ctx.stroke();

        // Dim the node
        ctx.fillStyle = 'rgba(10, 14, 26, 0.5)';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }
  }

  // --- Jamming zones ---

  _drawJammingZones(zones, time) {
    if (!zones || zones.length === 0) return;
    const ctx = this.ctx;

    for (const zone of zones) {
      ctx.save();

      if (zone.polygon) {
        // Polygon-defined zone
        const points = zone.polygon.map(p => ({
          x: p.x * this.width,
          y: p.y * this.height,
        }));

        // Fill
        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y);
        }
        ctx.closePath();
        ctx.fill();

        // Dashed border
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        const offset = this.reducedMotion ? 0 : (time * 0.02) % 10;
        ctx.lineDashOffset = -offset;
        ctx.stroke();
        ctx.setLineDash([]);

        // Label at top of zone
        const minY = Math.min(...points.map(p => p.y));
        const avgX = points.reduce((s, p) => s + p.x, 0) / points.length;
        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#EF4444';
        ctx.textAlign = 'center';
        ctx.fillText('EW ZONE', avgX, minY - 8);
      } else if (zone.center && zone.radius) {
        // Circle-defined zone
        const cx = zone.center.x * this.width;
        const cy = zone.center.y * this.height;
        const r = zone.radius * Math.min(this.width, this.height);

        ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        const offset = this.reducedMotion ? 0 : (time * 0.02) % 10;
        ctx.lineDashOffset = -offset;
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.font = '600 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#EF4444';
        ctx.textAlign = 'center';
        ctx.fillText('EW ZONE', cx, cy - r - 8);
      }

      ctx.restore();
    }
  }

  // --- Alerts (honeypot triggered) ---

  _drawAlerts(alerts, nodes, time) {
    if (!alerts || alerts.length === 0) return;
    const ctx = this.ctx;
    const now = Date.now();

    for (let i = alerts.length - 1; i >= 0; i--) {
      const alert = alerts[i];
      if (now > alert.expires_at) {
        alerts.splice(i, 1);
        continue;
      }

      const node = nodes && nodes[alert.nodeId];
      if (!node) continue;

      const px = node.position.x * this.width;
      const py = node.position.y * this.height;
      const elapsed = now - (alert.expires_at - 5000);
      const totalDuration = 5000;

      ctx.save();

      // Flash: 3 cycles over 1.5s
      if (elapsed < 1500) {
        const flashPhase = (elapsed / 500) % 1;
        const isAmber = flashPhase < 0.5;
        ctx.fillStyle = isAmber ? '#FBBF24' : '#EF4444';
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Radial pulse
      if (elapsed < 2000) {
        const progress = elapsed / 2000;
        const radius = progress * 80;
        const alpha = (1 - progress) * 0.6;
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Caption
      if (alert.caption && elapsed < totalDuration) {
        const fadeOut = elapsed > 4000 ? 1 - (elapsed - 4000) / 1000 : 1;
        ctx.globalAlpha = Math.max(0, fadeOut);
        ctx.font = '500 11px "JetBrains Mono", monospace';
        ctx.fillStyle = '#FBBF24';
        ctx.textAlign = 'center';
        ctx.fillText(alert.caption, px, py - 18);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }
  }
}
