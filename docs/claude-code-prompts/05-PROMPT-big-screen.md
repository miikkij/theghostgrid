# Task 05 — Big Screen Visualization

You are building the **Big Screen** component: a Canvas-based visualization rendering the live mesh state on a large operator display.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component F: Big Screen Visualization"
3. Read `docs/10-ui-design.md` — full section on Big Screen `/screen`
4. Skim `docs/04-design-deception.md` so you understand what wave patterns look like
5. Skim `docs/05-design-ai-hq-brain.md` so you know what reasoning traces contain

## Your scope

You own these files:

```
client/screen/index.html
client/screen/style.css
client/screen/script.js
client/screen/render.js
client/screen/README.md
client/shared/design-system.css   (you create; other UIs will use it too)
client/shared/connection.js       (you create; other UIs will use it too)
```

You do NOT own anything outside `client/screen/` and `client/shared/`.

## Prerequisites

- Server Core (Component A) must be operational and serving `/screen` route
- WebSocket connection at the documented event protocol works
- Other UI components will share your `client/shared/*` files; design them with that in mind

If Server Core isn't built yet, mock its WebSocket emissions in `script.js` for local development.

## What this component does

A full-screen, real-time visualization that operators and audiences watch during the demo. It must render at 60 FPS, look like a professional defense-tech operator display, and respond instantly to state changes from the server.

This is the main visual artifact of the demo. People will photograph it for social media. It must look excellent.

## Detailed requirements

### Layout overview

Refer to `docs/10-ui-design.md` for the layout diagram. Key elements:

- **Background**: dark base (#0A0E1A) with subtle grid overlay
- **Top-left**: cycle/timer indicator
- **Top-right**: telemetry panel
- **Main canvas**: the battlefield view (nodes, drones, transmissions, jamming)
- **Bottom-left**: AI reasoning panel (slides in when AI is active)
- **HQ icon**: in a corner (bottom-left or top-right)

### index.html

Single page with full-screen canvas and HTML overlay panels:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tactical Mesh — Operator Display</title>
  <link rel="stylesheet" href="/shared/design-system.css">
  <link rel="stylesheet" href="/screen/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <div id="app">
    <canvas id="battlefield"></canvas>
    
    <div id="cycle-indicator" class="overlay-panel top-left">
      <div class="utc-time">--:--:--</div>
      <div class="cycle-number">Cycle: <span data-cycle>0</span></div>
      <div class="cycle-progress"><div class="bar"></div></div>
    </div>
    
    <div id="telemetry" class="overlay-panel top-right">
      <div class="row"><span class="label">Packets</span><span class="value" data-packets>0</span></div>
      <div class="row"><span class="label">Drift</span><span class="value" data-drift>0ms</span></div>
      <div class="row"><span class="label">Nodes</span><span class="value" data-nodes>0</span></div>
      <div class="row"><span class="label">Decoys</span><span class="value" data-decoys>0</span></div>
      <div class="row"><span class="label">AI</span><span class="value" data-ai-status>STANDBY</span></div>
    </div>
    
    <div id="ai-reasoning" class="overlay-panel bottom-left hidden">
      <h3>AI REASONING</h3>
      <div id="reasoning-content"></div>
    </div>
    
    <div id="connection-indicator" class="status-dot"></div>
  </div>
  
  <script type="module" src="/shared/connection.js"></script>
  <script type="module" src="/screen/script.js"></script>
</body>
</html>
```

### style.css

Implement the visual style from `docs/10-ui-design.md`. Key points:

- Full viewport: `body { margin: 0; overflow: hidden; background: var(--bg-deep); }`
- Canvas: `position: absolute; inset: 0; width: 100%; height: 100%;`
- Overlay panels: positioned absolutely, semi-transparent backgrounds with backdrop-filter blur
- Use CSS variables from `client/shared/design-system.css`
- Smooth fade-in transitions for panels that appear/disappear
- AI reasoning panel: slides in from left with `transform: translateX(...)` transition

### render.js

Pure rendering module. Takes state, draws to canvas. No DOM manipulation, no WebSocket logic.

```javascript
export class BattlefieldRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
    this.width = width;
    this.height = height;
  }

  /**
   * Render one frame from the current state.
   * Called from requestAnimationFrame loop in script.js.
   */
  render(state, time) {
    this.clear();
    this.drawGrid();
    this.drawJammingZones(state.jamming_zones);
    this.drawHQ();
    this.drawDrones(state.drones, time);
    this.drawSyncPulses(state.cycle, time);      // active during sync_alpha / sync_beta
    this.drawTransmissionArcs(state.active_transmissions, time);
    this.drawNodes(state.nodes);
    this.drawAlerts(state.active_alerts, time);
  }

  // Each draw method handles one layer.
  // Document each clearly. Use canvas state save/restore between them.
}
```

#### Drawing details

**Grid**:
- 50px spacing, 1px lines
- Color: `rgba(42, 52, 71, 0.3)` (subtle)

**HQ icon**:
- Bottom-left corner, 36px size
- A simple castle/building SVG or canvas-drawn shape
- White color with subtle glow (use `shadowBlur` and `shadowColor`)
- Label "HQ" in monospace below

**Drones**:
- Triangle, 24px wide, 20px tall, pointing up
- Color: `var(--accent-green)` (#4ADE80)
- Animated subtle bob: `y += sin(time * 0.001) * 2`
- Fiber tether: thin (1px) line from drone to HQ, slight bezier curve
- Tether color: `rgba(74, 222, 128, 0.4)` fading to transparent at endpoints

**Sync pulses**:
- During SYNC-α (cycle phase 'sync_alpha'): draw expanding ring from each drone
  - 3px stroke, cyan (`#22D3EE`), opacity fades from 0.8 to 0 over 200ms
  - Radius grows from 0 to 60px
- During SYNC-β (cycle phase 'sync_beta_burst'): bigger, slower pulse
  - 8px stroke, brighter cyan, opacity 1.0 to 0 over 400ms
  - Radius grows from 0 to 150px
- Multiple pulses can overlap

**Transmission arcs**:
- Thin line (2px) between transmitting node and its destination
- Color: cyan, 0.6 opacity
- Animated: a small dot travels from source to destination over 50ms
- Arc disappears after dot reaches destination

**Nodes**:
- Real soldier: 12px circle, cyan (`#22D3EE`), with callsign label below in monospace 10px
- Decoy: 8px circle, gray (`#475569`), no label
- Honeypot: 10px circle, amber (`#FBBF24`), with subtle pulse animation
- Active node (currently transmitting): white ring around the dot (1px stroke, 14px radius)
- Jammed node: red ring + faded color
- Position: convert from state's normalized (0..1) coords to canvas pixels

**Jamming zones**:
- Polygon overlay, semi-transparent red (`rgba(239, 68, 68, 0.2)`)
- Dashed red border (2px stroke, dash pattern [5, 5])
- Animated: dash offset shifts over time for "live" feel
- Label: "EW ZONE" in red, top of zone

**Alerts (honeypot triggered)**:
- Honeypot node flashes amber → red → amber 3 times over 1.5s
- Radial pulse outward from honeypot location (similar to sync pulse but red)
- Text caption appears at honeypot: e.g., "HP-23 ACOUSTIC | ARTILLERY | DoA 287°"
- Caption fades out after 5s

### script.js

Orchestrates everything: connection, state management, render loop.

```javascript
import { connect } from '/shared/connection.js';
import { BattlefieldRenderer } from './render.js';

// State maintained locally, updated by WebSocket events
const state = {
  cycle: { number: 0, phase: 'idle', period_ms: 1000, last_alpha_ts: 0, last_beta_ts: 0 },
  nodes: {},
  drones: {},
  jamming_zones: [],
  active_transmissions: [],
  active_alerts: [],
  stats: { packets_total: 0, packets_dropped: 0, sync_drift_ms: 0, ai_decisions: 0 },
  ai_reasoning: null,
};

const canvas = document.getElementById('battlefield');
const renderer = new BattlefieldRenderer(canvas);

// Render loop
function tick(time) {
  renderer.render(state, time);
  updateOverlays(state);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// WebSocket handlers
const socket = connect('screen');

socket.on('cycle_tick', (data) => {
  state.cycle = { ...state.cycle, ...data };
});

socket.on('state_update', (data) => {
  Object.assign(state, data);
});

socket.on('node_state_change', (data) => {
  state.nodes[data.nodeId] = { ...state.nodes[data.nodeId], ...data };
});

socket.on('transmission_arc', (data) => {
  state.active_transmissions.push({
    from: data.from,
    to: data.to,
    expires_at: Date.now() + 50,
  });
  // Garbage-collect expired transmissions in render
});

socket.on('jamming_zone_added', (zone) => {
  state.jamming_zones.push(zone);
});

socket.on('alert', (alert) => {
  state.active_alerts.push({ ...alert, expires_at: Date.now() + 5000 });
});

socket.on('ai.decision', (decision) => {
  state.ai_reasoning = decision;
  showAIReasoning(decision);
});

function updateOverlays(state) {
  // Update DOM elements with latest stats
  document.querySelector('[data-cycle]').textContent = state.cycle.number;
  document.querySelector('[data-packets]').textContent = state.stats.packets_total;
  document.querySelector('[data-drift]').textContent = `${state.stats.sync_drift_ms}ms`;
  document.querySelector('[data-nodes]').textContent = Object.values(state.nodes).filter(n => n.type === 'real').length;
  document.querySelector('[data-decoys]').textContent = Object.values(state.nodes).filter(n => n.type === 'decoy').length;
  // ... etc
}

function showAIReasoning(decision) {
  const panel = document.getElementById('ai-reasoning');
  const content = document.getElementById('reasoning-content');
  content.innerHTML = `
    <div class="ai-classification">${decision.classification}</div>
    <div class="ai-reasoning-text">${decision.reasoning}</div>
    <div class="ai-confidence">Confidence: ${(decision.confidence * 100).toFixed(0)}%</div>
  `;
  panel.classList.remove('hidden');
  setTimeout(() => panel.classList.add('hidden'), 30000);
}
```

### client/shared/design-system.css

CSS variables for the entire UI ecosystem. Other components (`/ops`, `/phone`, `/`) will import this too.

```css
:root {
  /* Backgrounds */
  --bg-deep: #0A0E1A;
  --bg-panel: #131826;
  --bg-elevated: #1B2235;
  --border-default: #2A3447;
  
  /* Accents */
  --accent-green: #4ADE80;
  --accent-amber: #FBBF24;
  --accent-red: #EF4444;
  --accent-cyan: #22D3EE;
  --accent-gray: #475569;
  
  /* Text */
  --text-primary: #E2E8F0;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --text-bright: #F8FAFC;
  
  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --space-6: 48px;
  --space-7: 64px;
  
  /* Typography */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  
  /* Easing */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
}

/* Reset essentials */
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--text-primary);
  background: var(--bg-deep);
  -webkit-font-smoothing: antialiased;
}
```

### client/shared/connection.js

Reusable WebSocket connection helper. Other UI components will import this.

```javascript
/**
 * Connect to the server WebSocket with a given role.
 * Returns a socket-like object with on/off/emit methods.
 */
export function connect(role) {
  const script = document.createElement('script');
  script.src = '/socket.io/socket.io.js';
  document.head.appendChild(script);
  
  return new Promise((resolve) => {
    script.onload = () => {
      const socket = io({ query: { role } });
      
      socket.on('connect', () => {
        document.querySelector('#connection-indicator')?.classList.add('connected');
      });
      
      socket.on('disconnect', () => {
        document.querySelector('#connection-indicator')?.classList.remove('connected');
      });
      
      resolve(socket);
    };
  });
}
```

Or, if you prefer a synchronous-ish API, load the Socket.IO client via standard `<script>` tag in HTML and just provide helpers in `connection.js`.

## Performance requirements

- 60 FPS sustained at 1080p with 100 nodes, 5 drones, 3 active patterns
- Frame budget: 16ms per frame
- Use `requestAnimationFrame` for render loop (never `setInterval`)
- Cache static elements (grid, HQ icon) on offscreen canvas if needed
- Batch DOM updates outside the canvas render loop (use a separate `requestAnimationFrame` chain for overlay updates if necessary)
- Test with FPS counter visible during development

## Accessibility and polish

- Respect `prefers-reduced-motion` for animations (provide a calmer animation set when set)
- Use `pointer-events: none` on overlays that shouldn't intercept clicks
- Cursor: hide cursor after 5s of inactivity (operator displays don't need a cursor)

## Mocking for development

If Server Core is not yet built or not running, provide a `mock-state.js` that simulates server emissions:

```javascript
// mock-state.js — used when ?mock=true in URL
let cycle = 0;
setInterval(() => {
  cycle++;
  socket.emit_mock('cycle_tick', { number: cycle, phase: 'sync_beta_burst' });
  // ... emit fake state for development
}, 1000);
```

Enable with `http://localhost:3000/screen?mock=true`.

## Testing

Manual test checklist:

- Load `/screen` route → page loads without errors
- Mock mode produces moving nodes and animations
- Real mode shows actual server state
- Resize browser → canvas resizes correctly
- 60 FPS sustained with 100 nodes (use Chrome DevTools Performance tab)
- All overlay panels appear and disappear smoothly
- AI reasoning panel shows correctly when `ai.decision` event arrives
- Disconnection from server shows visible indicator
- Reconnection restores state without page reload

## Acceptance criteria

You are done when:

- All files in your scope are created
- Visualization runs at 60 FPS with realistic state
- All visual elements from `10-ui-design.md` are implemented and look professional
- Animations are smooth (no janky frame drops)
- Works at 1080p and 4K
- Connection indicator works
- Mock mode allows independent development
- `client/screen/README.md` documents how to run / test
- `DECISIONS.md` updated for any non-obvious choices
- Code is readable and well-organized

## Hand-off

When complete, your component:
- Reads state pushed from Server Core via WebSocket
- Displays the entire system's state visually
- Shares `client/shared/` with other UI components
- Is the demo's main visual element — everything that happens behind the scenes shows up here

This is the surface area people will see and judge. Make it look like an actual operator system, not a demo. The screen should be photographable.
