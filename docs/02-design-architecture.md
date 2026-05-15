# 02 — Design: System Architecture

## Architectural overview

The system is structured along two orthogonal axes:

1. **Protocol layers** (vertical): Transmission, Mesh, Application — corresponding to the Kova Labs *Tactical Mesh* challenge structure
2. **Compute tiers** (horizontal): HQ, Drone, Squad-edge, Node — corresponding to where intelligence and decision-making lives

Each protocol layer is implemented across multiple compute tiers, with responsibility tiered according to power, latency, and survivability characteristics of each tier.

## Layer model

```
┌─────────────────────────────────────────────────────────────────────────┐
│  APPLICATION LAYER                                                       │
│  • Deception choreography (decoy wave patterns)                          │
│  • Honeypot active sensing                                               │
│  • Tactical decision support                                             │
│  • AI-in-loop adaptive control                                           │
│  • OWVL broadcast tasking                                                │
├─────────────────────────────────────────────────────────────────────────┤
│  MESH LAYER                                                              │
│  • Topology discovery and maintenance                                    │
│  • Routing (multi-path, jamming-aware)                                   │
│  • Self-healing on node loss                                             │
│  • Cross-domain forwarding (ground ↔ drone ↔ HQ)                         │
│  • Key rotation distribution                                             │
├─────────────────────────────────────────────────────────────────────────┤
│  TRANSMISSION LAYER                                                      │
│  • Burst window scheduling                                               │
│  • LPI cover signal coordination                                         │
│  • Frequency hopping within burst                                        │
│  • Power randomization                                                   │
│  • Synchronization with drone beacon                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

Each layer is logically separable: protocol changes at one layer should not require changes at others, provided interface contracts are maintained. Implementation reality places certain coordination requirements across layers (e.g., the burst-window scheduler must know which neighbors are alive, which is mesh-layer state).

## Tier model

```
TIER 1 — HQ                                  ─────────────────────────────
        (fiber-backed, air-gapped compute)
        
        • Heavy AI workloads (LLM-class)              ◄─── ConfidentialMind
        • Aggregated battlefield intelligence              hosts the brain
        • Deception choreography generation
        • Schedule rotation
        • Threat fusion
        • Audit and after-action review

                  │                              ▲
                  │ fiber (data + commands)      │ fiber (telemetry)
                  ▼                              │

TIER 2 — DRONE                                ─────────────────────────────
        (fiber-tethered UAV, 200m AGL)
        
        • Sync-pulse emission                  ◄─── Jetson Orin Nano-class
        • LPI cover signal                          compute on payload
        • Drone-to-drone optical mesh
        • Local sensor fusion
        • Inter-drone routing decisions
        • Optional: light AI for classification

                  │                              ▲
                  │ RF (sync + cover + downlink) │ RF (ground bursts)
                  ▼                              │

TIER 3 — SQUAD-EDGE                           ─────────────────────────────
        (one carrier per squad)
        
        • Local tactical decision support       ◄─── Optional Orin Nano
        • Map display and updates                    in operator backpack
        • Threat alerting from broadcast
        • Burst transmission of squad-level data

                  │                              ▲
                  │ short-range mesh             │
                  ▼                              │

TIER 4 — NODE                                 ─────────────────────────────
        (individual soldier mesh radio
         OR cheap decoy emitter)
        
        • Protocol logic only, no general AI   ◄─── Bittium TAC WIN /
        • Burst-window TX during sync                Silvus / Persistent
          window                                     OR ESP32+LoRa decoy
        • Multi-hop relay
        • Optional: passive sensors (honeypot)
```

## Heterogeneous-node spectrum

A critical architectural decision: not all nodes are equal. The system uses a **heterogeneous node spectrum** where cost and capability are co-varied:

| Node class | Cost target | Compute | Sensors | Role | Population |
|---|---|---|---|---|---|
| Real mesh radio | €3,000–20,000 | Protocol-only | None | Soldier-carried | 1× soldier |
| Squad-edge node | €1,500–3,000 | Jetson Orin Nano | Map / display | Squad-level decision | 1× per squad |
| Honeypot node | €200–500 | ARM-class | Acoustic + IR + camera | Active sensing decoy | 5–10× per 10 km² |
| Standard decoy | €25–50 | ESP32 + LoRa | None | Statistical deception | 100–1000× per 10 km² |

This spectrum is the basis for the economic asymmetry argument: a few high-value real nodes hide inside a large population of cheap decoys, raising the cost of enemy targeting without raising the cost of friendly forces materially.

## Inter-tier data flow

### Upward (ground → HQ): operational data

```
Squad node ─burst─► neighbor mesh node ─burst─► drone (RF) ─fiber─► HQ AI
                       (multi-hop)
```

Operational data such as sitreps, position reports, sensor triggers, and honeypot engagement reports flows upward in small bursts. Each hop is sub-50ms. End-to-end latency target: under 500ms.

### Downward (HQ → ground): tasking and updates

```
HQ AI ─fiber─► drone ─broadcast pulse─► all ground nodes (passive RX)
```

Downlink uses One-Way Voice Link doctrine: HQ generates updates, drone broadcasts them, all listening nodes receive without acknowledging. No ground emission required.

### Lateral (drone → drone): aggregation and redundancy

```
Drone A ─optical link─► Drone B ─fiber─► HQ
              (no RF inter-drone)
```

When multiple drones are deployed, they exchange data via free-space optical (laser) links. This avoids accumulating RF signature in the airspace and provides redundancy if one drone's fiber is severed.

## Synchronization architecture

The single most critical architectural element is time discipline. Without sub-millisecond sync, neither the burst transmission protocol nor the deception choreography works.

```
                            ┌──────────────────┐
                            │ FIBER REFERENCE  │
                            │ CLOCK AT HQ      │
                            │ (atomic-grade)   │
                            └────────┬─────────┘
                                     │
                                     │ fiber, fixed delay
                                     ▼
                          ┌──────────────────────┐
                          │ DRONE SYNC EMITTER   │
                          │ (timing pulse on RF) │
                          └────────┬─────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       ┌────────────┐       ┌────────────┐       ┌────────────┐
       │ Ground     │       │ Ground     │       │ Ground     │
       │ node 1     │       │ node 2     │       │ node N     │
       │ (passive)  │       │ (passive)  │       │ (passive)  │
       └────────────┘       └────────────┘       └────────────┘
```

- The HQ-side reference clock is atomic-grade or chrony-disciplined
- Fiber link to drone introduces fixed, calibrated delay
- Drone emits RF sync pulse with known phase offset from reference
- Ground nodes lock to the sync pulse; their local clocks are disciplined to it
- Multiple drones broadcast simultaneously with cryptographically correlated pulses to defeat single-drone replay

GPS is not in this chain. Loss of GPS does not impact time discipline.

## Failure modes and fallbacks

| Failure | Detection | Fallback |
|---|---|---|
| Loss of one sync-drone | Missing pulse in expected window | Other drones continue; mesh unaffected |
| Loss of all sync-drones | No pulse for N cycles | Ground nodes fall back to inertial sync for 30 minutes; abort threshold |
| Severed drone fiber | HQ does not receive uplink from that drone | Drone continues sync emission; data routes to other drone's fiber |
| Mesh node loss | Neighbor pings unanswered | Routing reconverges within three burst cycles |
| HQ AI unavailable | No new schedule for >2 hours | Last cached schedule continues; degraded but operational |
| Wideband jamming on mesh band | Burst delivery rate drops | Frequency hops to alternate band; if all jammed, mission degraded |
| Cryptographic compromise | Detected via traffic anomaly | Emergency rotation broadcast within one operational hour |

## Architectural invariants

These properties must hold across all configurations and operating modes:

1. **No ground node ever emits without a sync-pulse trigger from a drone.** This guarantees burst discipline.
2. **HQ AI never receives unverified ground-originated data without authentication.** This prevents injection attacks via decoy-channel impersonation.
3. **Real and decoy nodes are statistically indistinguishable at the protocol level.** This is the deception invariant; any leak breaks the architecture.
4. **Drone fiber is the only RF-immune backhaul path.** All other paths assume some degree of RF observability.
5. **Out-of-band key fill is the only key-injection path.** No keys ever transit RF in cleartext, including bootstrap.

## Trade-offs explicitly accepted

- **Drone visibility**: Sync-drones are visually and IR-detectable. They are the high-value targets in this architecture. We accept this and mitigate via redundancy and altitude.
- **Decoy logistics**: 1000 decoys per 10 km² requires placement effort. We accept this and target airdrop deployment for forward areas.
- **HQ AI dependency**: Adaptive deception requires HQ compute. We accept this and provide cached-schedule fallback for HQ disconnection.
- **Bandwidth**: Burst-only transmission limits aggregate bandwidth versus continuous-emission systems. We accept this; tactical mesh applications are low-bandwidth by nature (sitreps, commands, position pings, not video).
- **No GPS positioning**: Without GPS, position requires either drone-TDoA, inertial nav, or local reference. We treat this as a feature in the GPS-denied environment, but it imposes additional design work on the navigation side that is outside this architecture's scope.
