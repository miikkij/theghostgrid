# Task 07 — Audience Phone Client + Landing

You are building the **Audience Phone Client** and the **Landing Page**: the two browser-facing pieces of the audience experience. Phone client is the mobile-first node UI that audience members get when they scan the QR code. Landing is the root page (`/`) that displays the QR and acts as system entry.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — sections "Component H: Audience Phone Client" and "Component I: Landing / Index Page"
3. Read `docs/10-ui-design.md` — full sections on Audience Phone Client `/phone` and Landing Page `/`
4. Read `docs/08-demo-and-pitch.md` — understand the demo flow; phones vibrate at specific moments

## Your scope

You own these files:

```
client/phone/index.html
client/phone/style.css
client/phone/script.js
client/phone/README.md
client/landing/index.html
client/landing/style.css
client/landing/script.js
client/landing/README.md
```

You do NOT own anything outside `client/phone/` and `client/landing/`.

## Prerequisites

- Server Core operational, serving `/phone` and `/` routes
- `client/shared/design-system.css` and `client/shared/connection.js` (from Big Screen task)
- WebSocket connection works

If shared files aren't ready, develop standalone and integrate later.

## What this component does

### Phone Client

When an audience member scans the QR code, they land on `/phone`. They see:

1. **Landing animation** (first 2-3 seconds): "Connecting to the mesh..."
2. **Active node screen**: their callsign, role, current state, neighbors, recent events
3. **Alert overlay**: full-screen takeover when honeypot triggers an alert in their area

The phone client must:
- Look beautiful (this is what most people see; first impressions matter)
- Provide haptic feedback (vibrate during burst transmissions, strongly on alerts)
- Keep screen awake during the demo
- Handle 50+ concurrent connections from the server
- Reconnect gracefully if connection drops

### Landing Page

The root URL of the system. What partners and judges see when navigating to the system directly. Shows:

- Project name with hero treatment
- The sync beacon as the headline insight
- QR code (auto-generated, pointing to `/phone`)
- Links to other interfaces
- Brief explanation of the four pillars

## Phone Client detailed requirements

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
  <meta name="theme-color" content="#0A0E1A">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Tactical Mesh Node</title>
  <link rel="stylesheet" href="/shared/design-system.css">
  <link rel="stylesheet" href="/phone/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body>
  <!-- State 1: Landing animation -->
  <div id="landing" class="screen visible">
    <div class="landing-content">
      <div class="mesh-animation">
        <!-- Animated mesh visualization (SVG or CSS-only) -->
        <svg viewBox="0 0 200 200" class="mesh-svg">
          <!-- Particle/network animation -->
        </svg>
      </div>
      <h1 class="landing-title">TACTICAL MESH</h1>
      <p class="landing-subtitle">Connecting you to the network...</p>
      <div class="connection-pulse"></div>
    </div>
  </div>
  
  <!-- State 2: Active node -->
  <div id="active-node" class="screen hidden">
    <header class="node-header">
      <div class="callsign" data-callsign>ALPHA-7</div>
      <div class="role-badge" data-role>RECON</div>
    </header>
    
    <section class="state-display">
      <div class="state-indicator" data-state="listening">
        <div class="state-ring"></div>
        <div class="state-label">LISTENING</div>
      </div>
      <div class="countdown">
        <span class="countdown-label">Next burst</span>
        <span class="countdown-value" data-countdown>0.4s</span>
      </div>
    </section>
    
    <section class="neighbors">
      <h3>NEIGHBORS</h3>
      <ul class="neighbors-list">
        <!-- Populated by JS -->
      </ul>
    </section>
    
    <section class="recent-events">
      <h3>RECENT</h3>
      <ul class="events-list">
        <!-- Populated by JS -->
      </ul>
    </section>
    
    <footer class="connection-footer">
      <span class="connection-dot" data-connection-status></span>
      <span class="connection-label" data-connection-label>Connected</span>
    </footer>
  </div>
  
  <!-- State 3: Alert overlay -->
  <div id="alert-overlay" class="screen alert hidden">
    <div class="alert-content">
      <div class="alert-icon">⚠</div>
      <h1 class="alert-title">ALERT</h1>
      <p class="alert-message" data-alert-message>ARTILLERY INCOMING</p>
      <p class="alert-meta" data-alert-meta>Estimated impact 28-45 seconds</p>
      <p class="alert-action">TAKE COVER</p>
      <div class="alert-countdown" data-alert-countdown>30</div>
    </div>
  </div>
  
  <script src="/socket.io/socket.io.js"></script>
  <script type="module" src="/phone/script.js"></script>
</body>
</html>
```

### style.css

Implement mobile-first design. Key principles:

- Full viewport (no scrolling on main view)
- Touch-friendly tap targets (44×44px minimum)
- Large readable text (state indicator at least 2rem)
- Smooth state transitions (300ms ease)
- Use safe-area-inset for notched devices

```css
@import url('/shared/design-system.css');

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--bg-deep);
}

body {
  display: flex;
  flex-direction: column;
}

.screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
  transition: opacity 300ms var(--ease-default), transform 300ms var(--ease-default);
}

.screen.hidden {
  opacity: 0;
  pointer-events: none;
  transform: scale(0.98);
}

.screen.visible {
  opacity: 1;
  transform: scale(1.0);
}

/* Landing screen */
#landing {
  align-items: center;
  justify-content: center;
  text-align: center;
}

.landing-title {
  font-size: 2.5rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin: var(--space-4) 0 var(--space-2);
  color: var(--text-bright);
}

.landing-subtitle {
  color: var(--text-secondary);
  font-size: 1rem;
}

.mesh-animation {
  width: 200px;
  height: 200px;
}

.connection-pulse {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  border: 2px solid var(--accent-cyan);
  margin: var(--space-4) auto;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.8; }
  50% { transform: scale(1.2); opacity: 0.3; }
}

/* Active node screen */
#active-node {
  padding: var(--space-3);
  gap: var(--space-3);
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--border-default);
}

.callsign {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: var(--accent-cyan);
}

.role-badge {
  padding: var(--space-1) var(--space-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border-default);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.state-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
}

.state-indicator {
  width: 200px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  margin-bottom: var(--space-3);
}

.state-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 3px solid var(--accent-cyan);
  transition: border-color 300ms;
}

.state-indicator[data-state="listening"] .state-ring {
  border-color: var(--accent-cyan);
  animation: subtle-pulse 2s ease-in-out infinite;
}

.state-indicator[data-state="sync"] .state-ring {
  border-color: var(--accent-cyan);
  box-shadow: 0 0 30px var(--accent-cyan);
  animation: bright-pulse 0.5s ease-out;
}

.state-indicator[data-state="tx"] .state-ring {
  border-color: var(--accent-amber);
  box-shadow: 0 0 20px var(--accent-amber);
}

.state-indicator[data-state="rx"] .state-ring {
  border-color: var(--accent-green);
}

.state-indicator[data-state="jammed"] .state-ring {
  border-color: var(--accent-red);
  animation: shake 0.5s ease-in-out infinite;
}

.state-indicator[data-state="dead"] .state-ring {
  border-color: var(--accent-gray);
  opacity: 0.5;
}

.state-label {
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-bright);
  letter-spacing: 0.1em;
}

.countdown {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.countdown-label {
  font-size: 0.875rem;
  color: var(--text-muted);
}

.countdown-value {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  color: var(--text-primary);
}

@keyframes subtle-pulse {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1.0; }
}

@keyframes bright-pulse {
  0% { box-shadow: 0 0 30px var(--accent-cyan); transform: scale(1.05); }
  100% { box-shadow: 0 0 0px var(--accent-cyan); transform: scale(1); }
}

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-3px); }
  75% { transform: translateX(3px); }
}

/* Neighbors and events */
.neighbors, .recent-events {
  background: var(--bg-panel);
  border-radius: 8px;
  padding: var(--space-2) var(--space-3);
}

.neighbors h3, .recent-events h3 {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.1em;
  margin: 0 0 var(--space-2);
}

.neighbors-list, .events-list {
  list-style: none;
  margin: 0;
  padding: 0;
  font-family: var(--font-mono);
  font-size: 0.875rem;
}

.neighbors-list li, .events-list li {
  padding: var(--space-1) 0;
  color: var(--text-primary);
}

.events-list li .event-time {
  color: var(--text-muted);
  margin-right: var(--space-2);
}

.events-list li .event-direction {
  color: var(--accent-cyan);
  margin-right: var(--space-2);
}

/* Connection footer */
.connection-footer {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-top: var(--space-2);
  font-size: 0.75rem;
  color: var(--text-muted);
}

.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent-green);
}

.connection-dot[data-status="disconnected"] {
  background: var(--accent-red);
}

/* Alert overlay */
#alert-overlay {
  background: var(--accent-red);
  color: white;
  z-index: 1000;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.alert-content {
  padding: var(--space-5);
}

.alert-icon {
  font-size: 5rem;
  margin-bottom: var(--space-3);
}

.alert-title {
  font-size: 3rem;
  font-weight: 700;
  margin: 0 0 var(--space-3);
  letter-spacing: 0.1em;
}

.alert-message {
  font-size: 1.5rem;
  font-weight: 600;
  margin: var(--space-2) 0;
}

.alert-meta {
  font-size: 1rem;
  opacity: 0.9;
  margin: var(--space-3) 0;
}

.alert-action {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  margin: var(--space-4) 0;
}

.alert-countdown {
  font-family: var(--font-mono);
  font-size: 4rem;
  font-weight: 700;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### script.js

The phone client logic. Manages state machine, WebSocket subscriptions, haptic feedback, wake lock.

```javascript
const socket = io({ query: { role: 'phone' } });

// Local node state
const node = {
  callsign: null,
  role: null,
  state: 'listening',
  neighbors: [],
  recent_events: [],
  area: null,  // for alert filtering
};

// Wake lock to keep screen awake
let wakeLock = null;
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    console.warn('Wake lock not available:', e);
  }
}
requestWakeLock();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !wakeLock) requestWakeLock();
});

// Haptic feedback helpers
function vibrate(pattern) {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

const HAPTIC = {
  SYNC: 20,
  TX: [10, 20, 10],
  RX: 10,
  JAMMING: [50, 50, 50, 50, 50],
  ALERT: [100, 50, 100, 50, 100, 50, 200],
};

// State machine
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('visible');
    s.classList.add('hidden');
  });
  const target = document.getElementById(screenId);
  target.classList.remove('hidden');
  target.classList.add('visible');
}

// Handle node assignment from server
socket.on('phone.assigned', (data) => {
  node.callsign = data.callsign;
  node.role = data.role;
  node.area = data.area;
  
  document.querySelector('[data-callsign]').textContent = data.callsign;
  document.querySelector('[data-role]').textContent = data.role;
  
  // Transition from landing to active node screen
  setTimeout(() => showScreen('active-node'), 2000);
});

// State updates
socket.on('phone.state_change', (data) => {
  node.state = data.state;
  const indicator = document.querySelector('.state-indicator');
  indicator.dataset.state = data.state;
  document.querySelector('.state-label').textContent = data.state.toUpperCase();
  
  // Haptic feedback
  if (data.state === 'sync') vibrate(HAPTIC.SYNC);
  if (data.state === 'tx') vibrate(HAPTIC.TX);
  if (data.state === 'rx') vibrate(HAPTIC.RX);
  if (data.state === 'jammed') vibrate(HAPTIC.JAMMING);
});

// Cycle countdown
socket.on('cycle_tick', (data) => {
  // Compute time until next sync_beta based on cycle period and current phase
  const msUntilBurst = computeMsUntilBurst(data);
  document.querySelector('[data-countdown]').textContent = (msUntilBurst / 1000).toFixed(1) + 's';
});

// Neighbor updates
socket.on('phone.neighbors', (data) => {
  node.neighbors = data.neighbors;
  renderNeighbors();
});

function renderNeighbors() {
  const list = document.querySelector('.neighbors-list');
  list.innerHTML = node.neighbors.slice(0, 5).map(n => `<li>${n}</li>`).join('');
}

// Recent events
socket.on('phone.event', (event) => {
  node.recent_events.unshift(event);
  if (node.recent_events.length > 3) node.recent_events.length = 3;
  renderEvents();
});

function renderEvents() {
  const list = document.querySelector('.events-list');
  list.innerHTML = node.recent_events.map(e => `
    <li>
      <span class="event-time">${formatTime(e.ts)}</span>
      <span class="event-direction">${e.direction === 'out' ? '↑' : '↓'}</span>
      <span>${e.partner || ''}</span>
    </li>
  `).join('');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 5);
}

// Alerts (honeypot warnings, etc.)
socket.on('alert', (alert) => {
  // Check if this alert applies to us based on area
  if (!alertAppliesToUs(alert, node.area)) return;
  
  showAlert(alert);
  vibrate(HAPTIC.ALERT);
});

function showAlert(alert) {
  document.querySelector('[data-alert-message]').textContent = alert.message || 'ALERT';
  document.querySelector('[data-alert-meta]').textContent = alert.meta || '';
  
  let timeLeft = alert.duration_seconds || 30;
  document.querySelector('[data-alert-countdown]').textContent = timeLeft;
  
  showScreen('alert-overlay');
  
  const interval = setInterval(() => {
    timeLeft--;
    document.querySelector('[data-alert-countdown]').textContent = timeLeft;
    if (timeLeft <= 0) {
      clearInterval(interval);
      showScreen('active-node');
    }
  }, 1000);
}

function alertAppliesToUs(alert, ourArea) {
  if (!alert.affected_area || !ourArea) return true;  // assume all phones get it
  const dx = ourArea.x - alert.affected_area.center.x;
  const dy = ourArea.y - alert.affected_area.center.y;
  return Math.sqrt(dx * dx + dy * dy) < alert.affected_area.radius;
}

// Connection status
socket.on('connect', () => {
  document.querySelector('[data-connection-status]').dataset.status = 'connected';
  document.querySelector('[data-connection-label]').textContent = 'Connected';
});

socket.on('disconnect', () => {
  document.querySelector('[data-connection-status]').dataset.status = 'disconnected';
  document.querySelector('[data-connection-label]').textContent = 'Reconnecting...';
});

function computeMsUntilBurst(cycle) {
  // Calculate based on cycle phase
  const now = Date.now();
  const nextBetaTs = cycle.last_alpha_ts + (cycle.sync_beta_offset_ms || 215);
  return Math.max(0, nextBetaTs - now);
}
```

## Landing Page detailed requirements

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tactical Mesh — Drone-Coordinated Resilient Communications</title>
  <link rel="stylesheet" href="/shared/design-system.css">
  <link rel="stylesheet" href="/landing/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <main class="landing-page">
    <section class="hero">
      <div class="hero-content">
        <h1 class="project-name">TACTICAL MESH</h1>
        <p class="tagline">Drone-Coordinated Resilient Communications</p>
        <hr class="divider">
        <p class="anchor-statement">
          The architecture is anchored in a sync beacon you cannot jam.
          Everything else is built on that.
        </p>
      </div>
      
      <div class="hero-visual">
        <svg viewBox="0 0 400 400" class="sync-beacon-visual">
          <!-- Animated sync beacon: drone with fiber tether, sync pulse radiating -->
        </svg>
      </div>
    </section>
    
    <section class="cta">
      <div class="qr-section">
        <div class="qr-container">
          <div id="qr-code" class="qr-code">
            <!-- QR code generated by JS -->
          </div>
          <p class="qr-label">Scan to join the mesh</p>
        </div>
      </div>
      
      <div class="links">
        <a href="/phone" class="link-button primary">Connect as Node</a>
        <a href="/screen" class="link-button">View Operator Screen</a>
        <a href="/ops" class="link-button">View Dashboard</a>
      </div>
    </section>
    
    <section class="pillars">
      <h2>FOUR PILLARS</h2>
      <div class="pillars-grid">
        <article class="pillar">
          <h3>Sync Beacon</h3>
          <p>Fiber-tethered drone provides time discipline that cannot be reached by enemy EW.</p>
        </article>
        <article class="pillar">
          <h3>Burst Mesh</h3>
          <p>Sub-50ms transmission windows under cover signal, frequency-hopped across the band.</p>
        </article>
        <article class="pillar">
          <h3>Statistical Deception</h3>
          <p>Cheap decoy emitters indistinguishable from real soldiers at the protocol level.</p>
        </article>
        <article class="pillar">
          <h3>Adaptive AI</h3>
          <p>Air-gappable, audit-first, ROE-bound AI loop that learns from observed enemy reactions.</p>
        </article>
      </div>
    </section>
    
    <footer>
      <p>Junction × Aalto Defence Hackathon 2026 — Tactical Mesh challenge by Kova Labs</p>
    </footer>
  </main>
  
  <script type="module" src="/landing/script.js"></script>
</body>
</html>
```

### style.css

```css
@import url('/shared/design-system.css');

body {
  min-height: 100vh;
  font-family: var(--font-sans);
  color: var(--text-primary);
}

.landing-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-6) var(--space-4);
}

.hero {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  margin-bottom: var(--space-7);
  min-height: 60vh;
  align-items: center;
}

@media (max-width: 768px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

.project-name {
  font-size: 3.5rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  margin: 0 0 var(--space-2);
  color: var(--text-bright);
}

.tagline {
  font-size: 1.25rem;
  color: var(--text-secondary);
  margin: 0 0 var(--space-4);
}

.divider {
  border: none;
  border-top: 1px solid var(--border-default);
  margin: var(--space-4) 0;
  width: 80px;
}

.anchor-statement {
  font-size: 1.5rem;
  line-height: 1.5;
  color: var(--text-primary);
  max-width: 500px;
}

.sync-beacon-visual {
  width: 100%;
  max-width: 400px;
}

.cta {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: var(--space-5);
  align-items: center;
  padding: var(--space-5);
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: 12px;
  margin-bottom: var(--space-7);
}

@media (max-width: 768px) {
  .cta {
    grid-template-columns: 1fr;
  }
}

.qr-code {
  width: 200px;
  height: 200px;
  background: white;
  border-radius: 8px;
  padding: var(--space-2);
}

.qr-label {
  text-align: center;
  color: var(--text-secondary);
  margin-top: var(--space-2);
}

.links {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.link-button {
  display: block;
  padding: var(--space-3) var(--space-4);
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  text-decoration: none;
  font-weight: 500;
  text-align: center;
  transition: all 150ms var(--ease-default);
}

.link-button:hover {
  background: var(--bg-panel);
  border-color: var(--accent-cyan);
}

.link-button.primary {
  background: var(--accent-cyan);
  color: var(--bg-deep);
  font-weight: 600;
  border-color: var(--accent-cyan);
}

.link-button.primary:hover {
  background: var(--text-bright);
}

.pillars {
  margin-bottom: var(--space-7);
}

.pillars h2 {
  font-size: 1rem;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  margin-bottom: var(--space-4);
}

.pillars-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: var(--space-4);
}

.pillar {
  background: var(--bg-panel);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  padding: var(--space-4);
}

.pillar h3 {
  margin: 0 0 var(--space-2);
  color: var(--accent-cyan);
  font-size: 1.125rem;
}

.pillar p {
  margin: 0;
  color: var(--text-secondary);
  line-height: 1.6;
}

footer {
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
  padding-top: var(--space-5);
  border-top: 1px solid var(--border-default);
}
```

### script.js

Mainly generates the QR code and animates the sync beacon visual.

```javascript
import QRCode from 'https://cdn.skypack.dev/qrcode';

const phoneURL = `${window.location.origin}/phone`;

QRCode.toCanvas(document.getElementById('qr-code'), phoneURL, {
  width: 200,
  margin: 1,
  color: {
    dark: '#0A0E1A',
    light: '#FFFFFF',
  },
}, (error) => {
  if (error) console.error('QR generation failed:', error);
});

// Animate the sync beacon visual
const svg = document.querySelector('.sync-beacon-visual');
if (svg) {
  // Draw drone, fiber, sync pulses, ground nodes
  svg.innerHTML = `
    <defs>
      <linearGradient id="fiber-grad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#4ADE80" stop-opacity="0"/>
        <stop offset="100%" stop-color="#4ADE80" stop-opacity="0.6"/>
      </linearGradient>
    </defs>
    
    <!-- Sync pulses (animated) -->
    <circle cx="200" cy="100" r="20" fill="none" stroke="#22D3EE" stroke-width="2" opacity="0.8">
      <animate attributeName="r" from="20" to="180" dur="2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" from="0.8" to="0" dur="2s" repeatCount="indefinite"/>
    </circle>
    
    <circle cx="200" cy="100" r="20" fill="none" stroke="#22D3EE" stroke-width="2" opacity="0.8">
      <animate attributeName="r" from="20" to="180" dur="2s" begin="1s" repeatCount="indefinite"/>
      <animate attributeName="opacity" from="0.8" to="0" dur="2s" begin="1s" repeatCount="indefinite"/>
    </circle>
    
    <!-- Drone -->
    <polygon points="200,80 188,108 212,108" fill="#4ADE80"/>
    
    <!-- Fiber tether -->
    <line x1="200" y1="108" x2="50" y2="380" stroke="url(#fiber-grad)" stroke-width="2"/>
    
    <!-- HQ -->
    <rect x="30" y="370" width="40" height="20" fill="#F8FAFC"/>
    <text x="50" y="395" text-anchor="middle" font-family="JetBrains Mono" font-size="10" fill="#F8FAFC">HQ</text>
    
    <!-- Ground nodes -->
    <circle cx="100" cy="320" r="6" fill="#22D3EE"/>
    <circle cx="160" cy="340" r="6" fill="#22D3EE"/>
    <circle cx="220" cy="335" r="6" fill="#22D3EE"/>
    <circle cx="280" cy="320" r="6" fill="#22D3EE"/>
    <circle cx="340" cy="345" r="6" fill="#22D3EE"/>
    
    <!-- Decoy nodes (smaller, gray) -->
    <circle cx="130" cy="280" r="4" fill="#475569"/>
    <circle cx="180" cy="290" r="4" fill="#475569"/>
    <circle cx="240" cy="285" r="4" fill="#475569"/>
    <circle cx="290" cy="295" r="4" fill="#475569"/>
    <circle cx="340" cy="290" r="4" fill="#475569"/>
  `;
}
```

## Phone client behavioral details

### Vibration patterns

| Event | Pattern (ms) |
|---|---|
| Sync received | `20` (single short) |
| Transmission | `[10, 20, 10]` (double tap) |
| Receive packet | `10` (single very short) |
| Jamming detected | `[50, 50, 50, 50, 50]` (rapid pulses) |
| Alert (honeypot) | `[100, 50, 100, 50, 100, 50, 200]` (alarm-like) |

### Performance targets

- First paint < 500ms on 4G
- Total page weight < 100KB (excluding fonts CDN)
- No layout shift after initial render
- 60 FPS animations (use will-change carefully)

### Browser support

- iOS Safari 14+
- Android Chrome 90+
- Test on actual devices, not just emulators

## Testing

Manual test checklist:

**Phone client:**
- Loads on `/phone` route
- Landing animation plays for 2-3 seconds
- Transitions to active node screen
- Receives callsign and role assignment
- State changes update visual indicator (test with mock events)
- Countdown updates correctly
- Vibration triggers on relevant events (iOS may need user gesture first)
- Alert overlay appears on alert event, vibrates, counts down, dismisses
- Connection lost shows disconnected indicator
- Wake lock prevents screen lock
- Works on 320px width up to 414px

**Landing page:**
- Loads on `/` route
- QR code generates and is scannable
- Sync beacon visual animates
- All links work
- Mobile responsive
- Looks professional

## Acceptance criteria

You are done when:

- Phone client loads in under 1 second on real mobile
- All three state screens render correctly
- WebSocket integration works (state changes flow from server to UI)
- Vibration works on Android, iOS (after user interaction)
- Alert overlay renders dramatically and dismisses correctly
- Landing page is beautiful and professional
- QR code generates correctly and resolves to `/phone`
- Sync beacon visual animates smoothly
- All design system colors and fonts used consistently
- READMEs exist documenting each
- `DECISIONS.md` updated

## Hand-off

When complete, audience members scanning the QR get a beautiful, responsive, haptic-feedback-providing UI. Partners visiting the system URL get a polished landing page that reads as serious defense-tech work. This is the second-most-photographable surface after the big screen.

The phone client and landing page are the public face of the system. Make them look excellent.
