'use strict';

const crypto = require('node:crypto');

const SLOT_COUNT = 50;
const KEY_LENGTH = 32;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const MAC_LENGTH = 16;

function deriveCycleKey(masterSecret, cycleNumber) {
  const ikm = Buffer.isBuffer(masterSecret) ? masterSecret : Buffer.from(masterSecret);
  const salt = Buffer.alloc(32);
  const info = Buffer.from(`cycle:${cycleNumber}`);
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, KEY_LENGTH));
}

function deriveSlot(cycleKey, nodeId, totalSlots) {
  totalSlots = totalSlots ?? SLOT_COUNT;
  const info = Buffer.from(`slot:${nodeId}`);
  const derived = Buffer.from(crypto.hkdfSync('sha256', cycleKey, Buffer.alloc(32), info, 4));
  return derived.readUInt32LE(0) % totalSlots;
}

function deriveHopSequence(masterSecret, nodeId, cycleNumber, slotIndex, channels, hopsPerSlot) {
  const ikm = Buffer.isBuffer(masterSecret) ? masterSecret : Buffer.from(masterSecret);
  const info = Buffer.from(`hop:${nodeId}:${cycleNumber}:${slotIndex}`);
  const derived = Buffer.from(crypto.hkdfSync('sha256', ikm, Buffer.alloc(32), info, hopsPerSlot));
  const sequence = [];
  for (let i = 0; i < hopsPerSlot; i++) {
    sequence.push(channels[derived[i] % channels.length]);
  }
  return sequence;
}

function generateNonce() {
  return crypto.randomBytes(NONCE_LENGTH);
}

function encrypt(plaintext, key, nonce) {
  const ptBuf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext);
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const nonceBuf = nonce || generateNonce();

  const cipher = crypto.createCipheriv('chacha20-poly1305', keyBuf, nonceBuf, {
    authTagLength: TAG_LENGTH,
  });
  const ciphertext = Buffer.concat([cipher.update(ptBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext, nonce: nonceBuf, tag };
}

function decrypt(ciphertext, key, nonce, tag) {
  const ctBuf = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);

  const decipher = crypto.createDecipheriv('chacha20-poly1305', keyBuf, nonce, {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ctBuf), decipher.final()]);
}

function mac(bytes, key) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key);
  const dataBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const hmac = crypto.createHmac('sha256', keyBuf);
  hmac.update(dataBuf);
  return hmac.digest().subarray(0, MAC_LENGTH);
}

function verifyMac(bytes, key, expectedMac) {
  const computed = mac(bytes, key);
  const expected = Buffer.isBuffer(expectedMac) ? expectedMac : Buffer.from(expectedMac);
  if (computed.length !== expected.length) return false;
  return crypto.timingSafeEqual(computed, expected);
}

module.exports = {
  SLOT_COUNT,
  KEY_LENGTH,
  NONCE_LENGTH,
  TAG_LENGTH,
  MAC_LENGTH,
  deriveCycleKey,
  deriveSlot,
  deriveHopSequence,
  generateNonce,
  encrypt,
  decrypt,
  mac,
  verifyMac,
};
