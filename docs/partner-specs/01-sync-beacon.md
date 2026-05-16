# THE GHOST GRID — 01: Sync Beacon Architecture

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

A fiber-tethered drone at 200m AGL serves as the time-discipline source for all ground mesh communications. Because the command channel runs over physical fiber, the timing reference cannot be electronically jammed. This eliminates the two dominant vulnerabilities of existing tactical mesh radios: GPS dependence for synchronization, and ground-based master-radio exposure to direction-finding.

## Synchronization chain

```
HQ atomic clock ─── fiber (fixed delay) ──► Drone sync emitter
                                                    │
                              ┌──────────────────────┼──────────────────────┐
                              ▼                      ▼                      ▼
                         Ground node 1         Ground node 2         Ground node N
                         (passive RX)          (passive RX)          (passive RX)
```

Ground nodes never emit to receive sync. They lock to the drone's RF pulse passively. No acknowledgment, no uplink. GPS is not in this chain.

## Burst cycle structure

Each 1000ms cycle is structured around the sync pulse:

```
T=0        T=15ms    T=215ms         T=515ms              T=1000ms
│ SYNC-α   │  PREP   │  SYNC-β + BURST (50ms window)  │  IDLE    │
```

SYNC-alpha is a low-power timing pulse. SYNC-beta is a high-power cover signal that masks ground bursts during the 50ms transmission window. Slot derivation uses the alpha timestamp as seed input.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Cycle period | 1000 ms (configurable) | `server/protocol/transmission.js:8` |
| Burst window | 50 ms | Design spec, implemented in cycle state machine |
| Sub-slots per window | 50 (1 ms each) | `server/protocol/transmission.js:10` |
| Sync-alpha duration | 15 ms | Protocol design |
| Prep phase | 200 ms | Protocol design |
| Cover signal bandwidth | 100 MHz (production) / 2.4 GHz ISM (demo) | Design spec |
| Cover power vs ground burst | +20 dB | Design spec |
| Fiber link | Single-mode, fixed calibrated delay | Architecture invariant |
| Drone altitude | 200m AGL nominal | Design spec |
| Fallback on all-drone loss | 30 min inertial sync | Design spec |

## Slot derivation (pseudocode)

```javascript
cycle_key = HKDF-SHA256(master_secret, salt=zeros, info="cycle:{N}")
slot_index = HKDF-SHA256(cycle_key, salt=zeros, info="slot:{node_id}") mod 50
```

See `server/protocol/crypto.js:11-23` for implementation. Deterministic without coordination — every node computes its own slot independently given the shared secret and cycle number derived from the sync pulse.

## Failure modes

| Failure | Detection | Fallback |
|---------|-----------|----------|
| Loss of one drone | Missing pulse | Other drones continue; mesh unaffected |
| Loss of all drones | No pulse for N cycles | Inertial sync for 30 min |
| Severed fiber | HQ loses uplink from drone | Drone continues sync emission autonomously |

---

**BUILT**: Cycle state machine with alpha/beta/burst/idle phases (`server/protocol/transmission.js`). HKDF-based slot derivation (`server/protocol/crypto.js:11-23`). Drone-loss recovery scenario in demo (`server/demo/scenarios.js:98-112`).

**DESIGNED**: Physical fiber-tethered drone hardware. Atomic clock at HQ. Multi-drone simultaneous broadcast with cryptographic correlation. Drone-to-drone optical mesh.

**INTEGRATES WITH**: Bittium TAC WIN (as ground node receiving sync), Silvus StreamCaster (same role), any radio capable of externally-triggered burst transmission.
