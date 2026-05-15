# Task 08 — Radio Bridge (Rust)

You are building the **Radio Bridge** component: a Rust process that interfaces with three USB WiFi packet-injection adapters using the Kova Labs `kova-wfb-rs` library, and communicates with the Node.js server via stdio.

## Pre-work

1. Read `docs/00-CONTEXT.md` (in `claude-code-prompts/`) first
2. Read `docs/06-build-components.md` — section "Component E: Radio Bridge"
3. Read `docs/03-design-protocol.md` — understand the transmission layer protocol
4. Read `docs/07-implementation-stack.md` — radio-side stack section
5. Check the Kova Labs library at https://github.com/kova-labs/kova-wfb-rs for API reference

## Your scope

You own these files:

```
radios/Cargo.toml
radios/src/main.rs
radios/src/burst.rs
radios/src/hopping.rs
radios/src/events.rs
radios/src/adapter.rs
radios/README.md
radios/.gitignore
```

You do NOT own anything outside `radios/`.

## Status: this component is optional

If USB WiFi adapter setup fails or hardware is unavailable, the system gracefully falls back to fully-simulated transmission (handled by Deception Engine). Your component should be:

1. Useful when hardware works (real packet injection demonstrates the protocol on real radios)
2. Not blocking when hardware doesn't work (server runs without you)

The Server Core component will detect your presence via stdio handshake. If your process doesn't start or exits, the server proceeds in simulated mode.

## What this component does

This Rust process:

1. Opens 3 USB WiFi adapters in monitor mode
2. Subscribes to the burst-window timing from the server (via stdin)
3. During burst windows, executes the transmission protocol on real radios
4. Listens for incoming frames and forwards them to the server (via stdout)
5. Handles channel hopping within burst windows
6. Reports adapter status and errors

The output protocol is JSON-lines on stdout. The input protocol is JSON-lines on stdin.

## Prerequisites

- 3× USB WiFi adapters with monitor mode + packet injection capability
- Linux host (Ubuntu 22.04+ recommended)
- Rust toolchain (cargo, rustc latest stable)
- `kova-wfb-rs` library

Hardware preflight (operator does this before running):
```bash
sudo apt install aircrack-ng
sudo airmon-ng start wlan1
sudo airmon-ng start wlan2
sudo airmon-ng start wlan3
sudo iwconfig  # verify all three in monitor mode
```

Your process should expect the adapters to be in monitor mode already. Don't try to put them there yourself; that requires root and complicates testing.

## Detailed requirements

### Cargo.toml

```toml
[package]
name = "tactical-mesh-radios"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
clap = { version = "4", features = ["derive"] }
anyhow = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
chacha20poly1305 = "0.10"
blake3 = "1"
hkdf = "0.12"
sha2 = "0.10"

# Add kova-wfb-rs dependency once available
# kova-wfb = { git = "https://github.com/kova-labs/kova-wfb-rs", branch = "main" }
# Or path = "../path/to/kova-wfb-rs" for local development

[[bin]]
name = "tactical-mesh-radios"
path = "src/main.rs"
```

### main.rs

Entry point. Parses CLI arguments, sets up tokio runtime, spawns adapter tasks and the stdio communication loop.

```rust
use clap::Parser;
use anyhow::Result;
use tracing::{info, error};
use tracing_subscriber::EnvFilter;

#[derive(Parser, Debug)]
#[command(name = "tactical-mesh-radios")]
struct Args {
    /// Interface name for the drone-role adapter
    #[arg(long, default_value = "wlan1")]
    drone: String,

    /// Interface name for the first ground-role adapter
    #[arg(long, default_value = "wlan2")]
    ground1: String,

    /// Interface name for the second ground-role adapter
    #[arg(long, default_value = "wlan3")]
    ground2: String,

    /// Run in simulation mode (no real radios)
    #[arg(long)]
    simulate: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();
    
    info!("Tactical Mesh Radio Bridge starting");
    info!("Drone iface: {}", args.drone);
    info!("Ground 1 iface: {}", args.ground1);
    info!("Ground 2 iface: {}", args.ground2);
    info!("Simulate mode: {}", args.simulate);

    // Emit startup banner on stdout (for server to see)
    emit_event(&Event::Started {
        adapters: vec![args.drone.clone(), args.ground1.clone(), args.ground2.clone()],
        simulate: args.simulate,
    });

    let result = if args.simulate {
        run_simulation().await
    } else {
        run_real(args).await
    };

    match result {
        Ok(()) => {
            info!("Radio bridge shutting down cleanly");
            Ok(())
        }
        Err(e) => {
            error!("Radio bridge error: {:#}", e);
            emit_event(&Event::FatalError { message: e.to_string() });
            Err(e)
        }
    }
}

async fn run_simulation() -> Result<()> {
    // Simulation mode: emit periodic fake frame events without real radios
    // useful for development without hardware
    let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
    loop {
        interval.tick().await;
        emit_event(&Event::FrameReceived {
            iface: "sim".to_string(),
            ts: now_ms(),
            src: "SIM_RADIO".to_string(),
            payload_b64: "AAAA".to_string(),
            channel: 6,
        });
    }
}

async fn run_real(args: Args) -> Result<()> {
    // Real mode: open the three adapters, manage burst windows, emit events
    let drone = adapter::Adapter::open(&args.drone, adapter::Role::Drone).await?;
    let ground1 = adapter::Adapter::open(&args.ground1, adapter::Role::Ground).await?;
    let ground2 = adapter::Adapter::open(&args.ground2, adapter::Role::Ground).await?;

    let burst = burst::BurstOrchestrator::new(drone, ground1, ground2);
    let stdin_handler = stdio::StdinHandler::new(burst.commands_tx());

    tokio::try_join!(burst.run(), stdin_handler.run())?;
    Ok(())
}
```

### events.rs

The event protocol structures.

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Started { adapters: Vec<String>, simulate: bool },
    AdapterStatus { iface: String, status: String, channel: Option<u8> },
    FrameReceived { iface: String, ts: u64, src: String, payload_b64: String, channel: u8 },
    FrameTransmitted { iface: String, ts: u64, bytes: usize, channel: u8 },
    ChannelChanged { iface: String, ts: u64, channel: u8 },
    BurstStarted { iface: String, ts: u64, cycle: u64 },
    BurstEnded { iface: String, ts: u64, cycle: u64, frames: usize },
    FatalError { message: String },
    Warning { message: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    TransmitFrame { iface: String, payload_b64: String, channel: u8 },
    SetChannel { iface: String, channel: u8 },
    StartBurst { cycle: u64, slot_assignments: Vec<SlotAssignment> },
    EndBurst { cycle: u64 },
    EmitCoverSignal { duration_ms: u64 },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotAssignment {
    pub iface: String,
    pub slot_index: u16,
    pub frequency_hops: Vec<u8>,
    pub payload_b64: String,
}

pub fn emit_event(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        println!("{}", json);
    }
}

pub fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
```

### adapter.rs

Wraps a single USB WiFi adapter. Provides start/stop, channel set, transmit, receive operations.

```rust
use anyhow::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Drone,
    Ground,
}

pub struct Adapter {
    pub iface: String,
    pub role: Role,
    pub current_channel: u8,
    // Internal: kova_wfb handle
}

impl Adapter {
    pub async fn open(iface: &str, role: Role) -> Result<Self> {
        // Initialize the kova-wfb adapter
        // Return Self
        todo!("integrate with kova-wfb-rs Open API")
    }

    pub async fn set_channel(&mut self, channel: u8) -> Result<()> {
        // Switch channel
        todo!("call kova-wfb set_channel")
    }

    pub async fn transmit(&mut self, payload: &[u8]) -> Result<()> {
        // Inject a packet
        todo!("call kova-wfb send_packet")
    }

    pub async fn receive(&mut self) -> Result<Option<ReceivedFrame>> {
        // Non-blocking receive; returns None if nothing
        todo!("call kova-wfb receive_packet")
    }
}

pub struct ReceivedFrame {
    pub payload: Vec<u8>,
    pub timestamp_ms: u64,
    pub rssi: i8,
}
```

When `kova-wfb-rs` is available, integrate with its real API. The `todo!()` placeholders should be replaced. Until then, implement a stub that simulates the behavior.

### burst.rs

Orchestrates burst-window timing across all three adapters. Receives burst commands from the server, executes the burst on the appropriate adapters, emits frame events as they arrive.

```rust
use crate::adapter::Adapter;
use crate::events::{Command, Event, emit_event};
use anyhow::Result;
use tokio::sync::mpsc;

pub struct BurstOrchestrator {
    drone: Adapter,
    ground1: Adapter,
    ground2: Adapter,
    commands_rx: mpsc::Receiver<Command>,
    commands_tx: mpsc::Sender<Command>,
}

impl BurstOrchestrator {
    pub fn new(drone: Adapter, ground1: Adapter, ground2: Adapter) -> Self {
        let (commands_tx, commands_rx) = mpsc::channel(100);
        Self { drone, ground1, ground2, commands_rx, commands_tx }
    }

    pub fn commands_tx(&self) -> mpsc::Sender<Command> {
        self.commands_tx.clone()
    }

    pub async fn run(mut self) -> Result<()> {
        let receive_task = tokio::spawn(async move {
            // Concurrent receive loops for all three adapters
            // Each emits FrameReceived events as packets arrive
        });

        // Main loop: process commands from stdin
        while let Some(cmd) = self.commands_rx.recv().await {
            match cmd {
                Command::StartBurst { cycle, slot_assignments } => {
                    self.execute_burst(cycle, slot_assignments).await?;
                }
                Command::SetChannel { iface, channel } => {
                    self.set_channel(&iface, channel).await?;
                }
                Command::TransmitFrame { iface, payload_b64, channel } => {
                    self.transmit_ad_hoc(&iface, &payload_b64, channel).await?;
                }
                Command::EmitCoverSignal { duration_ms } => {
                    self.emit_cover_signal(duration_ms).await?;
                }
                Command::Shutdown => break,
                _ => {}
            }
        }

        Ok(())
    }

    async fn execute_burst(&mut self, cycle: u64, slots: Vec<SlotAssignment>) -> Result<()> {
        // For each slot, transmit on the assigned adapter at the assigned channel
        // Frequency hops within the slot: change channel, transmit, change channel, etc.
        // Time the entire burst window (50ms)
        // Emit BurstStarted at start, BurstEnded at end
        // Emit FrameTransmitted as each frame is sent
        Ok(())
    }

    async fn emit_cover_signal(&mut self, duration_ms: u64) -> Result<()> {
        // Drone-role adapter transmits a continuous cover signal for duration_ms
        // This is the LPI cover that masks ground bursts
        Ok(())
    }
}
```

### hopping.rs

Frequency hopping helpers.

```rust
pub fn channel_for_hop(hop_index: usize, base_channels: &[u8]) -> u8 {
    base_channels[hop_index % base_channels.len()]
}

pub fn default_channels() -> Vec<u8> {
    vec![1, 6, 11]  // standard non-overlapping WiFi 2.4GHz channels
}
```

### stdio module

Handles the JSON-lines I/O with the server.

```rust
use crate::events::Command;
use anyhow::Result;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;

pub struct StdinHandler {
    commands_tx: mpsc::Sender<Command>,
}

impl StdinHandler {
    pub fn new(commands_tx: mpsc::Sender<Command>) -> Self {
        Self { commands_tx }
    }

    pub async fn run(self) -> Result<()> {
        let stdin = tokio::io::stdin();
        let reader = BufReader::new(stdin);
        let mut lines = reader.lines();

        while let Some(line) = lines.next_line().await? {
            match serde_json::from_str::<Command>(&line) {
                Ok(cmd) => {
                    if let Err(e) = self.commands_tx.send(cmd).await {
                        eprintln!("Failed to forward command: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("Invalid command JSON: {}", e);
                }
            }
        }

        Ok(())
    }
}
```

## Output protocol (stdout)

One JSON object per line. Examples:

```json
{"type":"started","adapters":["wlan1","wlan2","wlan3"],"simulate":false}
{"type":"adapter_status","iface":"wlan1","status":"ok","channel":6}
{"type":"frame_received","iface":"wlan2","ts":1234567890,"src":"BRAVO-3","payload_b64":"...","channel":6}
{"type":"frame_transmitted","iface":"wlan1","ts":1234567890,"bytes":87,"channel":6}
{"type":"burst_started","iface":"wlan1","ts":1234567890,"cycle":1247}
{"type":"burst_ended","iface":"wlan1","ts":1234567890,"cycle":1247,"frames":12}
```

## Input protocol (stdin)

One JSON object per line. Examples:

```json
{"type":"set_channel","iface":"wlan2","channel":11}
{"type":"transmit_frame","iface":"wlan2","payload_b64":"...","channel":6}
{"type":"start_burst","cycle":1247,"slot_assignments":[{"iface":"wlan2","slot_index":23,"frequency_hops":[6,11,1],"payload_b64":"..."}]}
{"type":"end_burst","cycle":1247}
{"type":"emit_cover_signal","duration_ms":50}
{"type":"shutdown"}
```

## Performance requirements

- Channel switch latency: under 5ms
- Frame transmit latency: under 1ms after command received
- Burst execution timing: within ±1ms of commanded start time
- Receive loop: zero-blocking, no dropped frames at sustained packet rate
- Process startup time: under 2 seconds

## Error handling

- Adapter disconnection during operation: emit warning, mark adapter as degraded, continue with remaining
- Invalid stdin command: emit warning, continue
- Fatal error: emit FatalError event, exit with non-zero code
- Server stdio close (parent process exited): exit cleanly

## Testing

Provide a test mode that doesn't require real hardware:

```bash
cargo run -- --simulate
```

In simulation mode:
- No real adapters opened
- Periodic fake `frame_received` events emitted on stdout
- Commands from stdin are acknowledged but not actually executed
- Useful for testing the server's integration without hardware

Also provide a smoke test for the Cargo build:

```bash
cargo build --release
cargo test
cargo clippy
```

All should pass cleanly.

## Build and run instructions

```bash
# Build
cd radios
cargo build --release

# Run with default interfaces (requires root for monitor mode adapters)
sudo RUST_LOG=info ./target/release/tactical-mesh-radios

# Run with custom interfaces
sudo RUST_LOG=info ./target/release/tactical-mesh-radios --drone wlan1 --ground1 wlan2 --ground2 wlan3

# Run in simulation mode (no hardware required)
RUST_LOG=info ./target/release/tactical-mesh-radios --simulate
```

The server (Node.js) spawns this binary as a child process:

```javascript
const { spawn } = require('child_process');
const radio = spawn('./radios/target/release/tactical-mesh-radios', [
  '--drone', config.radio.drone_iface,
  '--ground1', config.radio.ground_1_iface,
  '--ground2', config.radio.ground_2_iface,
]);

radio.stdout.on('data', (data) => {
  // Parse JSON-lines events
});

radio.stdin.write(JSON.stringify({ type: 'set_channel', iface: 'wlan1', channel: 6 }) + '\n');
```

## Acceptance criteria

You are done when:

- `cargo build --release` succeeds
- `cargo test` passes
- `cargo clippy` reports no warnings
- Simulation mode runs and emits valid JSON-lines on stdout
- Simulation mode accepts commands on stdin without errors
- Process exits cleanly on stdin close
- When `kova-wfb-rs` is available, real mode opens three adapters and exercises the protocol
- `radios/README.md` documents build, run, and integration with the server
- `DECISIONS.md` updated for any non-obvious choices

## Hand-off

When complete, the server can spawn your binary and:
- Receive real-time frame events from physical USB WiFi adapters
- Send transmission commands that execute on real radios
- Demonstrate the burst protocol on actual hardware during the pitch

If hardware doesn't cooperate during the demo, the simulation mode keeps your component running in the background, and the server falls back to fully-simulated transmission via the Deception Engine. The architecture story is unaffected; the demo just shows fewer "real radios" doing the work.
