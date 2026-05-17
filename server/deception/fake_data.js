'use strict';

const crypto = require('node:crypto');
const cryptoUtils = require('../protocol/crypto');
const frame = require('../protocol/frame');

let _strategy = 'encrypted_noise';

const PAYLOAD_SIZE = frame.MAX_MESH_PAYLOAD;

function init(_state) {
  // Reserved for future strategy-specific state subscriptions
}

function generatePayload(nodeId, cycleNumber, strategy) {
  const strat = strategy || _strategy;

  switch (strat) {
    case 'encrypted_noise':
      return generateEncryptedNoise(nodeId, cycleNumber);

    case 'replay':
      // TODO: Replay strategy — pre-captured real-but-old friendly traffic
      // from training exercises. Replayed by decoys for perfect statistical
      // equivalence. Requires a corpus store and index management.
      // Risk: very long observation windows may detect repetition.
      return generateEncryptedNoise(nodeId, cycleNumber);

    case 'generative':
      // TODO: Generative strategy — small local model generates plausible
      // traffic content matching doctrinal vocabulary and reporting conventions.
      // Infinite variation; risk is generation artifacts becoming identifiable.
      // Production target: run on squad-edge tier.
      return generateEncryptedNoise(nodeId, cycleNumber);

    default:
      return generateEncryptedNoise(nodeId, cycleNumber);
  }
}

function generateEncryptedNoise(nodeId, cycleNumber) {
  const cycleKey = cryptoUtils.deriveCycleKey(require('../config').protocol.master_secret, cycleNumber);
  const plainNoise = crypto.randomBytes(PAYLOAD_SIZE);
  const { ciphertext, nonce, tag } = cryptoUtils.encrypt(plainNoise, cycleKey);
  return {
    encrypted: true,
    data: Buffer.concat([nonce, ciphertext, tag]).toString('base64'),
    size: PAYLOAD_SIZE,
  };
}

function setStrategy(strategy) {
  const valid = ['encrypted_noise', 'replay', 'generative'];
  if (!valid.includes(strategy)) {
    throw new Error(`Unknown strategy: ${strategy}. Valid: ${valid.join(', ')}`);
  }
  _strategy = strategy;
}

function getStrategy() {
  return _strategy;
}

module.exports = {
  init,
  generatePayload,
};
