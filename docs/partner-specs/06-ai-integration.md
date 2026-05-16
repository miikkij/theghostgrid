# THE GHOST GRID — 06: AI Integration

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

The HQ brain runs on ConfidentialMind's air-gappable AI platform, consuming mesh telemetry and producing tactical broadcasts, choreography updates, and threat assessments. Four control loops operate at different timescales. Safety is enforced by a Rules of Engagement state machine that programmatically constrains AI actions — the AI cannot override ROE regardless of its reasoning.

## Adaptive control loops

| Loop | Timescale | Input | Output | Status |
|------|-----------|-------|--------|--------|
| Tactical | 1-5 seconds | Honeypot triggers, jamming events | Auto-broadcast threat alerts | **BUILT** |
| Operational | 1-15 minutes | Tactical event summary | Updated deception choreography | **BUILT** (manual trigger) |
| Strategic | Hourly | Cumulative observations | Key rotation, pattern library refresh | DESIGNED |
| After-action | Post-mission | Full mission log | Lessons learned, training data | DESIGNED |

## Tactical loop architecture

```javascript
// server/hq_brain/tactical_loop.js:66-140
Event ingested → Context assembled (last 5 min events, active patterns, jamming zones)
→ LLM call (system: TACTICAL_LOOP_PROMPT, response_format: json_object, temp: 0.3)
→ Normalize response → Confidence-based downgrade → ROE enforcement → Audit log
→ If HIGH urgency: auto-broadcast to affected area
```

Confidence gate: HIGH with confidence <0.5 is downgraded to MEDIUM. MEDIUM with confidence <0.3 becomes LOW. Prevents false-positive floods.

## ROE state machine

```javascript
// server/hq_brain/roe.js:7-17
STATES: PEACETIME | DEFENSIVE | ACTIVE | EMERGENCY
ALLOWED_ACTIONS[ACTIVE] = { maxUrgency: 'HIGH', autoBroadcast: true, choreographyUpdate: true }
ALLOWED_ACTIONS[PEACETIME] = { maxUrgency: 'LOW', autoBroadcast: false, choreographyUpdate: false }
```

ROE is set by command at mission start. AI cannot escalate beyond the current ROE state. Urgency is capped, broadcasts are blocked, choreography changes are rejected — programmatically, not by prompt instruction.

## Audit trail

Every AI action is logged with hash-chained integrity:

```javascript
// server/hq_brain/audit.js:27-56
{
  log_id: UUID,
  ts: timestamp,
  prev_hash: SHA256(previous_entry),  // tamper detection
  loop: 'tactical' | 'operational',
  event_input: { ... },
  llm_input: { systemPrompt, userMessage },
  llm_output: { urgency, classification, reasoning, confidence },
  action_taken: { type: 'broadcast' | 'recommend' | 'logged' }
}
```

Append-only. Written to both in-memory state and disk file. Hash chain detects tampering in after-action review.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Tactical loop latency | <5 seconds end-to-end | `tactical_loop.js:134` (measured) |
| LLM temperature (tactical) | 0.3 | `tactical_loop.js:78` |
| LLM temperature (operational) | 0.4 | `operational_loop.js:35` |
| Event queue depth | Max 5 (overflow drops LOW first) | `tactical_loop.js:12, 35-44` |
| Confidence threshold (HIGH) | >=0.5 required | `tactical_loop.js:176-177` |
| Confidence threshold (MEDIUM) | >=0.3 required | `tactical_loop.js:177` |
| ROE states | 4 (PEACETIME, DEFENSIVE, ACTIVE, EMERGENCY) | `roe.js:7-11` |
| Audit integrity | SHA256 hash chain | `audit.js:36-39` |
| Fallback | Local Ollama if ConfidentialMind unreachable | Design spec |

## What the AI cannot do

- Generate cryptographic keys (key management is separate infrastructure)
- Override broadcast suppression in radio-silence zones
- Recommend actions outside current ROE classification
- Execute strategic decisions without commander approval
- Act when input confidence is below threshold (degrades to "request human attention")

---

**BUILT**: Tactical loop with LLM call, confidence gating, and auto-broadcast (`server/hq_brain/tactical_loop.js`). Operational loop with choreography recommendations (`server/hq_brain/operational_loop.js`). ROE enforcement state machine (`server/hq_brain/roe.js`). Hash-chained audit trail (`server/hq_brain/audit.js`). ConfidentialMind/Ollama client with graceful fallback. Reasoning traces displayed on big screen.

**DESIGNED**: Strategic loop (hourly). After-action review loop. Persistent learning across missions. Full commander dashboard. Integration with NATO planning tools.

**INTEGRATES WITH**: ConfidentialMind (air-gappable AI-as-a-Service, validated with Hackerpack). Ollama (local fallback). Any LLM API supporting JSON-mode responses.
