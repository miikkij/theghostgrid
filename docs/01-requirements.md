# 01 — Requirements

## Scope statement

This document defines the requirements for a tactical mesh communications system that operates without GPS, resists modern SIGINT and EW threats, and uses statistical deception to reduce the operational value of enemy targeting. The system addresses the Kova Labs *Tactical Mesh* challenge while targeting all three challenge layers (Transmission, Mesh, Application).

The architecture has both a *hackathon scope* (48-hour proof of concept) and a *roadmap scope* (deployable system). This document covers both; subsequent design and implementation documents focus primarily on the hackathon scope with roadmap forward-references where appropriate.

## Stakeholders

| Stakeholder | Interest |
|---|---|
| Operational planner | Survivable communications in GPS-denied, EW-contested environments |
| Squad-level soldier | Receive tactical updates without revealing position |
| Drone operator | Resilient command and control of UAV assets |
| HQ / command element | Aggregated battlefield awareness with controllable deception layers |
| Sponsor / integrator | Path to deployable product with existing Finnish defence ecosystem |

## Functional requirements

### FR-1: Time synchronization without GPS

The system shall provide microsecond-grade time discipline to all ground nodes within line-of-sight of at least one sync-drone, without requiring GPS reception at any ground node.

- **FR-1.1** Sync-drones shall emit a discoverable timing pulse on a known frequency or known schedule.
- **FR-1.2** Ground nodes shall lock to the sync-drone pulse within five received pulses of cold start.
- **FR-1.3** Sync redundancy: at least two simultaneously broadcasting sync-drones shall be supportable so loss of one drone does not collapse the time-discipline layer.
- **FR-1.4** Pre-mission key/schedule loading shall be supported via out-of-band physical channel (cable, NFC, contact), not requiring radio bootstrap.

### FR-2: Low-emission ground transmission

The system shall minimize the duration, frequency, and predictability of ground-level RF emissions.

- **FR-2.1** Ground nodes shall transmit only during synchronized burst windows of less than 50 milliseconds.
- **FR-2.2** Transmission windows shall coincide with sync-drone cover signals where the cover signal exceeds the ground burst by at least 20 dB in the same band.
- **FR-2.3** Ground nodes shall hop transmission frequencies within the burst window according to a shared but cryptographically obscured schedule.
- **FR-2.4** Transmission power shall be randomized within operational bounds to disrupt direction-finding power consistency assumptions.

### FR-3: Mesh topology and routing

The system shall maintain connectivity across multiple ground nodes via multi-hop relay through other nodes and through airborne assets.

- **FR-3.1** Each node shall discover its current N nearest neighbors within communications range.
- **FR-3.2** The mesh shall route a packet from any node to any other reachable node via shortest-path or load-balanced multi-path algorithms.
- **FR-3.3** The mesh shall detect node failure or radio silence within three burst cycles and reconverge routing.
- **FR-3.4** Jamming of any contiguous region shall not partition the mesh provided alternate routes exist via sync-drone or unjammed neighbors.

### FR-4: Drone-mediated backhaul

The system shall support data exfiltration from the mesh to HQ via drone fiber tethers, and command injection from HQ to the mesh via drone broadcast.

- **FR-4.1** Drones shall relay ground-originated packets to HQ via fiber-optic backhaul with no RF emission of payload content.
- **FR-4.2** HQ-originated commands shall be broadcast by drones during dedicated downlink windows.
- **FR-4.3** Ground nodes shall passively receive HQ broadcasts; no acknowledgment shall be required, per One-Way Voice Link (OWVL) doctrine.
- **FR-4.4** Where multiple drones are available, drone-to-drone communication shall preferentially use optical (free-space laser) links to avoid RF signature accumulation.

### FR-5: Deception layer

The system shall make ground node emissions statistically indistinguishable from cheap decoy emissions, denying the enemy SIGINT analyst the ability to distinguish real soldier positions from artificial ones.

- **FR-5.1** Decoy nodes shall emit transmission bursts with the same protocol, timing, and metadata characteristics as real nodes.
- **FR-5.2** Decoy emission schedules shall be drawn from the same statistical distribution as real-node schedules (statistical sameness, not differentness).
- **FR-5.3** Decoy payloads shall be encrypted and statistically equivalent in size, frequency, and timing to real payloads; cleartext distinguishability shall not exist.
- **FR-5.4** Decoy node populations shall support spatial-temporal choreography: programmable wave patterns of activation that produce phantom unit-movement signatures.

### FR-6: Honeypot / active sensing

A subset of decoy nodes shall include passive sensors that detect enemy engagement and report engagement metadata.

- **FR-6.1** Honeypot nodes shall support at minimum acoustic and vibration sensing.
- **FR-6.2** Optional sensor extensions: passive IR, RF energy detection, image-frame capture on motion trigger.
- **FR-6.3** Upon enemy engagement, the honeypot shall report engagement type, time, direction-of-arrival (where measurable), and survive-or-destroyed status via one burst transmission before its potential loss.

### FR-7: HQ adaptive intelligence

HQ-side AI shall consume mesh-aggregated data, evaluate enemy responses, and adapt the deception and sync layers in near-real time.

- **FR-7.1** HQ AI shall be deployable on air-gappable infrastructure (ConfidentialMind or equivalent on-premises platform).
- **FR-7.2** HQ AI shall generate updated decoy choreography schedules at minimum every operational hour.
- **FR-7.3** HQ AI shall identify enemy targeting priorities from observed engagement-of-honeypot patterns.
- **FR-7.4** HQ AI shall rotate cryptographic schedules according to threat-driven cadence.
- **FR-7.5** HQ AI's outputs shall be auditable; every recommended action shall include reasoning trace for after-action review.

### FR-8: Bootstrap and key management

- **FR-8.1** All nodes shall receive cryptographic keys and schedule definitions via pre-mission physical fill, not radio.
- **FR-8.2** A new node joining a mission shall be provisioned by physical contact with any already-provisioned node.
- **FR-8.3** Key rotation shall occur on mission cadence or on threat trigger, distributed via HQ broadcast under post-rotation key cover.

## Non-functional requirements

### NFR-1: Resilience

| Threat | Required behavior |
|---|---|
| GPS jamming (full denial) | No degradation; time discipline sourced from drone-fiber, not GNSS |
| Single-frequency jamming | Mesh detects, frequency-hops, routes around |
| Wideband jamming over mesh band | Backhaul via drone-fiber continues; ground mesh degrades gracefully |
| Loss of one sync-drone | Other sync-drones maintain discipline; recovery within ten burst cycles |
| Loss of all sync-drones | Ground nodes fall back to inertial timing for up to thirty minutes; mission abort threshold |
| Multi-channel coherent SIGINT | LPI cover signal + frequency hopping + spread spectrum render decryption-less DF impractical |
| Cryptographic key compromise | Schedule rotation invalidates compromised material within one operational hour |

### NFR-2: Performance budget

- Burst latency end-to-end (soldier → HQ): under 500 ms in nominal conditions
- Burst latency degraded (one drone loss): under 2 seconds
- Time discipline drift: under 100 microseconds RMS across mesh under nominal conditions
- Mesh convergence on node failure: under three burst cycles
- Honeypot engagement-report latency: under 200 ms from sensor trigger to broadcast

### NFR-3: Economic asymmetry

- Decoy node BOM target: under €50 per unit
- Sync-drone construction target: under €5,000 per unit (excluding payload AI)
- Mesh radio cost target: existing hardware (Bittium / Silvus / Persistent / Doodle Labs) integration; no bespoke ground radio required
- Total area-saturation cost for 10 km² at 100 decoys/km²: under €50,000

### NFR-4: Operational hygiene

- No persistent RF emission from any ground node
- No requirement for pre-mission RF testing in the area of operations (avoid pattern-of-life)
- Mission setup time from arrival to operational: under thirty minutes for a trained operator
- Key fill time per node: under thirty seconds

### NFR-5: Compliance and operating envelope

- All transmission bands used shall be within ranges that the operating force is legally cleared to use (this constrains hackathon demo to ISM bands; deployment uses cleared military bands).
- Encryption shall use cryptographic primitives currently certified for the operating force (this is a deployment requirement; hackathon demo uses standard ChaCha20/Poly1305 or equivalent).
- Hardware shall be ITAR-considered; preference for European or domestic Finnish supply chain where possible.

## Constraints

### Hackathon constraints

- **Time:** 48 hours, Friday evening through Sunday noon
- **Team:** 1–4 people, expected 3–4 for full layer coverage
- **Hardware available:** 3 USB WiFi packet-injection adapters (provided by Kova Labs); Rust and C libraries with Python bindings provided
- **Hackerpack platforms:** ConfidentialMind air-gapped AI platform, Google Cloud Platform credits, ICEYE recruitment portal
- **Submission deadline:** Sunday 12:00
- **Pitch format:** 5 minutes hard cut + 3 minutes Q&A from judges
- **Eligibility:** NATO citizen + Switzerland + Ukraine
- **Code reuse:** No pre-written code; no rebuilding of existing company products

### Operational reality constraints (informing design)

- Audience demo apparatus (phones via WebSocket / WebRTC) is *visualization theatre only*; actual product endpoints are military mesh radios
- The 48-hour deliverable is a *system architecture proof* with three real radios + simulated decoys, not a production system
- All "soldier" emissions in the demo are simulated through phone screens and the three USB adapters
- Real-world deployment requires partnership with military radio vendor (Bittium for Finnish context), drone manufacturer (Kelluu, Donut Defence), and air-gapped compute vendor (ConfidentialMind)

## Success criteria

### Hackathon submission success

- All three challenge layers (Transmission, Mesh, Application) functionally demonstrated
- Three USB WiFi adapters show working burst transmission and mesh routing
- Audience-phone visualization layer scales to at least 50 participants
- Live jamming injection visibly causes mesh re-routing without collapse
- AI-in-loop demonstrates one full adaptation cycle within the demo window
- Pitch executes within 5 minutes with at least one moment that draws partner attention

### Partner conversation success

- Booth conversations with Kova Labs (challenge sponsor), ConfidentialMind (platform partner), 61N (DEFINE network), Bittium representatives if present
- Discussion of post-hackathon roadmap with at least one partner expressing concrete next-step interest
- Recruitment dialogue initiated with one or more DEFINE-network companies

### System-level success (roadmap)

- Architecture document set sufficient to brief a defence integrator engineering team in one session
- Differentiation against existing systems (Bittium TAC WIN, Silvus, Persistent, Goodix) demonstrably articulated
- GPS-independence claim defensible against engineer-level technical questioning
- Cost-asymmetry argument quantified with verifiable BOM and engagement-cost figures
