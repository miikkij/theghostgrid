# Implementation Plan — Post-Audit Fixes

Working document. Each task is checked off after implementation AND verification.
Source: [full-system-audit.md](full-system-audit.md)

---

## Phase 1: Make the Demo Work

Everything needed for ops buttons to produce visible system responses.

### 1.1 — Create scenario dispatcher [M-1] ✅
- [x] Create `server/demo/scenarios.js`
- [x] Listen for `ops.trigger_scenario` on the state event bus
- [x] Dispatch `inject_jamming` → call `mesh.declareJammed(area)`, add zone to `state.jamming_zones`, broadcast alert
- [x] Dispatch `drop_drone` → remove a drone from `state.drones`
- [x] Dispatch `activate_decoys` → call `deception.spawnDecoys()` + spawn 3 honeypots
- [x] Dispatch `activate_pattern` → call `deception.activatePattern()` with params
- [x] Dispatch `deactivate_pattern` → call `deception.deactivatePattern()` by ID
- [x] Dispatch `trigger_honeypot` → call `deception.triggerHoneypot()` on a random honeypot
- [x] Dispatch `reset_state` → reset nodes, drones, jamming zones, patterns
- [x] Dispatch `clear_jamming` → clear zones, restore jammed nodes
- [x] Pattern shortcuts: `pattern_linear`, `pattern_convoy`, `pattern_radial`
- [x] Wire into `server/index.js` via `require` + `init(state, cycleTicker)`
- [x] Emit `scenario_result` after each dispatch for ops event log
- [x] Seed initial drones on server start for visualization
- [x] **Verified:** 273 tests pass, lint clean

### 1.2 — Initialize HQ Brain at startup [M-3] ✅
- [x] Add `require('./hq_brain').init(state)` to `server/index.js` (async, with try/catch for degraded mode)
- [x] **Verified:** server starts without crash even when no LLM available

### 1.3 — Pause/resume cycle handlers [M-5] ✅
- [x] `pause_cycles` handler in scenario dispatcher → calls `cycleTicker.stop()`, sets phase to 'paused', broadcasts
- [x] `resume_cycles` handler → calls `cycleTicker.start()`
- [x] Exposed `cycleTicker` as `{ start, stop }` object from `index.js`
- [x] Added `cycleRunning` flag so sub-phase timeouts don't fire after pause
- [x] **Verified:** pause/resume logic in code

### 1.4 — Fix burst window config [W-1] ✅
- [x] Changed `server/config.js` from `burst_window_ms: 300` to `burst_window_ms: 50`
- [x] Updated `.env.example` to `BURST_WINDOW_MS=50`
- [x] **Verified:** server starts, tests pass

### 1.5 — Fix confidence-based urgency downgrade [W-6] ✅
- [x] Added to `normalizeResponse()`: confidence < 0.5 → HIGH becomes MEDIUM, confidence < 0.3 → MEDIUM becomes LOW
- [x] **Verified:** 43 HQ brain tests pass

### 1.6 — Fix frequency hops per slot [W-2] ✅
- [x] Changed `HOPS_PER_SLOT` from 3 to 10 in `server/protocol/transmission.js`
- [x] Updated test assertions (3 → 10) in `test_protocol.js`
- [x] **Verified:** 160 protocol tests pass

### 1.7 — Move master secret to env config [W-8] ✅
- [x] Added `protocol.master_secret` to `server/config.js` reading from `process.env.MASTER_SECRET`
- [x] Updated `server/protocol/transmission.js` to read from config
- [x] Updated `server/deception/decoy_simulator.js` to read from config
- [x] Updated `server/deception/fake_data.js` to read from config
- [x] Updated `server/deception/honeypot.js` to read from config
- [x] Added `MASTER_SECRET=` to `.env.example`
- [x] **Verified:** all 273 tests pass, lint clean

---

## Phase 2: Demo Orchestrator + Polish

Scripted 5-minute pitch sequence and UX improvements.

### 2.1 — Create demo orchestrator [M-2] ✅
- [x] Created `server/demo/script.js` with `start()` / `stop()` / timed `at()` scheduler
- [x] Full 5-minute pitch sequence:
  - T+0s: Resume cycles, ensure drones
  - T+10s: Sync beacon narrative marker
  - T+30s: Burst protocol narrative marker
  - T+60s: Inject jamming (sector 3, radius 0.15)
  - T+75s: Clear jamming — mesh reconverged
  - T+90s: Drop DRONE-2
  - T+120s: Activate 47 decoys + 3 honeypots
  - T+135s: Linear wave pattern
  - T+150s: Phantom convoy pattern
  - T+180s: Trigger honeypot (artillery)
  - T+195s: Force AI adaptation
  - T+240s: Restore DRONE-2
  - T+270s: Reset state — systems nominal
  - T+300s: Pitch complete
- [x] `stop_pitch` aborts mid-sequence (clears all pending timeouts)
- [x] Each step broadcasts `[PITCH]` message to ops event log + `demo_step` to screen
- [x] Added "Stop Pitch" button to ops dashboard
- [x] Wired into `server/index.js`
- [x] **Verified:** 273 tests pass, lint clean

### 2.2 — Fix DV announce interval [PARTIAL] ✅
- [x] Changed `DV_ANNOUNCE_INTERVAL` from 5 to 3 in `server/protocol/mesh.js`
- [x] **Verified:** 160 protocol tests pass

### 2.3 — Add scenario button icons [M-25] ✅
- [x] Added Unicode icons to all scenario buttons: ⚡ ▼ ◎ ◇ → ⇢ ◌ ⟳ ⏸ ▶ ↺ ▶▶ ■
- [x] **Verified:** visual check in HTML

### 2.4 — Emit scenario_result events [PARTIAL] ✅
- [x] Already implemented in Phase 1 — `scenarios.js:emitResult()` fires after each dispatch
- [x] **Verified:** ops dashboard receives scenario_result events

### 2.5 — Fix event name mismatches [PARTIAL] ✅
- [x] Ops script now listens for both `ai.decision` AND `ai_decision` (shared handler)
- [x] Ops script now listens for both `deception.pattern_activated` AND `pattern_update`
- [x] **Verified:** 273 tests pass, lint clean

---

## Phase 3: Hardening

Deeper spec compliance and robustness. Do if time allows.

### 3.1 — Radio bridge spawn from Node.js [M-4]
- [ ] Create radio bridge integration in server (spawn Rust binary, pipe stdin/stdout)
- [ ] Parse JSON-lines from radio bridge stdout, emit as state events
- [ ] Forward transmission commands from state bus to radio stdin
- [ ] Depends on: radio bridge other instance completing their work

### 3.2 — Audit log hash chaining [W-5]
- [ ] Each audit entry includes SHA-256 hash of previous entry
- [ ] First entry hashes a sentinel value
- [ ] Remove or gate `reset()` behind a test-only flag
- [ ] **Test:** export audit log, verify hash chain integrity

### 3.3 — Fix flood routing [PARTIAL]
- [ ] `mesh.js:floodRoute()` should return ALL neighbors, not just best-signal
- [ ] `handleReceivedFrame()` should emit one `frame_to_send` per neighbor for flood mode
- [ ] **Test:** protocol tests pass, flood routing reaches all reachable nodes

### 3.4 — Improve statistical equivalence [PARTIAL]
- [ ] Decoy routing class: randomly select from `['urgent', 'routine', 'cover']` weighted to match real distribution
- [ ] Decoy destination: randomly select from known node IDs instead of always `'BROADCAST'`
- [ ] Share frame composition code path between `transmission.js` and `decoy_simulator.js`
- [ ] **Test:** deception tests pass, visual inspection of frame fields

### 3.5 — ROE state machine [M-8]
- [ ] Create `server/hq_brain/roe.js` with states: PEACETIME, DEFENSIVE, ACTIVE, EMERGENCY
- [ ] Each state defines allowed actions (broadcast levels, auto-actions)
- [ ] `normalizeResponse()` validates LLM output against current ROE state
- [ ] **Test:** ROE in PEACETIME blocks HIGH urgency auto-broadcast

### 3.6 — Ops controls disabled on disconnect [PARTIAL]
- [ ] In ops `script.js`, add `disabled` attribute to all trigger buttons when disconnected
- [ ] Remove `disabled` on reconnect
- [ ] **Test:** disconnect server → buttons grey out. Reconnect → buttons active.

### 3.7 — Landing page footer links [M-31]
- [ ] Add repo URL, docs link, contact info to `client/landing/index.html` footer
- [ ] **Test:** visual check, links work

### 3.8 — Missing .env.example entries [M-35]
- [ ] Add `MASTER_SECRET=`, `WS_PATH=`, `IDLE_OFFSET_MS=515`, `ENABLE_AUDIO_FEEDBACK=false`
- [ ] **Test:** `.env.example` covers all config.js fields

---

## Phase 4: Population Simulator

Server-side virtual node population for a realistic demo without 30 actual phones.

### 4.1 — Virtual node simulator
- [ ] Create `server/demo/population.js`
- [ ] On startup (or on `activate_decoys` / explicit trigger), spawn 30 virtual soldier nodes
- [ ] Spread positions realistically across the operational area (grid/cluster patterns, not pure random)
- [ ] Register each as a real node in `state.nodes` with `type: 'soldier'`, unique NATO callsigns
- [ ] Subscribe to cycle events — walk each virtual node through SYNC → TX/RX → LISTENING (same as `phone_sim.js`)
- [ ] Compute neighbor tables by proximity, generate transmission events between virtual nodes
- [ ] Virtual nodes appear on big screen and ops minimap identically to real phone nodes
- [ ] Support configurable count via `NUM_SIMULATED_SOLDIERS` env var (default 30)
- [ ] Wire into `server/index.js` — activate on startup or via scenario trigger
- [ ] **Test:** start server → big screen shows 30+ labeled nodes with fiber tethers, state transitions, transmission arcs

### 4.2 — Population dynamics
- [ ] Some virtual nodes occasionally get jammed and recover (ambient threat simulation)
- [ ] Virtual nodes generate realistic traffic patterns (not all TX at the same time)
- [ ] Transmission arcs visible on big screen between virtual nodes during burst windows
- [ ] **Test:** big screen looks alive with mesh activity without any real phones connected

---

## Out of Scope (Post-hackathon / P1 functionality)

These are documented for completeness but not planned for implementation now:

- M-6: Power randomization (6dB per cycle)
- M-7: Cover signal generation (drone wideband emission)
- M-9: Strategic AI loop (hourly)
- M-10: After-action AI loop (post-mission)
- M-11: Key rotation mechanism
- M-12: Drone loss detection/recovery
- M-13: Inertial timing fallback
- M-14/M-15: Replay and generative fake data strategies
- M-16: Anti-pattern-of-life measures
- M-17: HQ-to-ground downlink via drone broadcast
- M-18: Anomaly detection ML model
- M-19: Counter-EW jammer localization
- M-20: Radio-silence zone suppression
- M-21/M-22: mesh.discoverNeighbors/handleNodeLoss interface methods
- M-23/M-24: hq_brain.proposeBroadcast/updateChoreography interface methods
- M-26/M-27/M-28: Ops click-to-expand, diagnostics, minimap scene switch
- M-29: Phone pull-to-refresh
- M-30: Audio feedback system
- M-32: Big screen geographic map overlay
- M-37: Adversarial ML classifier test
