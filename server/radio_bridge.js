'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { state } = require('./state');
const config = require('./config');
const log = require('./log').child({ component: 'radio_bridge' });

let radioProcess = null;

function init() {
  if (!config.radio.enabled) {
    log.info('radio bridge disabled (RADIO_ENABLED=false)');
    return;
  }

  const binaryPath = findBinary();
  if (!binaryPath) {
    log.warn('radio bridge binary not found — running without radios');
    return;
  }

  const args = [
    '--simulate',
    '--drone-iface', config.radio.drone_iface,
    '--ground1-iface', config.radio.ground_1_iface,
    '--ground2-iface', config.radio.ground_2_iface,
  ];

  log.info({ binary: binaryPath, args }, 'spawning radio bridge');

  radioProcess = spawn(binaryPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', 'radios'),
  });

  // Parse JSON-lines from stdout
  const rl = readline.createInterface({ input: radioProcess.stdout });
  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      handleRadioEvent(event);
    } catch {
      log.debug({ line }, 'non-JSON line from radio bridge');
    }
  });

  // Log stderr
  radioProcess.stderr.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) log.debug({ radio: msg }, 'radio stderr');
  });

  radioProcess.on('exit', (code) => {
    log.warn({ code }, 'radio bridge process exited');
    radioProcess = null;
  });

  radioProcess.on('error', (err) => {
    log.error({ err: err.message }, 'radio bridge spawn error');
    radioProcess = null;
  });

  // Forward transmission commands from state bus to radio stdin
  state.on('transmission.frame_to_send', (frame) => {
    sendCommand({ type: 'transmit_frame', payload: frame });
  });

  state.on('cycle.sync_beta_burst', (data) => {
    sendCommand({ type: 'emit_cover_signal', cycle: data.number });
  });
}

function handleRadioEvent(event) {
  switch (event.type) {
    case 'frame_received':
      state.emit('radio.frame_received', event);
      break;
    case 'frame_transmitted':
      state.emit('transmission.frame_transmitted', event);
      break;
    case 'adapter_status':
      state.broadcastTo('ops', 'adapter_status', {
        adapter: event.iface,
        status: event.status,
      });
      break;
    case 'burst_started':
    case 'burst_ended':
      state.emit('radio.' + event.type, event);
      break;
    case 'channel_changed':
      log.debug({ iface: event.iface, channel: event.channel }, 'channel changed');
      break;
    default:
      log.debug({ type: event.type }, 'unhandled radio event');
  }
}

function sendCommand(cmd) {
  if (radioProcess && radioProcess.stdin.writable) {
    radioProcess.stdin.write(JSON.stringify(cmd) + '\n');
  }
}

function shutdown() {
  if (radioProcess) {
    log.info('shutting down radio bridge');
    radioProcess.kill('SIGTERM');
    radioProcess = null;
  }
}

function findBinary() {
  const candidates = [
    path.join(__dirname, '..', 'radios', 'target', 'release', 'tactical_mesh_radios.exe'),
    path.join(__dirname, '..', 'radios', 'target', 'release', 'tactical_mesh_radios'),
    path.join(__dirname, '..', 'radios', 'target', 'debug', 'tactical_mesh_radios.exe'),
    path.join(__dirname, '..', 'radios', 'target', 'debug', 'tactical_mesh_radios'),
  ];

  const fs = require('fs');
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = { init, shutdown };
