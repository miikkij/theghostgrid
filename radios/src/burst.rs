use anyhow::Result;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};

use crate::adapter::{decode_payload, encode_payload, Adapter};
use crate::events::{emit_event, now_ms, Command, Event, SlotAssignment};
use crate::hopping;

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
        Self {
            drone,
            ground1,
            ground2,
            commands_rx,
            commands_tx,
        }
    }

    pub fn commands_tx(&self) -> mpsc::Sender<Command> {
        self.commands_tx.clone()
    }

    pub async fn run(mut self) -> Result<()> {
        info!("burst orchestrator running");

        while let Some(cmd) = self.commands_rx.recv().await {
            let result = match cmd {
                Command::StartBurst {
                    cycle,
                    slot_assignments,
                } => self.execute_burst(cycle, slot_assignments).await,
                Command::EndBurst { cycle } => {
                    debug!(cycle, "end_burst acknowledged");
                    Ok(())
                }
                Command::SetChannel { ref iface, channel } => {
                    self.set_channel(iface, channel).await
                }
                Command::TransmitFrame {
                    ref iface,
                    ref payload_b64,
                    channel,
                } => self.transmit_ad_hoc(iface, payload_b64, channel).await,
                Command::EmitCoverSignal { duration_ms } => {
                    self.emit_cover_signal(duration_ms).await
                }
                Command::Shutdown => {
                    info!("shutdown command received");
                    break;
                }
            };

            if let Err(e) = result {
                error!("command execution error: {e:#}");
                emit_event(&Event::Warning {
                    message: format!("command error: {e}"),
                });
            }
        }

        info!("burst orchestrator stopped");
        Ok(())
    }

    async fn execute_burst(
        &mut self,
        cycle: u64,
        slots: Vec<SlotAssignment>,
    ) -> Result<()> {
        let channels = hopping::default_channels();
        let mut total_frames: usize = 0;

        // Emit cover signal from drone concurrently with ground bursts
        emit_event(&Event::BurstStarted {
            iface: self.drone.iface.clone(),
            ts: now_ms(),
            cycle,
        });

        for slot in &slots {
            let adapter = self.adapter_by_name_mut(&slot.iface);
            let Some(adapter) = adapter else {
                warn!(iface = %slot.iface, "unknown adapter in slot assignment");
                continue;
            };

            let payload = match decode_payload(&slot.payload_b64) {
                Ok(p) => p,
                Err(e) => {
                    warn!("invalid payload in slot {}: {e}", slot.slot_index);
                    continue;
                }
            };

            // Execute frequency hops within this slot
            let hops = if slot.frequency_hops.is_empty() {
                hopping::hop_sequence(slot.slot_index, cycle, slot.slot_index, &channels)
            } else {
                slot.frequency_hops.clone()
            };

            for hop_channel in &hops {
                adapter.set_channel(*hop_channel).await?;
                adapter.transmit(&payload).await?;
                total_frames += 1;
            }
        }

        emit_event(&Event::BurstEnded {
            iface: self.drone.iface.clone(),
            ts: now_ms(),
            cycle,
            frames: total_frames,
        });

        Ok(())
    }

    async fn set_channel(&mut self, iface: &str, channel: u8) -> Result<()> {
        let adapter = self.adapter_by_name_mut(iface);
        match adapter {
            Some(a) => a.set_channel(channel).await,
            None => {
                warn!(iface, "set_channel for unknown adapter");
                Ok(())
            }
        }
    }

    async fn transmit_ad_hoc(
        &mut self,
        iface: &str,
        payload_b64: &str,
        channel: u8,
    ) -> Result<()> {
        let adapter = self.adapter_by_name_mut(iface);
        let Some(adapter) = adapter else {
            warn!(iface, "transmit_frame for unknown adapter");
            return Ok(());
        };

        if adapter.current_channel != channel {
            adapter.set_channel(channel).await?;
        }

        let payload = decode_payload(payload_b64)?;
        adapter.transmit(&payload).await?;
        Ok(())
    }

    async fn emit_cover_signal(&mut self, duration_ms: u64) -> Result<()> {
        self.drone.emit_cover_signal(duration_ms).await
    }

    fn adapter_by_name_mut(&mut self, iface: &str) -> Option<&mut Adapter> {
        if self.drone.iface == iface {
            Some(&mut self.drone)
        } else if self.ground1.iface == iface {
            Some(&mut self.ground1)
        } else if self.ground2.iface == iface {
            Some(&mut self.ground2)
        } else {
            None
        }
    }
}

/// Simulation loop: generates periodic fake frame_received events without
/// processing commands. Used when running with --simulate and no stdin
/// commands are expected.
pub async fn run_simulation_loop(adapters: &[String]) -> Result<()> {
    use rand::Rng;

    info!("simulation loop running");
    let channels = hopping::default_channels();
    let sources = ["ALPHA-3", "BRAVO-7", "CHARLIE-1", "DELTA-5", "ECHO-2"];
    let mut cycle: u64 = 0;
    let cycle_duration = std::time::Duration::from_millis(1000);
    let burst_window = std::time::Duration::from_millis(50);

    loop {
        cycle += 1;

        let drone_iface = adapters.first().map(|s| s.as_str()).unwrap_or("sim_drone");
        emit_event(&Event::BurstStarted {
            iface: drone_iface.to_string(),
            ts: now_ms(),
            cycle,
        });

        // Generate frames with rng scoped so it doesn't live across await
        let num_frames = {
            let mut rng = rand::thread_rng();
            let n: usize = rng.gen_range(2..8);
            for _ in 0..n {
                let iface_idx = rng.gen_range(0..adapters.len());
                let iface = &adapters[iface_idx];
                let channel = channels[rng.gen_range(0..channels.len())];
                let src = sources[rng.gen_range(0..sources.len())];
                let payload_len: usize = rng.gen_range(64..200);
                let payload: Vec<u8> = (0..payload_len).map(|_| rng.gen()).collect();

                emit_event(&Event::FrameReceived {
                    iface: iface.clone(),
                    ts: now_ms(),
                    src: src.to_string(),
                    payload_b64: encode_payload(&payload),
                    channel,
                });
            }
            n
        };

        tokio::time::sleep(burst_window).await;

        emit_event(&Event::BurstEnded {
            iface: drone_iface.to_string(),
            ts: now_ms(),
            cycle,
            frames: num_frames,
        });

        // Idle phase
        let idle = cycle_duration.saturating_sub(burst_window);
        tokio::time::sleep(idle).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::{Adapter, Role};

    #[tokio::test]
    async fn orchestrator_handles_shutdown() {
        let drone = Adapter::open("sim_drone", Role::Drone, true).unwrap();
        let g1 = Adapter::open("sim_g1", Role::Ground, true).unwrap();
        let g2 = Adapter::open("sim_g2", Role::Ground, true).unwrap();

        let orch = BurstOrchestrator::new(drone, g1, g2);
        let tx = orch.commands_tx();

        let handle = tokio::spawn(orch.run());
        tx.send(Command::Shutdown).await.unwrap();

        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn orchestrator_executes_burst() {
        let drone = Adapter::open("sim_drone", Role::Drone, true).unwrap();
        let g1 = Adapter::open("sim_g1", Role::Ground, true).unwrap();
        let g2 = Adapter::open("sim_g2", Role::Ground, true).unwrap();

        let orch = BurstOrchestrator::new(drone, g1, g2);
        let tx = orch.commands_tx();

        let handle = tokio::spawn(orch.run());

        tx.send(Command::StartBurst {
            cycle: 1,
            slot_assignments: vec![SlotAssignment {
                iface: "sim_g1".into(),
                slot_index: 0,
                frequency_hops: vec![1, 6, 11],
                payload_b64: "AQID".into(),
            }],
        })
        .await
        .unwrap();

        tx.send(Command::Shutdown).await.unwrap();
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn orchestrator_handles_set_channel() {
        let drone = Adapter::open("sim_drone", Role::Drone, true).unwrap();
        let g1 = Adapter::open("sim_g1", Role::Ground, true).unwrap();
        let g2 = Adapter::open("sim_g2", Role::Ground, true).unwrap();

        let orch = BurstOrchestrator::new(drone, g1, g2);
        let tx = orch.commands_tx();

        let handle = tokio::spawn(orch.run());

        tx.send(Command::SetChannel {
            iface: "sim_g1".into(),
            channel: 11,
        })
        .await
        .unwrap();

        tx.send(Command::Shutdown).await.unwrap();
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn orchestrator_handles_unknown_adapter() {
        let drone = Adapter::open("sim_drone", Role::Drone, true).unwrap();
        let g1 = Adapter::open("sim_g1", Role::Ground, true).unwrap();
        let g2 = Adapter::open("sim_g2", Role::Ground, true).unwrap();

        let orch = BurstOrchestrator::new(drone, g1, g2);
        let tx = orch.commands_tx();

        let handle = tokio::spawn(orch.run());

        // Should not crash on unknown adapter
        tx.send(Command::SetChannel {
            iface: "nonexistent".into(),
            channel: 6,
        })
        .await
        .unwrap();

        tx.send(Command::Shutdown).await.unwrap();
        let result = handle.await.unwrap();
        assert!(result.is_ok());
    }
}
