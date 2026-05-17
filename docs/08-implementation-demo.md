# 08 — Implementation: Demo and Pitch

## Pitch philosophy

Five minutes, hard cut. The mic dies at 5:00. Judges have heard 40+ pitches by the time it's our turn. The pitch must accomplish four things in this order:

1. **Earn attention** in the first 30 seconds with something they cannot ignore
2. **Demonstrate understanding** of the operational problem (signals credibility to defense judges)
3. **Show the architecture** clearly enough that judges who know mesh radios nod
4. **Close with the ask** for partnership conversations, not prize money

Everything else is cut. The demo IS the pitch; the deck is supporting material, not the main event.

## Opening: 60 seconds of audience activation

No slides. No speaking for the first 30 seconds.

The pitch begins:

> "I need everyone in this room to take out your phone. Scan this QR code."

Wait. Watch the big screen fill with audience-position dots as phones connect. Let the silence work; the visual is doing the talking.

When the count on the big screen passes 30:

> "You are now soldiers in a tactical mesh network. Above you, virtual fiber-tethered drones. Below, the enemy who wants to find you."

This achieves three things simultaneously:

- Every audience member is now invested (their phone is on the screen)
- The room is quiet because everyone is looking at their own device
- Judges have already seen something unusual; they're paying attention

## Minute 1: The problem (30 seconds)

> "Ukraine 2024 to 2026. Russian forces jam GPS across the entire eastern front. Friendly mesh radios that depend on GPS time discipline collapse. Master-radio sync becomes the highest-value target. Modern multi-channel SIGINT can direction-find any persistent emitter to within ten meters."

> "Existing tactical mesh radios — Bittium TAC WIN, Silvus, Persistent Wave Relay — they all assume GPS works and assume RF discipline is enough. They are not designed for the EW environment that actually exists."

Visual: big screen shows the architecture diagram briefly. Three layers, four tiers. Don't dwell.

## Minute 2: The first capability (30 seconds)

> "Watch your phones. We are about to demonstrate transmission layer."

Trigger the burst cycle visualization. On the big screen:

- The virtual drone emits a sync pulse (visible radiating wave animation)
- All audience phones countdown from 3
- At zero, phones briefly vibrate; on the big screen, arcs animate between nodes during the burst window
- The three real USB WiFi adapters on the table also briefly visualize their activity (small overlay)

> "Sub-fifty millisecond transmission windows. Frequency hopping across the band. The drone's cover signal masks ground emissions. What you just felt — that's the protocol. The three radios on this table are doing the real version with WiFi packet injection. The phones are showing you what the architecture looks like at scale."

## Minute 3: Mesh resilience (45 seconds)

> "Now an EW attack."

Click. Red overlay appears on one section of the big screen. The phones in that section show "JAMMED" state.

> "The mesh just lost twenty nodes. Watch."

Wait three seconds. The arcs on the big screen reroute around the dead zone. Stats counter updates: "Mesh reconverged in 2.3 seconds."

> "Self-healing mesh routing. The jammed area is isolated, the rest of the network keeps working. Bandwidth degraded but mission communications intact."

Click again. One of the virtual drones disappears.

> "Now we lose a sync-drone. The remaining drone takes over time discipline. No GPS in this chain anywhere. The mesh continues."

## Minute 4: The deception capability (60 seconds)

This is where the pitch differentiates from everything else in the room.

> "What we've shown so far is good engineering. Other teams will show similar mesh demonstrations. Here is what's different."

Click. The big screen now shows 47 additional gray dots filling the area around the audience-phone dots.

> "These are decoy emitters. Each one costs twenty-five euros to build. They transmit on the same protocol as your phones. To enemy SIGINT, they are indistinguishable from real soldiers."

Click. The decoy population begins emitting in a coordinated wave pattern, sweeping east-to-west across the area.

> "Wave choreography. From the outside, this looks like a battalion moving east. The enemy must allocate intelligence and targeting resources to it. We can make it look like ten battalions, in different directions, simultaneously."

> "A Russian Lancet drone costs thirty-five thousand euros. A Krasukha jammer costs five million. Our decoys cost twenty-five euros each. The cost asymmetry runs in our favor."

Click. One of the decoy dots flashes red — a honeypot has been "engaged."

> "And some of those decoys are honeypots with acoustic sensors. When the enemy engages a honeypot, we learn their position before they finish their fire mission."

The audience phones in the threatened area vibrate. A red alert appears on each phone screen: "ARTILLERY INCOMING - TAKE COVER".

> "Five seconds from sensor trigger to friendly warning. Artillery time of flight at typical ranges is thirty to ninety seconds. We get under cover before impact."

## Minute 5: The AI loop and the close (60 seconds)

> "Behind all of this, an AI running on ConfidentialMind's air-gapped infrastructure. Every honeypot engagement, every jamming event, every observed enemy reaction — it learns. It rewrites the deception choreography. It rotates schedules. It surfaces threats to commanders before commanders see them."

Click. The big-screen audit panel shows the AI's reasoning: "Detected: artillery battery at coordinates X. Pattern: north-to-south fire sequence over last 12 minutes. Recommended: shift decoy wave pattern 30 degrees, increase southern density 40%. Authorization: pending commander."

> "This is what defense AI integration looks like when you treat air-gappability, audit, and rules of engagement as first-class requirements. Not as features bolted onto a generic LLM."

> "We are not pitching a product. We are pitching an architecture. The endpoints are existing military mesh radios — Bittium, Silvus, Persistent. The drones are existing Finnish technology — Kelluu, Donut Defence. The compute platform exists — ConfidentialMind. What we built in 48 hours is the protocol stack and the integration vision that makes these pieces into a system."

> "DEFINE, 61N, ConfidentialMind, Kova Labs — we want to talk to you. This is not a startup ask. This is an R&D partnership ask."

Pause. Let it land.

> "Architecture beats features. Thank you."

## Demo state preparation

Before the pitch begins, ensure on the operator console:

- Backend server is running, stable
- Three USB adapters are operational and visible
- Big-screen visualization is showing the empty battlefield with HQ corner
- QR code is displayed for audience scanning
- Demo control panel is accessible (jamming trigger, drone loss trigger, decoy activation, honeypot trigger, AI loop trigger)
- Backup video is queued and playable in 5 seconds if live demo fails

## Demo control sequence (cheat sheet for the operator)

| Time | Action | Trigger |
|---|---|---|
| 0:00 | Start, show QR | Page already loaded |
| 0:30 | Wait for audience | Watch count |
| 1:00 | Begin narration | Read script |
| 1:30 | Start burst cycle | Toggle "burst-cycle-on" |
| 2:00 | Visualize transmission | Auto, runs while talking |
| 2:30 | Trigger EW attack | Click "inject-jamming-sector-3" |
| 2:45 | Verify mesh reconverged | Confirm visual |
| 3:00 | Trigger drone loss | Click "drone-2-fail" |
| 3:30 | Activate decoy population | Click "decoys-on" |
| 4:00 | Start wave choreography | Click "wave-pattern-linear-east" |
| 4:15 | Trigger honeypot engagement | Click "simulate-artillery-strike" |
| 4:30 | Show AI reasoning | Auto, panel opens |
| 5:00 | Mic cut; pause; thank | End |

## Q&A preparation (3 minutes after pitch)

Anticipated judge questions and prepared answers:

**Q: "How is this different from existing decoy emitter systems?"**

A: "Existing decoys are static deception assets — they emit on programmed schedules without coordination. Our decoys participate in the same protocol as real soldiers, with cryptographically synchronized burst timing and AI-driven choreography. The deception is co-designed with the comms protocol, not bolted on."

**Q: "What's the BOM at scale?"**

A: "Decoy nodes: about thirty-three euros today, target twenty-five at ten-thousand-unit production. Sync drones: about five thousand euros excluding payload. We use existing mesh radios at the soldier endpoint — Bittium TAC WIN or equivalent — so no new BOM at that tier. The economic argument is in the decoy layer."

**Q: "What about cryptographic compromise?"**

A: "We assume the long-term key is potentially compromised at some point in the mission cycle. Schedule rotation runs hourly by default, faster on threat detection. Compromised material has limited operational lifetime. The architecture does not require any single key to remain secret forever."

**Q: "Why fiber tether? Drones with fiber are slow and have range limits."**

A: "Yes. Fiber tether is the design choice that makes the sync drone EW-immune at the cost of altitude and range. We accept that limit. The sync drones are not strike drones; they are infrastructure. Slow and stable is fine. Strike drones operate under and around them."

**Q: "What's your team's plan after the hackathon?"**

A: "Architecture proof, then partner conversations. We are not chasing a startup outcome. We want this to inform an integrator-led product line, ideally with Bittium or similar. Our preferred next step is a session with one or more of the DEFINE-network companies to review the design in detail."

**Q: "What about real-world deployment cost?"**

A: "Decoy deployment by airdrop from existing platforms; ten kilometer square area saturation at one hundred decoys per kilometer square is under fifty thousand euros in node cost. Drone infrastructure assumes ten drones at five thousand each; fifty thousand for that. Total: about a hundred thousand for forward-deployed area defense of ten square kilometers, before any HQ infrastructure. That's well within Finnish unit budgets."

**Q: "How does this work with NATO interoperability?"**

A: "The protocol layer is bespoke. Integration with NATO Federated Mission Networking happens at the HQ side: our HQ brain consumes data from the mesh, emits in standard NATO link formats to broader networks. The mesh itself is below the NATO interop layer."

**Q: "Is the AI fully autonomous on the tactical loop?"**

A: "It auto-broadcasts threat alerts on the tactical loop (high-urgency events with five-second latency budget). It does not initiate kinetic action. Strategic recommendations require commander approval. Every AI action is logged and audited. The architecture is in-the-loop on lethality, not out-of-the-loop."

## Submission materials beyond the pitch

### Pitch video (≤ 2 minutes)

A truncated version of the 5-minute pitch, pre-recorded Saturday night as backup, uploaded to YouTube unlisted Sunday morning:

- 0:00-0:20: Hook (audience phones lighting up on big screen)
- 0:20-0:45: Problem statement
- 0:45-1:15: Demo highlights (burst cycle, jamming recovery, honeypot)
- 1:15-1:45: Deception layer and AI
- 1:45-2:00: Architecture summary and ask

Edit ruthlessly. The pitch video is for judges who didn't see the live pitch; everything must read in two minutes.

### Pitch deck PDF

Minimal slide deck:

1. **Title**: project name + tagline
2. **Architecture diagram**: 3-layer + 4-tier
3. **Demo screenshots**: 3 frames from the live demo (burst, jamming recovery, decoy wave)
4. **Differentiation table**: this architecture vs existing systems
5. **Economic argument**: cost asymmetry table
6. **Ask**: partner conversations with specific companies named

Six slides. PDF only. No animations.

### Source code submission

GitHub repo link in the submission form. Repo includes:

- All source code committed
- `README.md` with setup instructions
- `docs/` directory with this document set
- `LICENSE` (open source, e.g., Apache 2.0)
- Credit attribution per team agreement

## Partner conversation hooks

Each sponsor has a specific conversation we want to start:

### Kova Labs (challenge sponsor)
- "We used your libraries; what's the production path to integrating burst-protocol on top of standard radios?"
- "Have you considered fiber-tether sync architecture in your roadmap?"
- "Would you be interested in continuing this as a longer-form R&D project?"

### ConfidentialMind
- "We deployed the HQ brain on your platform; what's the production deployment story for defense customers?"
- "The audit and explainability requirements we built — does your platform have native primitives for this?"
- "Can you connect us to a defense customer interested in this kind of architecture?"

### 61N Solutions
- "Our architecture's intelligence layer is exactly the IPB problem your challenge addresses. Can we discuss?"
- "Our honeypot reporting layer feeds operational planning; what's the right interface to your tooling?"
- "DEFINE network — what's the entry path for an architecture like this?"

### DEFINE / 17Tech (accelerator companies if present)
- "We're looking for the right partner ecosystem to develop this; what does DEFINE accelerator entry look like for a research-stage architecture rather than a startup?"
- "Bittium, Patria, Insta — who in your network would be the right partner for ground-radio integration?"

### ICEYE
- "We didn't use SAR in this demo but our honeypot reporting could correlate with SAR change detection. Recruitment conversation?"

## What to bring to partner conversations

- A printed one-page summary (architecture diagram + 5 bullets)
- This document set on a USB or shared link
- Business cards (or Junction Platform profile link)
- Specific names of who you'd want to talk to next
- Clear ask: not money, not jobs, not deals — just "let's talk about this architecture for an hour"

## Post-pitch checklist

After the pitch is done:

1. Distribute the one-page printout to interested partners
3. Trade Discord usernames with anyone who wants to follow up
4. Note who said what in a shared team document
5. Don't try to "sell" further at the venue; let the architecture speak

The Friday-to-Sunday hackathon is the first conversation, not the last.
