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

---

## 2026-05-16 — Deception Engine

### Decoy frames use JSON path, not binary encoding, for simulated emission

Decoy frames are composed as JSON objects with HMAC MACs (matching `transmission.composeFrame` format) and emitted via `radio.frame_received_simulated`. The transmission module parses them identically to real frames. Binary encoding via `encodeTransmissionFrame` is available for visualization but not used in the simulation path — the JSON path is what the protocol stack actually processes. Binary equivalence is verified in tests (256-byte frames, identical format).

### Mulberry32 PRNG for deterministic wave pattern evaluation

The `random_walk_cluster` pattern needs reproducible pseudo-random walks from a seed. Node.js `Math.random()` is not seedable. Rather than adding a dependency, a 32-bit Mulberry32 generator is used inline — it's 6 lines, has good statistical properties for this use case, and produces identical trajectories given the same seed across runs.

### Cycle key cached per cycle in decoy simulator

With 47+ decoys per cycle, `deriveCycleKey` (HKDF) would be called 47 times per cycle producing identical results. The decoy simulator caches the cycle key and only re-derives when the cycle number changes. Measured performance: 0.4ms average per cycle for 50 decoys (well under the 50ms target).

### Phantom convoy proximity uses point-to-segment distance, not nearest-waypoint

The spec says activation is based on "proximity to path." Using point-to-nearest-waypoint would create activation hotspots at waypoints and gaps along edges. Point-to-segment distance (with parametric projection clamping) produces smooth activation along the entire path. The active zone width is hardcoded at 0.03 normalized units — wide enough to catch nodes near the path, narrow enough to look like a road corridor.

### Honeypot sensor classification table is static, not learned

Each (sensor_type, event_type) pair maps to a fixed classification string (e.g., acoustic+artillery → "artillery_overpressure"). In production, this would be a trained classifier. For the hackathon, the static table provides correct-looking reports for the demo scenarios without ML complexity.

### Encrypted noise strategy encrypts random bytes with AEAD, not just random bytes

The `encrypted_noise` fake data strategy doesn't just generate random bytes — it generates random plaintext and encrypts it with ChaCha20-Poly1305 using the cycle key. This means the payload structure (nonce + ciphertext + auth tag) is identical to a real encrypted payload, not just random noise. If an adversary could distinguish AEAD ciphertext from raw random bytes (they can't, but defense in depth), this approach still holds.

---

## 2026-05-16 — HQ Brain

### Built-in fetch used instead of axios/node-fetch

Node 20+ ships with global `fetch`. Both ConfidentialMind client and Ollama fallback use it directly, avoiding an additional dependency. The ConfidentialMind API follows the OpenAI-compatible `/v1/chat/completions` format; Ollama uses its native `/api/chat` endpoint.

### Tactical loop processes events serially with a bounded queue

The tactical loop queues incoming events and processes them one at a time (one LLM call at a time). If the queue exceeds 5 events, the oldest LOW-urgency event is dropped first; if none are LOW, the oldest event is dropped. This prevents cascading LLM calls during event storms while preserving high-urgency events.

### LLM response normalization as a safety layer

All LLM responses pass through `normalizeResponse()` before being acted on. Invalid urgency values default to LOW, missing fields get safe defaults, and confidence is clamped to [0,1]. This prevents malformed LLM output from triggering spurious broadcasts.

### Degraded mode returns LOW urgency for all events

When neither ConfidentialMind nor Ollama is available, the system enters degraded mode where every event is classified as LOW urgency with zero confidence. This ensures events are still logged for manual review without false-positive broadcasts.

### Operational loop is manual-trigger only (hackathon scope)

The operational loop subscribes to `ops.trigger_ai_adaptation` rather than running on a timer. This matches the hackathon demo flow where the operator explicitly triggers AI adaptation. Production would add a periodic timer.

### Audit log is dual-write: in-memory array + JSON-lines file

Audit entries are appended to both an in-memory array (for fast queries) and a `logs/audit.log` file (for persistence). The file uses JSON-lines format (one JSON object per line) for easy parsing. If the file can't be opened, the system continues with in-memory only.

### ConfidentialMind client uses 3-second timeout, Ollama uses 15-second

ConfidentialMind is expected to be a hosted service with low latency; 3 seconds aligns with the tactical loop's latency budget. Ollama runs locally and may need more time on CPU, so it gets 15 seconds. Both use AbortController for clean cancellation.

---

## 2026-05-16 — Big Screen Visualization

### Grid cached on offscreen canvas, redrawn only on resize

Drawing a full-screen grid (50px spacing) every frame at 60 FPS is wasteful — the grid is static. An offscreen `<canvas>` caches the grid and is drawn via `drawImage()` each frame (~0.1ms vs ~1.5ms for raw line drawing). The cache is invalidated when the viewport dimensions change.

### Two separate requestAnimationFrame loops for canvas and DOM

Canvas rendering runs at full 60 FPS via one rAF loop. DOM overlay updates (UTC clock, telemetry values, cycle progress) run on a second rAF loop throttled to 250ms intervals. This avoids DOM layout thrashing in the hot render path. The 250ms interval is fast enough for human perception of updating numbers while staying off the frame budget.

### Script tags instead of ES modules for browser scripts

The spec suggests `type="module"` but the server serves `connection.js` as a plain script at `/static/shared/connection.js`. Socket.IO's client is also loaded via `<script src="/socket.io/socket.io.js">`. Using standard script tags with `'use strict'` keeps loading order explicit and avoids CORS issues when files are served from different paths. The `BattlefieldRenderer` class is exposed on the global scope and consumed by `script.js` — acceptable for a 4-file application.

### Mock mode inline in script.js, not a separate file

The spec suggests `mock-state.js` as a separate file. Mock mode is integrated into `script.js` behind a `?mock=true` URL parameter check because: (1) it shares the same state object and helper functions, (2) it avoids an extra HTTP request, (3) the mock code is ~100 lines and doesn't warrant a separate load path. The mock simulator runs setInterval-based cycles that exercise every rendering path including sync pulses, transmission arcs, jamming zones, honeypot alerts, and AI decisions.

### Cursor auto-hide after 5 seconds

Operator displays don't need a visible cursor. CSS defaults to `cursor: none`; a `mousemove` listener adds `cursor-visible` class with a 5-second timeout. This makes the display look clean for photography while still being usable when the operator needs the mouse.

### Design system CSS variable names differ slightly from spec

The spec uses `--bg-deep` while the original stub used `--bg-base`. The design system was updated to match the spec naming (`--bg-deep`, `--accent-green`, `--accent-cyan`, etc.) since those are the canonical names from `10-ui-design.md`. Other UI components importing the shared CSS will use these names.

### Jamming zones support both polygon and circle definitions

The spec shows polygon zones. The renderer also supports `{ center, radius }` circle zones because the server state uses `{ center, radius, since }` format (per `06-build-components.md`). Both are handled transparently — the renderer checks for `polygon` first, falls back to `center`/`radius`.
