# Decisions Log

Non-obvious technical choices made during implementation.

---

## 2026-05-16 — Server Core

### State store uses dot-path resolution instead of a nested proxy

The `state.get('cycle.number')` / `state.set('cycle.number', 42)` API resolves dot-delimited paths by walking the object tree. Alternative was ES6 Proxy for transparent nested access, but Proxy adds complexity, breaks `JSON.stringify` snapshot, and is harder to debug. Simple path resolution keeps the code predictable for other component authors.

### Cycle ticker uses chained setTimeout, not setInterval

`setInterval` accumulates drift because it doesn't account for execution time within each tick. Chained `setTimeout` calculates the next delay based on elapsed wall-clock time, keeping cycles aligned to the configured period. This matters because burst-window timing is the foundation of the protocol.

### Phone callsigns are sequential (NATO prefix + counter)

Callsigns cycle through the NATO phonetic alphabet with an incrementing suffix (ALPHA-1, BRAVO-1, ... ZULU-1, ALPHA-2, ...). This guarantees uniqueness within a session and produces callsigns that look authentic for the demo. Not persistent across server restarts — acceptable for a hackathon demo.

### Socket.IO rooms for role-based broadcasting

Clients join a Socket.IO room matching their role ('phone', 'screen', 'ops', 'observer'). This allows `broadcastTo(role, event, payload)` to target only relevant clients without filtering on every message. Efficient for 100+ phone clients.

### EventEmitter max listeners set to 200

Default Node.js limit is 10, which would trigger warnings as more components subscribe. Set to 200 to support all planned components and their multiple event subscriptions without noise.

### cors package used instead of manual headers

Express 4.x doesn't include CORS middleware. The `cors` package is 5KB, well-tested, and avoids hand-rolled header logic. Required because phone clients may connect from different origins in some network configurations.

### pino-pretty only in TTY mode

Structured JSON logging in production (piped output), pretty-printed with colors only when stdout is a TTY (developer terminal). Detected at startup via `process.stdout.isTTY`.

---

## 2026-05-16 — Protocol Modules

### node:crypto used instead of @noble/ciphers

The spec mentions `@noble/ciphers` as an option. Node 20+ ships with ChaCha20-Poly1305 and HKDF in `node:crypto`, which avoids adding a dependency. All required primitives (AEAD, HKDF, HMAC) are available natively.

### HMAC-SHA256 truncated to 16 bytes for standalone MAC

The spec mentions Poly1305 or BLAKE3 for MACs. Poly1305 is used implicitly as part of ChaCha20-Poly1305 AEAD (the auth tag). For standalone MAC operations (frame integrity before decryption), HMAC-SHA256 truncated to 16 bytes was chosen — Node.js doesn't ship BLAKE3, and HMAC-SHA256 is well-tested and sufficient. The 16-byte length matches the spec's `[16B] MAC` field.

### Protocol defaults defined in module code, not config.js

Protocol-specific configuration (sub-slots, channels, hops-per-slot, TTL, neighbor timeout) is defined as module-level defaults in `transmission.js` and `mesh.js`, overridable via `init(state, config)`. The `server/config.js` file is owned by Server Core and doesn't include a `protocol` section. When Server Core adds protocol config, the modules will accept it through the init call.

### Frame binary format: nonce prepended, not derived

The 256-byte wire frame stores the 12-byte nonce at offset 0 rather than deriving it from (cycle, slot, node). Prepending avoids a dependency on the receiver already knowing the sender's identity before decryption, and the 12-byte cost is modest within a 256-byte frame.

### Mesh routing uses module-level state, not per-instance

Neighbor tables and routing tables are module-level Maps rather than class instances. This matches the Server Core pattern (module singleton), avoids passing references between modules, and is appropriate for a single-server system. The `reset()` function is exposed for test isolation.

### DV routing converges via synchronous Bellman-Ford in broadcastRoutingUpdates

Each DV announcement cycle rebuilds every node's routing table in a single synchronous pass. For a linear N-node topology, full convergence requires N-1 passes. This is fine for the hackathon's small mesh (3-10 ground nodes). A production system would use asynchronous, distributed announcements.

### Cover-fill frames use random padding, not zeroes

Padding bytes in `padPayload` are filled with `crypto.randomBytes` rather than zeroes. After encryption with ChaCha20-Poly1305, both would be indistinguishable to an observer, but random padding also prevents plaintext pattern analysis if the key is later compromised.
