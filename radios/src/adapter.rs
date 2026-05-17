use anyhow::{Context, Result};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rand::Rng;
use tracing::{debug, info, warn};

use crate::events::{emit_event, now_ms, Event};
use crate::hopping;

#[cfg(feature = "real-radio")]
use wfb_rs::{
    WfbRx, WfbRxConfig, WfbTx, WfbTxConfig, WFB_FRAME_TYPE_DATA, compute_max_payload,
};

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

pub struct ReceivedFrame {
    pub payload: Vec<u8>,
    pub timestamp_ms: u64,
    pub channel: u8,
    pub source: String,
}

const STREAM_ID: u32 = 1;

pub struct Adapter {
    pub iface: String,
    pub role: Role,
    pub current_channel: u8,
    simulate: bool,
    tx_seq: u32,
    #[cfg(feature = "real-radio")]
    tx: Option<WfbTx>,
    #[cfg(feature = "real-radio")]
    rx: Option<WfbRx>,
}

impl Adapter {
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
                tx_seq: 0,
                #[cfg(feature = "real-radio")]
                tx: None,
                #[cfg(feature = "real-radio")]
                rx: None,
            });
        }

        #[cfg(feature = "real-radio")]
        {
            info!(iface, %role, "opening real adapter via kova-wfb-rs");

            let tx = WfbTx::open(&WfbTxConfig {
                iface: iface.to_string(),
                stream_id: STREAM_ID,
                frame_type: WFB_FRAME_TYPE_DATA,
                mcs_index: 1,
                bandwidth: 20,
            })
            .context(format!("WfbTx::open failed on {iface}"))?;

            let rx = WfbRx::open(&WfbRxConfig {
                iface: iface.to_string(),
                stream_id: STREAM_ID,
                rcv_buf_size: None,
                ignore_self_injected: true,
                ring_size: 32,
            })
            .context(format!("WfbRx::open failed on {iface}"))?;

            emit_event(&Event::AdapterStatus {
                iface: iface.to_string(),
                status: "ok_real".into(),
                channel: Some(hopping::default_channels()[0]),
            });

            return Ok(Self {
                iface: iface.to_string(),
                role,
                current_channel: hopping::default_channels()[0],
                simulate: false,
                tx_seq: 0,
                tx: Some(tx),
                rx: Some(rx),
            });
        }

        #[cfg(not(feature = "real-radio"))]
        anyhow::bail!(
            "real adapter mode requires feature 'real-radio'; \
             build with: cargo build --features real-radio"
        )
    }

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

        let status = std::process::Command::new("iw")
            .args(["dev", &self.iface, "set", "channel", &channel.to_string()])
            .status()
            .context(format!("iw set channel failed on {}", self.iface))?;

        if !status.success() {
            anyhow::bail!("iw set channel {} failed on {}", channel, self.iface);
        }

        self.current_channel = channel;
        emit_event(&Event::ChannelChanged {
            iface: self.iface.clone(),
            ts: now_ms(),
            channel,
        });
        Ok(())
    }

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

        #[cfg(feature = "real-radio")]
        {
            self.tx
                .as_mut()
                .expect("tx handle missing on real adapter")
                .send(payload, self.tx_seq)
                .context("transmit failed")?;
            self.tx_seq = self.tx_seq.wrapping_add(1);

            emit_event(&Event::FrameTransmitted {
                iface: self.iface.clone(),
                ts: now_ms(),
                bytes,
                channel: self.current_channel,
            });
            return Ok(bytes);
        }

        #[cfg(not(feature = "real-radio"))]
        anyhow::bail!("real transmit requires feature 'real-radio'")
    }

    pub async fn receive(&mut self) -> Result<Option<ReceivedFrame>> {
        if self.simulate {
            return Ok(None);
        }

        #[cfg(feature = "real-radio")]
        {
            let max_payload = compute_max_payload();
            let mut buf = vec![0u8; max_payload];
            match self
                .rx
                .as_mut()
                .expect("rx handle missing on real adapter")
                .recv(&mut buf, std::time::Duration::from_millis(1))
            {
                Ok(Some((n, meta))) => Ok(Some(ReceivedFrame {
                    payload: buf[..n].to_vec(),
                    timestamp_ms: now_ms(),
                    channel: self.current_channel,
                    source: format!("ant{}:rssi{}", meta.antenna[0], meta.rssi[0]),
                })),
                Ok(None) => Ok(None),
                Err(e) => Err(e.into()),
            }
        }

        #[cfg(not(feature = "real-radio"))]
        anyhow::bail!("real receive requires feature 'real-radio'")
    }

    pub async fn emit_cover_signal(&mut self, duration_ms: u64) -> Result<()> {
        if self.role != Role::Drone {
            warn!(iface = %self.iface, "cover signal requested on non-drone adapter");
        }

        if self.simulate {
            debug!(iface = %self.iface, duration_ms, "simulated cover signal");
            tokio::time::sleep(std::time::Duration::from_millis(duration_ms.min(300))).await;
            return Ok(());
        }

        #[cfg(feature = "real-radio")]
        {
            let channels = [1u8, 6, 11];
            let mut noise = vec![0u8; 256];
            let deadline =
                std::time::Instant::now() + std::time::Duration::from_millis(duration_ms);
            while std::time::Instant::now() < deadline {
                rand::thread_rng().fill(&mut noise[..]);
                for &ch in &channels {
                    self.set_channel(ch).await?;
                    self.transmit(&noise).await?;
                }
            }
            return Ok(());
        }

        #[cfg(not(feature = "real-radio"))]
        anyhow::bail!("real cover signal requires feature 'real-radio'")
    }

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

pub fn encode_payload(payload: &[u8]) -> String {
    B64.encode(payload)
}

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
    fn real_adapter_fails_without_feature() {
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
