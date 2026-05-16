# Full System Audit — Implementation vs. Design Specifications

Comprehensive gap analysis of every design doc against the actual codebase.
Date: 2026-05-16

---

## Scorecard

| Category | DONE | PARTIAL | WRONG | MISSING |
|---|---|---|---|---|
| Requirements (01) | 28 | 21 | 3 | 16 |
| Protocol (03) | 23 | 15 | 3 | 6 |
| HQ Brain (05) | 25 | 16 | 2 | 6 |
| Build Components (06) | ~45 | ~18 | 0 | ~12 |
| Stack/Demo/UI (07+08+10) | ~55 | ~25 | 0 | ~20 |
| **Estimated Total** | **~176** | **~95** | **~7** | **~60** |

---

## SHOW-STOPPERS (Must fix for demo)

### SS-1: No Scenario Dispatcher

**The single biggest gap.** The ops dashboard buttons emit `ops.trigger_scenario` events but **no server code dispatches them** to subsystems. Clicking "Inject Jamming", "Drop Drone", "Activate Decoys", etc. does nothing.

The deception engine listens for `ops.trigger_decoys_on`, `ops.trigger_pattern`, `ops.trigger_honeypot` — but the dashboard emits `ops.trigger_scenario` with a `scenario` field. No bridge connects them.

**Fix:** Create `server/demo/scenarios.js` — a dispatcher that listens for `ops.trigger_scenario` and calls the right subsystem:
- `inject_jamming` → `mesh.declareJammed()` + add to `state.jamming_zones`
- `drop_drone` → remove drone from `state.drones`
- `activate_decoys` → `deception.spawnDecoys()`
- `activate_pattern` / `deactivate_pattern` → `wavePatterns.activate()` / `deactivate()`
- `trigger_honeypot` → `honeypot.trigger()`
- `pause_cycles` / `resume_cycles` → stop/start cycle ticker
- `reset_state` → reset all subsystems

### SS-2: No Demo Orchestrator

The "Run Full Pitch (5 min)" button sends an event nothing handles. The 5-minute scripted demo sequence does not exist. `server/demo/` directory is entirely missing.

**Fix:** Create `server/demo/script.js` with timed sequence: show sync → start burst → inject jamming → drone loss → decoys → honeypot → AI adaptation.

### SS-3: HQ Brain Never Initialized

`server/index.js` never `require()`s or `init()`s `server/hq_brain/index.js`. The entire AI pipeline is dead code in production — it only runs in tests.

**Fix:** Add `const hqBrain = require('./hq_brain'); hqBrain.init(state);` to `server/index.js`.

---

## WRONG (Implemented incorrectly)

### W-1: Burst window 300ms, spec says < 50ms

`server/config.js:17` sets `burst_window_ms: 300`. The spec says ground transmissions must be under 50ms. The Rust radio bridge correctly uses 50ms. The JS server-side value is 6x too large.

**Fix:** Change to `burst_window_ms: 50` in config.js. The 300ms in the spec is the SYNC-beta+BURST *phase* duration, but the actual ground burst window within it is 50ms.

### W-2: Frequency hops per slot — 3 instead of 10

`server/protocol/transmission.js:11` sets `HOPS_PER_SLOT: 3`. Spec requires 10 hops per sub-slot.

**Fix:** Change to `HOPS_PER_SLOT: 10`.

### W-3: JSON frame MAC uses HMAC-SHA256, spec says Poly1305

`server/protocol/crypto.js:66` uses `crypto.createHmac('sha256', ...)`. Spec says Poly1305. The AEAD path (binary frames) correctly uses ChaCha20-Poly1305, but the standalone MAC for JSON frames diverges.

**Fix:** Accept as documented deviation (DECISIONS.md already notes this). Node.js doesn't expose standalone Poly1305.

### ~~W-4: Ollama timeout 120s~~ — ACCEPTED

Ollama is a local fallback for machines without ConfidentialMind. Local inference on CPU is inherently slow. The 120s timeout is intentional and correct — constraining it to 5s would make the fallback unusable. The 5-second tactical budget applies to ConfidentialMind (which has a 3s timeout). When using Ollama, operators accept higher latency as a tradeoff for air-gapped operation.

### W-5: Audit logs not immutable

`server/hq_brain/audit.js` stores entries in a mutable array with a `reset()` function. No hash chain, no checksums, no tamper detection.

**Fix:** Add hash chaining (each entry includes hash of previous). Remove `reset()` or restrict to test-only.

### W-6: Confidence-based urgency downgrade not enforced

Prompt says "if confidence < 0.5, downgrade urgency by one level" but `normalizeResponse()` doesn't enforce this. A LOW-confidence HIGH-urgency response triggers auto-broadcast.

**Fix:** Add `if (response.confidence < 0.5 && response.urgency === 'HIGH') response.urgency = 'MEDIUM';` to normalizeResponse.

### W-7: Architectural invariant #1 violated

Spec: "No ground node ever emits without a sync-pulse trigger from a drone." Implementation: ground nodes emit based on server's `setTimeout` clock, not drone sync pulses. Acceptable for hackathon but should be documented.

### W-8: Master secret hardcoded

`'tactical-mesh-default-secret-change-me'` appears in `transmission.js:8`, `decoy_simulator.js:9`, `fake_data.js:42`, `honeypot.js:97`. Should read from config/env.

---

## MISSING — By Priority

### P0: Demo-critical

| # | What | Where it should be | Impact |
|---|---|---|---|
| M-1 | Scenario dispatcher | `server/demo/scenarios.js` | All ops buttons are dead |
| M-2 | Demo orchestrator (7 scenarios) | `server/demo/script.js` | No automated pitch |
| M-3 | HQ Brain init in server startup | `server/index.js` | AI pipeline never runs |
| M-4 | Radio bridge spawn from Node | `server/index.js` | No radio integration |
| M-5 | Pause/resume cycle handlers | `server/index.js` | Pause button dead |

### P1: Functionality gaps

| # | What | Spec source | Notes |
|---|---|---|---|
| M-6 | Power randomization (6dB) | FR-2.4 | No code anywhere |
| M-7 | Cover signal generation | 03-protocol | Drone cover emission entirely absent |
| M-8 | ROE state machine | 05-ai | Only natural-language prompt, no programmatic enforcement |
| M-9 | Strategic loop (hourly) | 05-ai | Prompt exists, no execution logic |
| M-10 | After-action loop | 05-ai | Not implemented |
| M-11 | Key rotation mechanism | FR-7.4, FR-8 | Static secret throughout |
| M-12 | Drone loss detection/recovery | NFR-1 | No failover logic |
| M-13 | Inertial timing fallback | NFR-1 | No fallback when all drones lost |
| M-14 | Replay fake data strategy | 04-deception | Stub only, falls through to noise |
| M-15 | Generative fake data strategy | 04-deception | Stub only |
| M-16 | Anti-pattern-of-life measures | 04-deception | No schedule rotation, population dynamics |
| M-17 | HQ-to-ground downlink broadcast | 03-protocol | No reverse path through drones |
| M-18 | Anomaly detection model | 05-ai | No ML classifier |
| M-19 | Counter-EW jammer localization | 05-ai | No signals geometry |
| M-20 | Radio-silence zone suppression | 05-ai | Auto-broadcast has no zone check |

### P2: Polish & completeness

| # | What | Notes |
|---|---|---|
| M-21 | `mesh.discoverNeighbors()` interface method | Neighbor discovery is implicit only |
| M-22 | `mesh.handleNodeLoss(nodeId)` interface method | Only `removeNeighbor` exists |
| M-23 | `hq_brain.proposeBroadcast()` interface | Broadcasts emitted internally only |
| M-24 | `hq_brain.updateChoreography()` interface | No callable method |
| M-25 | Ops button icons (spec: icon + label) | Text-only buttons |
| M-26 | Ops event log click-to-expand | Not implemented |
| M-27 | Ops adapter click-for-diagnostics | Not implemented |
| M-28 | Ops minimap click-to-switch-scene | Not implemented |
| M-29 | Phone pull-to-refresh gesture | Not implemented |
| M-30 | Audio feedback system | No sound effects anywhere |
| M-31 | Landing footer contact/repo/docs links | Only event name shown |
| M-32 | Big screen geographic map overlay | Spec says optional |
| M-33 | Prettier config | Only ESLint configured |
| M-34 | `stub_radio.js` dev tool | Not implemented |
| M-35 | `.env.example` missing `WS_PATH`, `IDLE_OFFSET_MS`, `ENABLE_AUDIO_FEEDBACK` | Incomplete template |
| M-36 | Backup video/slides | No media assets |
| M-37 | Adversarial ML classifier test | No verification tooling |
| M-38 | Model version in audit entries | Only string reference logged |
| M-39 | `client/screen/assets/` directory | No local assets |

---

## PARTIAL — Significant gaps in existing code

### Event Name Mismatches (cross-component)

| Client expects | Server sends | Affected component |
|---|---|---|
| `'ai.decision'` | `'ai_decision'` | Ops event log (fixed in router, but still inconsistent) |
| `'deception.pattern_activated'` | `'pattern_update'` | Ops pattern tracking |
| `'scenario_result'` | never emitted | Ops event log |
| `'event'` | never emitted (before our fix) | Ops event log |
| `'ops.trigger_decoys_on'` | `'ops.trigger_scenario'` | Decoy simulator |
| `'ops.trigger_pattern'` | `'ops.trigger_scenario'` | Wave patterns |
| `'ops.trigger_honeypot'` | `'ops.trigger_scenario'` | Honeypot system |

### Statistical Equivalence (deception)

Decoy frames are cryptographically identical to real frames (same encryption, size, timing). However:
- Inter-packet interval distribution not matched
- Routing class always `'cover'` for decoys (real nodes use urgent/routine/cover)
- Destination always `'BROADCAST'` for decoys (real nodes route to specific peers)
- Time-of-day variation not implemented
- Decoy state machine names don't match spec (LISTENING vs IDLE, SYNC vs ARMED)
- Frame composition is a separate code path from `transmission.js` (spec says shared binary)

### Flood Routing

`mesh.js:floodRoute()` returns a single best-signal neighbor instead of broadcasting to all neighbors. True flood should retransmit to every neighbor.

### Mesh Frame Format

Mesh layer uses JSON objects rather than the spec's binary format (2B source, 2B destination, 1B TTL, 1B class, 4B sequence). Functionally correct but sizes not enforced.

### DV Routing Reconvergence

Neighbor timeout is 3 cycles but DV announcement interval is 5 cycles. Reconvergence can take up to 5 cycles, exceeding the "within 3 cycles" spec.

### iOS Vibration

`navigator.vibrate()` is not supported on iOS Safari. Phone clients on iPhone get no haptic feedback. No alternative (Web Audio API pulse) is implemented.

### Phone Page Weight

HTML+CSS+JS is ~19KB, but socket.io client (~50KB) + Google Fonts push total near or above the 100KB target.

### Ops Dashboard Controls Disabled on Disconnect

Red banner appears but control buttons are not explicitly disabled during disconnect.

---

## UI DESIGN DEVIATIONS (Minor)

| Spec | Implementation | File |
|---|---|---|
| Grid overlay 20% opacity | 30% opacity | `client/screen/render.js` |
| Jamming zone fill 30% opacity | 15% opacity | `client/screen/render.js` |
| Routes: `/operator-screen`, `/control-panel` | `/screen`, `/ops` | `server/http.js` |
| Default port 3000 | 7620 | `server/config.js` |
| Jamming label includes "ESTIMATED JAMMER POSITION" | Shows only "EW ZONE" | `client/screen/render.js` |
| Alert vibration "3 long pulses" | `[100,50,100,50,100,50,200]` = 4 vibrations | `client/phone/script.js` |
| Connection indicator top-right (all UIs) | Big screen: top-center | `client/screen/index.html` |

---

## WHAT WORKS WELL

- **Design system** — all colors, fonts, spacing, component patterns match spec exactly
- **Protocol crypto** — ChaCha20-Poly1305, HKDF, slot derivation, frame encoding all correct
- **Mesh routing** — DV routing, neighbor discovery, self-healing, cross-domain forwarding all tested
- **Wave choreography** — all 4 patterns implemented correctly with composite union logic
- **Honeypot system** — sensor classification matrix, report generation, urgent mesh routing
- **HQ Brain tactical loop** — event queue, LLM integration, urgency classification, auto-broadcast, audit
- **Big Screen renderer** — all visual elements, 60 FPS, cached grid, sync pulses, transmission arcs
- **Phone client** — three-state machine, haptic feedback, wake lock, responsive design
- **Landing page** — sync beacon visual, QR generation, four pillars, professional aesthetic

---

## RECOMMENDED FIX ORDER

### Phase 1: Make the demo work — all P0 items (< 1 day)

1. **M-1: Create scenario dispatcher** (`server/demo/scenarios.js`) — bridges ops triggers to subsystems
2. **M-3: Init HQ Brain** in `server/index.js` — AI pipeline currently dead code
3. **M-5: Add pause/resume cycle handlers** — pause button currently dead
4. **W-1: Fix burst window** to 50ms in config
5. **W-6: Fix confidence-based urgency downgrade** enforcement

### Phase 2: Demo orchestrator + polish (< 1 day)

6. **M-2: Create demo orchestrator** (`server/demo/script.js`) — 5-minute scripted sequence
7. **Move master secret to env config** (out of source code)
8. **Fix DV announce interval** to 3 (match reconvergence spec)
9. **Add scenario button icons** to ops dashboard

### Phase 3: Hardening (if time allows)

10. **M-4: Radio bridge spawn from Node.js** (depends on radio bridge completion)
11. Add hash-chain audit immutability
12. Fix flood routing to broadcast to all neighbors
13. Improve statistical equivalence (routing class distribution, destination variety)
14. Add ROE state machine (programmatic, not prompt-only)
