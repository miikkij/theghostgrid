# Context — Shared by all Claude Code instances

## Project: Tactical Mesh

You are working on a defense-tech proof of concept demonstrating a drone-coordinated tactical mesh communications architecture. The system is being built for a hackathon submission and partner demonstration.

## Before you start: read the docs

In the repository, there is a `docs/` directory containing the full design specification:

```
docs/
├── 00-README.md                  ← start here for overview
├── 01-requirements.md            ← what the system must do
├── 02-design-architecture.md     ← three-layer + four-tier model
├── 03-design-protocol.md         ← transmission + mesh layer specs
├── 04-design-deception.md        ← application layer deception
├── 05-design-ai-hq-brain.md      ← AI integration design
├── 06-build-components.md        ← THIS IS YOUR PRIMARY REFERENCE
├── 07-implementation-stack.md    ← tech stack and tooling
├── 08-demo-and-pitch.md          ← what the demo must do
├── 09-roadmap.md                 ← post-event direction (not your concern)
└── 10-ui-design.md               ← UI specifications (relevant if you build UI)
```

**Read in this order at minimum**:
1. `00-README.md` for project framing
2. `06-build-components.md` for your component's specifications
3. Whichever design doc (02-05) covers your component's concerns
4. `10-ui-design.md` if you build any UI

Each task prompt will direct you to specific docs relevant to your component.

## The architectural anchor

The system is anchored in one technical concept: **a fiber-tethered drone serves as the time-discipline source for ground-level mesh communications, eliminating GPS dependency and master-radio exposure as failure modes**.

Everything else in the architecture is co-designed around this anchor. When building your component, remember that the sync beacon is what makes the rest of the system work. If you find yourself deviating from this anchor's implications, stop and re-read 02-design-architecture.md.

## Quality bar

This is a demonstration, but it should look and feel like professional defense-tech tooling. Specifically:

- **Visual quality matters**: this will be shown to partners and judges; aesthetics carry credibility
- **Code quality matters**: source will be reviewed; clean, commented, well-organized code earns trust
- **Architectural clarity matters**: components must integrate cleanly; respect interface contracts

Do not ship slop. Do not ship "it works on my machine." Do not ship without trying it.

## Stack overview

- **Backend**: Node.js (Express + Socket.IO)
- **Protocol/radio**: Rust for actual radio operations (Kova Labs WiFi adapter libraries)
- **Frontend**: Vanilla HTML/CSS/JS — no framework
- **Visualization**: HTML5 Canvas
- **AI**: ConfidentialMind hosted endpoint, with local Ollama fallback
- **Real-time transport**: Socket.IO over WebSocket

See `docs/07-implementation-stack.md` for full details.

## Repository layout (target)

```
tactical-mesh/
├── README.md
├── package.json                  ← root manifest
├── .env.example                  ← config template
├── .gitignore
├── server/                       ← Node.js backend
│   ├── index.js                  ← entry point
│   ├── state.js                  ← central state
│   ├── router.js                 ← event routing
│   ├── websocket.js              ← Socket.IO
│   ├── http.js                   ← Express routes
│   ├── config.js                 ← env loading
│   ├── protocol/
│   │   ├── transmission.js
│   │   ├── mesh.js
│   │   ├── frame.js
│   │   └── crypto.js
│   ├── deception/
│   │   ├── decoy_simulator.js
│   │   ├── wave_patterns.js
│   │   ├── fake_data.js
│   │   └── honeypot.js
│   ├── hq_brain/
│   │   ├── index.js
│   │   ├── confidentialmind_client.js
│   │   ├── tactical_loop.js
│   │   ├── operational_loop.js
│   │   ├── prompts.js
│   │   └── audit.js
│   └── demo/
│       ├── scenarios.js
│       └── script.js
├── radios/                       ← Rust radio bridge
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── burst.rs
│       └── hopping.rs
├── client/                       ← frontend (browser-facing)
│   ├── shared/
│   │   ├── design-system.css     ← shared design tokens
│   │   └── connection.js         ← shared WebSocket helpers
│   ├── landing/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── script.js
│   ├── phone/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── script.js
│   ├── screen/
│   │   ├── index.html
│   │   ├── style.css
│   │   ├── script.js
│   │   └── render.js
│   └── ops/
│       ├── index.html
│       ├── style.css
│       ├── script.js
│       └── controls.js
├── docs/                         ← the specification set
└── README.md
```

You only own the files specified in your task prompt. Do not modify files outside your scope without coordination.

## Interface contracts

All components communicate via two mechanisms:

### Server-side: event bus

A central event bus on the server allows components to publish and subscribe to events. Event names use namespace prefixes (`transmission.*`, `mesh.*`, `deception.*`, `hq.*`, `ops.*`).

The Server Core component owns the event bus. Other server-side components import it and use:

```javascript
const { state } = require('./state');

// Subscribe
state.on('transmission.frame_received', (event) => { ... });

// Publish
state.emit('mesh.neighbor_added', { nodeId, position });

// Read state
const cycle = state.get('cycle.number');

// Update state
state.set('jamming_zones', [...zones, newZone]);

// Broadcast to all WebSocket clients
state.broadcast('cycle_tick', { number, phase });
```

### Client-server: Socket.IO

Browser clients connect via Socket.IO. Event names match the server-side event bus where appropriate; some events are client-specific.

```javascript
const socket = io();

socket.on('cycle_tick', (data) => { ... });
socket.on('node_state_change', (data) => { ... });
socket.emit('ops.trigger_scenario', { scenario: 'inject_jamming' });
```

## Configuration

All configuration lives in `.env` (loaded at server start). A template is in `.env.example`. Components should read configuration from `server/config.js`, which exposes a normalized configuration object.

## Logging

Use a structured logger (pino is recommended). Log levels: trace, debug, info, warn, error.

```javascript
const log = require('./log').child({ component: 'mesh' });

log.info({ nodeId: 'A7' }, 'Node joined mesh');
log.error({ err }, 'Failed to route packet');
```

Critical events should be logged at info level. Use debug for verbose tracing. Use error for actual problems.

## When you don't know something

- Check the docs first
- Check if another component already provides what you need (look at `06-build-components.md`)
- If something is genuinely under-specified in the docs, make a reasonable choice and document it in `DECISIONS.md` in the repo root (append-only, dated entries)
- Do not invent requirements that aren't in the docs
- Do not skip the docs and guess

## Definition of done (your component)

You are done when:

- All files in your scope are created and committed
- Your component meets all the criteria in its definition-of-done section (in 06-build-components.md)
- Your component can be exercised in isolation (manual test or simple script)
- You have written or updated minimal README content for your component's directory
- You have updated `DECISIONS.md` with any non-obvious choices you made
- Your code passes a linter (eslint for JS, clippy for Rust)
- Your code does not break other components (check before committing)

## What you should NOT do

- Do not refactor code outside your scope
- Do not modify the design documents (they are specifications, not drafts)
- Do not change interface contracts without coordinating
- Do not commit secrets or API keys (use `.env`, which is gitignored)
- Do not add dependencies without justification
- Do not skip the design docs and improvise

## Communication style in code

- Comments should explain *why*, not *what*. The code says what; the comments say why.
- Keep functions small and named clearly
- Prefer pure functions where possible
- Handle errors explicitly; do not swallow exceptions
- Write code as if the next person to read it has 30 seconds and a coffee

## Your specific task

This context document is generic. Your specific task is in another prompt file (`01-PROMPT-*.md` through `07-PROMPT-*.md`). Read your task prompt next.
