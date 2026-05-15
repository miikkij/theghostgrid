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
