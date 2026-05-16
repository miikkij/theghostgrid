use serde::{Deserialize, Serialize};
use std::io::Write;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

static STDOUT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Started {
        adapters: Vec<String>,
        simulate: bool,
    },
    AdapterStatus {
        iface: String,
        status: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        channel: Option<u8>,
    },
    FrameReceived {
        iface: String,
        ts: u64,
        src: String,
        payload_b64: String,
        channel: u8,
    },
    FrameTransmitted {
        iface: String,
        ts: u64,
        bytes: usize,
        channel: u8,
    },
    ChannelChanged {
        iface: String,
        ts: u64,
        channel: u8,
    },
    BurstStarted {
        iface: String,
        ts: u64,
        cycle: u64,
    },
    BurstEnded {
        iface: String,
        ts: u64,
        cycle: u64,
        frames: usize,
    },
    FatalError {
        message: String,
    },
    Warning {
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    TransmitFrame {
        iface: String,
        payload_b64: String,
        channel: u8,
    },
    SetChannel {
        iface: String,
        channel: u8,
    },
    StartBurst {
        cycle: u64,
        slot_assignments: Vec<SlotAssignment>,
    },
    EndBurst {
        cycle: u64,
    },
    EmitCoverSignal {
        duration_ms: u64,
    },
    Shutdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotAssignment {
    pub iface: String,
    pub slot_index: u16,
    pub frequency_hops: Vec<u8>,
    pub payload_b64: String,
}

/// Emit a JSON-lines event on stdout. Thread-safe: serializes writes so lines
/// never interleave even when multiple adapter tasks emit concurrently.
pub fn emit_event(event: &Event) {
    if let Ok(json) = serde_json::to_string(event) {
        let _guard = STDOUT_LOCK.lock();
        let stdout = std::io::stdout();
        let mut handle = stdout.lock();
        let _ = writeln!(handle, "{json}");
        let _ = handle.flush();
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serializes_as_tagged_json() {
        let event = Event::Started {
            adapters: vec!["wlan1".into(), "wlan2".into()],
            simulate: true,
        };
        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains(r#""type":"started""#));
        assert!(json.contains(r#""simulate":true"#));
    }

    #[test]
    fn command_deserializes_from_json() {
        let input = r#"{"type":"set_channel","iface":"wlan1","channel":11}"#;
        let cmd: Command = serde_json::from_str(input).unwrap();
        match cmd {
            Command::SetChannel { iface, channel } => {
                assert_eq!(iface, "wlan1");
                assert_eq!(channel, 11);
            }
            _ => panic!("expected SetChannel"),
        }
    }

    #[test]
    fn command_shutdown_deserializes() {
        let input = r#"{"type":"shutdown"}"#;
        let cmd: Command = serde_json::from_str(input).unwrap();
        assert!(matches!(cmd, Command::Shutdown));
    }

    #[test]
    fn start_burst_with_slots_deserializes() {
        let input = r#"{"type":"start_burst","cycle":42,"slot_assignments":[{"iface":"wlan2","slot_index":7,"frequency_hops":[1,6,11],"payload_b64":"AQID"}]}"#;
        let cmd: Command = serde_json::from_str(input).unwrap();
        match cmd {
            Command::StartBurst {
                cycle,
                slot_assignments,
            } => {
                assert_eq!(cycle, 42);
                assert_eq!(slot_assignments.len(), 1);
                assert_eq!(slot_assignments[0].frequency_hops, vec![1, 6, 11]);
            }
            _ => panic!("expected StartBurst"),
        }
    }

    #[test]
    fn now_ms_returns_plausible_timestamp() {
        let ts = now_ms();
        assert!(ts > 1_700_000_000_000);
    }
}
