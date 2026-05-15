# Task 03 — Deception Engine

You are building the **Deception Engine** component: decoy simulation, wave choreography, fake data generation, and honeypot logic.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component C: Deception Engine"
3. Read `docs/04-design-deception.md` — your primary specification
4. Skim `docs/03-design-protocol.md` to understand frame format

## Your scope

You own these files:

```
server/deception/decoy_simulator.js
server/deception/wave_patterns.js
server/deception/fake_data.js
server/deception/honeypot.js
server/deception/index.js
server/deception/README.md
```

You do NOT own:
- Server core (`server/index.js`, `server/state.js`)
- Protocol modules (`server/protocol/*`) — you depend on these
- HQ Brain — separate instance
- Anything in `client/` or `radios/`

## Prerequisites

- Server Core (Component A) must be operational
- Protocol Modules (Component B) must expose:
  - `crypto.deriveCycleKey`, `crypto.deriveSlot`, `crypto.encrypt`
  - `transmission.composeFrame`, `transmission.allocateSlot`

If those are incomplete, work to the documented API and use stubs.

## What this component does

The Deception Engine simulates a population of decoy and honeypot nodes that participate in the protocol exactly as real nodes do, but with synthetic data. The four functional areas:

1. **Decoy population management** (`decoy_simulator.js`): spawn, position, lifecycle of decoy nodes
2. **Wave choreography** (`wave_patterns.js`): time-and-space patterning of decoy activation
3. **Fake data generation** (`fake_data.js`): synthetic but statistically-equivalent payloads
4. **Honeypot logic** (`honeypot.js`): active-sensing decoys that report engagement

## Detailed API specifications

### index.js (module facade)

```javascript
module.exports = {
  init(state),
  spawnDecoys(count, area),
  spawnHoneypot(position, sensors),
  activatePattern(patternName, parameters),
  deactivatePattern(patternId),
  getActivePatterns(),
  triggerHoneypot(nodeId, eventType, eventData),
  getDecoyStates(),
};
```

### decoy_simulator.js

```javascript
/**
 * Decoy population simulator
 */
module.exports = {
  init(state),

  /**
   * Spawn N decoy nodes in the given area.
   * area: { x: [0..1], y: [0..1] } normalized coords; uses uniform random within
   * Returns array of created node IDs.
   */
  spawnDecoys(count, area),

  /**
   * Spawn a single honeypot at a specific position.
   * sensors: array of sensor types ('acoustic', 'ir', 'vibration', 'camera')
   * Returns the node ID.
   */
  spawnHoneypot(position, sensors),

  /**
   * Remove a decoy or honeypot (e.g., simulated destruction).
   */
  destroyNode(nodeId),

  /**
   * Subscribe to cycle events; for each cycle, decide which decoys transmit
   * based on active patterns, and generate their frames.
   */
  // Internal: called on cycle.sync_beta_burst

  /**
   * Get current state of all decoys.
   */
  getStates(),
};
```

Decoy node identity:
- ID format: `DECOY-XXXX` for standard decoys, `HP-XXX` for honeypots
- Position: normalized [0..1] coordinates
- State: same as real nodes (LISTENING / SYNC / TX / RX / DEAD)
- Each decoy has a seed for deterministic-but-random behavior

### wave_patterns.js

```javascript
/**
 * Wave pattern library
 */
module.exports = {
  init(state),

  /**
   * Available pattern types.
   */
  PATTERNS: ['linear_translation', 'radial_expansion', 'random_walk_cluster', 'phantom_convoy'],

  /**
   * Activate a pattern.
   * Returns a pattern ID for later deactivation.
   */
  activate({ patternName, parameters }),

  /**
   * Deactivate a previously activated pattern.
   */
  deactivate(patternId),

  /**
   * Get the activation decision for a given node at a given cycle.
   * Returns true if the node should transmit this cycle based on all
   * active patterns, false otherwise.
   * 
   * This is the core function called once per node per cycle.
   */
  shouldTransmit(nodeId, position, cycleNumber),

  /**
   * Get all active patterns for inspection/visualization.
   */
  getActivePatterns(),
};
```

#### Pattern parameter schemas

**linear_translation**
```javascript
{
  direction: 'east' | 'west' | 'north' | 'south' | { x, y },  // unit vector
  velocity: 30,           // normalized units per cycle (e.g., 0.01 = 1% of area per cycle)
  band_width: 0.15,       // width of active band (normalized)
  start_position: 0,      // initial offset along direction
  period: 1.5,            // wrap-around period (1.0 = once across area)
}
```

**radial_expansion**
```javascript
{
  center: { x: 0.5, y: 0.5 },     // expansion center
  expansion_rate: 0.005,           // ring radius growth per cycle
  ring_width: 0.05,                // active ring thickness
  start_radius: 0.0,
  max_radius: 0.8,
}
```

**random_walk_cluster**
```javascript
{
  seed: 12345,                     // for reproducible "randomness"
  cluster_radius: 0.08,            // size of active cluster
  velocity: 0.008,                 // cluster movement per cycle
  initial_position: { x: 0.3, y: 0.5 },
}
```

**phantom_convoy**
```javascript
{
  path: [{ x, y }, { x, y }, ...], // waypoints
  velocity: 0.015,
  convoy_length: 0.1,              // length of active band along path
  loop: true,                      // restart at end
}
```

### fake_data.js

```javascript
/**
 * Fake data payload generator
 */
module.exports = {
  init(state),

  /**
   * Generate a fake payload for a decoy at a given cycle.
   * The payload is encrypted noise of appropriate size,
   * indistinguishable from a real payload after encryption.
   * 
   * strategy: 'encrypted_noise' (default) | 'replay' | 'generative'
   */
  generatePayload(nodeId, cycleNumber, strategy),

  /**
   * Set the strategy globally or per-node.
   */
  setStrategy(strategy),
};
```

For hackathon scope, implement `encrypted_noise` strategy:
- Random bytes of length matching the standard frame payload size
- Encrypted with the same primitives as real payloads
- After encryption, indistinguishable from real

The other two strategies (`replay`, `generative`) can be stubs with a TODO comment; document the design in code comments.

### honeypot.js

```javascript
/**
 * Honeypot logic
 */
module.exports = {
  init(state),

  /**
   * Trigger a honeypot manually (for demos) or programmatically.
   * eventType: 'artillery' | 'drone' | 'vehicle' | 'patrol'
   * eventData: { direction_of_arrival, amplitude, ... }
   * 
   * Composes the engagement report and submits it to the mesh
   * for urgent-class routing back to HQ.
   */
  trigger(nodeId, eventType, eventData),

  /**
   * Get list of all honeypots and their last activity.
   */
  getHoneypots(),
};
```

Engagement report format (mesh payload):

```javascript
{
  type: 'honeypot_report',
  honeypot_id: 'HP-23',
  timestamp: 1234567890,
  sensor: 'acoustic',
  classification: 'artillery_overpressure',
  direction_of_arrival_deg: 287,
  amplitude_db: -42,
  certainty: 0.87,
}
```

After triggering, the honeypot transmits one frame with this payload using urgent-class routing (TTL-limited flooding) targeted at HQ. The mesh layer handles the routing; you compose the frame and submit it.

## Subscription model

### Subscribes to:

- `cycle.sync_beta_burst` → for each decoy and honeypot, decide if it transmits this cycle (consult wave patterns)
- `ops.trigger_decoys_on` → enable decoy population (default count from config)
- `ops.trigger_pattern` → activate a specific wave pattern
- `ops.trigger_honeypot` → trigger a honeypot (manually)
- `ops.reset` → clear all decoys and patterns

### Emits:

- `deception.decoy_spawned` → for visualization
- `deception.pattern_activated` → for visualization
- `deception.honeypot_triggered` → for HQ Brain to process
- `radio.frame_received_simulated` → simulated frame transmissions from decoys (consumed by Protocol Modules and visualization)

## Implementation notes

### Decoy frame composition

When a decoy transmits in a given cycle, you generate a frame that:

1. Has a valid source node ID (the decoy's ID)
2. Has a valid sequence number (per-decoy monotonic)
3. Uses the same slot allocation algorithm as real nodes (from Protocol Modules)
4. Carries an encrypted-noise payload (from fake_data.js)
5. Has a valid MAC

The frame should be emitted as `radio.frame_received_simulated` so it appears identical to a real radio reception event to the rest of the system.

### Default decoy population

When `ops.trigger_decoys_on` fires with no parameters, spawn the number from config (`NUM_SIMULATED_DECOYS`, default 47) in the full area [0..1] × [0..1].

When the same event fires with parameters, use those parameters:

```javascript
state.emit('ops.trigger_decoys_on', { count: 100, area: { x: [0.2, 0.8], y: [0.2, 0.8] } });
```

### Wave pattern composition

Multiple patterns can be active simultaneously. The `shouldTransmit` function evaluates the union: if ANY active pattern says the node should transmit, it transmits. This allows overlapping waves to create complex emission patterns.

### Honeypot sensor simulation

The hackathon doesn't have real sensors. For the demo:

- Operator triggers honeypot manually via dashboard
- Honeypot composes engagement report
- Report is routed via mesh (urgent class) to HQ
- HQ Brain decides whether to broadcast alert to affected area
- Affected nodes receive broadcast and their phones vibrate

Provide the scaffolding for sensors as if they were real, so the production path is clear in the code.

### Performance considerations

With 47+ decoys ticking each cycle, the per-cycle computation must be cheap:
- Slot allocation: pre-compute per cycle once for all decoys
- Wave pattern evaluation: vectorize where possible (lodash chunking is fine)
- Frame composition: don't re-derive encryption keys per frame; cache per cycle

Profile if necessary; target sub-50ms total decoy processing per cycle.

## Testing

Provide `server/deception/test_deception.js`:

- Spawn 47 decoys
- Activate the `linear_translation` pattern
- Run 20 cycles
- Verify:
  - Each cycle, some subset of decoys transmit (varying based on pattern)
  - Transmitted frames are valid (MAC verifies)
  - Frames are indistinguishable from real-node frames by size/format
  - Pattern band sweeps across the area over time (log positions of transmitting nodes per cycle)
- Trigger a honeypot
- Verify:
  - Engagement report is composed correctly
  - Report propagates via mesh urgent routing
  - The `deception.honeypot_triggered` event fires

## Acceptance criteria

You are done when:

- All five files implement the documented APIs
- Test harness runs and assertions pass
- 47+ decoys can be active simultaneously without performance issues (sub-50ms per cycle)
- All four wave patterns produce visually distinct activation patterns when run
- Decoy frames pass MAC validation by Protocol Modules
- Honeypot trigger produces a routable report
- Decoy frames are statistically indistinguishable from real-node frames at the byte level
- `npm run lint` passes
- `server/deception/README.md` exists
- `DECISIONS.md` updated

## Hand-off

When complete, your component plays with:
- Visualization → reads decoy positions and active patterns from state for rendering
- HQ Brain → receives `deception.honeypot_triggered` and decides on broadcast
- Operator Dashboard → triggers decoy activation, pattern changes, honeypot via `ops.*` events
- Protocol Modules → your decoy frames flow through their mesh layer like real ones

Your component is the heart of the differentiation. Make it correct.
