# THE GHOST GRID — 04: Decoy Hardware

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

Cheap decoy nodes execute the same protocol state machine as real soldier-carried mesh radios. An external observer with multi-channel SIGINT but without cryptographic access cannot distinguish decoy emissions from real nodes by any observable RF property. This is not a marketing claim — it is enforced by protocol design: same frame size, same encryption, same timing, same slot-derivation algorithm.

## Hardware design (standard decoy)

| Component | Choice | Unit cost |
|-----------|--------|-----------|
| MCU | ESP32-C6 (dual-core 160MHz, WiFi + sub-GHz) | EUR 4 |
| Long-range radio | Semtech SX1262 LoRa module | EUR 6 |
| Battery | 18650 cell + holder + protection | EUR 5 |
| Solar trickle | 0.5W panel + charge controller | EUR 6 |
| Enclosure | IP67 polycarbonate, stake-mountable | EUR 5 |
| Antennas | Whip + helix LoRa | EUR 2 |
| PCB + assembly | Custom 2-layer | EUR 5 |
| **Total BOM** | | **EUR 33** |
| **At scale (10,000+)** | | **EUR 25** |

## Decoy behavioral model

The decoy runs an identical state machine to real nodes:

```
IDLE ──(SYNC-alpha received)──► ARMED ──(slot computed)──► PREP ──(slot window)──► TRANSMIT ──► IDLE
```

The only difference: payload source. Real node packages an actual sitrep. Decoy packages cryptographically random bytes padded to match real-packet length distribution (Strategy C: encrypted noise).

```javascript
// server/deception/decoy_simulator.js:169-218
// composeDecoyFrame() uses identical logic to transmission.composeFrame():
//   - Same HKDF slot derivation
//   - Same frame structure
//   - Same MAC computation
//   - Same encryption envelope
```

## Wave choreography

Decoys are not static. They activate in spatial-temporal patterns that simulate unit movement:

| Pattern | Function | Simulates |
|---------|----------|-----------|
| linear_translation | Band sweeping in direction at velocity v | Infantry advance |
| radial_expansion | Expanding ring from center point | Unit dispersal |
| random_walk_cluster | Meandering cluster with seeded RNG | Patrol movement |
| phantom_convoy | Activation along waypoint path | Vehicle convoy |

Implementation: `server/deception/wave_patterns.js` — four evaluator functions, union semantics (transmit if ANY active pattern selects this node this cycle).

## Deployment concept

Airdrop 100-1000 decoys per 10 km^2. Solar trickle provides indefinite operation in summer. At EUR 25 per unit, 1000 decoys cost EUR 25,000 — less than one engagement by the adversary.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Frame size (decoy) | 256 bytes (identical to real) | `server/protocol/frame.js:6` |
| Slot derivation | HKDF (same as real nodes) | `server/deception/decoy_simulator.js:170-171` |
| MAC algorithm | HMAC-SHA256 truncated (same as real) | `decoy_simulator.js:206-217` |
| Simulated decoys in demo | 47 default, configurable | `decoy_simulator.js:39` |
| Wave patterns implemented | 4 (linear, radial, cluster, convoy) | `wave_patterns.js:7-12` |
| Payload strategy (demo) | Strategy C: encrypted random noise | `server/deception/fake_data.js` |
| Power budget | 50ms burst/s at <1W; solar indefinite | Design estimate |
| ESP32-C6 SRAM | 512 KB (sufficient for protocol logic) | PUBLIC ESTIMATE |

---

**BUILT**: Decoy simulator spawning protocol-identical frames (`server/deception/decoy_simulator.js`). Four wave choreography patterns with runtime activation/deactivation (`server/deception/wave_patterns.js`). Fake data generation with statistical equivalence (`server/deception/fake_data.js`). 47 simulated decoys in live demo.

**DESIGNED**: Physical ESP32-C6 + SX1262 hardware. PCB layout. Solar power management. IP67 enclosure. Airdrop deployment packaging. Production Strategy B (generative fake data from local model).

**INTEGRATES WITH**: Any system sharing the HKDF key schedule. Decoys are transparent to the mesh — real nodes relay decoy frames without distinguishing them.
