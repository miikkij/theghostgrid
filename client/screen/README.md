# Big Screen — Operator Display

Canvas-based real-time visualization of the tactical mesh. This is the main visual artifact of the demo — designed for large screens (1080p+), photographable, 60 FPS.

## Running

### With server

```bash
npm run dev          # starts the server
# open http://localhost:3000/screen
```

### Simulation mode

Two ways to run the simulation (no backend data needed):

1. **UI button**: Open `/screen` and click the **▶ SIMULATION** button at bottom-center. Click **■ STOP** to return to live mode. Can be toggled any time.

2. **URL parameter**: Open `/screen?mock=true` to auto-start the simulation on page load.

The simulation runs 100+ nodes, 3 drones, sync pulses, jamming zones, honeypot alerts, and AI decisions — exercises every visual element on a timed sequence.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure — canvas + HTML overlay panels |
| `style.css` | Overlay panel positioning, animations, cursor auto-hide |
| `render.js` | Pure Canvas renderer — one class, one `render(state, time)` call per frame |
| `script.js` | Orchestration — state management, WebSocket events, overlay updates, mock simulator |

## Architecture

```
script.js  ─────► state object ─────► render.js (Canvas)
    │                                       │
    │                                       ▼
    │                                  requestAnimationFrame
    │
    ├── WebSocket events (real mode)
    └── Mock simulator   (mock mode)
```

- **render.js** is a pure rendering module. It takes `(state, time)` and draws to canvas. No DOM, no network.
- **script.js** owns state, connects to the server (or runs the mock simulator), and drives two `requestAnimationFrame` loops: one for canvas rendering, one for DOM overlay updates.
- Overlays are throttled to 250ms updates to stay off the hot render path.

## Visual elements

- **Grid**: 50px spacing, subtle lines
- **HQ**: Castle icon at bottom-left with glow
- **Drones**: Green triangles with animated bob, fiber tethers to HQ
- **Sync pulses**: Expanding cyan rings from drones (alpha = 3px, beta = 8px)
- **Transmission arcs**: Thin cyan lines with traveling dot
- **Nodes**: Cyan (soldier), gray (decoy), amber (honeypot)
- **Jamming zones**: Red semi-transparent polygons with animated dashed border
- **Alerts**: Flashing honeypot + radial pulse + caption

## Performance

- Grid is cached on an offscreen canvas (redrawn only on resize)
- DOM updates run on a separate rAF chain, throttled to 250ms
- Target: 60 FPS sustained with 100+ nodes at 1080p
- FPS counter visible at bottom-right during development

## Testing checklist

- [ ] `/screen` loads without console errors
- [ ] `/screen?mock=true` shows animated nodes, drones, sync pulses
- [ ] Resize browser → canvas and overlays adjust
- [ ] 60 FPS sustained with 100 nodes (Chrome DevTools Performance tab)
- [ ] AI reasoning panel slides in and auto-dismisses after 30s
- [ ] Jamming zone appears with animated dashed border
- [ ] Honeypot alert flashes and shows caption
- [ ] Disconnection shows overlay; reconnection hides it
- [ ] Cursor hides after 5s of inactivity
- [ ] Works at 1080p and 4K
