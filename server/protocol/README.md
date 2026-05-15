# Protocol Modules

Transmission Layer and Mesh Layer protocol logic for the Tactical Mesh system.

## Modules

### crypto.js

Cryptographic primitives — no external dependencies beyond `node:crypto`.

- `deriveCycleKey(masterSecret, cycleNumber)` — HKDF-SHA256 per-cycle key derivation (32-byte key)
- `deriveSlot(cycleKey, nodeId, totalSlots?)` — deterministic slot assignment via HKDF
- `deriveHopSequence(secret, nodeId, cycle, slot, channels, hopsPerSlot)` — frequency hop sequence
- `encrypt(plaintext, key, nonce?)` / `decrypt(ciphertext, key, nonce, tag)` — ChaCha20-Poly1305 AEAD
- `mac(bytes, key)` / `verifyMac(bytes, key, expected)` — HMAC-SHA256 truncated to 16 bytes

### frame.js

Binary frame encoding for wire format (256-byte fixed-size frames).

- `encodeTransmissionFrame(frameObj, key)` — encrypt and serialize to 256-byte Buffer
- `decodeTransmissionFrame(buffer, key)` — decrypt and parse; returns `null` on MAC failure
- `padPayload(payload, targetSize)` — random-fill padding for indistinguishability

Frame layout: `[12B nonce][228B ciphertext][16B auth tag]`

### transmission.js

Burst cycle scheduling and frame composition.

- `init(state, config?)` — subscribe to cycle events on the state bus
- `allocateSlot(nodeId, cycleNumber)` — `{ slotIndex, frequencyHops }`
- `composeFrame({ sourceNode, sequenceNumber, cycle, slot, meshPayload })` — build JSON frame with MAC
- `parseFrame(raw)` — validate MAC, parse JSON or binary frame
- `getHopSequence(nodeId, cycleNumber, slotIndex)` — channel sequence for Radio Bridge

### mesh.js

Neighbor management and dual-mode routing.

- `init(state, config?)` — subscribe to frame and cycle events
- `updateNeighbor(nodeId, neighborId, signalQuality, lastSeen)` — add/refresh neighbor
- `routePacket({ src, dst, payload, mode, ttl })` — returns next-hop node ID
  - `mode: 'routine'` — distance-vector (minimum hop, signal-quality tiebreak)
  - `mode: 'urgent'` — flood-forward (each receiver retransmits)
- `handleReceivedFrame(receiverNodeId, frame)` — consume, forward, or drop
- `declareJammed(area)` — remove jammed nodes, reconverge routing
- `getRoutingTable(nodeId)` — debug inspection

## Configuration

Pass config via `init(state, config)`. Defaults:

| Key | Default | Description |
|-----|---------|-------------|
| `MASTER_SECRET` | `'tactical-mesh-default-secret-change-me'` | Shared secret for key derivation |
| `SUB_SLOTS` | `50` | Sub-slots per burst window |
| `CHANNELS` | `[1, 6, 11]` | WiFi channels for frequency hopping |
| `HOPS_PER_SLOT` | `3` | Frequency hops per sub-slot |
| `DEFAULT_TTL` | `5` | Mesh packet time-to-live |
| `NEIGHBOR_TIMEOUT_CYCLES` | `3` | Cycles of silence before neighbor is dropped |
| `DV_ANNOUNCE_INTERVAL` | `5` | Cycles between DV routing updates |

## Events

### Subscribes to

- `cycle.sync_alpha` — schedule slots for upcoming burst
- `cycle.sync_beta_burst` — open burst window
- `cycle.idle` — clean up old allocations
- `radio.frame_received` / `radio.frame_received_simulated` — incoming frames
- `transmission.frame_received` — mesh layer processes parsed frames

### Emits

- `transmission.slot_allocated` — `{ nodeId, cycle, slotIndex, frequencyHops }`
- `transmission.burst_window_open` — `{ cycle, allocations }`
- `transmission.frame_to_send` — composed frame ready for Radio Bridge
- `transmission.frame_received` — parsed and MAC-validated frame
- `mesh.neighbor_added` / `mesh.neighbor_removed` — topology changes
- `mesh.routing_converged` — after DV update or jamming reconvergence
- `mesh.packet_delivered` — end-to-end packet delivery (including fiber uplink)

## Testing

```
node server/protocol/test_protocol.js
```

Runs 160 assertions covering crypto primitives, frame encode/decode, slot assignment determinism, MAC validation, DV routing convergence, flood routing, jamming reconvergence, cross-domain forwarding, and a 10-cycle integration simulation.

## Consumed by

- **Deception Engine** — imports `crypto.js` and `transmission.js` for slot computation and cover-fill generation
- **HQ Brain** — uses `mesh.js` for broadcast routing
- **Radio Bridge** — receives frames from `transmission.frame_to_send`, returns via `radio.frame_received`
- **Visualization** — subscribes to mesh/transmission events for rendering
