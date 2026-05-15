# 04 — Design: Deception (Application Layer)

## Overview

The Application Layer is where this architecture diverges most sharply from existing tactical mesh systems. Where conventional designs treat deception as an optional bolt-on, here it is the protocol's reason for existing. Every choice in the Transmission and Mesh layers below is in service of the deception properties specified at this layer.

This document specifies four interlocking application-layer capabilities:

1. **Decoy emitter network** — cheap nodes that produce real-looking traffic
2. **Wave choreography** — spatial-temporal patterning of decoy activation
3. **Fake data generation** — content that passes traffic analysis
4. **Honeypot active sensing** — decoys that detect and report enemy engagement

A fifth capability, **AI-driven adaptation**, is treated in document 05.

## The deception invariant

The architectural invariant that every other choice must preserve:

> **An external observer, with sophisticated multi-channel SIGINT but without cryptographic access to the system, cannot distinguish real soldier nodes from decoy nodes by any observable property of their RF emissions.**

This is not a marketing slogan. It is a mathematically defensible claim that constrains protocol design at every level. Any feature that breaks this invariant must be excluded.

## Decoy emitter network

### Hardware spec for the standard decoy

| Component | Choice | Cost |
|---|---|---|
| MCU | ESP32-C6 (WiFi + sub-GHz capable) | €4 |
| Long-range radio | LoRa SX1262 module | €6 |
| Battery | 18650 cell + holder + protection | €5 |
| Solar trickle | 0.5W panel + charge controller | €6 |
| Enclosure | IP67 polycarbonate, mountable | €5 |
| Antennas | Whip + helix LoRa | €2 |
| PCB + assembly | Custom 2-layer | €5 |
| **Total BOM** | | **€33** |

At scale (10,000+ units), BOM target drops to €25.

Compute envelope: ESP32-C6 dual-core 160MHz, 512KB SRAM, more than sufficient for the protocol responsibilities of a decoy. No "AI" runs on the decoy; it executes the slot-selection protocol, encrypts pre-staged fake data, and emits during burst windows.

Power budget: With solar trickle and conservative emission duty cycle (one burst per second, 50ms duration), expected operational lifetime is indefinite in northern European summer conditions. Winter operation requires capacity-bank sizing for two months of low-sun operation.

### Decoy behavioral model

A decoy node executes the same protocol state machine as a real soldier-carried mesh node:

```
   ┌─────────────┐    SYNC-α received     ┌──────────────┐
   │             │ ─────────────────────► │              │
   │   IDLE      │                        │   ARMED      │
   │             │ ◄─────────────────────  │              │
   └─────────────┘    cycle complete      └──────┬───────┘
                                                  │
                                                  │ slot computed
                                                  ▼
                                          ┌──────────────┐
   ┌─────────────┐                        │              │
   │             │                        │   PREP       │
   │   IDLE      │ ◄────── packet sent ── │              │
   │             │                        └──────┬───────┘
   └─────────────┘                                │
                                                  │ slot window
                                                  ▼
                                          ┌──────────────┐
                                          │              │
                                          │  TRANSMIT    │
                                          │              │
                                          └──────────────┘
```

The state machine is identical between real and decoy. The only difference is the source of the payload bytes: a real node packages an actual sitrep; a decoy packages a fake-payload from its pre-staged content store.

This is critical: **the binaries that run on real nodes and decoy nodes share the same state machine code path**. Verification that decoys are not distinguishable from real nodes is reducible to verification that the protocol implementation is correct and that the payload content generators are statistically equivalent.

## Wave choreography

### Concept

A naive decoy deployment has each decoy emit independently each cycle. This produces a "static" signature: enemy SIGINT sees a fixed distribution of emitters in the area, learns the pattern, ignores or targets it.

A choreographed deployment introduces **spatial-temporal correlation** in decoy activation that simulates the signature of unit movement, formation, and tactical maneuver.

### Wave patterns

A wave pattern is a function `f(t, x, y) → {emit, silent}` evaluated at each cycle for each node at position `(x, y)`.

**Pattern 1: linear translation**
```
f(t, x, y) = emit if (x + v·t) mod L < W else silent
```
A band of width W travels in the +x direction at velocity v, with period L. From outside this looks like a unit moving across the area.

**Pattern 2: radial expansion**
```
f(t, x, y) = emit if |sqrt(x² + y²) - r₀ - v·t| < W else silent
```
An expanding ring; looks like multiple unit elements dispersing from a central point.

**Pattern 3: pseudo-random walk cluster**
```
f(t, x, y) = emit if distance((x,y), trajectory(t)) < cluster_radius else silent
```
A "cluster" of activation that meanders pseudo-randomly across the area; looks like a small unit on patrol.

**Pattern 4: phantom convoy**
```
f(t, x, y) = emit if proximity_to_path(P, position_at_t(P, v, t)) < W else silent
```
Activation propagates along a specified path P at velocity v, mimicking a vehicle convoy traversing a road.

### Composite choreography

A real deployment runs multiple patterns simultaneously, with real soldier movements embedded within or across the patterns:

```
At time T, area shows:
  • Pattern 1 (linear) moving east at 30 km/h  ← phantom infantry advance
  • Pattern 4 (convoy) on Road A heading north  ← phantom supply convoy
  • Pattern 3 (cluster) loitering in Sector 7   ← phantom OP
  • Real Soldier Squad in Sector 4 (1 node, 4× per cycle bursts)
```

Enemy SIGINT must allocate analytic and engagement resources across all observed activity. The cost of correctly identifying which of these signatures is real is, by construction, the cost of breaking the cryptographic deception (which is computationally infeasible) or the cost of physical investigation of every active emission (which is economically prohibitive at scale).

### Choreography update cadence

Patterns are recomputed and pushed to decoy nodes via HQ broadcast:

- **Tactical (5-15 minutes)**: pattern parameters adjusted in response to observed enemy reactions
- **Operational (hours)**: pattern types rotated to prevent enemy from learning specific signatures
- **Strategic (daily)**: new pattern library deployed, old patterns retired

Decoys receive updates via the OWVL downlink: HQ generates the new schedule, drone broadcasts during downlink window, decoys (and real nodes) receive passively.

## Fake data generation

### Strategy

To pass traffic analysis, decoy payloads must be statistically equivalent to real payloads at every observable layer:

| Layer | Real characteristic | Decoy must match |
|---|---|---|
| Packet size after encryption | Distribution of sizes from real ops | Same distribution |
| Inter-packet interval | Varies by mission tempo | Same distribution |
| Metadata fields (source, dest, etc.) | Drawn from active topology | Reflect plausible topology |
| Cryptographic envelope | ChaCha20 + Poly1305 | Same primitives, valid MACs |
| Routing class (urgent/routine) | Varies | Same distribution |
| Time-of-day variation | Mission rhythm | Same rhythm |

### Three generation strategies (chosen per deployment)

**Strategy A: Replay**
Pre-captured real-but-old friendly traffic (from training exercises, previous operations declared declassified) is replayed by decoys. Statistically perfect by construction; risk is that an enemy with extremely long observation may notice repetition.

**Strategy B: Generative**
A small local model (could run on the squad-edge tier) generates plausible-sounding traffic content that matches doctrinal vocabulary and reporting conventions. Real-time, infinitely varied; risk is that generation artifacts may eventually become identifiable.

**Strategy C: Encrypted noise**
The "payload" is cryptographically random bytes, padded to match real-packet length distributions. Maximum statistical indistinguishability under the assumption that enemy cannot decrypt; brittle if decryption ever happens.

In practice deployments use B or C depending on threat profile. Hackathon demo uses C (simplest) with discussion of B as the production target.

### Anti-pattern-of-life

Even with perfect content equivalence, behavioral patterns over weeks-to-months could be learned. Mitigations:

- Decoy schedules rotated at the operational cadence (above)
- Decoy population grows and shrinks over time, mimicking force buildup and rotation
- A few "decoys" are intentionally retired (battery death) and replaced; the pattern of replacement is itself signal
- "Real" nodes occasionally use decoy schedules and vice versa, so any learned pattern attributing emissions to roles is invalidated

## Honeypot active sensing

### Concept

A subset of decoy nodes (5-10%) is equipped with passive sensors. These honeypot nodes detect enemy engagement of the deception field and report engagement metadata back through the mesh.

The intelligence value of a destroyed honeypot is often greater than the cost of the honeypot: each destruction reveals enemy weapon characteristics, location, decision cycle, and targeting priorities.

### Honeypot variants

| Variant | Additional sensors | Cost | Role |
|---|---|---|---|
| Standard decoy | None | €33 | Statistical filler |
| Acoustic honeypot | MEMS microphone + DSP | +€8 | Detect artillery, drones, vehicles |
| IR honeypot | Passive IR sensor | +€12 | Detect close-approach (drones, personnel) |
| Vibration honeypot | Geophone | +€6 | Detect tracked vehicles, foot patrol |
| Camera honeypot | Low-power image sensor + ML | +€40 | Visual ID of close threats |
| Full-spectrum honeypot | All above + RF sniffer | +€80 | Premium deployment, sparse |

### Honeypot engagement report

When a honeypot detects engagement (e.g., acoustic sensor catches artillery overpressure, IR sensor catches drone approach signature):

1. **Sensor trigger** (T=0): event detected, classified locally
2. **Burst slot** (T<+1s): emergency burst transmitted in next available slot using **urgent** routing class
3. **Multi-hop relay** (T+1 to T+5s): flood-routed through mesh to drone, then via fiber to HQ
4. **HQ correlation** (T+5 to T+15s): event cross-referenced with other simultaneous reports; pattern emerges
5. **Tactical alert** (T+15s): HQ broadcasts threat alert to all nodes including real soldiers; broadcast happens before next enemy strike cycle

End-to-end latency from enemy weapon launch to friendly warning: well under 30 seconds for most engagement types. Faster than artillery time-of-flight at typical ranges.

### Honeypot economic model

Cost to deploy 100 acoustic honeypots over 10 km²: 100 × €41 = €4,100

Value: characterization of enemy artillery battery operating in that area; reveals battery location after first fire mission; enables counter-battery within tens of minutes.

For comparison: a single Russian Lancet loitering munition costs ~$35,000. Engagement of a single Lancet by Western air defense costs $100K+. The asymmetry runs in favor of cheap-honeypot networks against expensive precision weapons.

## OPFOR / wargame integration

The deception layer is not only defensive. Offensive applications:

- **Phantom advance**: real unit moves into Sector A; decoys simultaneously simulate identical unit moving into Sector B; enemy reaction reveals which they consider higher-priority
- **Withdrawal cover**: real unit withdraws from Sector C; decoys maintain emission signature in Sector C for hours after withdrawal; enemy attacks empty positions
- **Reinforcement insertion**: new unit enters Sector D; decoys in same sector mask the insertion signature; enemy doesn't notice arrival
- **Bait operation**: heavy decoy concentration in Sector E attracts enemy ISR/strike; friendly forces position to ambush attackers in Sector F

Each of these is a tactical doctrine adaptation enabled by the deception infrastructure. The HQ AI (next document) can model these scenarios and recommend tactics adapted to observed enemy responses.

## Verification approach

Statistical indistinguishability is verified by adversarial testing:

1. Train an enemy-model ML classifier on packet captures from both real and decoy nodes
2. Goal: classifier should perform no better than random (50% accuracy on binary real/decoy classification)
3. Iterate protocol design until this property is achieved at chosen sample-size budget

This verification is a hackathon demo-stretch but a production must-have.

## Implementation notes for the hackathon

For the 48-hour demonstration:

- **Decoy simulation**: 47-100 simulated decoy nodes rendered on the audience-phone visualization; their emission events are computed in the server backend
- **Real radio decoys**: not possible to deploy real ESP32+LoRa nodes in the venue; the three USB WiFi adapters represent real-node positions while simulated decoys fill the area
- **Wave choreography**: implemented as a configurable algorithm running server-side, with patterns A, B, C, D selectable from demo control panel
- **Fake data**: Strategy C (encrypted noise) for simplicity; payload generation is one function call per decoy per cycle
- **Honeypot demo**: scripted scenario triggered during pitch: judge clicks "simulate enemy artillery strike" → one honeypot reports → mesh propagates → HQ alerts all nodes including audience phones (visible vibration + screen alert)

The Application Layer is where the demo's narrative payoff happens. Transmission and Mesh layers earn credibility; this layer earns wow.
