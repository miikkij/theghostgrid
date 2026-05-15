# 05 — Design: AI and HQ Brain

## Overview

The HQ brain is the fourth pillar of the architecture. Where Transmission, Mesh, and Deception layers handle protocol mechanics, the HQ brain handles **adaptation**: monitoring enemy reactions, generating new deception choreographies, rotating cryptographic schedules, and recommending tactical actions.

This document specifies the AI integration approach using ConfidentialMind as the deployment platform, the adaptive loops the AI runs, and the safety and audit constraints that govern its outputs.

## Why HQ-tier, not edge

The decision to centralize heavy AI at HQ rather than distributing it to drones or squad-edge nodes reflects three considerations:

1. **Compute density**: Modern LLMs and large reasoning models require GPU resources that fit in datacenter racks, not drone payloads. Putting the heavy AI behind fiber, with HQ-grade power and cooling, removes the constraint.

2. **Aggregation requirement**: Useful intelligence requires correlating signals across the entire mesh. Each node sees its corner of reality; only HQ sees the whole. AI that needs aggregate input must be where aggregate input arrives.

3. **Survivability tradeoff**: AI on a drone is exposed to drone loss. AI at HQ is exposed only to HQ compromise. Hardening HQ is easier than hardening drones.

Drone-tier and squad-edge tier may still run *small* models for specific roles (e.g., classification, local sensor fusion). The architectural decision is about where the *system-level adaptation loop* lives.

## ConfidentialMind as platform

ConfidentialMind provides air-gappable AI-as-a-Service: organizations can deploy LLMs and other AI workloads in private cloud, on-premises, or fully air-gapped environments while maintaining control over data and models. The fit with this architecture is exact:

- **Air-gappability**: Defense customers will not accept AI workloads that reach the public cloud. ConfidentialMind solves this without requiring custom deployment infrastructure.
- **Model flexibility**: Mix of open-weight LLMs (for narrative reasoning) and custom-trained small models (for classification, anomaly detection).
- **Audit and governance**: ConfidentialMind's platform includes governance primitives appropriate for defense applications.
- **Existing partner**: ConfidentialMind is a Defence Hackathon sponsor with Hackerpack platform access, validating early-engagement appetite.

For the hackathon, the HQ brain is deployed on ConfidentialMind's hosted platform. For production, the same workload runs on customer-controlled infrastructure.

## Adaptive control loops

The HQ brain runs four concurrent feedback loops at different timescales:

### Loop 1: Tactical (1-10 seconds)

**Input**: real-time mesh telemetry; honeypot engagement reports; observed jamming patterns
**Output**: immediate tactical broadcasts to friendly forces

```
sensor trigger
      │
      ▼
┌─────────────────┐
│ Event ingest    │  ← fiber from drone
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Correlation     │  ← cross-reference with last N minutes
└────────┬────────┘   of mesh state
         │
         ▼
┌─────────────────┐
│ LLM classify    │  ← determine event type, urgency
│ (small fast)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Auto-broadcast  │  → fiber to drone → ground broadcast
│ if HIGH urgency │
└─────────────────┘
```

Latency budget: under 5 seconds from sensor trigger to friendly broadcast.

This loop is critical for honeypot exploitation: when a honeypot detects an incoming artillery strike, friendly forces in the affected area need warning before time-of-flight elapses. Modern artillery has flight times of 30-90 seconds at typical battle ranges; a 5-second loop gives 25-85 seconds of warning.

### Loop 2: Operational (1-15 minutes)

**Input**: pattern of activity over the recent operational window
**Output**: updated deception choreography; routing-class priority updates

```
recent activity summary
      │
      ▼
┌──────────────────────────┐
│ LLM analysis             │
│ "What is the enemy       │
│  prioritizing?"          │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Wave pattern selection   │
│ (from library)           │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Generate new choreography│
│ parameters               │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Push to decoy nodes      │
│ via OWVL broadcast       │
└──────────────────────────┘
```

Latency budget: under 15 minutes from observed enemy reaction to deployed counter-choreography.

This is where AI's value compounds: the system continuously adapts what the enemy sees in response to what the enemy targets. Static deception is learnable; dynamic deception adapted faster than enemy can learn is not.

### Loop 3: Strategic (hourly)

**Input**: cumulative observations; mission planning artifacts; doctrinal context
**Output**: rotation of cryptographic schedules; new pattern library; commander-facing recommendations

```
hourly summary + mission state
      │
      ▼
┌────────────────────────────────┐
│ LLM strategic review           │
│ • What worked?                 │
│ • What did enemy learn?        │
│ • What should we change?       │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Schedule rotation              │
│ Key rotation                   │
│ Pattern-library refresh        │
└────────┬───────────────────────┘
         │
         ▼
┌────────────────────────────────┐
│ Commander dashboard            │
│ Recommendations + audit trail  │
└────────────────────────────────┘
```

Latency budget: hourly cycle aligned to mission timeline.

This loop produces artifacts that a human commander reviews and approves. Recommendations are never auto-executed at this tier; the AI proposes, the commander disposes.

### Loop 4: After-action (post-mission)

**Input**: full mission log
**Output**: lessons learned; updated doctrine inputs; training data for future AI iterations

This loop is offline and slow. It is what makes the system improve over operational cycles.

## Specific AI capabilities

### Threat fusion

Multi-source event correlation. The honeypot reports an acoustic signature consistent with artillery; a drone IR sensor caught a flash 12 km to the east; a satellite pass detected vehicle movement on a known artillery route 30 minutes ago. The AI fuses these into a single hypothesis: artillery battery at coordinate X, fired round, expected impact at coordinate Y.

This is the same problem solved by NATO link-16 integration but executed at squad-to-battalion level in real time.

### Deception generation

Given a desired tactical effect (e.g., "make the enemy think Battalion A is moving north"), the AI generates appropriate wave-pattern parameters: which decoys activate when, in what sequence, with what density. The generation accounts for terrain, observed enemy SIGINT capability, and consistency with other ongoing patterns.

This is a constrained generative problem suited to LLMs with tool access (the AI can call a "deploy choreography" tool that translates parameters into decoy schedules).

### Anomaly detection

Watching the aggregate mesh traffic for anomalies that suggest infiltration, compromise, or unexpected enemy capability. Anomalies are classified and reported to the strategic loop; high-confidence anomalies trigger emergency rotation.

This is small-model territory; typically a transformer-based anomaly detector trained on baseline traffic.

### Tactical recommendation

Given current battlefield state, AI recommends next moves: routing changes for friendly forces, decoy reinforcement of specific sectors, request for additional drone coverage. Recommendations are explainable: every recommendation includes a trace of which observations drove it.

This is where LLM-class reasoning is most valuable; the AI must construct narrative justifications a commander can evaluate.

### Counter-EW localization

When jamming is detected, the AI correlates jamming patterns across mesh observation points to estimate the jammer's geographic position. This is signals geometry, doable with deterministic algorithms but benefits from LLM reasoning when patterns are ambiguous.

## Safety and audit constraints

### Constraints accepted at design time

- **No autonomous lethal action**: AI never initiates kinetic engagement. Tactical broadcasts may include "enemy detected at X" but never include "engage X."
- **Commander-in-loop at strategic tier**: Strategic recommendations require human approval before execution.
- **Audit trail**: Every AI action is logged with input, model version, prompt/context, output, downstream effect. Logs are immutable for after-action review.
- **Bounded authority**: AI's authority is encoded in a Rules of Engagement (ROE) state machine that constrains valid actions. The AI cannot recommend or execute actions outside ROE; the ROE itself is set by command at mission start.

### What the AI cannot do

- Generate cryptographic keys (these come from key management infrastructure, not AI)
- Override broadcast suppression in zones marked for radio silence
- Recommend actions whose ROE classification has not been pre-approved
- Operate without commander oversight on strategic-tier decisions
- Make decisions when input quality is below confidence threshold (degrades to "request human attention")

### What the AI must do

- Surface uncertainty in every recommendation: confidence intervals, source data quality, contradicting evidence
- Refuse to recommend actions outside ROE, even if seemingly tactically optimal
- Flag when AI is operating in an unfamiliar regime (e.g., observed enemy behavior doesn't match any training distribution)
- Document every assumption made in producing a recommendation

## Tactical mesh feed format

The AI consumes a structured event stream from the mesh. Event types:

```yaml
event_type: position_report
timestamp: 2026-05-15T18:32:14.123Z
source_node: SQ-7-A
position: { lat: 60.18, lon: 24.96 }
confidence: 0.92
context: routine_burst

---

event_type: honeypot_trigger
timestamp: 2026-05-15T18:32:18.456Z
source_node: HP-23
sensor: acoustic
classification: artillery_overpressure
direction_of_arrival: 287°
amplitude: -42dBA

---

event_type: jamming_detected
timestamp: 2026-05-15T18:32:22.789Z
affected_area: [(60.17, 24.93), (60.18, 24.95)]
affected_nodes: [SQ-7-B, SQ-7-C, HP-12]
frequency_band: 2.412-2.422 GHz
estimated_jammer_position: probabilistic, see attachment

---

event_type: enemy_drone_observed
timestamp: 2026-05-15T18:32:35.012Z
source_node: HP-14
sensor: IR + acoustic
classification: FPV_drone_class
estimated_distance: 200m
trajectory: northbound at 60 km/h
```

The AI reads this stream, indexes by time and geography, and runs its loops over the windowed data.

## HQ brain output format

Outputs are structured for downstream consumption:

```yaml
output_type: tactical_broadcast
priority: HIGH
broadcast_window: next available
audience: nodes_within(coordinates: [60.17, 24.95], radius: 2km)
content:
  alert: "Possible artillery; expected impact 28-45s; take cover"
  evidence_summary: "HP-23 acoustic + HP-14 IR; classification confidence 0.87"
authorization: AUTO_TACTICAL_LOOP
log_id: 2026-05-15-T18:32:24.789Z-MOSCOW-001

---

output_type: choreography_update
priority: ROUTINE
deploy_at: 2026-05-15T19:00:00Z
target_decoy_population: sector_7_alpha
new_pattern:
  type: phantom_convoy
  parameters:
    path: route_K
    velocity: 35 km/h
    bandwidth: 200m
authorization: COMMANDER_APPROVED
log_id: 2026-05-15-T18:30:00.000Z-OPERATIONAL-014
```

## Hackathon scope for HQ brain

For the 48-hour demonstration:

- **Platform**: ConfidentialMind hosted environment using Hackerpack credentials
- **Models used**:
  - One LLM (e.g., Llama 3-class) for narrative reasoning and recommendation
  - One small classifier for event-type identification
- **Loops implemented**: Tactical loop (loop 1) fully; Operational loop (loop 2) with simplified pattern selection
- **Demo touchpoints**:
  - Honeypot trigger → AI classification → broadcast to all audience phones within 5 seconds (visible vibration + alert)
  - Mid-demo, operator clicks "simulate enemy adaptation" → AI generates new choreography → decoy pattern visibly changes on big screen
- **Audit visualization**: every AI action shown on big screen with reasoning trace, demonstrating explainability
- **What is NOT in the hackathon scope**: persistent learning across demos, full ROE state machine, integration with real cryptographic key management, commander dashboard

The hackathon demonstrates Loop 1 end-to-end and Loop 2 in simulation. Loops 3 and 4 are described in this design but not built.

## Why this matters for partner conversations

ConfidentialMind, 61N, and DEFINE-network companies have an immediate interest in seeing AI integrated into defense communications architectures correctly: with air-gappability, audit, ROE constraints, and commander-in-loop. Most defense AI demonstrations to date have skipped these properties for the sake of looking impressive.

This architecture treats them as first-class requirements. The pitch language to partners should emphasize: "this is what defense AI integration looks like when done by people who understand the operational reality." That framing differentiates from the broader hackathon field, where AI is often bolted on as a buzzword.
