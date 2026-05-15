'use strict';

require('dotenv').config();

module.exports = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    host: process.env.HOST || '0.0.0.0',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
  cycle: {
    period_ms: parseInt(process.env.BURST_CYCLE_MS) || 1000,
    sync_alpha_offset_ms: parseInt(process.env.SYNC_ALPHA_OFFSET_MS) || 0,
    sync_beta_offset_ms: parseInt(process.env.SYNC_BETA_OFFSET_MS) || 215,
    burst_window_ms: parseInt(process.env.BURST_WINDOW_MS) || 300,
  },
  radio: {
    drone_iface: process.env.RADIO_DRONE_IFACE || 'wlan1',
    ground_1_iface: process.env.RADIO_GROUND_1_IFACE || 'wlan2',
    ground_2_iface: process.env.RADIO_GROUND_2_IFACE || 'wlan3',
    enabled: process.env.RADIO_ENABLED === 'true',
  },
  confidentialmind: {
    endpoint: process.env.CM_ENDPOINT,
    api_key: process.env.CM_API_KEY,
    model: process.env.CM_MODEL || 'llama-3-70b',
  },
  demo: {
    num_simulated_decoys: parseInt(process.env.NUM_SIMULATED_DECOYS) || 47,
    enable_haptic: process.env.ENABLE_HAPTIC !== 'false',
  },
};
