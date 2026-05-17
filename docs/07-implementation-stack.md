# 07 — Implementation: Technical Stack

## Stack philosophy

For a 48-hour build, every technical choice prioritizes one of three properties:

1. **Time-to-first-result**: choices that get something working in hours, not days
2. **Demo robustness**: choices that fail predictably or recoverably during the pitch
3. **Architectural credibility**: choices that signal "we know what we're doing" to partner-tier judges

Production-grade choices (e.g., FreeRTOS on the decoy nodes, certified crypto libraries, real military mesh radios) are out of scope for the hackathon but acknowledged in design.

## Hardware

### Provided by Kova Labs

- **3× USB WiFi adapters** with IEEE 802.11 packet injection capability
- Rust crate `kova-wfb-rs` for frame-level access
- C library equivalent with Python bindings
- GitHub: https://github.com/kova-labs/kova-wfb-rs
- Mentors available on site for embedded systems / radio comms questions

### Team-provided

| Item | Purpose | Owner |
|---|---|---|
| Laptop (Linux preferred) | Server, USB radio host | Each team member |
| Laptop or large monitor | Big-screen operator display | One team member |
| HDMI cable + adapters | Connecting big screen | Whoever brings screen |
| Power strip | Multiple devices charging | One team member |
| Mobile hotspot (4G) | WiFi backup if venue fails | Anyone with capability |
| 5× phones (mixed iOS/Android) | Rehearsal of audience-phone client | Whole team |

### Critical hardware preflight (Friday evening)

```bash
# Linux dependency check
sudo apt install build-essential pkg-config libssl-dev linux-headers-$(uname -r)

# Rust + cargo
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env

# Kova Labs library
git clone https://github.com/kova-labs/kova-wfb-rs
cd kova-wfb-rs && cargo build --release

# Verify USB adapter detection
lsusb | grep -i "wireless\|wifi\|802.11"

# Identify interface name
sudo iwconfig    # look for wlan1, wlan2, wlan3 type entries

# Enable monitor mode (test on one adapter)
sudo airmon-ng start wlan1
```

If any of these steps fail Friday evening, mentors are present. Friday troubleshooting is non-negotiable; Sunday is too late.

## Server-side stack

### Runtime: Node.js

- **Version**: 20+ (latest LTS)
- **Why Node.js**: Socket.io maturity; WebSocket/HTTP server; JSON-native; fast prototyping
- **Why not Python**: GIL constraints on real-time fan-out to 100+ connections
- **Why not Go/Rust for server**: 48h time budget; team comfort

### Key packages

| Package | Version | Purpose |
|---|---|---|
| `express` | 4.x | HTTP server for static files and routes |
| `socket.io` | 4.x | WebSocket fanout to phone clients |
| `child_process` (built-in) | — | Spawn Rust radio process; pipe stdio |
| `canvas` (optional) | 2.x | Server-side canvas for screen pre-rendering |
| `node-fetch` | 3.x | Outbound HTTP to ConfidentialMind API |
| `dotenv` | 16.x | API key management |
| `winston` or `pino` | latest | Structured logging |

### Server architecture

```
                       ┌────────────────────────┐
                       │   index.js (entry)     │
                       └──────────┬─────────────┘
                                  │
       ┌──────────────────────────┼──────────────────────────┐
       │                          │                          │
       ▼                          ▼                          ▼
┌──────────────┐         ┌─────────────────┐        ┌──────────────┐
│ HTTP server  │         │ WebSocket layer │        │ Radio bridge │
│ (express)    │         │ (socket.io)     │        │ (Rust spawn) │
└──────┬───────┘         └────────┬────────┘        └──────┬───────┘
       │                          │                        │
       ▼                          ▼                        ▼
   /                       phone clients              3× USB adapters
   /operator-screen         operator screen           via stdio pipes
   /phone
   /control-panel
```

The `index.js` orchestrates everything. The Rust radio process publishes events over stdout (JSON-lines); the server consumes these and routes them to subscribers.

## Radio-side stack

### Language: Rust

- **Why Rust**: Kova Labs library is Rust-native; precise timing easier than Python; no GC pauses
- **Build system**: Cargo
- **Target**: native Linux x86_64

### Key crates

| Crate | Purpose |
|---|---|
| `kova-wfb` (provided) | Frame injection and capture |
| `tokio` | Async runtime for concurrent radio operations |
| `serde` + `serde_json` | Structured events to/from server |
| `chacha20poly1305` | Encryption |
| `blake3` | MAC computation (alternative to Poly1305) |
| `ringbuf` | Lock-free buffer for inter-thread |
| `clap` | CLI argument parsing |

### Radio orchestration model

Each USB adapter runs in its own thread. A controller thread coordinates burst-window timing:

```rust
// pseudo-code outline
fn main() {
    let runtime = tokio::runtime::Runtime::new().unwrap();
    
    let radio_a = spawn_radio(adapter: "wlan1", role: Role::Drone);
    let radio_b = spawn_radio(adapter: "wlan2", role: Role::Ground);
    let radio_c = spawn_radio(adapter: "wlan3", role: Role::Ground);
    
    let scheduler = burst_scheduler(cycle_ms: 1000);
    
    runtime.block_on(async {
        loop {
            scheduler.wait_until_alpha().await;
            // SYNC-α moment: alpha pulse from drone
            radio_a.emit_sync_alpha().await;
            
            scheduler.wait_until_beta().await;
            // SYNC-β + BURST window
            tokio::join!(
                radio_a.emit_cover_signal(),
                radio_b.transmit_if_pending(),
                radio_c.transmit_if_pending(),
            );
            
            // IDLE window: process received frames
            // publish events to server via stdout
        }
    });
}
```

The drone-role radio emits sync pulses and cover signal. Ground-role radios transmit during the cover window if they have pending data.

## Phone-client stack

### Architecture

Single HTML page, no framework. Vanilla JS keeps the bundle small and fast. The page is loaded by audience members via QR code.

```html
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Tactical Mesh Node</title>
    <link rel="stylesheet" href="/static/phone.css">
</head>
<body>
    <div id="callsign-display">ALPHA-7</div>
    <div id="role-display">RECON</div>
    <div id="state-indicator">LISTENING</div>
    <div id="countdown">1.0s</div>
    <div id="neighbors-list"></div>
    <div id="event-log"></div>
    
    <script src="/socket.io/socket.io.js"></script>
    <script src="/static/phone.js"></script>
</body>
</html>
```

### Key features in phone client

- Connect to `socket.io` on page load
- Receive node identity assignment from server
- Render current state (LISTENING / SYNC / TX / RX / JAMMED / RELAYED / DEAD)
- Update countdown to next burst window
- Trigger `navigator.vibrate()` on burst events
- Lock screen wake via Wake Lock API
- Update event log with last 3 events

### Phone client size targets

- HTML + CSS + JS: under 50KB total
- One round-trip to load
- No external dependencies beyond socket.io client

## Big-screen visualization stack

### Architecture

Separate HTML page at `/operator-screen` route. Renders the battlefield view with all nodes, drones, signal arcs, jamming zones.

### Tech choice: HTML5 Canvas

- **Why Canvas, not WebGL**: simplicity; we're rendering a few hundred sprites, not a 3D scene
- **Why Canvas, not SVG**: animation performance with 100+ moving elements
- **Why not D3**: time budget; raw canvas is more direct

### Frame structure

```javascript
// pseudo-code
const ctx = canvas.getContext('2d');

function render(state) {
    clearCanvas(ctx);
    
    drawMap(ctx);                          // background
    drawJammingZones(ctx, state.jamming);  // red overlays
    drawDrones(ctx, state.drones);         // with fiber tethers
    drawNodes(ctx, state.nodes);           // soldiers + decoys
    drawTransmissionArcs(ctx, state.bursts); // active transmissions
    drawHQConnection(ctx, state.hq);       // fiber to HQ
    drawTelemetry(ctx, state.stats);       // corner overlay
    
    requestAnimationFrame(() => render(latestState));
}
```

Updates pushed from server via WebSocket; render loop pulls latest state at 60 FPS.

### Visual design choices

- Dark background, military-style green/amber accents
- Real nodes: blue dots with callsign
- Decoy nodes: gray dots
- Honeypot nodes: orange dots with sensor icon
- Drones: triangle icons with fiber line back to HQ corner
- Transmission arcs: animated lines during burst window
- Jamming: semi-transparent red overlay
- Telemetry corner: stats counter (packets, latency, sync drift)

## ConfidentialMind integration

### Access via Hackerpack

ConfidentialMind provides API endpoints accessible from the server with credentials issued via Hackerpack. Friday evening setup:

- Receive credentials from organizers
- Test basic API call from server backend
- Verify model selection (target: Llama 3 70B or equivalent)
- Document model latency budget (target: under 2 seconds per call)

### Server-side AI loop

```javascript
async function tacticalLoop(event) {
    // assemble context
    const context = buildContextFromEvent(event, recentMeshState);
    
    // call ConfidentialMind
    const response = await fetch(CONFIDENTIAL_MIND_ENDPOINT, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
            model: 'llama-3-70b',
            messages: [
                { role: 'system', content: TACTICAL_LOOP_PROMPT },
                { role: 'user', content: context },
            ],
            response_format: { type: 'json_object' },
            max_tokens: 500,
        }),
    });
    
    const result = await response.json();
    
    // log for audit
    auditLog.append({ event, context, result, timestamp: Date.now() });
    
    // execute decision
    if (result.priority === 'HIGH') {
        broadcastToAllNodes(result.broadcast_content);
        showAuditOnBigScreen(result);  // visible explainability
    }
}
```

### Fallback: local Ollama

If ConfidentialMind access has issues during demo, a local Ollama instance with Llama 3 8B or similar provides the fallback. Slower and weaker but functional. Set up on Friday evening as risk mitigation.

## Configuration management

A single `.env` file (gitignored) holds all secrets and tunables:

```
# Server
PORT=3000
WS_PATH=/ws

# Radios
RADIO_DRONE_IFACE=wlan1
RADIO_GROUND_1_IFACE=wlan2
RADIO_GROUND_2_IFACE=wlan3
BURST_CYCLE_MS=1000
SYNC_ALPHA_OFFSET_MS=0
SYNC_BETA_OFFSET_MS=215
BURST_WINDOW_MS=300
IDLE_OFFSET_MS=515

# ConfidentialMind
CM_ENDPOINT=https://api.confidentialmind.com/v1/chat
CM_API_KEY=...
CM_MODEL=llama-3-70b

# Demo
NUM_SIMULATED_DECOYS=47
ENABLE_AUDIO_FEEDBACK=true
ENABLE_HAPTIC=true
```

## Local development

### Dev workflow

Each engineer works on their assigned area in a feature branch. Integration happens in person at the venue with shared screen.

Recommended development environment:

- VS Code with Rust-analyzer, ESLint, Prettier
- Two terminals: one for server (`npm run dev`), one for radio process (`cargo run`)
- Browser open to `localhost:3000` for client + `localhost:3000/operator-screen` for big screen

### Testing in dev

Without USB adapters at home (most team members), test against a stub radio:

```javascript
// stub_radio.js
// emits fake events on stdout matching the real radio's protocol
setInterval(() => {
    console.log(JSON.stringify({
        type: 'frame_received',
        timestamp: Date.now(),
        source: 'STUB_RADIO',
        payload_size: Math.floor(Math.random() * 200) + 50,
    }));
}, 500);
```

This lets Saturday engineers iterate on the server side without needing physical radios in front of them.

## Deployment topology at the venue

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Venue                                    │
│                                                                       │
│   ┌─────────────────────┐         ┌──────────────────────┐          │
│   │   Team Laptop A     │  HDMI   │   Big Screen Display │          │
│   │   (server + radios) ├────────►│   /operator-screen   │          │
│   │                     │         └──────────────────────┘          │
│   │   ┌─────────────┐   │                                            │
│   │   │ Server      │   │                                            │
│   │   │ Rust radios │   │         Audience Phones                    │
│   │   └─────────────┘   │         (50-100 devices)                   │
│   │   USB: wlan1/2/3    │                  │                         │
│   └──────────┬──────────┘                  │                         │
│              │ WebSocket                   │ WebSocket               │
│              ▼                              ▼                         │
│      ┌──────────────────────────────────────────────┐                │
│      │   Venue WiFi (FoundersHouse / Wave1234)      │                │
│      └──────────────────────┬───────────────────────┘                │
│                             │                                         │
│                             ▼                                         │
│                       Internet (uplink)                              │
│                             │                                         │
│                             ▼                                         │
│              ┌────────────────────────────┐                          │
│              │  ConfidentialMind API      │                          │
│              │  (hosted, secure endpoint) │                          │
│              └────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────────────┘
```

Single laptop hosts the server, the Rust radio process, and connects via HDMI to the big-screen display. Audience phones connect via venue WiFi to the server's WebSocket endpoint. ConfidentialMind is accessed over the venue's internet uplink.

## Performance budget

| Component | Target | Measured-where |
|---|---|---|
| Burst cycle precision | <10ms jitter | Rust timing logs |
| Server-to-client message latency | <100ms p99 | Socket.io ping |
| Phone-to-phone visible event sync | <250ms | Saturday rehearsal observation |
| ConfidentialMind API call | <2s | Server-side timing |
| Big-screen frame rate | 60 FPS sustained | Browser dev tools |
| Number of concurrent phones | 100+ | Stress test Saturday |
| Time from honeypot trigger to phone vibration | <5s | Demo measurement |

## Logging and observability

For the hackathon, logging is to console and to a single `audit.log` file:

- Server: pino structured logger, JSON output
- Rust radio: env_logger to stderr
- AI loop: every call logged with full prompt + response

After demo, all logs are zipped and included in submission for transparency.

## What we are deliberately not using

- **No databases**: in-memory state only; no persistence needed across 48 hours
- **No authentication**: anyone with the QR can connect; trust the venue
- **No HTTPS**: serve over HTTP on local WiFi; no certs to manage
- **No PWA / app**: web page is enough
- **No CI/CD**: manual deploys; we're running on one laptop
- **No tests beyond smoke tests**: time budget doesn't allow proper test discipline
- **No microservices**: monolith server, single Rust process; integration is easy
- **No Docker / Kubernetes**: just `npm run dev` and `cargo run`
