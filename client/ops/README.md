# Operator Dashboard (`/ops`)

Control panel for driving the Tactical Mesh demo. Single-screen interface for triggering scenarios, monitoring system state, and inspecting AI reasoning during live pitch or rehearsal.

## Access

- **Live**: `http://<server>/ops`
- **Mock mode** (no server required): `http://<server>/ops?mock` or open `index.html?mock` directly

## Layout

Three-column layout optimized for 1366×768 minimum:

| Column | Content |
|--------|---------|
| Left   | Scenario trigger buttons, cycle control |
| Center | Live mini-map, event log |
| Right  | AI reasoning panel, adapter status, active patterns |

Top status bar shows cycle number, node count, packets/sec, sync drift, and AI status.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `J` | Inject Jamming |
| `D` | Drop Drone |
| `H` | Trigger Honeypot |
| `A` | Activate Decoys |
| `R` | Reset State (requires confirmation) |
| `Space` | Toggle Pause / Resume |

Shortcuts are disabled when focus is in a form control (select, input).

## Scenario Triggers

### Adversarial (red)
- **Inject Jamming** — drops a random jamming zone on the battlefield
- **Drop Drone** — simulates loss of a sync drone
- **Trigger Honeypot** — simulates enemy engagement with a honeypot sensor

### Deception (amber)
- **Activate Decoys** — spawns 47 decoy emitters
- **Linear Wave** — starts/stops linear wave pattern (toggle)
- **Phantom Convoy** — starts/stops phantom convoy pattern (toggle)
- **Radial Expansion** — starts/stops radial expansion pattern (toggle)

### AI (cyan)
- **Force AI Adaptation** — triggers the operational AI loop

### System (neutral)
- **Pause Cycles** / **Resume** — freezes or resumes burst cycles
- **Reset State** — clears all decoys, patterns, jamming (requires confirmation)

### Demo
- **Run Full Pitch (5 min)** — runs the scripted demo sequence (requires confirmation)

## Pattern Buttons

Pattern buttons (Linear Wave, Phantom Convoy, Radial Expansion) act as toggles. When a pattern is active, the button shows a green left border. Clicking again deactivates the pattern.

## Connection State

- **Green dot** (top-right): connected, data fresh
- **Amber dot**: data stale (>5s since last update)
- **Red dot**: disconnected
- **Red banner**: appears across top when connection is lost

## Files

| File | Role |
|------|------|
| `index.html` | Dashboard structure and layout |
| `style.css` | Visual styles (CSS Grid, buttons, panels) |
| `controls.js` | Button click handlers, keyboard shortcuts, socket emissions |
| `script.js` | State management, rendering, event subscriptions, mock mode |

## Dependencies

- `/static/shared/design-system.css` — shared color/typography tokens
- `/static/shared/connection.js` — WebSocket connection helper
- Socket.IO client (`/socket.io/socket.io.js`)
