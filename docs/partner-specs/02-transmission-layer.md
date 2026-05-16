# THE GHOST GRID — 02: Transmission Layer

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

The transmission layer implements burst-only ground communication synchronized to the drone's timing pulse. Fixed-size encrypted frames, deterministic slot allocation, and per-hop frequency changes make ground emissions indistinguishable from cover noise to any observer without the cryptographic key.

## Frame format

```
┌─────────────────────────────────────────────────────────────┐
│ TRANSMISSION FRAME — 256 bytes total (fixed, always)        │
├─────────────────────────────────────────────────────────────┤
│ [12B] Nonce (random per frame)                              │
│ [228B] Ciphertext (ChaCha20-Poly1305 AEAD):                │
│    [1B]  Frame type (cover_fill=0, data=1, control=3)       │
│    [4B]  Cycle ID (uint32)                                  │
│    [2B]  Slot index (uint16)                                │
│    [2B]  Source node (uint16 hash of node_id)               │
│    [2B]  Sequence number                                    │
│    [2B]  Mesh payload length                                │
│    [215B] Mesh payload + random padding to fill             │
│ [16B] Poly1305 authentication tag                           │
└─────────────────────────────────────────────────────────────┘
```

Real data and cover-fill frames are identical in size, timing, and cryptographic envelope. An observer without the key sees only 256-byte noise at deterministic intervals.

## Slot allocation algorithm

```javascript
// server/protocol/crypto.js:11-23
cycle_key  = HKDF(SHA256, master_secret, salt=0x00*32, info="cycle:{N}")
slot_index = HKDF(SHA256, cycle_key, salt=0x00*32, info="slot:{node_id}")[0..4] mod 50
```

Collision-free for typical node populations (<50 per area). Deterministic: no coordination message needed.

## Frequency hopping

```javascript
// server/protocol/crypto.js:25-33
hop_sequence = HKDF(SHA256, master_secret, salt=0x00*32, info="hop:{node_id}:{cycle}:{slot}")
channels_used = derived_bytes.map(b => channels[b % channels.length])
```

Each 1ms sub-slot uses 10 hops of 100us across channels [1, 6, 11] (hackathon ISM) or full band (production). Sequence is per-node, per-cycle — never repeats.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Frame size | 256 bytes (constant) | `server/protocol/frame.js:6` |
| Encryption | ChaCha20-Poly1305 AEAD | `server/protocol/crypto.js:40-51` |
| Key derivation | HKDF-SHA256, per-cycle rotation | `server/protocol/crypto.js:11-15` |
| MAC | HMAC-SHA256 truncated to 16 bytes | `server/protocol/crypto.js:64-69` |
| Sub-slots per burst | 50 | `server/protocol/transmission.js:10` |
| Hops per sub-slot | 10 | `server/protocol/transmission.js:12` |
| Channels (hackathon) | 1, 6, 11 (non-overlapping 2.4 GHz) | `radios/src/hopping.rs:3-5` |
| Power randomization | +/- 6 dB uniform per cycle | Design spec |
| Key lifetime | 1 cycle (1 second) | By construction |

## MAC verification (anti-spoofing)

Every received frame is verified before processing. Invalid MAC = silent drop, no response.

```javascript
// server/protocol/transmission.js:156-173
const expectedMac = mac(content, cycleKey);
if (!timingSafeEqual(computed, expected)) return null;  // reject
```

Uses `crypto.timingSafeEqual` to prevent timing side-channels.

---

**BUILT**: Frame encode/decode with ChaCha20-Poly1305 (`server/protocol/frame.js:42-131`). HKDF key/slot/hop derivation (`server/protocol/crypto.js`). Burst orchestrator with frequency hopping across 3 adapters (`radios/src/burst.rs`). MAC verification with timing-safe comparison. Cover-fill generation.

**DESIGNED**: Sub-100us hop timing (current hackathon uses WiFi channel switching). Power randomization (protocol supports, not yet wired to adapter). Full 100 MHz production band.

**INTEGRATES WITH**: Kova Labs USB WiFi adapters (via kova-wfb-rs, stubs at `radios/src/adapter.rs:63-77`). Any radio supporting raw 802.11 injection with Radiotap headers.
