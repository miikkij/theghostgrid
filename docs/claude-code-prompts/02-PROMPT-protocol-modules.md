# Task 02 — Protocol Modules (Transmission + Mesh)

You are building the **Protocol Modules** component: the Transmission Layer and Mesh Layer logic.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component B: Protocol Modules"
3. Read `docs/03-design-protocol.md` — this is your primary specification
4. Skim `docs/02-design-architecture.md` for context

## Your scope

You own these files:

```
server/protocol/transmission.js
server/protocol/mesh.js
server/protocol/frame.js
server/protocol/crypto.js
server/protocol/README.md
```

You do NOT own:
- Server core (`server/index.js`, `server/state.js`, etc.) — another instance
- Deception engine — another instance
- Anything in `client/` — other instances

## Prerequisites

Server Core (Component A) must be operational. Specifically:
- `server/state.js` exports a state object with event bus methods
- The cycle ticker emits `cycle.sync_alpha`, `cycle.prep`, `cycle.sync_beta_burst`, `cycle.idle` events
- The state store has the documented shape

If Server Core is incomplete, write your modules to the documented API anyway, and provide a small test harness (`test_protocol.js`) that exercises your modules with a stub state object.

## What these modules do

### Transmission Layer (`transmission.js`)

Implements the protocol described in `docs/03-design-protocol.md` section "Transmission Layer":

- Schedule and timing within burst cycles
- Slot assignment (deterministic given node ID, cycle, secret)
- Frequency hopping logic (returns channel assignments; actual channel hop is done by Radio Bridge)
- Frame composition: assemble outgoing transmission frame
- Frame parsing: parse incoming raw bytes

### Mesh Layer (`mesh.js`)

Implements the protocol described in `docs/03-design-protocol.md` section "Mesh Layer":

- Neighbor table management
- Two routing modes:
  - Source-route flood (urgent traffic)
  - Distance-vector (routine traffic)
- Self-healing on node loss or jamming detection
- Cross-domain forwarding hooks (ground → drone → fiber)

### Frame format (`frame.js`)

Implements the binary or JSON frame format from `docs/03-design-protocol.md`:

- Encoding outgoing frames
- Decoding incoming frames
- Validating MACs
- Padding for indistinguishability

For the hackathon, frames can be JSON over WebSocket internally (not raw bytes on the wire); the Radio Bridge handles actual binary encoding for over-RF transmission.

### Crypto utilities (`crypto.js`)

Encryption and MAC primitives used by the protocol:

- `chacha20poly1305` AEAD for encryption
- BLAKE3 or Poly1305 for MACs (whichever is more convenient)
- Key derivation: HKDF for per-cycle, per-node keys from a master secret
- Slot selection: pseudorandom slot assignment from `HKDF(secret, nodeId, cycle)`

Use `@noble/ciphers` or `node:crypto` for primitives. Do not roll your own crypto.

## Detailed API specifications

### transmission.js

```javascript
/**
 * Transmission Layer
 */
module.exports = {
  /**
   * Called when cycle.sync_alpha event fires.
   * Schedules slot assignments for nodes that will transmit this cycle.
   */
  scheduleNextCycle(cycleNumber),

  /**
   * Allocate a specific sub-slot within the burst window for a node.
   * Returns: { slotIndex: 0-49, frequencyHops: [chan1, chan2, ...] }
   */
  allocateSlot(nodeId, cycleNumber),

  /**
   * Compose an outgoing transmission frame.
   * payload is the mesh-layer payload (binary or JSON object).
   * Returns the frame object ready for transmission.
   */
  composeFrame({ sourceNode, sequenceNumber, cycle, slot, meshPayload }),

  /**
   * Parse a received raw frame (bytes or JSON) into structured form.
   * Validates MAC; returns null if MAC invalid.
   */
  parseFrame(raw),

  /**
   * Get the frequency hop sequence for a given (nodeId, cycle, slot).
   * Used by the Radio Bridge to know when to switch channels.
   */
  getHopSequence(nodeId, cycleNumber, slotIndex),

  /**
   * Initialize the transmission module with the state bus.
   * Subscribes to cycle events and dispatches.
   */
  init(state),
};
```

### mesh.js

```javascript
/**
 * Mesh Layer
 */
module.exports = {
  /**
   * Initialize with state bus.
   */
  init(state),

  /**
   * Add or update a neighbor in the local node's neighbor table.
   */
  updateNeighbor(nodeId, neighborId, signalQuality, lastSeen),

  /**
   * Remove a neighbor (presumed dead/silent).
   */
  removeNeighbor(nodeId, neighborId),

  /**
   * Get current neighbors of a node.
   */
  getNeighbors(nodeId),

  /**
   * Route a packet from src to dst.
   * Returns the next-hop node ID, or null if no route exists.
   * mode is 'urgent' (flood) or 'routine' (DV).
   */
  routePacket({ src, dst, payload, mode, ttl }),

  /**
   * Called when a frame is received at this node.
   * Decides whether to:
   *   - Consume locally (we are the destination)
   *   - Forward (we are a relay)
   *   - Drop (TTL exhausted, duplicate, etc.)
   */
  handleReceivedFrame(receiverNodeId, frame),

  /**
   * Mark a node or area as jammed; trigger routing reconvergence.
   */
  declareJammed(area),

  /**
   * Get current routing table for inspection / debug.
   */
  getRoutingTable(nodeId),
};
```

### frame.js

```javascript
/**
 * Frame format
 */
module.exports = {
  TRANSMISSION_FRAME_SIZE: 256,    // total bytes after encryption + padding
  
  /**
   * Encode a transmission frame for the wire.
   * Returns a Buffer.
   */
  encodeTransmissionFrame(frameObj),

  /**
   * Decode a wire frame back to the structured form.
   * Returns null if invalid.
   */
  decodeTransmissionFrame(buffer),

  /**
   * Pad a payload to the standard frame size for indistinguishability.
   */
  padPayload(payload, targetSize),
};
```

### crypto.js

```javascript
/**
 * Cryptographic primitives
 */
module.exports = {
  /**
   * Derive a per-cycle key from the master secret.
   */
  deriveCycleKey(masterSecret, cycleNumber),

  /**
   * Derive a per-node slot from cycle key and node ID.
   */
  deriveSlot(cycleKey, nodeId),

  /**
   * Encrypt a payload with ChaCha20Poly1305.
   * Returns { ciphertext, nonce, tag }.
   */
  encrypt(plaintext, key, nonce),

  /**
   * Decrypt; throws on MAC failure.
   */
  decrypt(ciphertext, key, nonce, tag),

  /**
   * Compute MAC over arbitrary bytes.
   */
  mac(bytes, key),

  /**
   * Verify MAC.
   */
  verifyMac(bytes, key, expectedMac),
};
```

## Subscription model

Your modules subscribe to events from the state bus and emit events for downstream consumption.

### Subscribes to:

- `cycle.sync_alpha` → schedule the upcoming cycle
- `cycle.sync_beta_burst` → trigger any pending transmissions to be sent
- `cycle.idle` → process any frames received during the cycle
- `radio.frame_received` (from Radio Bridge or Deception Engine) → handle incoming frame
- `radio.frame_received_simulated` (from Deception Engine) → handle incoming decoy frame

### Emits:

- `transmission.frame_to_send` → frame composed, ready for Radio Bridge or simulation
- `transmission.slot_allocated` → debugging/visualization
- `mesh.neighbor_added` → state update
- `mesh.neighbor_removed` → state update
- `mesh.routing_converged` → after re-routing
- `mesh.packet_delivered` → end-to-end packet success

## Defaults for hackathon scope

- Burst cycle: 1000ms
- Sub-slots per burst: 50 (1ms each within 50ms burst window)
- Frequency channels: 3 (WiFi 1, 6, 11) — Radio Bridge maps to actual channels
- Hops per sub-slot: 3
- Cryptography: ChaCha20Poly1305 with 256-bit keys
- MAC: built into Poly1305
- TTL default: 5 hops
- Neighbor timeout: 3 cycles silent → drop

These should be configurable via `config.js`.

## Implementation notes

### Slot assignment determinism

Critical: real nodes and decoy nodes (in Deception Engine) must use the same slot assignment algorithm. The Deception Engine will import your `crypto.js` and `transmission.js` for slot computation.

Use a pure function:

```javascript
function computeSlot(nodeId, cycleNumber, secret) {
  const seed = HKDF(secret, `${nodeId}:${cycleNumber}`);
  return seed.readUint32LE(0) % 50;  // 50 sub-slots
}
```

### Indistinguishability of cover-fill

When a node has no real payload to send, it must still transmit cover-fill that is statistically identical to a real payload. Real and cover-fill frames must:

- Be the same total size (after encryption + padding)
- Have valid MACs (using the cover-fill key, which is also a derived key)
- Have identical metadata distribution

This is foundational to the deception layer. Get it right.

### Mesh routing modes

For urgent traffic (honeypot alerts, threat broadcasts):
- TTL-limited flooding
- Each node retransmits in next available burst slot if it hasn't already seen this (src, sequence)
- Duplicate suppression via per-node cache of recently-seen (src, sequence) pairs

For routine traffic (sitreps, position reports):
- Distance-vector
- Periodic neighbor announcements (every 5 cycles)
- Route via lowest-hop neighbor with adequate signal quality

Both modes should be implemented; the `routePacket` function chooses based on `mode` parameter.

### Cross-domain forwarding

When a packet's destination is HQ:
- The mesh layer recognizes drone nodes in the topology
- Routes prefer drone-relay paths when available
- Once at a drone, the packet exits the ground mesh (goes to fiber, simulated as direct delivery to HQ in the state bus)

When HQ broadcasts:
- Drone(s) broadcast to all ground nodes via SYNC-β cover signal payload
- Ground nodes receive passively (no acknowledge)

## Testing

Provide a small test harness `server/protocol/test_protocol.js` that:

- Instantiates a stub state object
- Creates 5 simulated nodes
- Runs 10 cycles
- Verifies:
  - Each node gets a unique slot per cycle
  - Frames are composed, encoded, decoded correctly
  - MAC verification works
  - A packet routes from node A to node E through intermediate hops

Run with `node server/protocol/test_protocol.js`.

## Acceptance criteria

You are done when:

- All four files implement the documented APIs
- Test harness runs and all assertions pass
- Slot assignment is deterministic given seed
- Cover-fill and real frames are byte-identical after encryption (no length leakage)
- Both routing modes work in the test harness
- Jamming declaration triggers reconvergence
- Crypto correctly encrypts/decrypts and rejects tampered frames
- Module subscribes to and emits the documented events
- `npm run lint` passes for `server/protocol/`
- `server/protocol/README.md` exists with usage notes
- `DECISIONS.md` updated for any non-obvious choices

## Hand-off

When complete, your modules will be consumed by:
- Deception Engine — uses your slot assignment and crypto for decoys
- HQ Brain — uses your mesh layer for broadcast routing
- Radio Bridge — receives frames you compose, returns frames it captured
- Visualization — receives state events from your modules for rendering
