# The Ghost Grid — Drone-Coordinated Resilient Communications

## Core concept: the sync beacon

The architectural anchor of this system is a single technical insight:

> **A fiber-tethered drone, suspended above a unit, can serve as the time-discipline source for ground-level mesh communications. Because the drone's command channel runs over physical fiber rather than RF, its timing reference cannot be electronically warfare'd back to the ground forces it serves.**

This eliminates the two dominant vulnerabilities of existing tactical mesh radios:

1. **GPS dependence** — the sync beacon does not need GPS; it derives time from HQ via fiber
2. **Master-radio exposure** — there is no ground-based master node that can be RF-direction-found

Everything else in this architecture is co-designed around this core: burst-only ground transmission becomes possible because the sync source is reliable; mass deception becomes possible because synchronized burst windows give all participants (real and decoy) a shared protocol heartbeat; AI-driven adaptation becomes possible because the sync layer is robust enough to carry control plane updates.

The sync beacon is the kernel. The four pillars below are extensions.

## Four co-designed pillars

1. **Sync beacon** — fiber-tethered UAV emitting time-discipline pulse to ground (the anchor concept)
2. **Low-emission ground mesh** — burst-only transmission under cover signals, frequency-hopped within burst windows
3. **Statistical deception** — cheap decoy nodes choreographed into wave patterns indistinguishable from real soldier traffic
4. **Adaptive intelligence** — AI-in-loop on air-gappable HQ compute, generating new deception patterns and threat responses in real time

## Why this matters

Existing tactical mesh radios (Bittium TAC WIN, Silvus StreamCaster, Persistent Wave Relay) work well in benign environments. They fail at predictable points: GPS-dependent time discipline collapses under wideband jamming, master-radio sync exposes high-value targets, and ground-emission patterns leak position information to modern multi-channel SIGINT.

This architecture addresses each failure mode at the protocol level rather than as a bolted-on feature. The cost-asymmetry argument — cheap decoys forcing expensive enemy targeting decisions — emerges naturally from the design rather than being imposed on it.

## Document set

### Requirements

- **[01-requirements.md](01-requirements.md)** — Functional, non-functional, operational constraints, success criteria

### Design

- **[02-design-architecture.md](02-design-architecture.md)** — Three-layer system architecture, four-tier compute model, layer interactions
- **[03-design-protocol.md](03-design-protocol.md)** — Transmission Layer (burst, LPI cover, frequency hopping) + Mesh Layer (topology, routing, self-healing)
- **[04-design-deception.md](04-design-deception.md)** — Application Layer deception (decoy choreography, wave patterns, fake data, honeypots)
- **[05-design-ai-hq-brain.md](05-design-ai-hq-brain.md)** — HQ AI integration, adaptive control loops, audit and governance

### Implementation

- **[06-build-components.md](06-build-components.md)** — Component inventory, interface contracts, dependencies, definition of done
- **[07-implementation-stack.md](07-implementation-stack.md)** — Technical stack, libraries, hardware, deployment topology
- **[08-demo-and-pitch.md](08-demo-and-pitch.md)** — Demo narrative emphasizing the sync-beacon hook, pitch script, partner conversations
- **[10-ui-design.md](10-ui-design.md)** — UI specifications for big screen, operator dashboard, audience phone, landing page

### Roadmap

- **[09-roadmap.md](09-roadmap.md)** — Post-event technical and commercial roadmap

## Key concepts at a glance

| Term | Meaning |
|---|---|
| Sync beacon | Fiber-tethered UAV emitting time-discipline pulse; ground nodes synchronize passively |
| LPI cover | Low Probability of Intercept; drone's data-window pulse masks ground bursts |
| Burst-only TX | Ground nodes transmit only during synchronized sub-50ms windows |
| Decoy node | Cheap emitter that mimics real soldier transmissions; saturates enemy SIGINT |
| Wave choreography | Time-and-space patterned activation of decoys producing phantom unit movement |
| Honeypot node | Decoy with active sensors; attracts and characterizes enemy ISR/strike |
| HQ brain | Air-gappable AI running adaptive control loops |
| OWVL | One-Way Voice Link doctrine; broadcast downlink, no acknowledgments |

## Differentiation summary

| Capability | Existing systems | This architecture |
|---|---|---|
| Time discipline | GPS-disciplined (jammable) | Drone-fiber-sourced (jam-immune) |
| Sync source location | Master radio on ground (DF-vulnerable) | Airborne, fiber-backed (no RF trace to ground) |
| Ground transmission | Continuous or scheduled emit | Burst-only under cover signal |
| Deception | Bolt-on if at all | Co-designed at protocol level |
| Cost asymmetry | Defender expensive | Decoys cheap vs enemy engagement |
| AI integration | Out-of-band tooling | In-protocol adaptive loop |

## Implementation philosophy

This document set defines the system. The build itself proceeds through independently developable components with clean interface contracts, allowing parallel execution. See [06-build-components.md](06-build-components.md) for the component inventory.

The implementation prompts in [claude-code-prompts/](claude-code-prompts/) are intended to be consumed by parallel Claude Code instances, each working on a well-bounded part of the system.
