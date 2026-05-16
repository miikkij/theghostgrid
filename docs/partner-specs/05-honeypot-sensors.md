# THE GHOST GRID — 05: Honeypot Sensors

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

5-10% of deployed decoys carry passive sensors. These honeypot nodes detect enemy engagement of the deception field and report engagement metadata back through the mesh. The intelligence value of a destroyed honeypot exceeds its cost: each destruction reveals enemy weapon type, location, decision cycle, and targeting priorities.

## Honeypot variants

| Variant | Additional sensors | Added cost | Detection capability |
|---------|-------------------|------------|---------------------|
| Acoustic | MEMS microphone + DSP | +EUR 8 | Artillery, drones, vehicles |
| IR | Passive infrared sensor | +EUR 12 | Close-approach (drones, personnel) |
| Vibration | Geophone | +EUR 6 | Tracked vehicles, foot patrol |
| Camera | Low-power image sensor + edge ML | +EUR 40 | Visual identification |
| Full-spectrum | All above + RF sniffer | +EUR 80 | Premium, sparse deployment |

## Sensor-to-alert pipeline

```
T+0s     Sensor trigger (local classification on honeypot)
T+<1s    Emergency burst in next available slot (urgent routing class, TTL=5)
T+1-5s   Flood-routed through mesh to drone, then fiber to HQ
T+3-5s   HQ AI tactical loop: event correlation + LLM classification
T+<5s    Auto-broadcast threat alert to all nodes in affected area
```

End-to-end: sensor trigger to friendly warning in under 5 seconds. Faster than artillery time-of-flight at typical battle ranges (30-90 seconds).

## Classification matrix

```javascript
// server/deception/honeypot.js:9-33
SENSOR_CLASSIFICATIONS = {
  acoustic: { artillery: 'artillery_overpressure', drone: 'rotary_wing_signature',
              vehicle: 'tracked_vehicle_engine', patrol: 'footstep_pattern' },
  ir:       { artillery: 'muzzle_flash', drone: 'thermal_signature',
              vehicle: 'engine_heat', patrol: 'body_heat' },
  vibration:{ artillery: 'ground_shock', drone: 'rotor_vibration',
              vehicle: 'tracked_vibration', patrol: 'footfall_vibration' },
  camera:   { artillery: 'flash_detection', drone: 'visual_track',
              vehicle: 'visual_track', patrol: 'motion_detection' }
}
```

## Honeypot report format

```javascript
{
  type: 'honeypot_report',
  honeypot_id: 'HP-023',
  timestamp: 1747408338456,
  sensor: 'acoustic',
  classification: 'artillery_overpressure',
  direction_of_arrival_deg: 287,
  amplitude_db: -42,
  certainty: 0.87
}
```

Transmitted as urgent-class mesh frame addressed to HQ. Uses flood routing for guaranteed delivery regardless of mesh state.

## Specs

| Parameter | Value | Source |
|-----------|-------|--------|
| Valid event types | artillery, drone, vehicle, patrol | `server/deception/honeypot.js:5` |
| Valid sensors | acoustic, ir, vibration, camera | `honeypot.js:6` |
| Routing class | urgent (flood mode) | `honeypot.js:88` |
| TTL | 5 hops | `honeypot.js:89` |
| End-to-end latency target | <5 seconds to friendly broadcast | Design spec, achieved in demo |
| Certainty range | 0.70 - 0.95 (varies by sensor/event) | `honeypot.js:79` |
| Cost per acoustic honeypot | EUR 41 (EUR 33 base + EUR 8 sensor) | Design BOM |
| 100 honeypots over 10 km^2 | EUR 4,100 total | Design estimate |

## Economic model

Cost to deploy 100 acoustic honeypots: EUR 4,100.
Value: characterization of enemy artillery battery; reveals battery location after first fire mission; enables counter-battery.
Comparison: single Lancet drone costs ~EUR 32,000. Single Western air defense engagement costs EUR 100K+.

---

**BUILT**: Honeypot registration and trigger system (`server/deception/honeypot.js`). Classification matrix for 4 sensor types x 4 event types. Urgent-class mesh frame generation with MAC. Integration with HQ brain tactical loop (`server/hq_brain/tactical_loop.js:19-21`). Live demo scenario: artillery trigger -> AI classification -> broadcast to audience phones within 5 seconds.

**DESIGNED**: Physical sensor hardware (MEMS microphones, IR sensors, geophones). Edge classification ML on ESP32. Camera-based honeypot with visual tracking. Full-spectrum variant.

**INTEGRATES WITH**: Any C2 system consuming structured threat reports. NATO STANAG 4559 sensor data format (adaptation layer needed). ConfidentialMind for AI classification at HQ tier.
