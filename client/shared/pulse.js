'use strict';

/**
 * System Pulse — scrolling activity graph for Tactical Mesh.
 * Renders a horizontal ECG-style timeline of system events.
 * Each event type gets a distinct color. The graph scrolls
 * left continuously, drawing dots and spikes as events arrive.
 *
 * Usage:
 *   var pulse = new SystemPulse(canvasElement, { height: 60 });
 *   pulse.push('honeypot', 0.8);   // type, intensity 0-1
 *   pulse.push('ai_decision', 0.6);
 *   // call pulse.render() in your animation loop, or it self-animates
 */

function SystemPulse(canvas, opts) {
  opts = opts || {};
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.height = opts.height || 60;
  this.scrollSpeed = opts.scrollSpeed || 40; // pixels per second
  this.maxAge = opts.maxAge || 30000; // keep 30s of history
  this.events = [];
  this.baselineY = this.height * 0.65;
  this._lastFrame = 0;
  this._animId = null;

  this.colors = {
    honeypot:       '#FBBF24',
    ai_decision:    '#22D3EE',
    jamming:        '#EF4444',
    alert:          '#EF4444',
    node_join:      '#4ADE80',
    node_leave:     '#475569',
    scenario:       '#22D3EE',
    deception:      '#FBBF24',
    routing:        '#4ADE80',
    cycle:          'rgba(34, 211, 238, 0.15)',
    demo:           '#22D3EE',
    burst:          'rgba(74, 222, 128, 0.1)',
    default:        '#64748B',
  };

  this._resize();
  this._startLoop();

  var self = this;
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { self._resize(); }, 100);
  });
}

SystemPulse.prototype._resize = function () {
  var rect = this.canvas.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  var w = Math.round(rect.width);
  var h = Math.round(rect.height) || this.height;
  this.canvas.width = w * dpr;
  this.canvas.height = h * dpr;
  this.width = w;
  this.height = h;
  this.dpr = dpr;
  this.baselineY = h * 0.65;
};

SystemPulse.prototype.push = function (type, intensity) {
  this.events.push({
    type: type || 'default',
    intensity: Math.min(1, Math.max(0.1, intensity || 0.5)),
    ts: Date.now(),
  });

  // Trim events that have scrolled off the left edge
  var maxVisibleMs = (this.width / this.scrollSpeed) * 1000 + 2000;
  var cutoff = Date.now() - maxVisibleMs;
  while (this.events.length > 0 && this.events[0].ts < cutoff) {
    this.events.shift();
  }
};

SystemPulse.prototype._startLoop = function () {
  var self = this;
  function frame(now) {
    self._renderFrame(now);
    self._animId = requestAnimationFrame(frame);
  }
  this._animId = requestAnimationFrame(frame);
};

SystemPulse.prototype.destroy = function () {
  if (this._animId) cancelAnimationFrame(this._animId);
};

SystemPulse.prototype._renderFrame = function (now) {
  if (!this._lastFrame) this._lastFrame = now;
  var ctx = this.ctx;
  var w = this.width;
  var h = this.height;
  var dpr = this.dpr;

  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Clear
  ctx.fillStyle = '#0A0E1A';
  ctx.fillRect(0, 0, w, h);

  // Subtle grid lines
  ctx.strokeStyle = 'rgba(42, 52, 71, 0.3)';
  ctx.lineWidth = 0.5;
  for (var gx = 0; gx < w; gx += 60) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }

  // Baseline
  var by = this.baselineY;
  ctx.strokeStyle = 'rgba(42, 52, 71, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, by);
  ctx.lineTo(w, by);
  ctx.stroke();

  // Map events to x positions (right edge = now, scrolls left)
  var nowMs = Date.now();
  var pxPerMs = this.scrollSpeed / 1000;

  // Draw baseline pulse (subtle sine wave)
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var px = 0; px < w; px += 2) {
    var t = nowMs - (w - px) / pxPerMs;
    var sine = Math.sin(t / 200) * 2;
    if (px === 0) ctx.moveTo(px, by + sine);
    else ctx.lineTo(px, by + sine);
  }
  ctx.stroke();

  // Draw events
  for (var i = 0; i < this.events.length; i++) {
    var ev = this.events[i];
    var age = nowMs - ev.ts;
    var x = w - (age * pxPerMs);

    if (x < -10 || x > w + 10) continue;

    var color = this.colors[ev.type] || this.colors.default;
    var spikeH = ev.intensity * (h * 0.5);

    // Spike line
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x, by - spikeH);
    ctx.stroke();

    // Dot at peak
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, by - spikeH, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Small downward tick after spike (ECG style)
    ctx.beginPath();
    ctx.moveTo(x, by);
    ctx.lineTo(x + 2, by + spikeH * 0.15);
    ctx.lineTo(x + 4, by);
    ctx.stroke();
  }

  // Right edge bright line (current moment)
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(w - 1, 0);
  ctx.lineTo(w - 1, h);
  ctx.stroke();

  ctx.restore();
};
