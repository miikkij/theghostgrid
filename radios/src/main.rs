mod adapter;
mod burst;
mod events;
mod hopping;

use anyhow::Result;
use clap::Parser;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

use adapter::{Adapter, Role};
use burst::BurstOrchestrator;
use events::{emit_event, Command, Event};

#[derive(Parser, Debug)]
#[command(name = "tactical-mesh-radios", about = "Tactical Mesh Radio Bridge")]
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
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();

    info!("Tactical Mesh Radio Bridge starting");
    info!(drone = %args.drone, ground1 = %args.ground1, ground2 = %args.ground2, simulate = args.simulate);

    let adapters = vec![args.drone.clone(), args.ground1.clone(), args.ground2.clone()];

    emit_event(&Event::Started {
        adapters: adapters.clone(),
        simulate: args.simulate,
    });

    let result = if args.simulate {
        run_simulate(adapters).await
    } else {
        run_real(args).await
    };

    match result {
        Ok(()) => {
            info!("radio bridge shutting down cleanly");
            Ok(())
        }
        Err(e) => {
            error!("radio bridge error: {e:#}");
            emit_event(&Event::FatalError {
                message: e.to_string(),
            });
            Err(e)
        }
    }
}

/// Simulate mode: opens simulated adapters, runs the burst orchestrator,
/// feeds it commands from stdin, and emits simulated frames in the background.
async fn run_simulate(adapters: Vec<String>) -> Result<()> {
    let drone = Adapter::open(&adapters[0], Role::Drone, true)?;
    let ground1 = Adapter::open(&adapters[1], Role::Ground, true)?;
    let ground2 = Adapter::open(&adapters[2], Role::Ground, true)?;

    let orch = BurstOrchestrator::new(drone, ground1, ground2);
    let cmd_tx = orch.commands_tx();

    // Background: simulated frame generation loop
    let sim_adapters = adapters.clone();
    let sim_task = tokio::spawn(async move {
        if let Err(e) = burst::run_simulation_loop(&sim_adapters).await {
            error!("simulation loop error: {e:#}");
        }
    });

    // Background: stdin command reader
    let stdin_tx = cmd_tx.clone();
    let stdin_task = tokio::spawn(async move {
        if let Err(e) = read_stdin(stdin_tx).await {
            // stdin closed (parent process exited) — not an error
            info!("stdin closed: {e}");
        }
    });

    // Foreground: burst orchestrator
    let orch_task = tokio::spawn(orch.run());

    // Wait for either stdin to close or orchestrator to finish
    tokio::select! {
        _ = stdin_task => {
            info!("stdin closed, shutting down");
            let _ = cmd_tx.send(Command::Shutdown).await;
        }
        result = orch_task => {
            if let Err(e) = result {
                error!("orchestrator panic: {e}");
            }
        }
    }

    sim_task.abort();
    Ok(())
}

/// Real mode: opens actual USB WiFi adapters via kova-wfb-rs.
async fn run_real(args: Args) -> Result<()> {
    let drone = Adapter::open(&args.drone, Role::Drone, false)?;
    let ground1 = Adapter::open(&args.ground1, Role::Ground, false)?;
    let ground2 = Adapter::open(&args.ground2, Role::Ground, false)?;

    let orch = BurstOrchestrator::new(drone, ground1, ground2);
    let cmd_tx = orch.commands_tx();

    let stdin_tx = cmd_tx.clone();
    let stdin_task = tokio::spawn(async move {
        if let Err(e) = read_stdin(stdin_tx).await {
            info!("stdin closed: {e}");
        }
    });

    let orch_task = tokio::spawn(orch.run());

    tokio::select! {
        _ = stdin_task => {
            info!("stdin closed, shutting down");
            let _ = cmd_tx.send(Command::Shutdown).await;
        }
        result = orch_task => {
            if let Err(e) = result {
                error!("orchestrator panic: {e}");
            }
        }
    }

    Ok(())
}

/// Read JSON-lines commands from stdin and forward them to the orchestrator.
async fn read_stdin(tx: mpsc::Sender<Command>) -> Result<()> {
    let stdin = tokio::io::stdin();
    let reader = BufReader::new(stdin);
    let mut lines = reader.lines();

    while let Some(line) = lines.next_line().await? {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        match serde_json::from_str::<Command>(&line) {
            Ok(cmd) => {
                if tx.send(cmd).await.is_err() {
                    break;
                }
            }
            Err(e) => {
                warn!(line, "invalid command JSON: {e}");
                emit_event(&Event::Warning {
                    message: format!("invalid command: {e}"),
                });
            }
        }
    }

    Ok(())
}
