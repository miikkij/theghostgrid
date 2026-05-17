# 06 — Implementation: 48-Hour Plan

## Mission

Ship a working demonstration of the Tactical Mesh architecture in 48 hours that covers all three Kova Labs challenge layers (Transmission, Mesh, Application) and earns Overall Winner consideration. Submission deadline: Sunday 12:00.

## Scope decisions for 48 hours

What ships:

- Three USB WiFi adapters running burst-protocol packet exchange with frequency hopping
- Mesh layer with neighbor discovery, two routing modes, jamming-resilient re-routing
- Application layer with simulated decoy choreography (47+ simulated decoys)
- Audience-phone visualization (50-100 concurrent participants)
- Big-screen operator view with all three layers visible
- HQ brain on ConfidentialMind running Tactical Loop (Loop 1) end-to-end
- One honeypot scenario demo: enemy strike detected, alert broadcast, audience phones vibrate
- One choreography adaptation demo: enemy reaction observed, AI generates new pattern, decoys visibly change

What does not ship:

- Production cryptographic key infrastructure (placeholder keys only)
- Operational and strategic AI loops (Loop 1 only; Loops 2-4 described, not built)
- Real ESP32-LoRa decoy hardware (decoys are simulated in visualization)
- Multi-drone optical inter-link (single-drone-equivalent in demo)
- Pre-mission key fill mechanism (assumed pre-provisioned)
- AR overlay or fancy 3D rendering (clean 2D canvas suffices)

## Team and role allocation

Assumes a team of 3-4. Roles:

| Role | Owner | Responsibility |
|---|---|---|
| Protocol engineer | 1 person, Rust comfort | Transmission Layer using Kova Labs libraries |
| Mesh engineer | 1 person | Mesh Layer routing + neighbor management |
| Application + viz | 1-2 persons | Decoy choreography, audience-phone client, big-screen visualization |
| AI integration | shared / one person | ConfidentialMind setup, Tactical Loop |
| Demo + pitch | 1 person (lead) | Coordination, demo script, pitch rehearsal |

If team is 3, the AI integration role is shared between protocol and application engineers as time allows. The demo+pitch lead doubles as application engineer.

## Schedule

### Friday evening (16:00 - 23:00)

| Time | Activity |
|---|---|
| 16:00-18:00 | Check-in, find team if not pre-formed, claim Kova Labs hardware |
| 18:00-19:00 | Friday dinner (pizza), partner booth walk-through |
| 19:00-20:00 | Opening ceremony, challenge confirmation |
| 20:00-22:00 | Team alignment session: scope confirmation, role assignment, sketch first architecture diagram on a whiteboard |
| 22:00-23:00 | Last-train (23:30) prep for non-residents; setup Discord channel for team comms; pre-load Kova Labs Rust libraries; verify USB WiFi adapters work |
| 23:00 | Non-residents depart, residents continue or also depart |

### Saturday (09:00 - 23:00)

| Time | Activity |
|---|---|
| 09:00-10:30 | Reconvene, breakfast at venue |
| 10:30-12:30 | Brunch + first integration session |
| 09:00-12:00 | **Protocol engineer**: burst-window timing skeleton; first three-radio echo test |
| 09:00-12:00 | **Mesh engineer**: neighbor table + simple flood routing; protocol-engineer-stub-compatible |
| 09:00-12:00 | **App+viz lead**: server skeleton (Node.js + Socket.io), phone client minimal page, big-screen canvas hello-world |
| 12:30-14:00 | First integration: three radios + server + 5 phones (team) talking |
| 14:00-18:00 | Layer-specific deep work |
| 14:00-18:00 | **Protocol engineer**: frequency hopping within burst window; cover signal simulation |
| 14:00-18:00 | **Mesh engineer**: distance-vector mode; jamming detection + re-routing |
| 14:00-18:00 | **App+viz**: decoy simulation engine; wave choreography patterns (start with linear translation) |
| 14:00-18:00 | **AI integration**: ConfidentialMind environment up; first LLM call from server backend |
| 18:00-19:00 | Saturday dinner break (mandatory: tired teams ship bugs) |
| 19:00-22:00 | Demo flow rehearsal session |
| 22:00-23:00 | Stress test with 15-20 audience phones (recruit Discord people) |
| 23:00 | Non-residents depart |

### Saturday night → Sunday morning (continuation for residents)

Optional overnight work. Watch for diminishing returns; tired code is buggy code. Recommended cap: 02:00.

### Sunday (09:00 - 12:00)

| Time | Activity |
|---|---|
| 09:00-10:00 | Final integration testing; recovery from any overnight breakage |
| 10:00-11:00 | Demo dress rehearsal twice end-to-end |
| 11:00-11:30 | Submission package assembly: pitch video, source code link, deck PDF |
| 11:30-12:00 | Final review and submission |
| **12:00** | **SUBMISSION HARD DEADLINE** |
| 12:00-13:00 | Lunch; peer-review begins |
| 13:00-16:00 | Top-5 announcement, pitch slot, final judging |
| 16:00-17:00 | Closing, prize ceremony, partner conversations |

## Milestones

| When | Milestone | Verification |
|---|---|---|
| Friday 22:00 | Team aligned, hardware confirmed | Three USB adapters identifiable in `lsusb` output |
| Saturday 12:00 | Three radios echo packets | Manual test: packet sent on radio A, received on radio B |
| Saturday 14:00 | Server + 5 phone clients connected | Visible on big screen |
| Saturday 17:00 | Mesh routes a packet through all three radios | Visualization shows the hop sequence |
| Saturday 19:00 | Decoy simulation rendering on big screen | At least 30 simulated decoys visible, animated |
| Saturday 22:00 | Honeypot scenario end-to-end works | Trigger → AI classify → broadcast → phone vibrates |
| Sunday 10:00 | Full demo run without fatal errors | Two consecutive clean runs |
| Sunday 12:00 | Submission complete | Confirmation page from Junction platform |

## Risk register and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| USB adapter setup fails | Medium | High | Friday evening prep; alternative: software-only simulation of transmission layer |
| Venue WiFi can't handle 100 phones | High | High | Have a 4G mobile hotspot backup; demo can fall back to fewer phones |
| WebSocket sync drift > 200ms | Medium | Medium | Lean into it narratively: "this is why hardware sync matters" |
| iOS Safari quirks (haptic, WebRTC) | High | Medium | Test on iPhone Friday night; have Android fallback message |
| ConfidentialMind environment access issues | Low | Medium | Set up Friday evening; fallback: local Llama via Ollama |
| Team member dropouts (illness, etc.) | Low | High | Cross-train: every role has a backup understanding |
| Demo crashes during pitch | Medium | Catastrophic | Record a backup video Saturday night; play it if live fails |
| Last-train missed on Friday | Low | Low | Take alternative transport |
| Submission system overload Sunday 11:50 | High | Catastrophic | Submit by 11:30 with everything; revise during the buffer |

## Tooling and dev practices

- **Version control**: GitHub repo, public if Kova Labs is fine with it
- **Branching**: simple — main + feature branches, merge often
- **CI**: optional but useful: one workflow that runs `cargo check` on push
- **Communication**: Discord voice + screen-share during work blocks
- **File sharing**: Google Drive for documents; GitHub for code
- **Decision logging**: append-only `DECISIONS.md` in repo; every architecture choice gets a one-line entry

## Test discipline

Limited time means limited testing budget. Spend it on:

- **Integration smoke tests**: every major milestone has a "does the whole thing still work" run
- **Stress test of phone count**: Saturday 22:00 with 15-20 actual phones from Discord recruits
- **Demo rehearsal**: Sunday 10:00, dress rehearsal twice, time it
- **Adversarial test**: someone outside the team trying to break the demo flow; do this Saturday afternoon

What is NOT tested:

- Long-running stability (beyond the demo window)
- Real cryptographic attack
- Real RF propagation in field conditions
- Production-grade error handling

These are appropriate cuts for hackathon scope.

## Submission package contents

Sunday before 12:00, the following must be in the Junction platform:

| Item | Format | Notes |
|---|---|---|
| Project name | Text | e.g., "Tactical Mesh: Drone-Coordinated Resilient Comms" |
| Punchline | Text | One sentence: what it is and why it matters |
| Description | Markdown | 2-3 paragraphs; pull from 00-README.md |
| Challenge | Pick one | Tactical Mesh by Kova Labs |
| Technologies | Tags | Rust, Node.js, WebSocket, WebRTC, ConfidentialMind, Linux 802.11 |
| Pitch video | YouTube/Vimeo link, ≤ 2 minutes | Pre-recorded Saturday night as backup; live link Sunday morning |
| Demo URL | Link | If applicable |
| Source code | GitHub link | Public or private; organizers must access |
| Pitch deck | PDF | Minimal: title slide + diagram + 3 layer slides + ask slide |
| Team member contact | Phone numbers | For winner contact |
| Discord usernames | List | For team comms |
| Crediting preferences | Per member | As agreed within team |

## Compute and infrastructure

- **Local dev**: each team member's laptop
- **Server (during event)**: one team laptop runs the Node.js server + protocol orchestration
- **Big screen**: separate laptop attached to a venue monitor; runs /screen route of the server
- **ConfidentialMind**: hosted via Hackerpack; API calls from server backend
- **Google Cloud**: optional fallback for Gemini API if ConfidentialMind has issues
- **No production hosting needed**: everything runs on-laptop during demo

## Code repository structure (target)

```
tactical-mesh/
├── README.md
├── DECISIONS.md
├── server/                    # Node.js + Socket.io
│   ├── index.js
│   ├── protocol/
│   │   ├── transmission.js    # burst-window orchestration
│   │   ├── mesh.js            # routing
│   │   └── deception.js       # choreography engine
│   ├── ai/
│   │   ├── confidentialmind.js
│   │   └── tactical_loop.js
│   └── visualizations/
│       ├── operator_screen.js
│       └── phone_client.js
├── radios/                    # Rust, Kova Labs libs
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── burst.rs
│       └── hopping.rs
├── client/                    # phone-facing HTML/JS
│   └── index.html
├── operator/                  # big-screen visualization
│   └── screen.html
├── docs/                      # this document set
└── demo/
    ├── pitch.md
    └── backup_video.mp4       # Saturday-night recording
```

## Definition of done (for the hackathon)

The submission is ready when:

- All three layers demonstrably function in a 5-minute demo
- The honeypot end-to-end scenario completes within 5 seconds of trigger
- At least 30 audience phones can connect concurrently and visibly react
- The pitch video is under 2 minutes and clearly explains the architecture
- Source code compiles and runs from a fresh clone with documented setup
- All required submission fields are populated by 11:30 Sunday

## Post-event protocol

Within 7 days of the event:

- Capture lessons learned
- Follow up with partner conversations
- Archive repo, set to public if appropriate
