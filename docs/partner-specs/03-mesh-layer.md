# THE GHOST GRID — 03: Mesh Layer

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

The mesh layer provides multi-hop routing across ground nodes and drone relays. It supports two routing modes selected per-message: TTL-limited flood for time-critical traffic (honeypot alerts), and Bellman-Ford distance-vector for routine sitreps. Self-healing removes jammed nodes and reconverges routes within 3 burst cycles.

## Dual-mode routing

**Flood mode (urgent)**: Origin tags packet with TTL. Every receiving node retransmits in its next burst slot. Duplicates suppressed via (source, sequence) cache. Drone intercepts HQ-bound packets and forwards over fiber.

**Distance-vector mode (routine)**: Each node maintains a routing table built from neighbor announcements every 3 cycles. Path selection: minimum hop count, tie-break on signal quality.

```javascript
// server/protocol/mesh.js:100-107
function routePacket({ src, dst, mode }) {
  if (mode === 'urgent') return floodRoute(src, dst);
  return dvRoute(src, dst);
}
```

## Mesh frame format (inside transmission frame payload)

```
[2B] Source node (logical origin)
[2B] Destination (logical dest, or BROADCAST)
[1B] TTL (decremented each hop)
[1B] Traffic class (urgent / routine / cover)
[4B] Mesh sequence (per-source)
[N]  Application payload (encrypted at app layer)
```

## Self-healing on jamming

```javascript
// server/protocol/mesh.js:228-258
function declareJammed(area) {
  // 1. Identify nodes within jamming radius
  // 2. Remove jammed nodes from all neighbor tables
  // 3. Reconverge routing for survivors
  // 4. Emit mesh.routing_converged event
}
```

Jamming detection uses bulk packet loss in a geographic cluster. Nodes that fail to receive SYNC-beta are presumed jammed. The mesh routes around them, falling back to drone relay if no ground path exists.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Default TTL | 5 hops | `server/protocol/mesh.js:4` |
| Neighbor timeout | 3 cycles (3 seconds) | `server/protocol/mesh.js:5` |
| DV announce interval | Every 3 cycles | `server/protocol/mesh.js:6` |
| Seen-packet cache | 1000 entries, LRU eviction | `server/protocol/mesh.js:8` |
| Radio range (simulation) | 0.3 normalized units | `server/protocol/mesh.js:9` |
| Reconvergence time | 1-3 burst cycles | By measurement in demo |
| Cross-domain forwarding | Ground -> Drone (RF) -> HQ (fiber) | `mesh.js:186-199` |
| Duplicate suppression | Per-node (source:sequence) set | `mesh.js:155-170` |

## Cross-domain forwarding

```
Ground node ──burst──► Drone (receives during burst window)
Drone ──fiber──► HQ
HQ ──fiber──► Drone ──broadcast──► Ground (passive RX, no ack)
```

Drone-role nodes are detected by the mesh layer (`role === 'drone'`) and used as fiber-backhaul gateways. A packet addressed to HQ routes to the nearest drone automatically.

## Neighbor discovery

Each cycle, nodes record source IDs from successfully demodulated frames. Neighbor table entries: `{node_id, signal_quality, last_heard_cycle, role}`. Stale entries (>3 cycles) are dropped, invalidating routes through them.

---

**BUILT**: Complete Bellman-Ford DV routing (`server/protocol/mesh.js:263-308`). TTL-limited flood routing (`mesh.js:109-123`). Neighbor discovery and aging (`mesh.js:46-71, 316-328`). Jamming declaration and reconvergence (`mesh.js:228-258`). Cross-domain forwarding via drone to HQ (`mesh.js:186-199`). Duplicate suppression with LRU cache (`mesh.js:155-170`). Periodic DV updates (`mesh.js:330-338`).

**DESIGNED**: Multi-drone optical mesh inter-drone routing. Geographic-cluster jamming detection (currently triggered manually). Signal-quality weighted path selection at scale.

**INTEGRATES WITH**: Bittium TAC WIN (as mesh node with standard burst protocol), Silvus StreamCaster (as high-bandwidth relay node), any system supporting addressed packet forwarding.
