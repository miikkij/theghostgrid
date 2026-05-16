# Audience Phone Client

Mobile-first node UI served at `/phone`. This is what audience members see when they scan the QR code during the demo.

## Screens

The client is a three-state screen machine:

1. **Landing** (2-3 seconds) — animated mesh visualization, "Connecting you to the network..."
2. **Active Node** — callsign, role badge, state indicator ring, burst countdown, neighbors, recent events
3. **Alert Overlay** — full-screen red takeover with vibration, countdown timer, auto-dismiss

## Features

- **Haptic feedback** — vibration patterns for sync, TX, RX, jamming, and alert events
- **Wake lock** — keeps screen awake during demo via Screen Wake Lock API
- **Auto-reconnect** — WebSocket reconnects automatically; connection status shown in footer
- **Safe area insets** — handles notched devices (iPhone X+)
- **Mock mode** — append `?mock` to URL for standalone testing without server

## WebSocket Events

| Event | Direction | Purpose |
|---|---|---|
| `identity` / `phone.assigned` | Server → Client | Assigns callsign, role, area |
| `phone.state_change` / `node_state_change` | Server → Client | Updates node state indicator |
| `cycle_tick` | Server → Client | Updates burst countdown |
| `phone.neighbors` | Server → Client | Updates neighbor list |
| `phone.event` | Server → Client | Adds to recent events feed |
| `alert` | Server → Client | Triggers alert overlay |

## Vibration Patterns

| Event | Pattern (ms) |
|---|---|
| Sync | `20` |
| TX | `[10, 20, 10]` |
| RX | `10` |
| Jamming | `[50, 50, 50, 50, 50]` |
| Alert | `[100, 50, 100, 50, 100, 50, 200]` |

## Testing

Open `/phone?mock` in a mobile browser to exercise all states without a running server.

On iOS Safari, vibration requires a user gesture first — tap the screen once after loading.

## Files

- `index.html` — three-screen markup with ARIA labels
- `style.css` — mobile-first styles, safe-area support, state animations
- `script.js` — state machine, WebSocket handlers, haptics, wake lock, mock mode
