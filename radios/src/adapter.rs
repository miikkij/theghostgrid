use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::Rng;
use tracing::{debug, warn};

use crate::events::{emit_event, now_ms, Event};
use crate::hopping;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Drone,
    Ground,
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::Drone => write!(f, "drone"),
            Role::Ground => write!(f, "ground"),
        }
    }
}

#[allow(dead_code)]
pub struct ReceivedFrame {
    pub payload: Vec<u8>,
    pub timestamp_ms: u64,
    pub channel: u8,
    pub source: String,
}

pub struct Adapter {
    pub iface: String,
    pub role: Role,
    pub current_channel: u8,
    simulate: bool,
    // TODO: When kova-wfb-rs is available, store the real handles here:
    // tx: Option<wfb_rs::WfbTx>,
    // rx: Option<wfb_rs::WfbRx>,
}

impl Adapter {
    /// Open an adapter. In simulate mode, no hardware is touched.
    /// In real mode, this is where kova-wfb-rs WfbTx/WfbRx would be initialized.
    pub fn open(iface: &str, role: Role, simulate: bool) -> Result<Self> {
        if simulate {
            debug!(iface, %role, "opening simulated adapter");
            emit_event(&Event::AdapterStatus {
                iface: iface.to_string(),
                status: "ok_simulated".into(),
                channel: Some(hopping::default_channels()[0]),
            });
            return Ok(Self {
                iface: iface.to_string(),
                role,
                current_channel: hopping::default_channels()[0],
                simulate: true,
            });
        }

        // TODO: Real adapter initialization using kova-wfb-rs:
        //
        //   let tx_config = wfb_rs::WfbTxConfig { ... };
        //   let rx_config = wfb_rs::WfbRxConfig { ... };
        //   let tx = wfb_rs::WfbTx::new(iface, tx_config)
        //       .context("failed to open TX on {iface}")?;
        //   let rx = wfb_rs::WfbRx::new(iface, rx_config)
        //       .context("failed to open RX on {iface}")?;
        //
        // The adapter expects the interface to already be in monitor mode
        // (set up via `airmon-ng start <iface>` before launching this process).

        anyhow::bail!(
            "real adapter mode requires kova-wfb-rs (not yet linked); \
             use --simulate for development"
        )
    }

    /// Switch the adapter to a different WiFi channel.
    pub async fn set_channel(&mut self, channel: u8) -> Result<()> {
        if self.simulate {
            debug!(iface = %self.iface, channel, "simulated channel switch");
            self.current_channel = channel;
            emit_event(&Event::ChannelChanged {
                iface: self.iface.clone(),
                ts: now_ms(),
                channel,
            });
            return Ok(());
        }

        // TODO: Real channel switch using kova-wfb-rs or iw/iwconfig:
        //   Command::new("iw").args(["dev", &self.iface, "set", "channel", &channel.to_string()])
        //       .status()?;
        // Or if kova-wfb-rs exposes a set_channel method, use that instead.

        anyhow::bail!("real channel switch not implemented")
    }

    /// Inject a packet on this adapter.
    pub async fn transmit(&mut self, payload: &[u8]) -> Result<usize> {
        let bytes = payload.len();

        if self.simulate {
            debug!(iface = %self.iface, bytes, "simulated transmit");
            emit_event(&Event::FrameTransmitted {
                iface: self.iface.clone(),
                ts: now_ms(),
                bytes,
                channel: self.current_channel,
            });
            return Ok(bytes);
        }

        // TODO: Real packet injection using kova-wfb-rs:
        //   self.tx.as_mut().unwrap().send(payload)
        //       .context("transmit failed on {}")?;

        anyhow::bail!("real transmit not implemented")
    }

    /// Non-blocking receive. Returns None if no frame is available.
    #[allow(dead_code)]
    pub async fn receive(&mut self) -> Result<Option<ReceivedFrame>> {
        if self.simulate {
            return Ok(None);
        }

        // TODO: Real receive using kova-wfb-rs:
        //   match self.rx.as_mut().unwrap().recv_optional(timeout) {
        //       Ok(Some((payload, meta))) => Ok(Some(ReceivedFrame {
        //           payload,
        //           timestamp_ms: now_ms(),
        //           channel: self.current_channel,
        //           source: format_source_from_header(&meta),
        //       })),
        //       Ok(None) => Ok(None),
        //       Err(e) => Err(e.into()),
        //   }

        anyhow::bail!("real receive not implemented")
    }

    /// Generate a simulated received frame (used in simulate mode's background loop).
    #[allow(dead_code)]
    pub fn generate_simulated_frame(&self) -> ReceivedFrame {
        let mut rng = rand::thread_rng();
        let payload_len: usize = rng.gen_range(64..200);
        let payload: Vec<u8> = (0..payload_len).map(|_| rng.gen()).collect();
        let sources = ["ALPHA-3", "BRAVO-7", "CHARLIE-1", "DELTA-5", "ECHO-2"];
        let src = sources[rng.gen_range(0..sources.len())];

        ReceivedFrame {
            payload,
            timestamp_ms: now_ms(),
            channel: self.current_channel,
            source: src.to_string(),
        }
    }

    /// Emit a cover signal for the specified duration (drone role only).
    pub async fn emit_cover_signal(&mut self, duration_ms: u64) -> Result<()> {
        if self.role != Role::Drone {
            warn!(iface = %self.iface, "cover signal requested on non-drone adapter");
        }

        if self.simulate {
            debug!(iface = %self.iface, duration_ms, "simulated cover signal");
            // Simulate the timing of a cover signal
            tokio::time::sleep(std::time::Duration::from_millis(duration_ms.min(300))).await;
            return Ok(());
        }

        // TODO: Real cover signal using kova-wfb-rs:
        //   Generate pseudorandom wideband data and inject continuously
        //   for `duration_ms` milliseconds. The cover signal should occupy
        //   the full band (channels 1, 6, 11 in rapid succession) to mask
        //   ground burst transmissions.

        anyhow::bail!("real cover signal not implemented")
    }

    /// Report the adapter as degraded (e.g., after a disconnect).
    #[allow(dead_code)]
    pub fn mark_degraded(&self, reason: &str) {
        emit_event(&Event::Warning {
            message: format!("{} degraded: {reason}", self.iface),
        });
        emit_event(&Event::AdapterStatus {
            iface: self.iface.clone(),
            status: "degraded".into(),
            channel: Some(self.current_channel),
        });
    }
}

/// Encode raw bytes as base64 for the JSON-lines protocol.
pub fn encode_payload(payload: &[u8]) -> String {
    B64.encode(payload)
}

/// Decode base64 payload from the JSON-lines protocol.
pub fn decode_payload(b64: &str) -> Result<Vec<u8>> {
    B64.decode(b64).context("invalid base64 payload")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn simulated_adapter_opens_successfully() {
        let adapter = Adapter::open("sim0", Role::Drone, true).unwrap();
        assert_eq!(adapter.iface, "sim0");
        assert_eq!(adapter.role, Role::Drone);
        assert!(adapter.simulate);
    }

    #[test]
    fn real_adapter_fails_without_library() {
        let result = Adapter::open("wlan1", Role::Ground, false);
        assert!(result.is_err());
    }

    #[test]
    fn base64_round_trip() {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let encoded = encode_payload(&data);
        let decoded = decode_payload(&encoded).unwrap();
        assert_eq!(data, decoded);
    }

    #[test]
    fn simulated_frame_has_valid_fields() {
        let adapter = Adapter::open("sim0", Role::Ground, true).unwrap();
        let frame = adapter.generate_simulated_frame();
        assert!(!frame.payload.is_empty());
        assert!(frame.timestamp_ms > 0);
        assert!(!frame.source.is_empty());
    }
}
