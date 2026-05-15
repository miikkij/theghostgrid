# Task 01 — Server Core

You are building the **Server Core** component of the Tactical Mesh system.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component A: Server Core"
3. Read `docs/07-implementation-stack.md` — sections on server-side stack
4. Skim `docs/02-design-architecture.md` for architectural context

## Your scope

You own these files:

```
server/index.js
server/state.js
server/router.js
server/websocket.js
server/http.js
server/config.js
server/log.js
package.json
.env.example
.gitignore
README.md (root, your initial version)
```

You do NOT own:
- `server/protocol/*` (another instance)
- `server/deception/*` (another instance)
- `server/hq_brain/*` (another instance)
- `radios/*` (another instance)
- `client/*` (other instances)

## What this component does

The Server Core is the foundation that other components plug into. It provides:

1. HTTP server (Express) serving the four browser-facing routes (`/`, `/screen`, `/ops`, `/phone`) and static assets
2. WebSocket server (Socket.IO) for real-time bidirectional communication with browser clients
3. Central state store (JavaScript object with event emitter)
4. Event bus that other components subscribe to and publish on
5. Configuration loading from environment
6. Structured logging
7. Graceful start/stop lifecycle

## Detailed requirements

### State and event bus

Create a central `state` object (in `state.js`) that combines:

- **EventEmitter** for subscribe/publish
- **State store** with path-based get/set
- **WebSocket broadcast helpers**

```javascript
// state.js — target API
const state = {
  // EventEmitter functionality
  on(event, handler),
  off(event, handler),
  emit(event, payload),
  
  // State access
  get(path),          // e.g., state.get('cycle.number')
  set(path, value),   // e.g., state.set('cycle.number', 1247)
  
  // WebSocket broadcast (delegates to websocket.js)
  broadcast(event, payload),                // to all clients
  broadcastTo(role, event, payload),        // to clients of a role (phone, screen, ops)
  
  // Internal
  _store: { ... },    // the actual state
  _ee: new EventEmitter(),
};
```

Initial state shape:

```javascript
{
  cycle: {
    number: 0,
    phase: 'idle',          // 'sync_alpha' | 'prep' | 'sync_beta_burst' | 'idle'
    period_ms: 1000,
    last_alpha_ts: null,
    last_beta_ts: null,
  },
  nodes: {},                // { [nodeId]: { type, position, state, neighbors, lastSeen } }
  drones: {},               // { [droneId]: { position, status, role } }
  jamming_zones: [],
  active_patterns: [],
  stats: {
    packets_total: 0,
    packets_dropped: 0,
    sync_drift_ms: 0,
    ai_decisions: 0,
    uptime_ms: 0,
  },
  audit_log: [],
}
```

### HTTP server (Express)

In `http.js`:

- Express app
- Serve static files from `client/` directory
- Routes:
  - `GET /` → serve `client/landing/index.html`
  - `GET /screen` → serve `client/screen/index.html`
  - `GET /ops` → serve `client/ops/index.html`
  - `GET /phone` → serve `client/phone/index.html`
- API routes:
  - `POST /api/scenario/trigger` — trigger a demo scenario (body: `{ scenario, parameters }`)
  - `GET /api/state` — get current state snapshot (for debugging)
  - `GET /api/health` — health check
- Reasonable middleware: cors, json body parser, request logging

### WebSocket (Socket.IO)

In `websocket.js`:

- Initialize Socket.IO server attached to the HTTP server
- Connection handling:
  - On connect: assign client a role based on its requested type ('phone', 'screen', 'ops', or 'observer')
  - On phone connection: assign a unique callsign (e.g., `ALPHA-7`) and role (`RECON`, `OPS`, `COMMS`, `MEDIC`)
  - Maintain a registry of connected clients with their roles
- Event handling (server receives from client):
  - `ops.trigger_scenario` (from operator) → emit on event bus for Demo Orchestrator to handle
  - `phone.acknowledge` (from phone, optional telemetry)
- Event broadcasting (server pushes to clients):
  - `cycle_tick` → broadcast on every cycle phase change
  - `node_state_change` → push to affected phones and broadcast to screen/ops
  - `alert` → push to phones in alert area, broadcast to screen/ops
  - `state_update` → periodic full or delta state push
  - `ai_decision` → broadcast to screen/ops when AI emits decision

### Configuration

In `config.js`:

- Load from `.env` via `dotenv`
- Export a normalized config object:

```javascript
module.exports = {
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
  },
  cycle: {
    period_ms: parseInt(process.env.BURST_CYCLE_MS) || 1000,
    sync_alpha_offset_ms: parseInt(process.env.SYNC_ALPHA_OFFSET_MS) || 0,
    sync_beta_offset_ms: parseInt(process.env.SYNC_BETA_OFFSET_MS) || 215,
    burst_window_ms: parseInt(process.env.BURST_WINDOW_MS) || 300,
  },
  radio: {
    drone_iface: process.env.RADIO_DRONE_IFACE || 'wlan1',
    ground_1_iface: process.env.RADIO_GROUND_1_IFACE || 'wlan2',
    ground_2_iface: process.env.RADIO_GROUND_2_IFACE || 'wlan3',
    enabled: process.env.RADIO_ENABLED === 'true',
  },
  confidentialmind: {
    endpoint: process.env.CM_ENDPOINT,
    api_key: process.env.CM_API_KEY,
    model: process.env.CM_MODEL || 'llama-3-70b',
  },
  demo: {
    num_simulated_decoys: parseInt(process.env.NUM_SIMULATED_DECOYS) || 47,
    enable_haptic: process.env.ENABLE_HAPTIC !== 'false',
  },
};
```

### Logging

In `log.js`:

- Use pino as the logger
- Pretty-print in development (`pino-pretty`)
- Structured JSON in production
- Child loggers for each component (e.g., `log.child({ component: 'http' })`)

### Entry point

In `index.js`:

- Load config
- Initialize logger
- Initialize state
- Initialize HTTP server
- Attach Socket.IO
- Start cycle ticker (publishes cycle phase events at correct intervals — but actual protocol logic is in Protocol Modules, you just provide the tick)
- Handle graceful shutdown (SIGINT, SIGTERM)
- Log startup banner with port, version, environment

### package.json

```json
{
  "name": "tactical-mesh",
  "version": "0.1.0",
  "type": "commonjs",
  "scripts": {
    "start": "node server/index.js",
    "dev": "node --watch server/index.js",
    "lint": "eslint server/",
    "format": "prettier --write 'server/**/*.js'"
  },
  "dependencies": {
    "express": "^4.21.0",
    "socket.io": "^4.8.0",
    "dotenv": "^16.4.0",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "prettier": "^3.3.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### .env.example

Provide all configuration keys with reasonable defaults and inline comments.

### .gitignore

```
node_modules/
.env
*.log
.DS_Store
target/
.vscode/
```

### Root README.md

Brief README at the repo root with:
- Project name and one-line description
- Setup instructions (npm install, copy .env.example to .env, npm start)
- Pointer to `docs/00-README.md` for full information
- Pointer to `docs/06-build-components.md` for build status

## Interface for other components

Other components will import `state` and use the event bus. Make sure your implementation supports:

```javascript
// What another component will do
const { state } = require('../state');
const log = require('../log').child({ component: 'mesh' });

state.on('cycle.sync_alpha', () => {
  // Mesh module reacts to sync alpha phase
});

state.emit('mesh.neighbor_added', { nodeId, position });
state.set('nodes.ALPHA-7.state', 'TX');
state.broadcastTo('screen', 'transmission_arc', { from: 'A7', to: 'B3' });
```

Document the exported API clearly in `state.js` with JSDoc comments.

## Cycle ticker

Within `index.js` (or split out into its own file if cleaner), implement a cycle ticker that fires four events per cycle:

```javascript
// Each cycle of period_ms duration:
// T=0                              -> emit 'cycle.sync_alpha'
// T=sync_alpha_offset_ms + 15ms    -> emit 'cycle.prep'
// T=sync_beta_offset_ms            -> emit 'cycle.sync_beta_burst'
// T=sync_beta_offset_ms + burst_window_ms  -> emit 'cycle.idle'
// At each tick, update state.cycle.phase and broadcast to clients
```

Use `setTimeout` chains (not setInterval) to avoid drift accumulation.

## Acceptance criteria

You are done when:

- `npm install && npm start` works from a clean clone
- Server starts on port 3000 (or as configured) without errors
- Visiting `http://localhost:3000/` returns the (stub or real) landing HTML
- Visiting `/screen`, `/ops`, `/phone` returns appropriate (stub or real) HTML
- Socket.IO connection from a browser succeeds and receives `cycle_tick` events
- A test client subscribing to events via the event bus receives them
- Event bus and state changes propagate to WebSocket clients within 50ms
- Logger outputs structured logs at the configured level
- Graceful shutdown on Ctrl+C
- `lint` passes
- `DECISIONS.md` updated with any non-obvious choices

## Note on stubs

Other components are not yet built. For your work to be testable in isolation, create minimal HTML stubs for the four routes (one paragraph each indicating "Page X — being built by [component]"). The actual UI components will replace these stubs.

## Note on Demo Orchestrator

The Demo Orchestrator component does not yet exist either. For your work, when `ops.trigger_scenario` is received, simply log the trigger and emit an event on the bus. Other components will subscribe to those events.

## Hand-off

When complete, your component is the foundation for:
- Protocol Modules (Component B) → subscribes to cycle events, emits transmission events
- Deception Engine (Component C) → subscribes to cycle events, emits decoy events
- HQ Brain (Component D) → subscribes to events, emits decisions
- Big Screen, Operator Dashboard, Phone Client → consume WebSocket events
- Radio Bridge (Component E) → reads from stdin, writes to stdout; server connects via child_process

Your work is solid when all of these can plug in without modification to your code.
