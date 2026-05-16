# Implementation Plan — Post-Audit Fixes

Working document. Each task is checked off after implementation AND verification.
Source: [full-system-audit.md](full-system-audit.md)

---

## Phase 1: Make the Demo Work

Everything needed for ops buttons to produce visible system responses.

### 1.1 — Create scenario dispatcher [M-1]
- [ ] Create `server/demo/scenarios.js`
- [ ] Listen for `ops.trigger_scenario` on the state event bus
- [ ] Dispatch `inject_jamming` → call `mesh.declareJammed(area)`, add zone to `state.jamming_zones`, broadcast event
- [ ] Dispatch `drop_drone` → remove a drone from `state.drones`, broadcast event
- [ ] Dispatch `activate_decoys` → call `deception.spawnDecoys()` with configured count
- [ ] Dispatch `activate_pattern` → call `deception.activatePattern()` with params from trigger
- [ ] Dispatch `deactivate_pattern` → call `deception.deactivatePattern()` by ID
- [ ] Dispatch `trigger_honeypot` → call `deception.triggerHoneypot()` on a random honeypot
- [ ] Dispatch `reset_state` → reset nodes, drones, jamming zones, patterns to initial state
- [ ] Wire into `server/index.js` via `require` + `init(state)`
- [ ] **Test:** press each ops button → verify visible change on big screen and ops minimap

### 1.2 — Initialize HQ Brain at startup [M-3]
- [ ] Add `require('./hq_brain').init(state)` to `server/index.js`
- [ ] Verify no crash on startup (LLM may be unavailable — degraded mode should activate)
- [ ] **Test:** trigger honeypot → verify `ai.decision` event appears in ops AI panel

### 1.3 — Pause/resume cycle handlers [M-5]
- [ ] Add `ops.pause_cycles` and `ops.resume_cycles` handlers (either in scenario dispatcher or in `index.js`)
- [ ] `pause_cycles` → clear the cycle timer, set `state.cycle.phase = 'paused'`, broadcast
- [ ] `resume_cycles` → restart the cycle ticker
- [ ] Export `stopCycleTicker` and `startCycleTicker` from `index.js` or make them accessible
- [ ] **Test:** click Pause in ops → cycles stop, phase shows "paused". Click Resume → cycles resume.

### 1.4 — Fix burst window config [W-1]
- [ ] Change `server/config.js:17` from `burst_window_ms: 300` to `burst_window_ms: 50`
- [ ] Verify cycle timing still works (idle phase gets longer: 1000 - 215 - 50 = 735ms)
- [ ] **Test:** server starts, cycles run, no timing errors in console

### 1.5 — Fix confidence-based urgency downgrade [W-6]
- [ ] In `server/hq_brain/tactical_loop.js` `normalizeResponse()`, add: if confidence < 0.5 and urgency is HIGH, downgrade to MEDIUM
- [ ] **Test:** run HQ brain test suite — all 43 tests still pass

### 1.6 — Fix frequency hops per slot [W-2]
- [ ] Change `server/protocol/transmission.js:11` from `HOPS_PER_SLOT: 3` to `HOPS_PER_SLOT: 10`
- [ ] **Test:** run protocol test suite — all 160 tests still pass (hop count assertions will need updating)

### 1.7 — Move master secret to env config [W-8]
- [ ] Add `MASTER_SECRET` to `server/config.js` reading from `process.env.MASTER_SECRET` with current default as fallback
- [ ] Update `server/protocol/transmission.js` to read from config instead of hardcoded string
- [ ] Update `server/deception/decoy_simulator.js` to read from config
- [ ] Update `server/deception/fake_data.js` to read from config
- [ ] Update `server/deception/honeypot.js` to read from config
- [ ] Add `MASTER_SECRET=` to `.env.example`
- [ ] **Test:** all test suites pass, server starts clean

---

## Phase 2: Demo Orchestrator + Polish

Scripted 5-minute pitch sequence and UX improvements.

### 2.1 — Create demo orchestrator [M-2]
- [ ] Create `server/demo/script.js`
- [ ] Implement `runFullPitch(state)` — timed sequence of scenario dispatches:
  - T+0s: Ensure burst cycles running, spawn initial decoys if needed
  - T+10s: Show sync beacon (visual — cycles are already running)
  - T+30s: Inject jamming in a sector → mesh reconverges
  - T+60s: Drop a drone → routing adapts
  - T+90s: Activate decoy population + linear wave pattern
  - T+120s: Trigger honeypot → AI tactical loop → alert on phones
  - T+150s: Force AI adaptation → choreography update
  - T+180s: Deactivate jamming → recovery
  - T+240s: Show final state — all systems nominal
  - T+300s: Pitch complete
- [ ] Support `stop` to abort mid-sequence (clear all pending timeouts)
- [ ] Wire `run_full_pitch` scenario trigger to `runFullPitch()`
- [ ] **Test:** click "Run Full Pitch" → 5-minute sequence runs visibly on big screen

### 2.2 — Fix DV announce interval [PARTIAL]
- [ ] Change `server/protocol/mesh.js` `DV_ANNOUNCE_INTERVAL` from 5 to 3
- [ ] **Test:** protocol tests pass, reconvergence within 3 cycles

### 2.3 — Add scenario button icons to ops [M-25]
- [ ] Add inline SVG icons to each scenario button in `client/ops/index.html`
- [ ] Icons: ⚡ jamming, 🔻 drone drop, 🎯 honeypot, 👥 decoys, 〰 wave, 🧠 AI, ⏸ pause, ▶ resume, ↺ reset, ▶▶ pitch
- [ ] **Test:** visual check — all buttons have icon + label

### 2.4 — Emit scenario_result events [PARTIAL]
- [ ] After each scenario dispatch in `scenarios.js`, emit `scenario_result` event with success/failure
- [ ] Ops dashboard already listens for `scenario_result` (script.js:122)
- [ ] **Test:** press ops button → event log shows scenario result entry

### 2.5 — Fix event name mismatches [PARTIAL]
- [ ] In ops `script.js`, add listener for `'ai_decision'` (underscore) alongside existing `'ai.decision'` (dot)
- [ ] In ops `script.js`, add listener for `'pattern_update'` alongside `'deception.pattern_*'` events
- [ ] **Test:** trigger pattern activation → ops pattern list updates. Trigger AI → ops AI panel updates.

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
