# Task 04 — HQ Brain (AI Integration)

You are building the **HQ Brain** component: AI integration with ConfidentialMind, tactical adaptation loops, and audit logging.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component D: HQ Brain"
3. Read `docs/05-design-ai-hq-brain.md` — your primary specification

## Your scope

You own these files:

```
server/hq_brain/index.js
server/hq_brain/confidentialmind_client.js
server/hq_brain/tactical_loop.js
server/hq_brain/operational_loop.js
server/hq_brain/prompts.js
server/hq_brain/audit.js
server/hq_brain/ollama_fallback.js
server/hq_brain/README.md
```

You do NOT own anything outside `server/hq_brain/`.

## Prerequisites

- Server Core operational (state bus, event emitter)
- Protocol Modules operational (for mesh-routed broadcasts)
- Deception Engine operational (emits `deception.honeypot_triggered`)

You can stub these dependencies if not yet built. Your work should function with stubs and integrate when they're real.

## What this component does

Implements the four AI control loops described in `docs/05-design-ai-hq-brain.md`:

1. **Tactical loop** (1-10s): processes urgent events (honeypot, jamming) → emits broadcasts
2. **Operational loop** (1-15 min): adapts deception choreography
3. **Strategic loop** (hourly): commander-facing recommendations
4. **After-action loop** (post-event): logs lessons

For hackathon scope, fully implement Tactical loop and stub Operational loop. Strategic and AAR loops can be described in code comments but not built.

## Detailed API specifications

### index.js

```javascript
module.exports = {
  init(state),
  
  /**
   * Ingest an event for AI processing.
   * The router decides which loop processes it.
   */
  ingestEvent(event),

  /**
   * Get recent audit trail entries.
   */
  getAuditTrail({ since, limit }),

  /**
   * Get last reasoning trace (for big-screen display).
   */
  getLastReasoning(),

  /**
   * Trigger operational loop manually (for demos).
   */
  triggerOperationalLoop(),
};
```

### confidentialmind_client.js

```javascript
/**
 * ConfidentialMind API client
 */
module.exports = {
  /**
   * Call the configured LLM with the given prompt.
   * Returns the parsed response or throws.
   */
  async chat({ systemPrompt, userMessage, responseFormat, maxTokens, temperature }),

  /**
   * Health check.
   */
  async health(),
};
```

Configuration comes from `config.confidentialmind`:
- endpoint
- api_key
- model

If the endpoint is unreachable or unconfigured, fall back to `ollama_fallback.js`.

### ollama_fallback.js

```javascript
/**
 * Local Ollama fallback (e.g., llama3:8b running locally)
 */
module.exports = {
  async chat({ systemPrompt, userMessage, responseFormat, maxTokens, temperature }),
  async health(),
};
```

Same interface as `confidentialmind_client.js`. Useful when ConfidentialMind is unavailable.

### tactical_loop.js

```javascript
/**
 * Tactical loop — processes high-urgency events
 */
module.exports = {
  init(state),

  /**
   * Subscribes to:
   *   - deception.honeypot_triggered
   *   - mesh.jamming_detected
   *   - protocol.anomaly_detected
   * 
   * For each event:
   *   1. Build context from recent state
   *   2. Call LLM with TACTICAL_LOOP_PROMPT
   *   3. Parse response
   *   4. If HIGH urgency: auto-broadcast
   *   5. Log to audit trail
   *   6. Emit ai.decision event for visualization
   */
  async processEvent(event),
};
```

Target latency: under 5 seconds from event to broadcast (including LLM call).

### operational_loop.js

```javascript
/**
 * Operational loop — periodic deception pattern updates
 */
module.exports = {
  init(state),

  /**
   * Called periodically (every 15 min in production, every 1 min in demo).
   * Or triggered manually from demo orchestrator.
   * 
   * 1. Summarize recent activity
   * 2. Call LLM with OPERATIONAL_LOOP_PROMPT
   * 3. Parse new choreography parameters from response
   * 4. Emit ops.update_choreography for Deception Engine to consume
   * 5. Log to audit
   */
  async runOperationalCycle(),
};
```

For hackathon scope, this loop can be triggered manually by operator (via `ops.trigger_ai_adaptation` event) rather than running on a timer. In production it would run continuously.

### prompts.js

Contains the system prompts for the LLM. These should be carefully written, not improvised. Quality of prompts directly affects quality of AI behavior.

```javascript
module.exports = {
  TACTICAL_LOOP_PROMPT: `...`,
  OPERATIONAL_LOOP_PROMPT: `...`,
  STRATEGIC_LOOP_PROMPT: `...`,
};
```

**TACTICAL_LOOP_PROMPT** structure (write the full text in the file):

```
You are the tactical loop of a defense mesh communications AI. You process
high-urgency events from a tactical mesh network deployed in a contested
environment. You operate under the following rules of engagement:

1. You may issue tactical broadcasts to alert friendly forces.
2. You may NOT recommend or initiate kinetic engagement.
3. Every decision must include a reasoning trace.
4. You must classify urgency as: HIGH (auto-broadcast), MEDIUM (recommend),
   LOW (log only).

You will receive event context including:
- Event type (honeypot_trigger, jamming_detected, anomaly)
- Time and location
- Source node
- Sensor data
- Recent context (nearby events in last 5 minutes)

You will respond in JSON format:
{
  "urgency": "HIGH" | "MEDIUM" | "LOW",
  "classification": "string describing event type",
  "affected_area": { "center": {x, y}, "radius": number },
  "broadcast_content": "alert message, plain English, under 50 words" | null,
  "reasoning": "explanation of your classification and decision",
  "confidence": 0.0-1.0
}

If urgency is HIGH, the broadcast will be sent automatically.
If MEDIUM, a commander will review your recommendation.
If LOW, the decision is logged but no action taken.

Examples of HIGH urgency:
- Honeypot acoustic sensor detects artillery overpressure
- Multiple honeypots in a sector trigger near-simultaneously
- Sudden mesh-wide jamming event

Examples of MEDIUM urgency:
- Single honeypot vibration sensor (could be friendly traffic)
- Localized jamming (operator should be informed)

Examples of LOW urgency:
- Anomalous single-frame loss (likely noise)
- Stale neighbor information

Be specific in reasoning. Cite the data that drove the classification.
```

**OPERATIONAL_LOOP_PROMPT** structure:

```
You are the operational loop of a defense mesh communications AI. You
periodically review tactical activity and adapt the deception choreography
to maintain effectiveness against enemy SIGINT.

You will receive:
- A summary of activity in the last operational window (15 minutes)
- Currently active deception patterns
- Recent enemy reactions (honeypot triggers, jamming events)

You will respond in JSON format:
{
  "analysis": "what is enemy prioritizing? what is working? what isn't?",
  "recommended_changes": [
    {
      "pattern_id": "current_pattern_id" | null,
      "action": "deactivate" | "activate" | "modify",
      "new_pattern": { "name": "...", "parameters": {...} } | null,
      "justification": "..."
    }
  ],
  "rationale": "summary of the operational reasoning",
  "confidence": 0.0-1.0
}

Available patterns: linear_translation, radial_expansion, random_walk_cluster, phantom_convoy.
Available parameters: see deception engine spec.

Be cautious about pattern changes — too frequent changes are themselves a signal.
Aim for changes only when enemy reaction provides clear evidence the current
pattern is being learned or worked around.
```

### audit.js

```javascript
/**
 * Audit log for all AI decisions
 */
module.exports = {
  init(state),

  /**
   * Append an entry to the audit log.
   * Entry shape:
   *   {
   *     ts: timestamp,
   *     loop: 'tactical' | 'operational' | 'strategic',
   *     event_input: {...},
   *     llm_input: { systemPrompt, userMessage },
   *     llm_output: {...},
   *     action_taken: {...},
   *     log_id: 'uuid',
   *   }
   */
  log(entry),

  /**
   * Query audit log.
   */
  query({ since, until, loop, limit }),

  /**
   * Get total count.
   */
  count(),

  /**
   * Export audit log to file (for after-action review).
   */
  exportToFile(path),
};
```

For hackathon scope, audit log is in-memory + appended to a file at `logs/audit.log` (JSON-lines format). Production would use durable storage.

## Subscription model

### Subscribes to:

- `deception.honeypot_triggered` → tactical loop
- `mesh.jamming_detected` → tactical loop
- `protocol.anomaly_detected` → tactical loop
- `ops.trigger_ai_adaptation` → operational loop (manual trigger)

### Emits:

- `hq.broadcast_proposed` → server core relays to drones for downlink (or for hackathon: directly to phone clients in affected area)
- `hq.audit_entry` → for big-screen display
- `ops.update_choreography` → consumed by Deception Engine
- `ai.decision` → for big-screen reasoning panel display

## Implementation notes

### Context assembly

Before calling the LLM, assemble a useful context. For tactical events:

```javascript
const context = {
  event: triggeringEvent,
  recent_events: state.get('audit_log').filter(e => /* last 5 min */),
  active_patterns: state.get('active_patterns'),
  jamming_zones: state.get('jamming_zones'),
  honeypots_in_area: /* nearby honeypots */,
};
```

Format this as a structured user message for the LLM.

### Timeouts and graceful degradation

LLM calls can take seconds. Budget:
- Tactical: 3 second timeout; if exceeded, log warning, do nothing (don't auto-broadcast based on partial response)
- Operational: 15 second timeout; if exceeded, log and skip cycle

If LLM is unreachable for >30 seconds, switch to ollama_fallback. If both are unavailable, log error and continue silently.

### Latency budget breakdown

For Tactical Loop, target end-to-end under 5 seconds:

- Event ingestion: <100ms
- Context assembly: <100ms
- LLM call: <3000ms
- Response parsing: <100ms
- Audit log write: <50ms
- Emit broadcast: <100ms (subsequent broadcast handled by Server Core)

Total: ~3.5 seconds nominal; 5 seconds maximum.

### Broadcasting alerts

When tactical loop decides HIGH urgency, it emits `hq.broadcast_proposed`. For hackathon scope, this routes directly to:

1. All phone clients within the affected area (`affected_area` from LLM response)
2. Big screen (for visualization)
3. Operator dashboard (for awareness)

Production would route via mesh broadcast pulse from drones. For hackathon, you push directly via Server Core's WebSocket.

### Hand-handling of slow LLM responses

The tactical loop runs async. While LLM is processing event A, event B might arrive. Strategy:

- Queue events; process serially (one LLM call at a time)
- If queue exceeds 5, drop oldest LOW-urgency events
- Log queue depth as metric

## Testing

Provide `server/hq_brain/test_hq_brain.js`:

- Stub the LLM client to return canned responses
- Inject 3 honeypot trigger events
- Verify:
  - All three events are processed
  - Audit log has 3 entries
  - 2 broadcasts emitted (HIGH urgency events)
  - 1 logged-only (LOW urgency event)
  - Reasoning traces are captured

Also include a real-LLM test (`test_hq_brain_live.js`) that calls actual ConfidentialMind / Ollama:

- Inject a honeypot artillery event
- Verify response parses correctly
- Verify response includes reasoning + classification

Run live test only when LLM credentials are configured.

## Acceptance criteria

You are done when:

- All files implement documented APIs
- Stub tests pass
- Live tests pass when LLM is configured
- Tactical loop processes a honeypot event end-to-end in under 5 seconds (measured)
- Audit log is append-only and timestamped
- Reasoning traces emit `ai.decision` events visible to big-screen
- Fallback to Ollama works when ConfidentialMind is unreachable
- LLM prompts in `prompts.js` are written carefully and produce useful outputs
- `npm run lint` passes
- `server/hq_brain/README.md` documents usage
- `DECISIONS.md` updated

## Hand-off

When complete, your component plays with:
- Big Screen → consumes `ai.decision` events for reasoning panel
- Operator Dashboard → triggers `ops.trigger_ai_adaptation`, displays audit trail
- Server Core → relays `hq.broadcast_proposed` to phone clients

Your component is what distinguishes "AI-themed" from "AI-integrated." Take prompt writing seriously.
