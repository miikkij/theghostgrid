# 03 — Design: Protocol (Transmission + Mesh)

## Overview

This document specifies the Transmission Layer and Mesh Layer protocols. The two layers are presented together because they are tightly coupled: mesh routing decisions depend on transmission-layer timing, and transmission-layer scheduling depends on mesh-layer topology state.

## Transmission Layer

### Burst cycle structure

The fundamental time unit is the **burst cycle**, a configurable interval (default: 1 second) during which one round of synchronized transmission occurs. Each cycle is structured as follows:

```
T=0                                                        T=1000ms
│                                                              │
│◄────── Cycle N ──────────────────────────────────────────────►│
│                                                              │
├─────────┬──────────────────┬──────────────────┬──────────────┤
│ SYNC-α  │  PREP            │  SYNC-β + BURST  │  IDLE        │
│ (15ms)  │  (200ms)         │  (300ms)         │  (485ms)     │
├─────────┴──────────────────┴──────────────────┴──────────────┤
│                                                              │
│  α: small sync pulse from drone                              │
│  PREP: ground nodes compute their burst slot and prepare     │
│  β: large cover pulse from drone + ground bursts within      │
│  IDLE: silence; ground nodes process received data           │
└──────────────────────────────────────────────────────────────┘
```

The SYNC-α pulse is a short, low-power timing pulse. Its function is to give ground nodes a precise time reference for the upcoming SYNC-β window. Drone-side it requires only milliwatts; ground-side it must be detectable but it doesn't carry payload.

The SYNC-β pulse is the cover signal. It's a higher-power, frequency-spread emission whose primary purpose is to mask ground burst transmissions occurring during the same window. The drone payload itself (a downlink message to ground) may ride within this cover; the cover is structured as a wideband signal in which the drone's actual payload is one frequency band among many.

### Cover signal design

The cover signal must satisfy two properties:

1. **Frequency-spread**: it occupies the entire band that ground bursts can use, so any frequency a ground node hops to falls within cover.
2. **Cryptographically randomized**: the cover's content is pseudorandom (seeded from a shared secret rotated each cycle), so an enemy SIGINT receiver cannot subtract the known waveform and look at residual energy.

Concretely:

- Band: 100 MHz wide (deployment); ISM 2.4 GHz for hackathon
- Cover energy distribution: pseudorandom across band, with peak power 20 dB above expected ground burst power
- Cover modulation: cryptographic stream cipher output mapped to phase + amplitude
- Burst window within cover: 50 ms wide

A ground node hopping frequencies during its burst is always within cover at every hop. Direction-finding requires separating the soldier's emission from the cover; the cryptographic randomization defeats coherent subtraction.

### Burst slot assignment

Within the 50ms burst window, transmissions are further structured to avoid mutual collision while preserving the deception property that all transmissions look statistically identical from outside:

- The 50ms window is divided into 50 sub-slots of 1ms each
- Each node (real or decoy) selects its sub-slot for this cycle pseudorandomly from a shared seed plus per-node identifier
- A node may have a packet to transmit or may have nothing; if it has nothing, it transmits a fake-data filler matching the encrypted-envelope size distribution of real packets
- Real and decoy nodes follow identical slot-selection algorithms; an outside observer cannot determine which 1ms sub-slot contains real data

This is **slotted ALOHA with external clock** plus **cover traffic indistinguishability**.

### Frequency hopping within burst

Each 1ms sub-slot is further subdivided into 10 hops of 100 microseconds each. Within its sub-slot, a node transmits its packet across 10 frequencies in a sequence determined by:

```
hop_sequence(node_id, cycle, slot) = HKDF(shared_secret, node_id || cycle || slot)
```

Each hop uses a different frequency in the band. The sequence is per-node and per-cycle, so the same node transmits a different hop sequence next cycle.

A receiving node knows the hop sequence (because it shares the secret) and follows along. An outside observer without the secret sees only noise distributed across the band.

### Power randomization

Each node randomly varies its transmit power within a 6dB range each cycle, drawn from a uniform distribution. This disrupts direction-finding algorithms that assume consistent power across cycles to localize a stationary emitter.

### Transmission Layer message format

```
┌───────────────────────────────────────────────────────────────────┐
│ TRANSMISSION FRAME (encrypted envelope)                           │
├───────────────────────────────────────────────────────────────────┤
│ [1B]  Frame type     (cover-fill, data, ack-suppressed, control)  │
│ [4B]  Cycle id       (which sync cycle this belongs to)           │
│ [2B]  Slot id        (which sub-slot in burst window)             │
│ [2B]  Source node    (origin node identifier)                     │
│ [2B]  Sequence       (per-source monotonic counter)               │
│ [2B]  Mesh payload   (length of mesh-layer payload)               │
│ [N]   Mesh payload   (opaque to transmission layer)               │
│ [16B] MAC            (Poly1305 over above with key from HQ schedule)│
└───────────────────────────────────────────────────────────────────┘
```

All frames are equal-size after encryption (padded to maximum). Real data and cover-fill are indistinguishable to anyone without the decryption key. The MAC ensures that injected fake-real frames from an enemy are rejected.

## Mesh Layer

### Topology model

Mesh topology is **flat with optional hierarchy**: every node can in principle communicate with every other node via multi-hop, but in practice a node only knows its immediate neighbors (typically 4–8) and depends on the routing protocol to bridge beyond.

```
                  Drone A                           Drone B
                    ▲│                                ▲│
                    ││                                ││
                    │▼                                │▼
        ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐
        │  N1 │──│  N2 │──│  N3 │──│  N4 │──│  N5 │──│  N6 │
        └─────┘  └─────┘  └─────┘  └─────┘  └─────┘  └─────┘
            │       │        │        │        │        │
            ▼       ▼        ▼        ▼        ▼        ▼
         ┌───┐   ┌───┐    ┌───┐    ┌───┐    ┌───┐    ┌───┐
         │D1 │   │D2 │    │D3 │    │D4 │    │D5 │    │D6 │
         └───┘   └───┘    └───┘    └───┘    └───┘    └───┘
                          (decoys)
```

- Nodes (N) and decoys (D) are protocol-equivalent at the mesh layer
- Drones provide simultaneously: sync source, optional relay path, and HQ-backhaul
- Lines indicate "in-range" relationships; actual routing chooses paths dynamically

### Neighbor discovery

Each cycle, each node:

1. Listens during the burst window for transmissions from other nodes
2. Records the source node identifier of each frame successfully demodulated
3. Maintains a neighbor table with: node_id, signal_quality, last_heard_cycle, role_hint

Neighbors that go silent for more than N cycles (default: 3) are dropped from the table. Routes through them are invalidated.

### Routing protocol

The system supports two complementary routing modes selected per-message based on traffic class:

**Mode 1: Source-route flood (low-volume, time-critical)**

For honeypot engagement reports, emergency burst messages, or any data marked time-critical:

- Origin node tags packet with TTL of N hops
- Every receiving node retransmits in its next burst slot (if it's not already received this packet)
- Duplicates suppressed via (source, sequence) cache
- HQ-bound packets are recognized by drones and forwarded to fiber; ground retransmission ceases for that path

This is robust to topology changes and fast; cost is bandwidth amplification per message.

**Mode 2: Distance-vector routing (normal sitreps and routine traffic)**

For routine traffic, the mesh maintains a distance-vector table:

- Each node periodically broadcasts its known routes
- Routing table converges within 5-10 cycles after topology changes
- Path selection: minimum-hop, with tie-break on signal-quality-weighted reliability

### Self-healing

When a node fails (loss detected via neighbor table aging) or a jamming zone appears (detected via bulk packet loss in a geographic cluster), the mesh reconverges:

1. **Detection cycle**: nodes adjacent to the failure mark affected routes as suspect
2. **Convergence cycle (1-3 cycles)**: alternate paths are computed via existing neighbor links
3. **Drone-failover (if no ground path exists)**: traffic is routed via the nearest drone, which has fiber-immune backhaul to HQ

Jamming-zone detection uses the fact that drone-broadcast SYNC-β should be received uniformly across the area. Nodes that fail to receive SYNC-β are presumed jammed; the mesh routes around them.

### Cross-domain forwarding

Messages move between three domains: **ground mesh**, **drone optical mesh**, and **fiber backbone**.

- Ground → drone: ground node tags packet for "uplink"; nearest drone with line-of-sight receives during burst window
- Drone → drone: optical link, no RF; drone-side routing
- Drone → fiber → HQ: standard TCP/UDP over fiber link
- Reverse path: HQ → fiber → drone → broadcast pulse → ground nodes (passive RX)

A packet may traverse all three domains. The mesh layer abstracts this; the application layer sees a logical end-to-end channel.

### Mesh Layer message format

```
┌───────────────────────────────────────────────────────────────────┐
│ MESH FRAME (inside transmission layer payload)                    │
├───────────────────────────────────────────────────────────────────┤
│ [2B]  Source node    (logical origin)                             │
│ [2B]  Destination    (logical destination, or BROADCAST)          │
│ [1B]  TTL            (decrement at each hop)                      │
│ [1B]  Class          (urgent / routine / cover)                   │
│ [4B]  Mesh sequence  (per-source-destination pair)                │
│ [N]   App payload    (encrypted at application layer)             │
└───────────────────────────────────────────────────────────────────┘
```

Mesh sequence numbers enable duplicate suppression. The application payload is independently encrypted; mesh-layer nodes (including decoys) cannot read application content.

## Coordination between layers

The transmission layer publishes events: **burst-window-open**, **frame-received**, **frame-transmitted**. The mesh layer subscribes and reacts.

The mesh layer publishes routing-table state changes; the transmission layer uses these to prioritize next-burst slot allocation toward higher-priority paths.

A clean separation is maintained in code: transmission knows nothing of mesh routing, mesh knows nothing of frequency hopping. They communicate via well-defined events.

## Implementation notes for the hackathon

For the 48-hour hackathon, several simplifications are accepted:

- **Frequency hopping**: simulated via switching among WiFi channels (channels 1, 6, 11) rather than true microsecond-grade RF hopping; the Kova Labs USB adapters support channel changes
- **Cover signal**: emulated by one of the three USB adapters acting as the "drone"; it broadcasts a continuous wideband signal during the burst window using packet injection
- **Burst window**: 50ms is achievable via Linux high-precision timers; sub-50ms sub-slots are achievable but require careful timing budget
- **Three real radios**: serve as proof-of-protocol; visualization layer simulates the additional 47+ decoys
- **MAC verification**: BLAKE3 or Poly1305 implemented in Rust (libraries available); minor performance budget
- **Routing**: both modes implemented but stress-tested on small (3-node) ground configuration

The protocol described above is the design target. The hackathon demonstration is a faithful subset suitable for proving the architecture and recruiting partner conversations.
