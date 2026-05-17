# Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 real wiring issues found in the codebase audit, add routing table tab to ops dashboard, clean up dead exports — so no engineer at the hackathon can spot unwired code.

**Architecture:** Each task is independent. We wire phantom event listeners to real emitters, connect ROE to the dashboard, add the missing wave pattern trigger, add a routing table tab to the ops UI, and remove dead exports that serve no purpose. Every change is verified by test or manual server start.

**Tech Stack:** Node.js (server), vanilla JS (client), Socket.IO (WebSocket)

---

## File Map

| File | Changes |
|------|---------|
| `server/demo/scenarios.js` | Add `pattern_cluster` + `set_roe` + `destroy_node` handlers, emit `mesh.jamming_detected` from `inject_jamming` |
| `server/protocol/mesh.js` | Emit `mesh.jamming_detected` from `declareJammed()` |
| `server/hq_brain/tactical_loop.js` | Remove `protocol.anomaly_detected` listener |
| `server/hq_brain/operational_loop.js` | Add `roe.canUpdateChoreography()` check |
| `server/websocket.js` | Add `ops.set_roe` handler |
| `server/router.js` | Forward ROE state changes + routing table requests to ops |
| `client/ops/index.html` | Add "Random Walk" button, ROE dropdown, "Routing" tab, "Destroy Node" button |
| `client/ops/controls.js` | Add `pattern_cluster` + `destroy_node` triggers, ROE dropdown handler |
| `client/ops/script.js` | Add routing table rendering + ROE state display |
| `server/deception/decoy_simulator.js` | Remove phantom `ops.trigger_*` listeners |
| `server/hq_brain/index.js` | Remove dead exports (`ingestEvent`, `getAuditTrail`, `getLastReasoning`) |
| `server/protocol/transmission.js` | Remove dead `getConfig` export |
| `server/protocol/crypto.js` | Remove dead `SLOT_COUNT`, `KEY_LENGTH`, `MAC_LENGTH` exports |
| `server/protocol/frame.js` | Remove dead `HEADER_SIZE`, `PLAINTEXT_SIZE`, `FRAME_TYPES`, `FRAME_TYPE_NAMES`, `nodeIdToUint16`, `padPayload` exports |
| `server/deception/honeypot.js` | Remove dead `VALID_SENSORS` export |
| `server/deception/fake_data.js` | Remove dead `setStrategy`, `getStrategy`, `PAYLOAD_SIZE` exports |
| `server/hq_brain/roe.js` | Remove dead `STATES` export |
| `server/hq_brain/prompts.js` | Remove dead `STRATEGIC_LOOP_PROMPT` export |

---

## Task 1: Wire `mesh.jamming_detected` so tactical loop actually processes jamming

**Context:** `tactical_loop.js:22` listens for `mesh.jamming_detected` but nothing emits it. Jamming goes through `scenarios.js` → `mesh.declareJammed()` which emits `mesh.routing_converged`. The fix: emit `mesh.jamming_detected` from `declareJammed()` with the affected area and nodes, so the HQ brain can classify and broadcast jamming alerts.

**Files:**
- Modify: `server/protocol/mesh.js:316-318`
- Modify: `server/hq_brain/tactical_loop.js:25` (remove phantom listener)
- Test: `npm run test:protocol`

- [ ] **Step 1: Add `mesh.jamming_detected` emission to `declareJammed()`**

In `server/protocol/mesh.js`, find the existing event emission inside `declareJammed()` (around line 316):

```javascript
  if (_state) {
    _state.emit('mesh.routing_converged', { reason: 'jamming', affected, area });
  }
```

Replace with:

```javascript
  if (_state) {
    _state.emit('mesh.jamming_detected', {
      timestamp: Date.now(),
      affected_nodes: affected,
      affected_area: area,
      frequency_band: '2.4 GHz',
    });
    _state.emit('mesh.routing_converged', { reason: 'jamming', affected, area });
  }
```

- [ ] **Step 2: Remove `protocol.anomaly_detected` phantom listener**

In `server/hq_brain/tactical_loop.js`, delete lines 25-27:

```javascript
  state.on('protocol.anomaly_detected', (event) => {
    enqueue({ ...event, event_type: 'anomaly' });
  });
```

This event is never emitted anywhere. If anomaly detection is built later, the listener can be re-added when the emitter exists.

- [ ] **Step 3: Run tests**

Run: `npm run test:protocol`
Expected: 160 passed, 0 failed

Run: `npm run test:radio-bridge`
Expected: 37 passed, 0 failed

- [ ] **Step 4: Manual verification**

Start server: `npm run dev`
Open ops dashboard. Click "Inject Jamming."
Check the ops event log — should now show both a routing event AND an AI decision about the jamming (if LLM backend is available) or at least the event should reach the tactical loop queue.

- [ ] **Step 5: Commit**

```bash
git add server/protocol/mesh.js server/hq_brain/tactical_loop.js
git commit -m "fix: wire mesh.jamming_detected to tactical loop, remove phantom anomaly listener"
```

---

## Task 2: Wire ROE to ops dashboard

**Context:** ROE (Rules of Engagement) is a state machine in `server/hq_brain/roe.js` with 4 states: PEACETIME, DEFENSIVE, ACTIVE, EMERGENCY. `enforce()` is called on every tactical loop decision and caps urgency / blocks broadcasts based on state. But `setState()` is never called — ROE is stuck on ACTIVE forever. The fix: add a dropdown to the ops dashboard that calls `setState()`.

ROE matters because:
- PEACETIME: AI can only log (LOW urgency max, no auto-broadcast, no choreography)
- DEFENSIVE: AI can recommend (MEDIUM max, no auto-broadcast, choreography allowed)
- ACTIVE: AI can auto-broadcast HIGH urgency alerts and update choreography
- EMERGENCY: Same as ACTIVE (reserved for future escalation rules)

**Files:**
- Modify: `server/websocket.js:113` (add handler after `ops.set_cycle_period`)
- Modify: `server/demo/scenarios.js:273` (add `set_roe` handler)
- Modify: `server/hq_brain/operational_loop.js` (add ROE check before choreography emit)
- Modify: `server/router.js` (forward ROE changes to clients)
- Modify: `client/ops/index.html:63-68` (add ROE dropdown in AI/HQ section)
- Modify: `client/ops/controls.js` (add ROE dropdown handler)
- Modify: `client/ops/script.js` (display current ROE state)

- [ ] **Step 1: Add WebSocket handler for ROE**

In `server/websocket.js`, after the `ops.set_cycle_period` handler (line 113), add:

```javascript
    socket.on('ops.set_roe', (data) => {
      if (data && data.state) {
        state.emit('ops.set_roe', data);
      }
    });
```

- [ ] **Step 2: Add `set_roe` scenario handler**

In `server/demo/scenarios.js`, after the `pattern_radial` shortcut (line 272), add:

```javascript
  set_roe(params) {
    const roe = require('../hq_brain/roe');
    const newState = params.state || 'ACTIVE';
    const changed = roe.setState(newState);
    if (changed) {
      _state.set('roe_state', newState);
      _state.broadcast('roe_state_changed', { state: newState });
      log.info({ roe: newState }, 'ROE state changed');
    }
  },
```

Also register a direct event listener in `init()`, after line 22:

```javascript
  state.on('ops.set_roe', (data) => {
    dispatch('set_roe', data);
  });
```

- [ ] **Step 3: Add ROE check in operational loop**

In `server/hq_brain/operational_loop.js`, find the choreography emit block (around line 60):

```javascript
  if (result.recommended_changes.length > 0) {
    state.emit('ops.update_choreography', {
```

Wrap it with a ROE check:

```javascript
  const roe = require('./roe');
  if (result.recommended_changes.length > 0 && roe.canUpdateChoreography()) {
    state.emit('ops.update_choreography', {
```

Add an else log for when ROE blocks it:

```javascript
  } else if (result.recommended_changes.length > 0) {
    log.info({ roe: roe.getState() }, 'Choreography changes blocked by ROE');
  } else {
```

- [ ] **Step 4: Add ROE dropdown to ops dashboard HTML**

In `client/ops/index.html`, find the AI/HQ control group (after the "Force AI Adaptation" button, around line 70). Add before the closing `</div>` of that group:

```html
        <div class="roe-control">
          <label class="roe-label">ROE</label>
          <select id="roe-select" class="roe-select">
            <option value="PEACETIME">PEACETIME</option>
            <option value="DEFENSIVE">DEFENSIVE</option>
            <option value="ACTIVE" selected>ACTIVE</option>
            <option value="EMERGENCY">EMERGENCY</option>
          </select>
        </div>
```

- [ ] **Step 5: Add ROE dropdown handler to controls.js**

In `client/ops/controls.js`, inside the `init(socket)` function, after the trigger button wiring, add:

```javascript
  var roeSelect = document.getElementById('roe-select');
  if (roeSelect) {
    roeSelect.addEventListener('change', function () {
      socket.emit('ops.set_roe', { state: roeSelect.value });
    });
  }
```

- [ ] **Step 6: Sync ROE state on incoming events**

In `client/ops/script.js`, inside `bindSocketEvents(socket)`, add:

```javascript
  socket.on('roe_state_changed', function (data) {
    var sel = document.getElementById('roe-select');
    if (sel && data.state) sel.value = data.state;
  });
```

- [ ] **Step 7: Add ROE CSS**

In `client/ops/style.css`, add:

```css
.roe-control { display: flex; align-items: center; gap: 6px; margin-top: 4px; }
.roe-label { font-size: 10px; color: #8cf; font-family: 'JetBrains Mono', monospace; text-transform: uppercase; }
.roe-select { background: #1a1a2e; color: #e0e0e0; border: 1px solid #333; font-size: 11px; font-family: 'JetBrains Mono', monospace; padding: 2px 4px; }
```

- [ ] **Step 8: Test manually**

Start server. Open ops. Change ROE dropdown to PEACETIME. Trigger honeypot.
Expected: Tactical loop should log "ROE capped urgency" and NO auto-broadcast should fire.
Change back to ACTIVE. Trigger honeypot. Expected: Normal HIGH urgency broadcast.

- [ ] **Step 9: Commit**

```bash
git add server/websocket.js server/demo/scenarios.js server/hq_brain/operational_loop.js client/ops/index.html client/ops/controls.js client/ops/script.js client/ops/style.css
git commit -m "feat: wire ROE state machine to ops dashboard"
```

---

## Task 3: Remove phantom `ops.trigger_*` listeners from decoy_simulator

**Context:** `decoy_simulator.js` registers listeners for `ops.trigger_decoys_on`, `ops.trigger_pattern`, `ops.trigger_honeypot` in its `init()`. These events are never emitted — the ops dashboard sends `ops.trigger_scenario` which goes through `scenarios.js`, which calls the deception API directly. These are dead wiring.

**Files:**
- Modify: `server/deception/decoy_simulator.js:37-56`
- Test: `npm run test:deception`

- [ ] **Step 1: Remove the three phantom listeners**

In `server/deception/decoy_simulator.js`, delete the three event listener blocks in `init()` (lines 37-56):

```javascript
  _state.on('ops.trigger_decoys_on', (data) => {
    const count = data?.count || 47;
    const area = data?.area || { x: [0, 1], y: [0, 1] };
    spawnDecoys(count, area);
  });

  _state.on('ops.trigger_pattern', (data) => {
    if (data?.patternName) {
      wavePatterns.activate({
        patternName: data.patternName,
        parameters: data.parameters || {},
      });
    }
  });

  _state.on('ops.trigger_honeypot', (data) => {
    if (data?.nodeId && data?.eventType) {
      honeypot.trigger(data.nodeId, data.eventType, data.eventData || {});
    }
  });
```

Keep only the `ops.reset` listener and the `cycle.sync_beta_burst` listener — those are wired.

- [ ] **Step 2: Run tests**

Run: `npm run test:deception`
Expected: 70 passed, 0 failed

- [ ] **Step 3: Commit**

```bash
git add server/deception/decoy_simulator.js
git commit -m "fix: remove phantom ops.trigger_* listeners from decoy simulator"
```

---

## Task 4: Add `random_walk_cluster` pattern trigger

**Context:** Three of four wave patterns have shortcuts in `scenarios.js` (lines 270-272) and buttons in the ops dashboard. `random_walk_cluster` does not. The pattern itself is fully implemented in `wave_patterns.js` and has default params in `scenarios.js:289`. Only the trigger is missing.

**Files:**
- Modify: `server/demo/scenarios.js:272` (add `pattern_cluster` handler)
- Modify: `client/ops/index.html:63` (add button after "Radial Expansion")
- Modify: `client/ops/controls.js` (add toggle handler)

- [ ] **Step 1: Add scenario handler**

In `server/demo/scenarios.js`, after line 272 (`pattern_radial`), add:

```javascript
  pattern_cluster(params) { HANDLERS.activate_pattern({ patternName: 'random_walk_cluster', parameters: params }); },
```

- [ ] **Step 2: Add button to ops dashboard**

In `client/ops/index.html`, after the "Radial Expansion" button (line 63), add:

```html
        <button class="btn btn-warn" data-trigger="pattern_cluster">Random Walk</button>
```

- [ ] **Step 3: Add toggle handler in controls.js**

In `client/ops/controls.js`, find the pattern toggle handlers (around `pattern_radial`, line 99-115). After that block, add a matching entry for `pattern_cluster`:

```javascript
  pattern_cluster: (function () {
    var active = false;
    var patternId = null;
    return function () {
      if (!active) {
        socket.emit('ops.trigger_scenario', {
          scenario: 'pattern_cluster',
          parameters: { seed: Math.floor(Math.random() * 99999), cluster_radius: 0.1, velocity: 0.008, initial_position: { x: 0.4, y: 0.5 } },
        });
        active = true;
      } else {
        socket.emit('ops.trigger_scenario', {
          scenario: 'deactivate_pattern',
          parameters: { patternName: 'random_walk_cluster' },
        });
        active = false;
      }
    };
  })(),
```

- [ ] **Step 4: Test manually**

Start server. Open ops. Click "Random Walk" button. Check big screen — should see a meandering cluster of decoy activations. Click again to deactivate.

- [ ] **Step 5: Commit**

```bash
git add server/demo/scenarios.js client/ops/index.html client/ops/controls.js
git commit -m "feat: add random_walk_cluster pattern trigger to ops dashboard"
```

---

## Task 5: Add Routing Table tab to ops dashboard + destroyNode scenario

**Context:** `mesh.getRoutingTable(nodeId)` returns per-node routing tables but is never exposed to the UI. Adding a "Routing" tab to the ops dashboard lets engineers inspect real mesh state. We also wire `destroyNode` as a scenario to demonstrate mesh survivability.

**Files:**
- Modify: `server/demo/scenarios.js` (add `destroy_node` handler)
- Modify: `server/websocket.js` (add `ops.get_routing_table` request handler)
- Modify: `server/router.js` (forward routing table data)
- Modify: `client/ops/index.html` (add Routing tab + Destroy Node button)
- Modify: `client/ops/script.js` (render routing table, handle node selection)
- Modify: `client/ops/controls.js` (add destroy_node trigger)

- [ ] **Step 1: Add `destroy_node` scenario handler**

In `server/demo/scenarios.js`, add in the HANDLERS object:

```javascript
  destroy_node(params) {
    const nodeId = params.nodeId;
    if (!nodeId) {
      log.warn('destroy_node: no nodeId provided');
      return;
    }
    const deception = require('../deception');
    const destroyed = deception.getDecoyStates()[nodeId];
    if (destroyed) {
      require('../deception/decoy_simulator').destroyNode(nodeId);
    }
    _state.set(`nodes.${nodeId}.state`, 'DEAD');
    log.info({ nodeId }, 'node destroyed');
  },
```

- [ ] **Step 2: Add WebSocket handler for routing table requests**

In `server/websocket.js`, after the `ops.set_roe` handler, add:

```javascript
    socket.on('ops.get_routing_table', (data, callback) => {
      const mesh = require('./protocol/mesh');
      const nodeId = data && data.nodeId;
      if (nodeId) {
        const table = mesh.getRoutingTable(nodeId);
        const neighbors = mesh.getNeighbors(nodeId);
        if (typeof callback === 'function') {
          callback({ nodeId, routes: table, neighbors });
        }
      }
    });
```

- [ ] **Step 3: Add Routing tab HTML**

In `client/ops/index.html`, find the tab bar (line 120-124). Add a new tab button:

```html
        <button class="tab-btn" data-tab="routing">Routing <span id="routing-badge" style="font-size:9px;color:#666"></span></button>
```

After the last `tab-content` div (around line 158), add:

```html
      <div class="tab-content" id="tab-routing">
        <div id="routing-node-select" style="padding:4px;font-size:10px;color:#888;">
          Select a node from the list below to inspect its routing table.
        </div>
        <div id="routing-node-list" style="max-height:100px;overflow-y:auto;border-bottom:1px solid #333;padding:4px;"></div>
        <div id="routing-table-content" style="padding:4px;font-size:10px;font-family:'JetBrains Mono',monospace;"></div>
      </div>
```

- [ ] **Step 4: Add Destroy Node button**

In `client/ops/index.html`, in the danger controls section (after "Trigger Honeypot" button, around line 47), add:

```html
        <button class="btn btn-danger" data-trigger="destroy_node">Destroy Node</button>
```

- [ ] **Step 5: Add routing table rendering in script.js**

In `client/ops/script.js`, add a new function and wire it to the Routing tab:

```javascript
// --- Routing Table Tab ---
var _selectedRoutingNode = null;

function updateRoutingNodeList() {
  var container = document.getElementById('routing-node-list');
  if (!container) return;
  var nodes = window._lastNodes || {};
  var ids = Object.keys(nodes).filter(function (id) {
    return nodes[id].state !== 'DEAD';
  }).sort();
  container.innerHTML = ids.map(function (id) {
    var cls = id === _selectedRoutingNode ? 'color:#0ff;cursor:pointer;' : 'color:#888;cursor:pointer;';
    return '<span style="' + cls + 'margin-right:6px;font-size:10px;" data-route-node="' + id + '">' + id + '</span>';
  }).join('');
}

function onRoutingNodeClick(e) {
  var nodeId = e.target.dataset.routeNode;
  if (!nodeId) return;
  _selectedRoutingNode = nodeId;
  updateRoutingNodeList();
  if (window._socket) {
    window._socket.emit('ops.get_routing_table', { nodeId: nodeId }, function (data) {
      renderRoutingTable(data);
    });
  }
}

function renderRoutingTable(data) {
  var container = document.getElementById('routing-table-content');
  if (!container || !data) return;
  var html = '<div style="color:#0ff;margin-bottom:4px;">' + data.nodeId + ' — ' + (data.neighbors ? data.neighbors.length : 0) + ' neighbors</div>';

  if (data.neighbors && data.neighbors.length > 0) {
    html += '<div style="color:#666;margin-bottom:2px;">NEIGHBORS:</div>';
    data.neighbors.forEach(function (n) {
      html += '<div style="color:#8cf;padding-left:8px;">' + n.nodeId + ' q=' + (n.signalQuality || 0).toFixed(2) + '</div>';
    });
  }

  var routes = data.routes || {};
  var dests = Object.keys(routes);
  if (dests.length > 0) {
    html += '<div style="color:#666;margin-top:4px;margin-bottom:2px;">ROUTES:</div>';
    html += '<table style="font-size:10px;width:100%;"><tr style="color:#666;"><td>DEST</td><td>NEXT HOP</td><td>HOPS</td><td>Q</td></tr>';
    dests.forEach(function (dest) {
      var r = routes[dest];
      html += '<tr><td style="color:#e0e0e0;">' + dest + '</td><td style="color:#8cf;">' + r.nextHop + '</td><td>' + r.hopCount + '</td><td>' + (r.quality || 0).toFixed(2) + '</td></tr>';
    });
    html += '</table>';
  } else {
    html += '<div style="color:#666;margin-top:4px;">No routes computed yet.</div>';
  }

  container.innerHTML = html;
}
```

In the `bindSocketEvents` function, add node state tracking:

```javascript
  socket.on('node_state_change', function (data) {
    // ... existing handler ...
    // After updating node state, refresh routing list if tab is active
    if (document.getElementById('tab-routing') && document.getElementById('tab-routing').classList.contains('active')) {
      updateRoutingNodeList();
    }
  });
```

Wire the click handler at the bottom of the init section:

```javascript
document.getElementById('routing-node-list')?.addEventListener('click', onRoutingNodeClick);
```

Store socket reference for routing table requests:

```javascript
window._socket = socket;
```

- [ ] **Step 6: Add `destroy_node` trigger in controls.js**

In `client/ops/controls.js`, add:

```javascript
  destroy_node: function () {
    var nodes = window._lastNodes || {};
    var alive = Object.keys(nodes).filter(function (id) { return nodes[id].state !== 'DEAD' && nodes[id].type !== 'drone'; });
    if (alive.length === 0) return;
    var victim = alive[Math.floor(Math.random() * alive.length)];
    socket.emit('ops.trigger_scenario', { scenario: 'destroy_node', parameters: { nodeId: victim } });
  },
```

- [ ] **Step 7: Test manually**

Start server. Open ops dashboard. Click "Routing" tab. Should show list of node IDs. Click a node ID. Should show its neighbor list and routing table with destination, next hop, hop count, quality. Click "Destroy Node" — a random node should die. Verify routing tab updates (the dead node disappears, routes reconverge).

- [ ] **Step 8: Commit**

```bash
git add server/demo/scenarios.js server/websocket.js client/ops/index.html client/ops/script.js client/ops/controls.js
git commit -m "feat: add routing table tab and destroy_node scenario to ops dashboard"
```

---

## Task 6: Clean up dead exports

**Context:** The audit found exported constants and functions that are never imported anywhere. These are clutter that makes the codebase look AI-generated (export everything, use nothing). Remove them from `module.exports` — the code itself stays (internal use is fine), just don't export it.

**Files:**
- Modify: `server/protocol/transmission.js` (remove `getConfig`)
- Modify: `server/protocol/crypto.js` (remove `SLOT_COUNT`, `KEY_LENGTH`, `MAC_LENGTH`)
- Modify: `server/protocol/frame.js` (remove `HEADER_SIZE`, `PLAINTEXT_SIZE`, `FRAME_TYPES`, `FRAME_TYPE_NAMES`, `nodeIdToUint16`, `padPayload`)
- Modify: `server/deception/honeypot.js` (remove `VALID_SENSORS`)
- Modify: `server/deception/fake_data.js` (remove `setStrategy`, `getStrategy`, `PAYLOAD_SIZE`)
- Modify: `server/hq_brain/index.js` (remove `ingestEvent`, `getAuditTrail`, `getLastReasoning`)
- Modify: `server/hq_brain/roe.js` (remove `STATES`)
- Modify: `server/hq_brain/prompts.js` (remove `STRATEGIC_LOOP_PROMPT`)
- Modify: `server/hq_brain/audit.js` (remove `count`, `exportToFile`)
- Test: `npm test`

- [ ] **Step 1: Clean `transmission.js` exports**

In `server/protocol/transmission.js`, change the `module.exports` block to:

```javascript
module.exports = {
  init,
  scheduleNextCycle,
  allocateSlot,
  composeFrame,
  parseFrame,
  getHopSequence,
};
```

(Removed: `getConfig`)

- [ ] **Step 2: Clean `crypto.js` exports**

In `server/protocol/crypto.js`, change `module.exports` to:

```javascript
module.exports = {
  NONCE_LENGTH,
  TAG_LENGTH,
  deriveCycleKey,
  deriveSlot,
  deriveHopSequence,
  generateNonce,
  encrypt,
  decrypt,
  mac,
  verifyMac,
};
```

(Removed: `SLOT_COUNT`, `KEY_LENGTH`, `MAC_LENGTH`)

- [ ] **Step 3: Clean `frame.js` exports**

In `server/protocol/frame.js`, change `module.exports` to:

```javascript
module.exports = {
  TRANSMISSION_FRAME_SIZE,
  MAX_MESH_PAYLOAD,
  encodeTransmissionFrame,
  decodeTransmissionFrame,
};
```

(Removed: `HEADER_SIZE`, `PLAINTEXT_SIZE`, `FRAME_TYPES`, `FRAME_TYPE_NAMES`, `nodeIdToUint16`, `padPayload`)

- [ ] **Step 4: Clean `honeypot.js` exports**

In `server/deception/honeypot.js`, change `module.exports` to:

```javascript
module.exports = {
  VALID_EVENT_TYPES,
  init,
  registerHoneypot,
  unregisterHoneypot,
  trigger,
  getHoneypots,
  reset,
};
```

(Removed: `VALID_SENSORS`)

- [ ] **Step 5: Clean `fake_data.js` exports**

In `server/deception/fake_data.js`, change `module.exports` to:

```javascript
module.exports = {
  init,
  generatePayload,
};
```

(Removed: `setStrategy`, `getStrategy`, `PAYLOAD_SIZE`)

- [ ] **Step 6: Clean `hq_brain/index.js` exports**

In `server/hq_brain/index.js`, change `module.exports` to:

```javascript
module.exports = { init, reset };
```

(Removed: `ingestEvent`, `getAuditTrail`, `getLastReasoning`, `triggerOperationalLoop`. The tactical loop feeds itself via event listeners. The operational loop is triggered via `ops.trigger_ai_adaptation` event. No external caller needs these.)

- [ ] **Step 7: Clean `roe.js` exports**

In `server/hq_brain/roe.js`, change `module.exports` to:

```javascript
module.exports = { setState, getState, enforce, canUpdateChoreography };
```

(Removed: `STATES` — it's used internally but no external module imports it.)

- [ ] **Step 8: Clean `prompts.js` exports**

In `server/hq_brain/prompts.js`, change `module.exports` to:

```javascript
module.exports = { TACTICAL_LOOP_PROMPT, OPERATIONAL_LOOP_PROMPT };
```

(Removed: `STRATEGIC_LOOP_PROMPT` — the strategic loop is not built. The prompt text stays in the file for reference but isn't exported.)

- [ ] **Step 9: Clean `audit.js` exports**

In `server/hq_brain/audit.js`, change `module.exports` to:

```javascript
module.exports = { init, log: append, query, reset };
```

(Removed: `count`, `exportToFile` — test-only, and tests can use `query({}).length` instead.)

- [ ] **Step 10: Run all tests**

Run: `npm test`
Expected: 160 + 70 + 37 = 267 passed, 0 failed

If any test fails because it imports a removed export, fix that test to not use the dead export.

- [ ] **Step 11: Commit**

```bash
git add server/protocol/transmission.js server/protocol/crypto.js server/protocol/frame.js server/deception/honeypot.js server/deception/fake_data.js server/hq_brain/index.js server/hq_brain/roe.js server/hq_brain/prompts.js server/hq_brain/audit.js
git commit -m "fix: remove dead exports found in audit"
```

---

## Verification Checklist (after all tasks)

- [ ] `npm test` — 267+ tests pass
- [ ] Start server, open ops dashboard
- [ ] Inject jamming → event log shows "Mesh routing converged" AND AI processes jamming event
- [ ] Change ROE to PEACETIME → trigger honeypot → NO auto-broadcast (capped to LOW)
- [ ] Change ROE back to ACTIVE → trigger honeypot → auto-broadcast fires
- [ ] Click "Random Walk" button → decoys activate in cluster pattern on big screen
- [ ] Click "Routing" tab → see node list → click node → see routing table with real hops
- [ ] Click "Destroy Node" → node dies → routing tab shows reconvergence
- [ ] No `// TODO` in protocol or deception code
- [ ] No exported function without at least one production caller
- [ ] `grep -r "TODO" server/protocol/ server/deception/` returns nothing
