# Radio Bridge

Rust process that interfaces with three USB WiFi packet-injection adapters (via Kova Labs `kova-wfb-rs`) and communicates with the Node.js server over stdio JSON-lines.

## Build

```bash
cd radios
cargo build --release
cargo test
cargo clippy
```

Requires Rust stable (1.77+).

## Run

### Simulation mode (no hardware)

```bash
RUST_LOG=info ./target/release/tactical-mesh-radios --simulate
```

Emits periodic simulated burst cycles with fake frame events on stdout. Accepts commands on stdin. Exits cleanly when stdin closes.

### Real mode (USB WiFi adapters)

Requires three USB WiFi adapters in monitor mode (set up before launching):

```bash
sudo airmon-ng start wlan1
sudo airmon-ng start wlan2
sudo airmon-ng start wlan3
```

Then:

```bash
sudo RUST_LOG=info ./target/release/tactical-mesh-radios \
  --drone wlan1 --ground1 wlan2 --ground2 wlan3
```

Real mode requires `kova-wfb-rs` to be linked. Until it's available on crates.io, uncomment the dependency in `Cargo.toml` and point it at the local checkout or git repo.

## Server integration

The Node.js server spawns this binary as a child process:

```javascript
const radio = spawn('./radios/target/release/tactical-mesh-radios', [
  '--simulate' // or --drone wlan1 --ground1 wlan2 --ground2 wlan3
]);

radio.stdout.on('data', (data) => {
  // Parse JSON-lines events
});

radio.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
```

If the process fails to start or exits, the server falls back to fully-simulated mode.

## Protocol

### Output (stdout) — one JSON object per line

| Event | Fields |
|---|---|
| `started` | `adapters`, `simulate` |
| `adapter_status` | `iface`, `status`, `channel` |
| `frame_received` | `iface`, `ts`, `src`, `payload_b64`, `channel` |
| `frame_transmitted` | `iface`, `ts`, `bytes`, `channel` |
| `channel_changed` | `iface`, `ts`, `channel` |
| `burst_started` | `iface`, `ts`, `cycle` |
| `burst_ended` | `iface`, `ts`, `cycle`, `frames` |
| `fatal_error` | `message` |
| `warning` | `message` |

### Input (stdin) — one JSON object per line

| Command | Fields |
|---|---|
| `transmit_frame` | `iface`, `payload_b64`, `channel` |
| `set_channel` | `iface`, `channel` |
| `start_burst` | `cycle`, `slot_assignments[]` |
| `end_burst` | `cycle` |
| `emit_cover_signal` | `duration_ms` |
| `shutdown` | — |

## Architecture

```
main.rs       — CLI args, tokio runtime, stdio loop, simulate/real dispatch
events.rs     — Event/Command serde types, emit_event(), now_ms()
adapter.rs    — Single adapter abstraction (open, set_channel, transmit, receive)
burst.rs      — BurstOrchestrator + simulation loop
hopping.rs    — Frequency hopping helpers (channel selection, hop sequences)
```

Logs go to stderr (structured, via `tracing`). Set `RUST_LOG=debug` for verbose output.
