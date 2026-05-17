# History Log — How This Project Came To Be

**Project:** Tactical Mesh — Drone-Coordinated Resilient Communications
**Event:** Junction × Aalto Defence Hackathon 2026, Helsinki, 15–17 May
**Author of this log:** Jouni Miikki, with Claude (Anthropic's assistant) as co-author

## Foreword: why this document exists

This is an AI-accelerated hackathon project. The full design, document set, and implementation prompts were produced in extended dialogue with Claude (Anthropic's AI assistant) over multiple sessions in the weeks preceding the event. Some of the implementation will also be performed by parallel Claude Code instances.

This document exists to:

1. **Preserve transparency.** No one viewing the project should be misled about how it was built. AI was the primary acceleration tool. Human judgment, validation, and direction were the authoritative layer on top.
2. **Provide an audit trail.** If the project fails to deliver, or if specific architectural claims turn out to be wrong, this log helps locate where the error originated — was it a Claude hallucination, a human mis-direction, or an emergent assumption from the dialogue?
3. **Honor the constraint of honesty.** Defense work, especially when shown to partners and judges, deserves to be presented honestly. Pretending the documents were produced by traditional human effort would misrepresent the actual work.

The hackathon community knows AI tooling is widely used. Most participants will not write this kind of log. Doing so explicitly is a choice — one that fits the user's stated preference for direct, no-bullshit communication.

## Context: who and when

- **User / project lead:** Jouni Miikki, Finnish Principal Solution Architect, ~30 years of experience
- **Demoscener handle:** "mov"
- **Engagement window:** the dialogue that produced this design and document set occurred over multiple Claude conversations in the weeks preceding the hackathon
- **AI tools used:**
  - Claude (Anthropic) for architecture iteration, document set, prompt generation — this is the primary tool
  - Claude Code instances are planned for parallel implementation during the hackathon itself
- **Documentation language:** primarily English; conversation between Jouni and Claude was bilingual Finnish/English

## The starting point

The hackathon registration was secured. The user's caution about verifying information is relevant context for the AI-accelerated work that followed — outputs were actively checked rather than accepted at face value.

## Challenge selection

Three challenges were available from the sponsors:

1. **Kova Labs — Tactical Mesh** (3× USB WiFi packet-injection adapters + Rust/C/Python libraries provided)
2. **Kova Labs — Tactical Edge Perception** (Jetson Orin Nano edge-AI focus)
3. **61N Solutions — AI2PB** (AI for Intelligence Preparation of the Battlefield, open-source data fusion)

**Decision:** Tactical Mesh challenge from Kova Labs was selected.

**Reasoning, attributed:**
- Hardware-first nature matched the preference for building tangible systems
- Three protocol layers (Transmission, Mesh, Application) allowed pursuit of the Overall Winner prize across all layers, not just one
- The Edge Perception challenge was rejected because Jetson Orin Nano work felt closer to "another generic AI inference demo"
- AI2PB was considered but Tactical Mesh's all-three-layer pursuit was deemed more ambitious

## The architectural iteration (~15 cycles)

The core technical concept emerged through extended back-and-forth dialogue. Below is a high-level reconstruction. The exact sequence is reconstructed from the conversation summary; some details may not be in strict chronological order.

### Cycle 1: starting concept — "what if we did mesh comms with deception"

Initial framing was around deception as a defensive layer for mesh communications. The user brought general awareness of EW threats from Ukraine 2024–26 and the limitations of existing tactical mesh radios.

Claude proposed the broad outline of "real soldier nodes hiding inside a population of decoys." Initial sketch.

### Cycle 2–4: protocol-level co-design

The dialogue refined the idea: for decoys to be useful, they must be **statistically indistinguishable** from real nodes at the protocol level, not just visually similar. This led to:

- Co-designed protocol where decoys and real nodes follow identical state machines
- Shared encryption envelope so payloads cannot be distinguished by content
- Shared slot-allocation algorithm so timing cannot distinguish them
- Same frame format for both

This was a Claude-led contribution that the user accepted as architecturally correct.

### Cycle 5–6: the GPS-jamming problem and sync-beacon emergence

The user raised the operational reality that GPS jamming makes existing time-discipline solutions fragile. The dialogue explored alternatives:

- Master ground radio (rejected: becomes DF target)
- Atomic clock per node (rejected: too expensive)
- Cellular timing (rejected: also jammable, requires infrastructure)
- **Drone-tethered timing source** (accepted)

The sync beacon concept emerged here: a fiber-tethered drone that derives time discipline from HQ via physical fiber, then broadcasts it as an RF pulse to ground nodes that synchronize passively.

This was a co-developed idea: the user brought the GPS-jamming concern, Claude proposed several options, the dialogue iterated until the drone-fiber concept stabilized.

**Critical caveat:** the user has not formally verified that this architecture is unique or novel. It's plausible that classified or proprietary defense work has already explored similar ideas. We can't verify this from public sources.

### Cycle 7–9: enabling features

Once the sync beacon was the anchor, multiple secondary features became natural:

- **Burst-only ground transmission** — possible because sync is reliable
- **LPI cover signals from drone** — uses the drone's own emission to mask ground bursts
- **Frequency hopping within burst** — feasible because timing is precise
- **One-Way Voice Link doctrine** for downlink — ground nodes never transmit acknowledgments
- **Optical drone-to-drone links** — avoids RF accumulation in airspace

Each of these was suggested by Claude as a logical consequence of the sync beacon being in place. The user accepted them. None were independently verified against existing military doctrine.

### Cycle 10–12: deception layer expansion

The deception layer expanded into:

- **Wave choreography**: spatial-temporal patterned activation of decoys to simulate unit movement
- **Honeypot nodes**: decoys with active sensors that report enemy engagement
- **Economic asymmetry argument**: cheap decoys force expensive enemy targeting decisions

The wave patterns (linear translation, radial expansion, random walk cluster, phantom convoy) were Claude-suggested with parameter schemas. The user accepted them.

The honeypot cost-asymmetry numbers (€25 decoys vs €35k Lancet drones vs €5M Krasukha jammers) are Claude-sourced from training data. **These specific numbers should be verified before quoting them in the pitch.**

### Cycle 13–14: AI integration

The AI layer was added:

- **Four control loops** (tactical, operational, strategic, after-action) at different cadences
- **ConfidentialMind** chosen as deployment platform (sponsor of the hackathon, fits air-gappability requirement)
- **Audit trail and ROE constraints** as first-class requirements

The four-loop structure is Claude-suggested. The ConfidentialMind partnership angle is opportunistic given they're a hackathon sponsor with Hackerpack credentials available.

### Cycle 15: framing convergence

The final iteration converged on positioning:

- Sync beacon as the **architectural anchor**, not just one feature among many
- Other pillars (burst protocol, deception, AI) as **co-designed extensions**
- Cost asymmetry as the **commercial argument**
- "Architecture, not product" as the **partner conversation framing**

## The DEFINE validation moment

In a partner conversation at a venue or networking event preceding the hackathon, the user had a conversation with a representative from **DEFINE** (Defence Innovation Network Finland). The representative was, by the user's account, primarily looking for student-level engagement and did not show strong interest in most of the user's pitches.

However, when the user described and iterated the **sync beacon concept specifically**, the DEFINE representative reportedly smiled, and a nearby contact remarked something to the effect of *"tais upota kun tuolleen otti sen, että siinä voisi olla jotain"* ("that seemed to land when you presented it that way — could be something there").

This is a single anecdotal data point. It is not a formal endorsement. It is, however, the only piece of external human signal that any element of this architecture resonated with someone from the defense community. As such, it carries disproportionate weight in the project's framing decisions:

- The pitch leads with the sync beacon (rather than presenting all four pillars equally)
- The README emphasizes "the architecture is anchored in a sync beacon you cannot jam"
- Partner conversation hooks are designed around this kernel

**Caveat:** building an entire pitch on one anecdotal positive reaction is a known risk. If at the actual hackathon, the sync beacon concept does not land with judges or other partners, the project should pivot to leading with whichever pillar gets engagement. The audit trail of this decision is here so that, in retrospect, we can ask "was over-weighting the DEFINE moment correct?"

## Strategic decisions

### Demo apparatus framing

The hackathon demo will use:
- **Three USB WiFi adapters** from Kova Labs as actual radios
- **50-100 audience phones** via QR code as visualization theatre
- **Big screen** as the HQ-style operator display

The phones are not represented as real military radios. The framing in the pitch is: *"this is the architecture; the real endpoints would be Bittium or Silvus radios."* This honesty was a deliberate choice — pretending the phones were real radios would mislead and would be caught by any defense-knowledgeable judge.

### Code reuse rules

All hackathon code is new, written during or shortly before the event, primarily by Claude Code instances per the prompt set. No code was reused from other projects.

### Eligibility verification

The user verified hackathon eligibility (NATO citizen + Switzerland + Ukraine). The user qualifies as a Finnish citizen.

## Documentation development

### First draft (initial pass)

The first draft of the document set was produced in one Claude conversation. It included ten markdown files:

1. `00-README.md`
2. `01-requirements.md`
3. `02-design-architecture.md`
4. `03-design-protocol.md`
5. `04-design-deception.md`
6. `05-design-ai-hq-brain.md`
7. `06-implementation-plan.md` (original — heavily scheduled, "Friday 19:00 do X")
8. `07-implementation-stack.md`
9. `08-implementation-demo.md`
10. `09-roadmap.md`

### User redirect

The user reviewed the first draft and gave a critical correction:

- Documents were too tied to specific scheduling and team assignments
- This would cause information loss when fed to Claude Code instances
- Request: **make docs generic**, focused on components and interfaces, not on time and people
- Additionally: emphasize the **sync beacon as the validated kernel** (per the DEFINE conversation)
- Additionally: add **UI specifications** (dashboard panel, mobile-specific page, beautiful HTML pages)

This redirect was important. The first draft had over-planned the team logistics in a way that would have constrained Claude Code instance scope unhelpfully.

### Second pass

Per the redirect:

- `06-implementation-plan.md` rewritten as `06-build-components.md` — generic component inventory with interface contracts, no scheduling
- `08-implementation-demo.md` rewritten as `08-demo-and-pitch.md` — sync beacon leads the pitch narrative
- `00-README.md` rewritten to emphasize sync beacon as anchor concept
- `10-ui-design.md` newly added — full UI specifications for all four interfaces

### Third pass: Claude Code prompts

A new directory `claude-code-prompts/` was created with:

- `00-CONTEXT.md` — shared context for all instances
- `01-PROMPT-server-core.md` through `08-PROMPT-radio-bridge.md` — one detailed prompt per component

Each prompt specifies: scope, file ownership, interface contracts, implementation notes, acceptance criteria, hand-off conditions.

### Fourth pass: launcher prompts

A final document `CLAUDE-CODE-LAUNCHER-PROMPTS.md` was created with copy-paste-ready prompts for each Claude Code instance, including branch instructions and recommended sequencing.

## What Claude generated vs what was human-validated

### Claude-generated (verification pending)

- **Specific BOM numbers** (decoy €33, sync drone €5,000) — order-of-magnitude estimates from training data; not from current quotes
- **Weapon engagement costs** (Lancet €35k, Krasukha €5M, Western air defense $100k+ per Lancet engagement) — Claude's recollection; may be outdated
- **Existing tactical mesh radio prices and specifications** (Bittium, Silvus, Persistent, Doodle Labs) — from training data; verify with vendor or public-source freshness
- **Specific contact names at sponsor companies** — from Claude's research output; verify before quoting
- **DEFINE NATO Deployable CIS Module 2027 opening** — Claude-generated; verify
- **Cryptographic library recommendations** (chacha20poly1305, BLAKE3, HKDF) — these are well-known primitives; safe to use
- **Specific protocol numerical parameters** (50ms burst window, 1ms sub-slots, 10 hops per slot, 3 cycles for neighbor timeout) — Claude-chosen reasonable values; should be empirically tuned in practice
- **All technical architecture diagrams and decision rationale text in the docs** — Claude-generated structure; human-acceptable framing

### Human-validated decisions

- **Challenge selection** — Tactical Mesh over Edge Perception or AI2PB
- **Strategic framing** — architecture as anchor, sync beacon as kernel, partnership-not-product
- **Eligibility verification**
- **Demo apparatus framing** — phones are admitted theatre
- **Document set scope correction** — generic over scheduling-specific
- **Sync beacon validation** — the DEFINE conversation framing
- **Overall direction throughout** — human was the steering authority; Claude proposed, human disposed

### Co-developed (dialogue contributions from both)

- **The sync beacon concept itself** — emerged from iterated dialogue, not pure invention by either party
- **Protocol details** — Claude proposed, Jouni refined, multi-round iteration
- **Deception layer** — Claude expanded, Jouni validated tactical sense
- **AI loop structure** — Claude proposed four loops, Jouni accepted with conditions on audit/ROE
- **UI design system** — Claude generated initial, Jouni didn't override but didn't deeply validate either

## Known unknowns going into the hackathon

These are open risks. If the project fails to deliver, the root cause is likely in this list:

1. **Hardware setup**: USB WiFi adapter packet injection may not work cleanly on the host laptops, may not interoperate with Kova Labs library cleanly, may have driver issues
2. **Venue conditions**: WiFi reliability for 50-100 phones simultaneous, lighting/visibility for big screen, power for multiple devices
3. **Team formation**: as of writing this log, the team composition is uncertain; the work distribution assumes 1–4 people are available
4. **Time pressure**: 48 hours is short for the scope envisioned even with parallel Claude Code instances
5. **Pitch landing**: the sync beacon framing rests on a single anecdotal positive reaction; if it doesn't land with judges, the project's positioning may need to pivot mid-pitch
6. **AI-generated content correctness**: technical claims throughout the docs may contain errors that a defense-knowledgeable judge would catch — Jouni should review the docs once more for any specific claim that should be hedged or verified
7. **Architecture novelty**: it is plausible that classified or proprietary defense work has already explored similar ideas; the "this is novel" framing could be challenged by a partner who knows of prior art
8. **ConfidentialMind access**: live API access at the venue is unverified; Ollama fallback is provided but adds setup complexity
9. **Demo flow reliability**: the 5-minute pitch demo flow has dependencies on multiple components working in sequence; any one failing could derail the live demo

## What we'd do differently (to be filled retrospectively)

This section is intentionally blank at project start. After the event, the user is invited to fill in honest reflections on:

- What worked
- What didn't
- Where Claude's contributions were most valuable
- Where Claude's contributions were misleading or counterproductive
- What human judgment was essential
- What lessons to carry to the next AI-accelerated project

(Empty section as of project start.)

## A note on the relationship between AI and operator judgment

The user's stated preference (in their preferences file) is *"Älä keksi tietoja. Jos et tiedä jotain, sano 'en tiedä'."* — do not invent information; if you don't know, say so.

In producing the document set, Claude attempted to honor this preference but the user should recognize that AI assistants, including Claude, do invent things they should not. The document set is comprehensive but not infallible. Treating it as authoritative without spot-checking would be a mistake. Treating it as a useful starting point that requires verification is appropriate.

The user has consistently questioned Claude's outputs throughout the dialogue — that pattern should continue at the hackathon. If a partner asks a question Claude couldn't have known the answer to, the right response is "good question, let me check" rather than improvising from the docs.

## References

- The full document set: `docs/` directory
- The implementation prompts: `docs/claude-code-prompts/` directory  
- The launcher prompts: `CLAUDE-CODE-LAUNCHER-PROMPTS.md`
- Hackathon platform: Junction online
- Discord: `junction-community` server
- Sponsor Hackerpacks: Kova Labs, ConfidentialMind, Google Cloud, ICEYE

## Final note on transparency

This is an AI-accelerated project. The person presenting it (Jouni Miikki) brings 30 years of architectural experience, real-world defense ecosystem context, and decision authority. Claude brought document generation speed, structural consistency, and the ability to iterate at a pace humans cannot match alone.

Neither component would have produced this project alone. The combination produced it in days rather than months. The project is what it is — including any flaws that result from the AI involvement.

Anyone evaluating the work is invited to ask hard questions. The answers, including "we don't know" or "Claude generated that estimate and we haven't verified it," should be given honestly.

Architecture beats features. Honesty beats theater.

---

*Log compiled at project preparation. Maintained as living document. Update with retrospective notes after the event.*

---

## Build-time addendum (Sunday morning, post-build)

A few things changed during the 48-hour build that the pre-event log does not capture:

- **Project renamed** from "Tactical Mesh" to "THE GHOST GRID" with tagline "Everything they see is a lie." The original codebase still references "tactical-mesh" in several paths.
- **Mesh layer wiring**: during code review the mesh module was found to be structurally disconnected from the runtime data flow — neighbor table never seeded at runtime. Fixed by adding neighbor seeding in `population.js` so the protocol actually processes incoming frames. The visualization layer is still independent (greedy nearest-neighbor for animation), but the protocol module is now live.
- **Transmission and deception layer audit**: both confirmed real with live crypto (ChaCha20-Poly1305 AEAD, HKDF, HMAC-SHA256), 130 tests, ~75% of which verify specific security properties (not stubs).
- **Cost numbers**: Lancet ~$35,000 per unit confirmed via web search (Wikipedia, Forbes 2023, multiple 2025-2026 sources). Krasukha-class jamming systems hedged to "millions of dollars" since specific figures vary across sources.
- **Event reality**: USB WiFi adapters could not be picked up at the venue (all distributed before arrival). No partner conversations possible at the booth area. The full retrospective on what this means for AI-accelerated defense-tech engagement is in the "What we'd do differently" section, to be filled later.