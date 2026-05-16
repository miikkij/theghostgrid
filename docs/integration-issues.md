# Integration Issues & Improvement Plan

Investigation of cross-component integration gaps discovered during end-to-end testing.
Date: 2026-05-16

---

## Issue 1: Cycle period change has no effect

**Severity:** High — operator cannot control demo pacing
**Affected:** Ops dashboard, all clients

### Root cause

Four breaks in the chain from dropdown to cycle ticker:

1. **Server has no handler.** `controls.js:231` emits `ops.set_cycle_period` but `websocket.js` only handles `ops.trigger_scenario` and `phone.acknowledge`. The event is silently dropped.
2. **Config is static.** `config.js` is a frozen module-level object loaded once at startup.
3. **Ticker caches period.** `index.js:18` destructures `period_ms` into a `const` at startup. The `setTimeout` loop on line 57 always uses the original 1000ms value.
4. **Ticker never re-reads state.** Even if `state.set('cycle.period_ms', 5000)` were called, `runCycle()` doesn't read from the state store.

### Fix needed

- Add `socket.on('ops.set_cycle_period', ...)` handler in `websocket.js`
- Change `runCycle()` to read `state.get('cycle.period_ms')` each iteration
- Recalculate sub-phase offsets (prep, beta, idle) proportionally when period changes
- Fix naming: router sends `sync_beta_offset_ms` populated with `period_ms` (semantic confusion)

---

## Issue 2: Adapter status panel never updates

**Severity:** Medium — cosmetic during demo but expected by judges
**Affected:** Ops dashboard adapter panel, AI status indicator

### Root cause

The entire server-side plumbing is missing:

1. **No radio bridge process manager.** No code in `server/` spawns the Rust `radios` binary, reads its stdout, or parses its JSON-lines. The Rust code emits `AdapterStatus` events to stdout but nobody reads them.
2. **No `adapter_status` event forwarding in the router.** `router.js` has no handler for adapter events.
3. **No periodic health polling for ConfidentialMind/Ollama.** Health functions exist in `confidentialmind_client.js:61` and `ollama_fallback.js:58` but are only called once at startup. No periodic re-check, no status broadcast.
4. **No `adapters` field in server state.** `state.js` INITIAL_STATE has no adapters key.

### What exists

- Client-side listener and rendering works (`script.js:101`, `script.js:295-316`)
- Rust radio bridge emits `AdapterStatus` to stdout (`radios/src/adapter.rs`)
- Mock mode correctly simulates adapter status

### Fix needed

- Create `server/radio_bridge.js` — spawn Rust process, parse JSON-lines, emit events
- Add periodic LLM health polling (every 30s) that emits `adapter_status` for the `cm` adapter
- Add `adapter_status` forwarding in `router.js`
- When radio bridge is not running (RADIO_ENABLED=false), emit simulated "ok_simulated" status

---

## Issue 3: Big screen shows no TX/RX animations on phone nodes

**Severity:** High — primary visual artifact looks dead
**Affected:** Big screen `/screen`

### Root cause

**Payload format mismatch between router and big screen client.**

- `phone_sim.js` calls `state.set('nodes.BRAVO-1.state', 'TX')` → triggers `state.changed`
- `router.js:53` forwards to screen as `{ path: 'nodes.BRAVO-1.state', value: 'TX' }`
- `script.js:482` expects `{ nodeId: 'BRAVO-1', state: 'TX' }` — checks `data.nodeId` which is `undefined` → silently exits

The renderer in `render.js:303-368` is correct — it properly draws TX/RX rings when `node.state` matches. The state just never gets updated client-side.

### Fix needed (choose one)

**Option A — Fix the router** to send `{ nodeId, [field]: value }` instead of `{ path, value }`:
```js
const parts = path.split('.');
const nodeId = parts[1];
const field = parts.slice(2).join('.');
state.broadcastTo('screen', 'node_state_change', { nodeId, [field]: value });
```

**Option B — Fix the client handler** to parse the `path` field. Option A is cleaner.

---

## Issue 4: Ops event log is always empty

**Severity:** High — operator has no visibility into system events
**Affected:** Ops dashboard event log panel

### Root cause

Three separate event name mismatches:

| Client listens for | Server broadcasts | Status |
|---|---|---|
| `'event'` (script.js:85) | — | Server never emits this event name |
| `'ai.decision'` (script.js:89) | `'ai_decision'` (underscore) | **Name mismatch** |
| `'scenario_result'` (script.js:122) | — | Server never emits this |
| `'deception.pattern_activated'` (script.js:106) | `'pattern_update'` | **Name mismatch** |
| `'deception.pattern_deactivated'` (script.js:113) | `'pattern_update'` | **Name mismatch** |

### Fix needed

- Decide on canonical event names (dot vs underscore) and align client+server
- Add a generic `'event'` broadcast in the router for notable system events (honeypot triggers, node joins/leaves, jamming, AI decisions)
- Route `'scenario_result'` events from the demo orchestrator when it exists

---

## Issue 5: Ops minimap doesn't update after initial load

**Severity:** Medium — operator must refresh to see current state
**Affected:** Ops dashboard live mesh state panel

### Root cause

1. **No ongoing `state_update` broadcasts.** Server only sends `state_update` once on initial WebSocket connect (`websocket.js:85`). No periodic re-broadcast.
2. **Ops client doesn't handle `node_state_change`.** The minimap redraws from `state.nodes` every 100ms, but the local `state.nodes` object is never updated after the initial snapshot because the client doesn't listen for `node_state_change`.

### Fix needed

- Add `node_state_change` handler in ops `script.js` that updates `state.nodes`
- OR add periodic `state_update` broadcast in the router (e.g., every 1s)
- The minimap rendering loop itself works fine (10 FPS setInterval)

---

## Issue 6: Phone neighbors and events not populating

**Severity:** Medium — phone shows "Discovering..." and "Waiting for events..." forever with only 2 nodes
**Affected:** Phone client `/phone`

### Root cause

With only 2 phone nodes, both randomly positioned, they may be beyond the 0.35 neighbor radius. `phone_sim.js:29` computes neighbors by proximity — if the two nodes land > 0.35 apart, both get empty neighbor lists and no events are generated.

### Fix needed

- Increase neighbor radius from 0.35 to 0.5 (or make it configurable)
- OR include decoy nodes and drones in the neighbor computation (not just soldier nodes)
- Consider generating synthetic events even without neighbors (e.g., relay events, sync confirmations)

---

## Issue 7: Design clarification — continuous cycling is correct

**Confirmed:** The burst cycle is designed to run continuously at 1s intervals.

Per `03-design-protocol.md`: *"The fundamental time unit is the burst cycle, a configurable interval (default: 1 second) during which one round of synchronized transmission occurs."*

The deception invariant requires constant transmission: *"A node may have a packet to transmit or may have nothing; if it has nothing, it transmits a fake-data filler."* Pausing cycles would distinguish real from decoy nodes.

The demo has a toggle (`burst-cycle-on`) for presentation pacing, but architecturally, cycles never pause during operations.

**The 5000ms "slow" option is valid for demo pacing** — it just doesn't work yet (Issue 1).

---

## Priority order for fixes

| Priority | Issue | Effort | Impact |
|---|---|---|---|
| P0 | #3 Big screen node animations | Small (router payload fix) | Demo looks alive |
| P0 | #1 Cycle period control | Medium (4 changes) | Operator can pace the demo |
| P1 | #4 Event log empty | Small (name alignment) | Operator has visibility |
| P1 | #5 Ops minimap stale | Small (add handler) | Ops dashboard is useful |
| P1 | #6 Phone neighbors empty | Small (radius tweak) | Phone feels real |
| P2 | #2 Adapter status | Medium (new module) | Panel shows real status |

---

## Files requiring changes

### Server
- `server/websocket.js` — add `ops.set_cycle_period` handler
- `server/index.js` — dynamic period in cycle ticker
- `server/router.js` — fix node_state_change payload, align event names, add generic event broadcasting
- `server/phone_sim.js` — increase neighbor radius
- `server/radio_bridge.js` — new file, radio process manager (when radio bridge is ready)

### Client
- `client/screen/script.js` — fix node_state_change handler (or fix in router)
- `client/ops/script.js` — add node_state_change handler, fix event name mismatches
