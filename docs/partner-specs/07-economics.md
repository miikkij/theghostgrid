# THE GHOST GRID — 07: Economics and Cost Asymmetry

**Version**: 1.0 | **Date**: 2026-05-16

---

## What and why

The architecture creates a structural cost asymmetry: cheap decoys force the adversary to spend expensive targeting resources against each emission source, most of which are worthless. The defender's marginal cost per deception unit is EUR 25. The adversary's marginal cost per engagement decision is EUR 35,000+. This 1,400:1 ratio compounds with scale.

## Cost comparison: defender vs adversary

| Defender action | Cost | Adversary response | Cost |
|----------------|------|-------------------|------|
| Deploy 1 decoy | EUR 25 | Lancet loitering munition engagement | ~EUR 32,000 |
| Deploy 1 decoy | EUR 25 | Krasukha-4 jammer time-on-target (hourly) | ~EUR 5,000 |
| Deploy 1 acoustic honeypot | EUR 41 | SIGINT analyst classification attempt | ~EUR 200/hr |
| Deploy 1000 decoys (10 km^2) | EUR 25,000 | Target discrimination across field | EUR 32M (if all engaged) |
| Run deception for 1 month | EUR 25,000 + power | Maintain ISR coverage of deception field | EUR 500K+ |

Sources for adversary costs: PUBLIC ESTIMATE from open-source defense procurement data.

## Defender BOM at scale

| Component | 1 unit | 100 units | 10,000 units |
|-----------|--------|-----------|--------------|
| Standard decoy | EUR 33 | EUR 30 | EUR 25 |
| Acoustic honeypot | EUR 41 | EUR 37 | EUR 31 |
| Full-spectrum honeypot | EUR 113 | EUR 100 | EUR 85 |
| Sync-beacon drone (per unit) | — | — | EUR 15,000-30,000 |
| HQ compute (ConfidentialMind) | — | — | EUR 5,000/month |

## Deployment economics

| Scenario | Decoys | Honeypots | Total hardware | Monthly ops |
|----------|--------|-----------|---------------|-------------|
| Battalion sector (10 km^2) | 500 | 50 | EUR 14,550 | EUR 5,000 |
| Brigade area (50 km^2) | 2,500 | 250 | EUR 72,750 | EUR 8,000 |
| Division front (200 km^2) | 10,000 | 1,000 | EUR 281,000 | EUR 15,000 |

Compare: single Bittium TAC WIN radio costs EUR 3,000-20,000. Single Silvus StreamCaster: EUR 15,000-30,000. The decoy field is cheaper than 10-20 real radios while forcing adversary expenditure of millions.

## Integration cost vs existing systems

| Integration path | What changes | What stays | Estimated effort |
|-----------------|-------------|-----------|-----------------|
| Add decoy field to existing TAC WIN mesh | Deploy decoys, share key schedule | Existing radios unchanged | 2-3 months integration |
| Add sync beacon to existing network | Deploy fiber-tethered drone, firmware update for sync-lock | Radio hardware unchanged | 6 months, firmware + drone |
| Full system (new deployment) | All components | Nothing (greenfield) | 12-18 months to production |
| AI overlay only | Add ConfidentialMind + event ingest | Existing mesh unchanged | 3-4 months |

## Where the money goes (full system)

```
                    ┌─────────────────────────┐
                    │ TOTAL SYSTEM COST        │
                    │ (battalion, year 1)      │
                    └──────────┬──────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐      ┌──────▼─────┐      ┌──────▼─────┐
    │ Hardware   │      │ Integration│      │ Operations │
    │ EUR 50K    │      │ EUR 150K   │      │ EUR 60K/yr │
    │ (decoys +  │      │ (firmware, │      │ (compute,  │
    │  drones +  │      │  testing,  │      │  key mgmt, │
    │  honeypots)│      │  cert)     │      │  maintenance)│
    └───────────┘      └────────────┘      └────────────┘
```

## Key economic argument

The system is not expensive. The system makes the adversary's response expensive. Every EUR 25 decoy either:
1. Absorbs a EUR 32,000 engagement (direct value), or
2. Consumes adversary ISR/analyst time discriminating real from fake (opportunity cost), or
3. Forces adversary to ignore real threats because classification confidence is too low (tactical value)

All three outcomes favor the defender. The adversary has no cheap counter: breaking the deception requires breaking the cryptography (computationally infeasible) or physically investigating every emitter (economically prohibitive at scale).

---

**BUILT**: Full cost model calculated from implemented decoy counts. 47 simulated decoys demonstrating protocol-identical emissions. Honeypot pipeline proving sensor-to-alert economics. Demo showing adversary engagement cost vs decoy cost.

**DESIGNED**: Physical hardware production at 10,000-unit scale. Supply chain for ESP32-C6 + SX1262. Solar power sizing for Nordic winter. Airdrop packaging. Production procurement estimates.

**INTEGRATES WITH**: Existing defense procurement frameworks (decoys are consumable items, not capital equipment). Standard NATO logistics categories. ConfidentialMind pricing model for AI compute.
