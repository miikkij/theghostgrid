# HQ Brain — AI Integration

AI control loops for the Tactical Mesh system. Processes mesh events through ConfidentialMind-hosted LLMs (or local Ollama fallback) to produce tactical broadcasts, deception choreography updates, and audit trails.

## Architecture

```
Events (honeypot, jamming, anomaly)
          │
          ▼
    ┌─────────────┐
    │ Tactical     │  1-10s latency
    │ Loop         │  → auto-broadcast (HIGH)
    └──────┬──────┘  → recommend (MEDIUM)
           │         → log only (LOW)
           ▼
    ┌─────────────┐
    │ Operational  │  Manual trigger (hackathon)
    │ Loop         │  → choreography updates
    └──────┬──────┘
           │
           ▼
    ┌─────────────┐
    │ Audit Log   │  Every decision recorded
    └─────────────┘
```

## LLM Backend

Priority order:
1. **ConfidentialMind** — set `CM_ENDPOINT` and `CM_API_KEY` in `.env`
2. **Ollama fallback** — run `ollama serve` with `llama3:8b` locally
3. **Degraded mode** — logs events for manual review, no AI classification

## API

```javascript
const hqBrain = require('./server/hq_brain');

// Initialize (called by server core)
await hqBrain.init(state);

// Manual event injection
hqBrain.ingestEvent({ event_type: 'honeypot_trigger', ... });

// Trigger operational adaptation
await hqBrain.triggerOperationalLoop();

// Query audit trail
const entries = hqBrain.getAuditTrail({ since: Date.now() - 300000, limit: 10 });

// Last AI reasoning (for big-screen display)
const reasoning = hqBrain.getLastReasoning();
```

## Events

### Subscribes to
- `deception.honeypot_triggered` → tactical loop
- `mesh.jamming_detected` → tactical loop
- `protocol.anomaly_detected` → tactical loop
- `ops.trigger_ai_adaptation` → operational loop

### Emits
- `hq.broadcast_proposed` — tactical alert for relay to phone clients
- `hq.audit_entry` — each AI decision
- `ops.update_choreography` — updated deception parameters
- `ai.decision` — reasoning trace for big-screen display

## Testing

```bash
# Stub LLM tests (no backend needed)
node server/hq_brain/test_hq_brain.js

# Live LLM tests (requires ConfidentialMind or Ollama)
node server/hq_brain/test_hq_brain_live.js
```

## Configuration

| Env variable | Default | Description |
|---|---|---|
| `CM_ENDPOINT` | (none) | ConfidentialMind API endpoint |
| `CM_API_KEY` | (none) | ConfidentialMind API key |
| `CM_MODEL` | `llama-3-70b` | Model to use |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `llama3:8b` | Ollama model name |
