'use strict';

const crypto = require('node:crypto');
const cryptoUtils = require('./crypto');

const TRANSMISSION_FRAME_SIZE = 256;
const NONCE_SIZE = cryptoUtils.NONCE_LENGTH;
const TAG_SIZE = cryptoUtils.TAG_LENGTH;
const PLAINTEXT_SIZE = TRANSMISSION_FRAME_SIZE - NONCE_SIZE - TAG_SIZE; // 228
const HEADER_SIZE = 13;
const MAX_MESH_PAYLOAD = PLAINTEXT_SIZE - HEADER_SIZE; // 215

const FRAME_TYPES = {
  cover_fill: 0,
  data: 1,
  ack_suppressed: 2,
  control: 3,
  broadcast: 4,
};

const FRAME_TYPE_NAMES = Object.fromEntries(
  Object.entries(FRAME_TYPES).map(([k, v]) => [v, k]),
);

function nodeIdToUint16(nodeId) {
  let hash = 5381;
  for (let i = 0; i < nodeId.length; i++) {
    hash = ((hash << 5) + hash + nodeId.charCodeAt(i)) & 0xffff;
  }
  return hash;
}

function padPayload(payload, targetSize) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (buf.length >= targetSize) return buf.subarray(0, targetSize);
  const padded = Buffer.alloc(targetSize);
  buf.copy(padded);
  crypto.randomBytes(targetSize - buf.length).copy(padded, buf.length);
  return padded;
}

function encodeTransmissionFrame(frameObj, key) {
  const type = FRAME_TYPES[frameObj.type] ?? FRAME_TYPES.data;
  const cycle = frameObj.cycle || 0;
  const slot = frameObj.slot || 0;
  const sourceNode =
    typeof frameObj.source_node === 'string'
      ? nodeIdToUint16(frameObj.source_node)
      : frameObj.source_node || 0;
  const sequence = frameObj.sequence || 0;

  const meshBuf = frameObj.mesh
    ? Buffer.from(JSON.stringify(frameObj.mesh))
    : Buffer.alloc(0);

  const plaintext = Buffer.alloc(PLAINTEXT_SIZE);
  let offset = 0;
  plaintext.writeUInt8(type, offset);
  offset += 1;
  plaintext.writeUInt32LE(cycle, offset);
  offset += 4;
  plaintext.writeUInt16LE(slot, offset);
  offset += 2;
  plaintext.writeUInt16LE(sourceNode, offset);
  offset += 2;
  plaintext.writeUInt16LE(sequence, offset);
  offset += 2;
  plaintext.writeUInt16LE(meshBuf.length, offset);
  offset += 2;

  padPayload(meshBuf, MAX_MESH_PAYLOAD).copy(plaintext, offset);

  const nonce = cryptoUtils.generateNonce();
  const { ciphertext, tag } = cryptoUtils.encrypt(plaintext, key, nonce);

  const frame = Buffer.alloc(TRANSMISSION_FRAME_SIZE);
  nonce.copy(frame, 0);
  ciphertext.copy(frame, NONCE_SIZE);
  tag.copy(frame, NONCE_SIZE + PLAINTEXT_SIZE);

  return frame;
}

function decodeTransmissionFrame(buffer, key) {
  if (!Buffer.isBuffer(buffer) || buffer.length !== TRANSMISSION_FRAME_SIZE) {
    return null;
  }

  const nonce = buffer.subarray(0, NONCE_SIZE);
  const ciphertext = buffer.subarray(NONCE_SIZE, NONCE_SIZE + PLAINTEXT_SIZE);
  const tag = buffer.subarray(NONCE_SIZE + PLAINTEXT_SIZE);

  let plaintext;
  try {
    plaintext = cryptoUtils.decrypt(ciphertext, key, nonce, tag);
  } catch {
    return null;
  }

  let offset = 0;
  const type = plaintext.readUInt8(offset);
  offset += 1;
  const cycle = plaintext.readUInt32LE(offset);
  offset += 4;
  const slot = plaintext.readUInt16LE(offset);
  offset += 2;
  const sourceNodeHash = plaintext.readUInt16LE(offset);
  offset += 2;
  const sequence = plaintext.readUInt16LE(offset);
  offset += 2;
  const meshLen = plaintext.readUInt16LE(offset);
  offset += 2;

  let mesh = null;
  if (meshLen > 0 && meshLen <= MAX_MESH_PAYLOAD) {
    try {
      mesh = JSON.parse(plaintext.subarray(offset, offset + meshLen).toString());
    } catch {
      mesh = null;
    }
  }

  return {
    type: FRAME_TYPE_NAMES[type] || 'unknown',
    cycle,
    slot,
    source_node_hash: sourceNodeHash,
    sequence,
    mesh,
  };
}

module.exports = {
  TRANSMISSION_FRAME_SIZE,
  MAX_MESH_PAYLOAD,
  encodeTransmissionFrame,
  decodeTransmissionFrame,
};
