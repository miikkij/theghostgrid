# 06 — Build Components and Interfaces

## Purpose

This document defines the system as a set of independently buildable components with explicit interface contracts. It is the implementation counterpart to the design documents: where 02-05 specify *what the system does and why*, this document specifies *what must be built and how the pieces fit*.

No scheduling, sequencing, or resourcing decisions are made here. The component inventory is consumed by parallel build efforts; each effort takes its scoped component and produces its deliverables against the interface contracts defined below.

## Component inventory

```
                          ┌──────────────────┐
                          │   HQ BRAIN       │
                          │   (AI loop)      │
                          └────────┬─────────┘
                                   │ events, decisions
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                         SERVER CORE                              │
│            (state, routing, WebSocket, HTTP)                     │
└──┬───────┬───────────────────┬───────────────────┬───────────────┘
   │       │                   │                   │
   │       │                   │                   │
   ▼       ▼                   ▼                   ▼
┌────────┐ ┌─────────┐ ┌─────────────────┐ ┌─────────────┐
│ RADIO  │ │PROTOCOL │ │ DECEPTION       │ │ DEMO        │
│ BRIDGE │ │ MODULES │ │ ENGINE          │ │ ORCHESTRATOR│
│        │ │         │ │                 │ │             │
│ (Rust) │ │ (JS)    │ │ (JS)            │ │ (JS)        │
└────┬───┘ └─────────┘ └─────────────────┘ └─────────────┘
     │
     ▼
┌────────────────┐
│ USB WiFi       │
│ adapters (3)   │
└────────────────┘


           SERVER CORE serves three browser-side clients:

   ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
   │  BIG SCREEN     │  │  OPERATOR       │  │  AUDIENCE        │
   │  (visualization)│  │  DASHBOARD      │  │  PHONE CLIENT    │
   │                 │  │  (control)      │  │                  │
   │  /screen        │  │  /ops           │  │  /phone          │
   └─────────────────┘  └─────────────────┘  └──────────────────┘
```

## Component specifications

Each component is specified below with:
- **Purpose**: what it does
- **Files owned**: what it creates/modifies
- **Inputs**: what it consumes from other components
- **Outputs**: what it provides to other components
- **Definition of done**: verification criteria

---

### Component A: Server Core

**Purpose**: HTTP and WebSocket server; central state management; event routing between protocol modules, HQ brain, and browser clients.

**Files owned**:
- `server/index.js` — entry point
- `server/state.js` — central state store
- `server/router.js` — event routing
- `server/websocket.js` — Socket.IO setup and fanout
- `server/http.js` — Express HTTP routes
- `server/config.js` — environment configuration loader

**Inputs**:
- Events from Protocol Modules (frame received, frame transmitted, neighbor changed)
- Events from Radio Bridge (raw frames in/out)
- Events from Deception Engine (decoy activity)
- Events from HQ Brain (decisions, broadcasts)
- WebSocket messages from browser clients (phone, dashboard, big screen)

**Outputs**:
- Central state object readable by all components
- WebSocket event broadcasts to subscribed clients
- HTTP routes for static content serving
- Event hooks consumed by Protocol Modules, HQ Brain, Deception Engine

**Interfaces**:

```javascript
// Event bus interface
state.on(eventType, handler)      // subscribe to events
state.emit(eventType, payload)    // publish event
state.get(path)                   // read state at path
state.set(path, value)            // write state at path
state.broadcast(event, payload)   // push to all WS clients
state.broadcastTo(role, event, payload)  // push to clients of role
```

State shape:
```javascript
{
  cycle: { number, phase, t_alpha, t_beta },
  nodes: { [nodeId]: { type, position, state, neighbors, lastSeen } },
  drones: { [droneId]: { position, status, role } },
  jamming_zones: [{ center, radius, since }],
  stats: { packets_total, packets_dropped, sync_drift_ms, ... },
  audit_log: [...]
}
```

**Definition of done**:
- Server starts cleanly with `npm run dev`
- WebSocket clients can connect and receive state updates
- HTTP routes serve `/screen`, `/ops`, `/phone`, `/` correctly
- Event bus allows components to subscribe and publish
- State changes propagate to all connected WebSocket clients within 50ms

---

### Component B: Protocol Modules

**Purpose**: Transmission Layer and Mesh Layer protocol logic. Implements burst window scheduling, slot assignment, frequency hopping (logical), neighbor discovery, routing.

**Files owned**:
- `server/protocol/transmission.js`
- `server/protocol/mesh.js`
- `server/protocol/frame.js` — frame format helpers
- `server/protocol/crypto.js` — encryption / MAC utilities

**Inputs**:
- Cycle tick from Server Core (drives burst window scheduling)
- Frame events from Radio Bridge or simulated frames from Deception Engine
- Configuration: cycle period, burst window size, frequency-hopping schedule

**Outputs**:
- Frames to transmit (pushed to Radio Bridge or simulated)
- Mesh routing decisions (consumed by Server Core for state updates)
- Neighbor table updates
- Routing convergence events

**Interfaces**:

```javascript
// transmission.js
transmission.scheduleNextCycle()
transmission.allocateSlot(nodeId)
transmission.composeFrame(srcNode, dstNode, payload)
transmission.parseFrame(rawBytes)

// mesh.js
mesh.discoverNeighbors()
mesh.routePacket(srcNode, dstNode, packet)
mesh.handleNodeLoss(nodeId)
mesh.handleJamming(zone)
```

**Definition of done**:
- Burst cycles run on configurable interval (default 1000ms)
- Slot allocation is deterministic given (nodeId, cycle, secret)
- Mesh routing finds a path between any two reachable nodes
- Routing reconverges within 3 cycles after simulated node loss
- Frame format spec (from 03-design-protocol.md) is correctly implemented

---

### Component C: Deception Engine

**Purpose**: Decoy node simulation, wave choreography, fake data generation, honeypot scenario engine.

**Files owned**:
- `server/deception/decoy_simulator.js`
- `server/deception/wave_patterns.js`
- `server/deception/fake_data.js`
- `server/deception/honeypot.js`

**Inputs**:
- Cycle tick from Server Core
- Choreography configuration from HQ Brain
- Honeypot trigger commands from Demo Orchestrator or Operator Dashboard
- Topology / position data from Server Core state

**Outputs**:
- Simulated decoy transmission events (fed into Protocol Modules as if from real nodes)
- Wave pattern state (consumed by Big Screen for visualization)
- Honeypot engagement reports (fed up to HQ Brain via mesh)

**Interfaces**:

```javascript
deception.spawnDecoys(count, area)
deception.activatePattern(patternName, parameters)
deception.deactivatePattern(patternName)
deception.triggerHoneypot(nodeId, eventType)
deception.getActivePatterns()
deception.getDecoyStates()
```

Wave pattern types to implement:
- `linear_translation` — band moving across area
- `radial_expansion` — expanding ring
- `random_walk_cluster` — meandering cluster
- `phantom_convoy` — propagation along path

**Definition of done**:
- Can spawn 50+ simulated decoys at configurable positions
- Each wave pattern visibly distinguishable on Big Screen
- Decoy emissions follow same statistical distribution as real-node emissions (identical frame format, encryption envelope, slot timing)
- Honeypot trigger produces broadcast within 5 seconds
- Pattern parameters are runtime-changeable without restart

---

### Component D: HQ Brain

**Purpose**: AI integration layer. Consumes mesh events, calls LLM for tactical decisions, manages audit log, generates updated deception schedules.

**Files owned**:
- `server/hq_brain/index.js`
- `server/hq_brain/confidentialmind_client.js`
- `server/hq_brain/tactical_loop.js`
- `server/hq_brain/operational_loop.js`
- `server/hq_brain/prompts.js` — system prompts for LLM
- `server/hq_brain/audit.js`

**Inputs**:
- Honeypot engagement events from Deception Engine
- Mesh state changes from Server Core
- Jamming detection events
- LLM API credentials from configuration

**Outputs**:
- Tactical broadcast messages (HIGH urgency: auto-broadcast; lower: queued)
- Updated wave choreography parameters (pushed to Deception Engine)
- Audit log entries (every AI action logged)
- Reasoning traces (consumed by Big Screen audit panel)

**Interfaces**:

```javascript
hq_brain.ingestEvent(event)
hq_brain.proposeBroadcast(content, urgency)
hq_brain.updateChoreography(newPatternConfig)
hq_brain.getAuditTrail(timeRange)
hq_brain.getLastReasoning()
```

LLM call structure:
```javascript
{
  model: 'llama-3-70b',  // or whatever ConfidentialMind exposes
  messages: [
    { role: 'system', content: TACTICAL_LOOP_PROMPT },
    { role: 'user', content: contextualizedEvent }
  ],
  response_format: { type: 'json_object' },
  max_tokens: 500
}
```

**Definition of done**:
- Tactical loop processes honeypot events within 5 seconds end-to-end
- LLM responses are parsed and acted on correctly
- Audit log is append-only and timestamped
- Reasoning traces are human-readable on Big Screen
- Graceful fallback to local Ollama if ConfidentialMind unreachable

---

### Component E: Radio Bridge

**Purpose**: Interface to Kova Labs USB WiFi adapters. Rust process emitting events to server, accepting transmission commands.

**Files owned**:
- `radios/Cargo.toml`
- `radios/src/main.rs`
- `radios/src/burst.rs`
- `radios/src/hopping.rs`
- `radios/src/events.rs`

**Inputs**:
- Transmission commands from Server Core (frames to send)
- Burst window timing from Server Core
- USB adapter device names from configuration

**Outputs**:
- JSON-lines event stream over stdout (consumed by Server Core)
- Received frames decoded and emitted as events

Event format (one JSON object per line):
```json
{"type": "frame_received", "ts": 1234567890, "iface": "wlan1", "src": "...", "payload_b64": "..."}
{"type": "frame_transmitted", "ts": 1234567890, "iface": "wlan1", "bytes": 87}
{"type": "channel_changed", "ts": 1234567890, "iface": "wlan1", "channel": 6}
{"type": "adapter_status", "ts": 1234567890, "iface": "wlan1", "status": "ok"}
```

**Definition of done**:
- Reads from 3 USB adapters concurrently
- Emits frame events as JSON-lines on stdout
- Accepts transmission commands via stdin
- Handles adapter disconnection gracefully
- Optional component: server gracefully degrades to fully-simulated mode if no radios

---

### Component F: Big Screen Visualization

**Purpose**: Operator's primary visual display. Canvas-based rendering of mesh state, transmissions, jamming, drones, telemetry.

**Files owned**:
- `client/screen/index.html`
- `client/screen/style.css`
- `client/screen/script.js`
- `client/screen/render.js`
- `client/screen/assets/` (icons, fonts)

**Inputs**:
- WebSocket connection to Server Core
- State updates streamed via WebSocket
- Configuration via URL parameters or local config

**Outputs**:
- Visual display only; no upstream messages

**Visual elements to render**:
- Map background (grid)
- Node dots (color-coded by type: real / decoy / honeypot)
- Drones (with animated fiber tethers to HQ)
- Transmission arcs (animated during burst windows)
- Jamming zones (red overlay)
- HQ icon (corner)
- Sync-pulse waves (radiating animation)
- Telemetry panel (cycle number, packet stats, sync drift, AI status)
- AI audit panel (recent reasoning traces, appearing as the AI acts)

**Visual style**: see `10-ui-design.md` for color palette, typography, layout.

**Definition of done**:
- Sustains 60 FPS with 100+ nodes visible
- All required visual elements render correctly
- Animations are smooth (no janky frame drops)
- Responsive to state updates within one frame
- Works on 1920×1080 and 4K displays

---

### Component G: Operator Dashboard

**Purpose**: Control panel for demo operations. Trigger scenarios, monitor system health, inspect state.

**Files owned**:
- `client/ops/index.html`
- `client/ops/style.css`
- `client/ops/script.js`
- `client/ops/controls.js`

**Inputs**:
- WebSocket connection to Server Core
- State updates for monitoring panels

**Outputs**:
- Control commands via WebSocket (jamming trigger, drone drop, decoy activation, honeypot, AI loop)

**UI elements**:
- System status bar (cycle number, connected nodes, packets/sec, sync drift, AI status)
- Scenario trigger buttons (large, clearly labeled)
- Live mini-map of mesh state
- Event log (recent activity)
- AI reasoning panel
- Cycle control (pause/resume, change period)
- Adapter status panel

**Visual style**: see `10-ui-design.md`.

**Definition of done**:
- All scenario triggers produce visible system response within 2 seconds
- System status updates are real-time (under 100ms lag)
- Layout is clear, dense, but legible
- Recovery controls (reset state) are present
- Works on operator laptop (typically 1366×768 or 1920×1080)

---

### Component H: Audience Phone Client

**Purpose**: Mobile-optimized page served to audience members who scan the QR code. Beautiful landing, then node-state display with vibration and visual feedback.

**Files owned**:
- `client/phone/index.html`
- `client/phone/style.css`
- `client/phone/script.js`
- `client/phone/landing.html` (or in same file with state machine)

**Inputs**:
- WebSocket connection to Server Core
- Node identity assignment from server (callsign, role)
- State updates from server (burst events, role changes, alerts)

**Outputs**:
- Visual display and haptic feedback only
- Optional: telemetry pings back to server

**UI states**:

1. **Landing** (first 3 seconds after page load):
   - Beautiful project intro
   - "Connecting you to the mesh..."
   - Smooth transition to node state

2. **Node state** (main view):
   - Callsign + role badge (e.g., "ALPHA-7 / RECON")
   - Large state indicator: LISTENING / SYNC / TX / RX / JAMMED / RELAYED / DEAD
   - Countdown to next burst
   - Compact neighbor list
   - Recent event feed (3 events)
   - Vibration on burst transmission events
   - Screen flash on critical events (jamming, honeypot alert)

3. **Alert state** (overlay):
   - Red full-screen takeover on threat alert ("ARTILLERY INCOMING")
   - Vibration pattern
   - Self-dismisses after timeout or next event

**Visual style**: see `10-ui-design.md` for mobile-specific guidance.

**Definition of done**:
- Loads in under 1 second on average 4G/5G mobile
- Total page weight under 100KB
- Vibration works on Android Chrome and iOS Safari
- Screen wake lock prevents lock during demo
- Smooth state transitions
- Responsive design works on 320×568 (iPhone SE) through 414×896 (iPhone Pro Max)

---

### Component I: Landing / Index Page

**Purpose**: Root page (`/`) for the system. Acts as system entry, displays QR code for sharing, links to specialized views.

**Files owned**:
- `client/landing/index.html`
- `client/landing/style.css`
- `client/landing/script.js`

**Visual elements**:
- Hero section with project name and tagline
- Large QR code (auto-generated, pointing to `/phone`)
- Link buttons: "View Operator Screen", "View Dashboard", "Connect as Node"
- Brief explanation of what the system is
- Visual styling consistent with project aesthetic

**Definition of done**:
- QR code renders and resolves to correct URL
- All link buttons work
- Visually consistent with operator/dashboard styling
- Useful as the first thing a partner/judge sees on visiting the URL

---

### Component J: Demo Orchestrator

**Purpose**: Scripted demo scenarios. Pre-recorded sequences that can be played back during the live demo with operator control.

**Files owned**:
- `server/demo/scenarios.js`
- `server/demo/script.js`
- `server/demo/backup_player.js`

**Inputs**:
- Trigger commands from Operator Dashboard
- Server Core state hooks

**Outputs**:
- Sequenced commands to other components (e.g., trigger jamming at step 3, honeypot at step 5)

**Scenarios to implement**:

1. **Basic burst cycle demo** — demonstrate one full sync-pulse + burst cycle with visualization
2. **Jamming and recovery** — inject jamming, show mesh reconverge
3. **Drone loss** — drop one drone, show sync continuity from remaining drones
4. **Decoy activation** — activate decoy population, show wave choreography start
5. **Honeypot engagement** — trigger artillery scenario, show alert propagation
6. **AI adaptation** — trigger AI loop, show choreography update
7. **Full pitch sequence** — the 5-minute demo flow as a scripted scenario

**Definition of done**:
- Each scenario is independently triggerable
- Scenarios are interruptible (operator can stop mid-flow)
- Full pitch sequence runs end-to-end as designed
- Backup recording capability (record current state for replay if live fails)

---

## Cross-component conventions

### Event naming

All events use snake_case strings with namespace prefix:

- `transmission.frame_received`
- `transmission.frame_transmitted`
- `mesh.neighbor_added`
- `mesh.routing_converged`
- `deception.pattern_activated`
- `deception.honeypot_triggered`
- `hq.broadcast_proposed`
- `hq.audit_entry`
- `ops.scenario_triggered`

### Position coordinate system

All positions use 2D coordinates normalized to the area of operations:
- Range: [0.0, 1.0] in both x and y
- Big screen renders at canvas resolution: `screen_x = pos.x * canvas_width`
- Realistic geographic context optional (could overlay map of Finland operational area)

### Time references

- Server time is authoritative
- All timestamps are Unix milliseconds (JavaScript `Date.now()`)
- Burst cycle numbers monotonically increment from server start

### Frame payload format (across protocol layers)

```javascript
{
  // Transmission layer
  type: 'data' | 'cover_fill' | 'control' | 'broadcast',
  cycle: 12345,
  slot: 23,
  source_node: 'A7',
  sequence: 9876,
  
  // Mesh layer payload (inside transmission frame)
  mesh: {
    src: 'A7',
    dst: 'HQ',
    ttl: 5,
    class: 'urgent' | 'routine' | 'cover',
    sequence: 12345,
    
    // Application payload (inside mesh frame)
    app: {
      // varies by message type
    }
  },
  
  mac: '...'  // Poly1305 or BLAKE3
}
```

## Build sequencing notes

While this document does not prescribe scheduling, certain dependencies must be respected:

- **Server Core** must exist before other components can integrate (foundation)
- **Protocol Modules** can be built against a stub Server Core
- **Deception Engine** depends on Protocol Modules for frame composition
- **HQ Brain** depends on Server Core and Deception Engine
- **Visualizations** depend on Server Core's WebSocket interface
- **Radio Bridge** is independent and can be built in parallel with everything else
- **Demo Orchestrator** integrates everything; built last but can be stubbed early

Components can otherwise be developed in parallel.

## Definition of system done

The system is complete when:

- All components meet their individual definition of done
- The full pitch sequence (scenario 7 in Demo Orchestrator) runs end-to-end without manual intervention beyond expected operator triggers
- Each visualization correctly reflects the underlying state
- The audience phone client supports 50+ concurrent connections
- All components run from a single `npm start` after initial dependency install
- A new contributor can clone the repo, run install scripts, and have a working system within 30 minutes
