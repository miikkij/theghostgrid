'use strict';

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');
const { state } = require('./state');
const config = require('./config');
const frame = require('./protocol/frame');
const cryptoUtils = require('./protocol/crypto');
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
    '--drone', config.radio.drone_iface,
    '--ground1', config.radio.ground_1_iface,
    '--ground2', config.radio.ground_2_iface,
  ];

  log.info({ binary: binaryPath, args }, 'spawning radio bridge (real mode)');

  radioProcess = spawn(binaryPath, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: path.join(__dirname, '..', 'radios'),
  });

  const rl = readline.createInterface({ input: radioProcess.stdout });
  rl.on('line', (line) => {
    try {
      const event = JSON.parse(line);
      handleRadioEvent(event);
    } catch {
      log.debug({ line }, 'non-JSON line from radio bridge');
    }
  });

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

  // Outbound: encode frame to 256-byte binary, base64, send to Rust bridge
  state.on('transmission.frame_to_send', (frameObj) => {
    const cycleKey = cryptoUtils.deriveCycleKey(
      config.protocol.master_secret,
      frameObj.cycle || 0,
    );
    const encoded = frame.encodeTransmissionFrame(frameObj, cycleKey);
    const payload_b64 = encoded.toString('base64');

    const iface = frameObj._iface || config.radio.ground_1_iface;
    const slotInfo = frameObj.slot || 0;
    const hops = frameObj._frequencyHops || [1, 6, 11];

    sendCommand({
      type: 'start_burst',
      cycle: frameObj.cycle || 0,
      slot_assignments: [{
        iface,
        slot_index: slotInfo,
        frequency_hops: hops,
        payload_b64,
      }],
    });
  });

  state.on('cycle.sync_beta_burst', (data) => {
    sendCommand({ type: 'emit_cover_signal', duration_ms: config.cycle.burst_window_ms });
  });
}

function handleRadioEvent(event) {
  switch (event.type) {
    case 'frame_received': {
      // Decode base64 payload to 256-byte Buffer for binary frame decryption
      if (event.payload_b64) {
        const raw = Buffer.from(event.payload_b64, 'base64');
        state.emit('radio.frame_received', {
          raw,
          iface: event.iface,
          src: event.src,
          channel: event.channel,
          ts: event.ts,
        });
      }
      break;
    }
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

module.exports = { init, handleRadioEvent, shutdown };
