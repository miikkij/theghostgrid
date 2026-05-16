# THE GHOST GRID — Partner Technical Spec Sheets

**Version**: 1.0 | **Date**: 2026-05-16 | **Event**: Junction x Aalto Defence Hackathon

---

## Navigation

| # | Sheet | One-line summary |
|---|-------|-----------------|
| 01 | [Sync Beacon](01-sync-beacon.md) | Fiber-tethered drone provides jam-immune time discipline to ground mesh |
| 02 | [Transmission Layer](02-transmission-layer.md) | Burst protocol with HKDF slot allocation, frequency hopping, ChaCha20-Poly1305 encryption |
| 03 | [Mesh Layer](03-mesh-layer.md) | Dual-mode routing (flood + distance-vector), self-healing, cross-domain forwarding |
| 04 | [Decoy Hardware](04-decoy-hardware.md) | ESP32-C6 + LoRa SX1262 decoy node at EUR 25 BOM, protocol-identical to real nodes |
| 05 | [Honeypot Sensors](05-honeypot-sensors.md) | Active sensing decoys with acoustic/IR/vibration, sensor-to-alert in under 5 seconds |
| 06 | [AI Integration](06-ai-integration.md) | HQ brain on ConfidentialMind with tactical and operational loops, ROE enforcement, audit |
| 07 | [Economics](07-economics.md) | Cost asymmetry analysis: EUR 25 decoy vs EUR 35K+ engagement cost |

---

## System overview

The Ghost Grid is a drone-coordinated tactical mesh architecture that eliminates GPS dependence and master-radio exposure through a fiber-tethered sync beacon, while enabling protocol-native statistical deception at scale.

## How to read these sheets

Each sheet is one printed page. Scan the specs table first for numerical parameters, then read the status block at the bottom for build maturity. Code paths are cited inline for verification.

## Repository

All cited file paths are relative to repository root. Protocol, deception, and AI modules are in `server/`. Radio bridge is in `radios/src/`. Visualization clients are in `client/`.
