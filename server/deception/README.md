# Deception Engine

Decoy population management, wave choreography, fake data generation, and honeypot active sensing for the Tactical Mesh system.

## Architecture

```
index.js                 ← Module facade; single entry point for other components
├── decoy_simulator.js   ← Decoy population lifecycle, frame composition per cycle
├── wave_patterns.js     ← Spatial-temporal activation patterns (4 types)
├── fake_data.js         ← Encrypted-noise payload generation
└── honeypot.js          ← Active-sensing decoys that report engagement
```

## Usage

```javascript
const deception = require('./deception');
const { state } = require('./state');

deception.init(state);

// Spawn 47 decoys in the full area
deception.spawnDecoys(47, { x: [0, 1], y: [0, 1] });

// Activate a wave pattern
const patternId = deception.activatePattern('linear_translation', {
  direction: 'east',
  velocity: 0.01,
  band_width: 0.15,
  start_position: 0,
  period: 1.5,
});

// Spawn a honeypot with acoustic sensor
const hpId = deception.spawnHoneypot({ x: 0.3, y: 0.7 }, ['acoustic']);

// Trigger honeypot (manual demo or sensor event)
deception.triggerHoneypot(hpId, 'artillery', { direction_of_arrival: 270 });
```

## Wave Patterns

| Pattern | Signature | Use Case |
|---|---|---|
| `linear_translation` | Band sweeping across area | Phantom infantry advance |
| `radial_expansion` | Expanding ring from center | Unit dispersal from rally point |
| `random_walk_cluster` | Meandering cluster | Simulated patrol |
| `phantom_convoy` | Activation along waypoint path | Supply convoy on a road |

Multiple patterns run simultaneously (union logic).

## Events

**Subscribes to:** `cycle.sync_beta_burst`, `ops.trigger_decoys_on`, `ops.trigger_pattern`, `ops.trigger_honeypot`, `ops.reset`

**Emits:** `deception.decoy_spawned`, `deception.pattern_activated`, `deception.honeypot_triggered`, `radio.frame_received_simulated`

## Testing

```bash
node server/deception/test_deception.js
```
