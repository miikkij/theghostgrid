# Task 06 — Operator Dashboard

You are building the **Operator Dashboard** component: the control panel used to drive the demo, trigger scenarios, monitor system state, and inspect AI reasoning.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component G: Operator Dashboard"
3. Read `docs/10-ui-design.md` — full section on Operator Dashboard `/ops`
4. Read `docs/08-demo-and-pitch.md` — section on demo control sequence (you build the controls that operator clicks)

## Your scope

You own these files:

```
client/ops/index.html
client/ops/style.css
client/ops/script.js
client/ops/controls.js
client/ops/README.md
```

You do NOT own:
- `client/shared/*` — used by you, owned by Big Screen instance
- Other client routes

## Prerequisites

- Server Core operational (WebSocket + `/api/scenario/trigger` route)
- `client/shared/design-system.css` and `client/shared/connection.js` from Big Screen task
- Other components' event names (you trigger them; they handle the work)

If Server Core or shared files aren't ready, develop against a mock and integrate later.

## What this component does

The operator's bridge during the demo. Single screen with:

- Real-time system status
- Scenario trigger buttons (clearly labeled, easy to hit under demo pressure)
- Live mini-map of mesh state
- Event log
- AI reasoning panel
- Cycle control
- Adapter status

The operator uses this during pitch rehearsal and live pitch. Reliability and clarity matter more than visual flair.

## Detailed requirements

### Layout

Refer to `docs/10-ui-design.md` for the layout sketch. Three-column structure works well:

- **Left column**: Scenario triggers + cycle control + pattern management
- **Center column**: Live mini-map + event log
- **Right column**: AI reasoning panel + adapter status

Top: system status bar across full width. Bottom: optional secondary controls.

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tactical Mesh — Operator Dashboard</title>
  <link rel="stylesheet" href="/shared/design-system.css">
  <link rel="stylesheet" href="/ops/style.css">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
</head>
<body>
  <header id="status-bar">
    <div class="brand">TACTICAL MESH / OPS</div>
    <div class="status-metrics">
      <span class="metric"><span class="label">Cycle</span><span class="value" data-cycle>0</span></span>
      <span class="metric"><span class="label">Nodes</span><span class="value" data-nodes>0</span></span>
      <span class="metric"><span class="label">Pkts/s</span><span class="value" data-pps>0</span></span>
      <span class="metric"><span class="label">Drift</span><span class="value" data-drift>0ms</span></span>
      <span class="metric"><span class="label">AI</span><span class="value" data-ai-status>OFF</span></span>
    </div>
    <div class="system-state">
      <span class="status-dot" data-system-status></span>
      <span class="system-label" data-system-label>READY</span>
    </div>
  </header>
  
  <main id="dashboard">
    <section id="controls" class="panel">
      <h2>SCENARIO TRIGGERS</h2>
      
      <div class="control-group">
        <h3>Adversarial</h3>
        <button class="btn btn-danger" data-trigger="inject_jamming">Inject Jamming</button>
        <button class="btn btn-danger" data-trigger="drop_drone">Drop Drone</button>
        <button class="btn btn-danger" data-trigger="trigger_honeypot">Trigger Honeypot</button>
      </div>
      
      <div class="control-group">
        <h3>Deception</h3>
        <button class="btn btn-warn" data-trigger="activate_decoys">Activate Decoys</button>
        <button class="btn btn-warn" data-trigger="pattern_linear">Linear Wave</button>
        <button class="btn btn-warn" data-trigger="pattern_convoy">Phantom Convoy</button>
        <button class="btn btn-warn" data-trigger="pattern_radial">Radial Expansion</button>
      </div>
      
      <div class="control-group">
        <h3>AI</h3>
        <button class="btn btn-info" data-trigger="trigger_ai_adaptation">Force AI Adaptation</button>
      </div>
      
      <div class="control-group">
        <h3>System</h3>
        <button class="btn btn-neutral" data-trigger="pause_cycles">Pause Cycles</button>
        <button class="btn btn-neutral" data-trigger="resume_cycles">Resume</button>
        <button class="btn btn-neutral" data-trigger="reset_state">Reset State</button>
      </div>
      
      <div class="control-group">
        <h3>Demo Sequence</h3>
        <button class="btn btn-primary" data-trigger="run_full_pitch">Run Full Pitch (5min)</button>
      </div>
    </section>
    
    <section id="center-column">
      <div id="minimap" class="panel">
        <h2>LIVE MESH STATE</h2>
        <canvas id="minimap-canvas"></canvas>
      </div>
      
      <div id="event-log" class="panel">
        <h2>EVENT LOG</h2>
        <div class="event-log-content"></div>
      </div>
    </section>
    
    <section id="right-column">
      <div id="ai-panel" class="panel">
        <h2>AI REASONING</h2>
        <div class="ai-content">
          <div class="ai-no-data">No recent AI decisions</div>
        </div>
        <div class="ai-history">
          <h3>Recent Decisions</h3>
          <div class="ai-history-list"></div>
        </div>
      </div>
      
      <div id="adapters-panel" class="panel">
        <h2>ADAPTERS</h2>
        <div class="adapter-row">
          <span class="adapter-name">wlan1 (drone)</span>
          <span class="adapter-status" data-adapter="wlan1">—</span>
        </div>
        <div class="adapter-row">
          <span class="adapter-name">wlan2 (ground 1)</span>
          <span class="adapter-status" data-adapter="wlan2">—</span>
        </div>
        <div class="adapter-row">
          <span class="adapter-name">wlan3 (ground 2)</span>
          <span class="adapter-status" data-adapter="wlan3">—</span>
        </div>
        <div class="adapter-row">
          <span class="adapter-name">ConfidentialMind</span>
          <span class="adapter-status" data-adapter="cm">—</span>
        </div>
      </div>
      
      <div id="cycle-control" class="panel">
        <h2>CYCLE</h2>
        <label>Period
          <select data-cycle-period>
            <option value="250">250ms (fast)</option>
            <option value="500">500ms</option>
            <option value="1000" selected>1000ms (normal)</option>
            <option value="2000">2000ms</option>
            <option value="5000">5000ms (slow)</option>
          </select>
        </label>
        <div class="active-patterns">
          <h3>Active Patterns</h3>
          <ul class="patterns-list"></ul>
        </div>
      </div>
    </section>
  </main>
  
  <div id="connection-indicator" class="status-dot"></div>
  
  <script src="/socket.io/socket.io.js"></script>
  <script type="module" src="/ops/script.js"></script>
</body>
</html>
```

### style.css

Implement the visual style. Key patterns:

- Use CSS Grid for the main dashboard layout
- All buttons use the design system colors (danger=red, warn=amber, info=cyan, neutral=panel bg, primary=cyan with stronger border)
- Buttons should have visible hover, active, and disabled states
- Buttons are 48px tall minimum (touch-friendly for operator who may be standing)
- Status dots: 10px circles with appropriate colors and optional pulse animations
- Event log: monospace, scrolls automatically, newest at top, color-coded by severity
- Mini-map canvas: square, fills its container
- AI reasoning panel: large readable text, clear hierarchy

Example button CSS:

```css
.btn {
  padding: var(--space-2) var(--space-3);
  min-height: 48px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  font-family: var(--font-sans);
  font-weight: 500;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 150ms var(--ease-default);
  width: 100%;
  margin-bottom: var(--space-1);
  text-align: left;
}

.btn:hover {
  background: var(--bg-panel);
  border-color: var(--accent-cyan);
}

.btn:active {
  transform: translateY(1px);
}

.btn-danger { border-left: 4px solid var(--accent-red); }
.btn-warn { border-left: 4px solid var(--accent-amber); }
.btn-info { border-left: 4px solid var(--accent-cyan); }
.btn-primary {
  background: var(--accent-cyan);
  color: var(--bg-deep);
  font-weight: 600;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

### controls.js

The controls module handles button clicks, emitting events to the server.

```javascript
const socket = io({ query: { role: 'ops' } });

const triggers = {
  inject_jamming: () => {
    const area = {
      center: { x: 0.4 + Math.random() * 0.2, y: 0.4 + Math.random() * 0.2 },
      radius: 0.15,
    };
    socket.emit('ops.trigger_scenario', { scenario: 'inject_jamming', parameters: { area } });
  },
  
  drop_drone: () => {
    socket.emit('ops.trigger_scenario', { scenario: 'drop_drone', parameters: {} });
  },
  
  trigger_honeypot: () => {
    socket.emit('ops.trigger_scenario', { 
      scenario: 'trigger_honeypot', 
      parameters: { eventType: 'artillery', direction_of_arrival_deg: 270 + Math.random() * 30 }
    });
  },
  
  activate_decoys: () => {
    socket.emit('ops.trigger_scenario', { scenario: 'activate_decoys', parameters: { count: 47 } });
  },
  
  pattern_linear: () => {
    socket.emit('ops.trigger_scenario', {
      scenario: 'activate_pattern',
      parameters: {
        patternName: 'linear_translation',
        direction: 'east',
        velocity: 0.01,
        band_width: 0.15,
      }
    });
  },
  
  pattern_convoy: () => {
    socket.emit('ops.trigger_scenario', {
      scenario: 'activate_pattern',
      parameters: {
        patternName: 'phantom_convoy',
        path: [
          { x: 0.1, y: 0.5 },
          { x: 0.5, y: 0.3 },
          { x: 0.9, y: 0.6 },
        ],
        velocity: 0.015,
      }
    });
  },
  
  pattern_radial: () => {
    socket.emit('ops.trigger_scenario', {
      scenario: 'activate_pattern',
      parameters: {
        patternName: 'radial_expansion',
        center: { x: 0.5, y: 0.5 },
        expansion_rate: 0.005,
      }
    });
  },
  
  trigger_ai_adaptation: () => {
    socket.emit('ops.trigger_scenario', { scenario: 'trigger_ai_adaptation', parameters: {} });
  },
  
  pause_cycles: () => {
    socket.emit('ops.trigger_scenario', { scenario: 'pause_cycles', parameters: {} });
  },
  
  resume_cycles: () => {
    socket.emit('ops.trigger_scenario', { scenario: 'resume_cycles', parameters: {} });
  },
  
  reset_state: () => {
    if (!confirm('Reset all state? This clears all decoys, patterns, jamming.')) return;
    socket.emit('ops.trigger_scenario', { scenario: 'reset_state', parameters: {} });
  },
  
  run_full_pitch: () => {
    if (!confirm('Run full 5-minute pitch sequence?')) return;
    socket.emit('ops.trigger_scenario', { scenario: 'run_full_pitch', parameters: {} });
  },
};

// Wire up all buttons
document.querySelectorAll('button[data-trigger]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const trigger = btn.dataset.trigger;
    if (triggers[trigger]) {
      btn.classList.add('triggered');
      setTimeout(() => btn.classList.remove('triggered'), 300);
      triggers[trigger]();
    }
  });
});

// Cycle period control
document.querySelector('[data-cycle-period]').addEventListener('change', (e) => {
  socket.emit('ops.set_cycle_period', { period_ms: parseInt(e.target.value) });
});

export { socket };
```

### script.js

Orchestrates the dashboard: subscribes to server events, updates UI elements, drives the mini-map render.

```javascript
import { socket } from './controls.js';

// Mini-map renderer (simpler than big-screen, but same data)
const minimapCanvas = document.getElementById('minimap-canvas');
const minimapCtx = minimapCanvas.getContext('2d');

function resizeMinimap() {
  const rect = minimapCanvas.getBoundingClientRect();
  minimapCanvas.width = rect.width;
  minimapCanvas.height = rect.height;
}
resizeMinimap();
window.addEventListener('resize', resizeMinimap);

// Local state cache
const state = {
  cycle: { number: 0, phase: 'idle' },
  nodes: {},
  drones: {},
  jamming_zones: [],
  stats: { packets_total: 0, packets_dropped: 0, sync_drift_ms: 0 },
  events: [],
  ai_reasoning: null,
  ai_history: [],
  adapters: {},
  active_patterns: [],
};

// WebSocket event subscriptions
socket.on('cycle_tick', (data) => {
  state.cycle = { ...state.cycle, ...data };
  updateStatusBar();
});

socket.on('state_update', (data) => {
  Object.assign(state, data);
  updateAll();
});

socket.on('event', (event) => {
  state.events.unshift({ ts: Date.now(), ...event });
  if (state.events.length > 50) state.events.length = 50;
  renderEventLog();
});

socket.on('ai.decision', (decision) => {
  state.ai_reasoning = decision;
  state.ai_history.unshift(decision);
  if (state.ai_history.length > 10) state.ai_history.length = 10;
  renderAIPanel();
});

socket.on('adapter_status', (data) => {
  state.adapters[data.adapter] = data.status;
  renderAdapterStatus();
});

socket.on('deception.pattern_activated', (data) => {
  state.active_patterns.push(data);
  renderActivePatterns();
});

socket.on('deception.pattern_deactivated', (data) => {
  state.active_patterns = state.active_patterns.filter(p => p.id !== data.id);
  renderActivePatterns();
});

// Render functions
function updateStatusBar() { /* update DOM data-* attributes */ }
function updateAll() { updateStatusBar(); renderEventLog(); renderAIPanel(); renderAdapterStatus(); }
function renderEventLog() { /* update event log content */ }
function renderAIPanel() { /* update AI reasoning panel */ }
function renderAdapterStatus() { /* update adapter rows */ }
function renderActivePatterns() { /* update active patterns list */ }

// Minimap render loop
function renderMinimap() {
  // Similar to big-screen render but smaller and simpler
  // Draws nodes, drones, jamming zones in normalized coords
  // No fancy animations; just current state
}

setInterval(renderMinimap, 100);  // 10 FPS is plenty for minimap

// Keyboard shortcuts for common operations
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  
  const shortcuts = {
    'j': 'inject_jamming',
    'd': 'drop_drone',
    'h': 'trigger_honeypot',
    'a': 'activate_decoys',
    'r': 'reset_state',
    ' ': 'pause_cycles',  // spacebar
  };
  
  if (shortcuts[e.key]) {
    e.preventDefault();
    document.querySelector(`[data-trigger="${shortcuts[e.key]}"]`)?.click();
  }
});
```

## Interaction details

**Button feedback**: every click should produce immediate visual feedback (flash, scale animation) so the operator knows the click registered.

**Confirmation dialogs**: destructive operations (Reset State, Run Full Pitch) get a `confirm()` dialog. All others trigger immediately.

**Disabled states**: when system is paused, "Pause Cycles" should be disabled; "Resume" should be enabled. Toggle based on state.

**Active state for patterns**: the pattern buttons should show an "active" indicator when the corresponding pattern is running. Click again to deactivate.

**Event log**: newest at top, auto-scroll, color-coded:
- Green dot: routine event
- Amber: warning (jamming detected, etc.)
- Red: alert (honeypot triggered)
- Cyan: AI decision

**Keyboard shortcuts**: as listed above. Useful when operator's hands are busy during the demo.

## Performance requirements

- All interactions register visually within 100ms
- Mini-map renders at 10 FPS (no need for 60)
- Event log handles 100+ entries without lag (windowed render if needed)
- Dashboard works on 1366×768 minimum

## Testing

Manual test checklist:

- Each button click sends correct event to server (verify in server logs)
- Cycle period selector changes server-side cycle timing
- Status bar updates from server events
- Event log scrolls and color-codes correctly
- AI reasoning panel shows last decision on `ai.decision` event
- Adapter status updates from `adapter_status` events
- Active patterns list updates as patterns activate/deactivate
- Mini-map shows accurate node positions
- Connection indicator works
- All keyboard shortcuts function

## Acceptance criteria

You are done when:

- Dashboard loads at `/ops` without errors
- All trigger buttons work and produce expected server responses
- Real-time updates flow from server to dashboard with < 100ms perceived lag
- Mini-map renders correctly with up to 200 nodes visible
- AI reasoning panel displays decisions with reasoning, confidence, classification
- Layout is dense but readable
- Visual style matches `docs/10-ui-design.md`
- Keyboard shortcuts work
- Confirmation dialogs prevent accidental destructive operations
- `client/ops/README.md` documents usage and shortcuts
- `DECISIONS.md` updated

## Hand-off

Your dashboard is the operator's primary tool during the demo. It must be reliable, responsive, and clear. The operator will be talking to the audience while clicking your buttons; visual clarity matters more than aesthetic flourish, but both matter.
