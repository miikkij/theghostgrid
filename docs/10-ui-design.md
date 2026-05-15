# 10 — UI Design Specifications

## Purpose

This document specifies the visual design and interaction behavior for all user interfaces in the system: the operator big screen, the operator dashboard, the audience phone client, and the landing page.

The aesthetic is *defense-tech operator interface*: dense, technical, legible at distance, dark themed with high-contrast accent colors. The design should feel like an operator's tool, not a consumer app.

## Design system

### Color palette

```
PRIMARY BACKGROUNDS
  Deep base       #0A0E1A   (deep blue-black, primary canvas)
  Panel           #131826   (slightly lighter, for content panels)
  Elevated        #1B2235   (elevated cards, modals)
  Borders         #2A3447   (subtle dividers)

OPERATIONAL ACCENTS
  Active green    #4ADE80   (active status, live data, OK)
  Warning amber   #FBBF24   (caution, pending action)
  Alert red       #EF4444   (jamming, critical alert, danger)
  Info cyan       #22D3EE   (sync events, information)
  Inactive gray   #475569   (decoys, dormant nodes)

TEXT
  Primary         #E2E8F0   (main readable text)
  Secondary       #94A3B8   (labels, metadata)
  Muted           #64748B   (timestamps, low-priority)
  Bright          #F8FAFC   (headings, emphasis)

NODE TYPES (semantic)
  Real soldier    #22D3EE   (cyan, distinguishable)
  Decoy           #475569   (gray, faded)
  Honeypot        #FBBF24   (amber, alerts when triggered)
  Drone           #4ADE80   (green, active infrastructure)
  HQ              #F8FAFC   (white, command authority)
  Jammed          #EF4444   (red, with overlay)
```

### Typography

```
PRIMARY FONT: Inter, system-ui, sans-serif
  - Clean, technical, optimized for screen
  - Available via Google Fonts CDN or system fallback

MONOSPACE FONT: JetBrains Mono, ui-monospace
  - For data displays, callsigns, coordinates, timestamps
  - Available via Google Fonts CDN or system fallback

SIZE SCALE (rem-based, 1rem = 16px base)
  Hero            3rem      / 48px / for landing headlines
  H1              2rem      / 32px / page titles, big-screen status
  H2              1.5rem    / 24px / section headers
  H3              1.25rem   / 20px / panel titles
  Body            1rem      / 16px / standard text
  Small           0.875rem  / 14px / labels, metadata
  Tiny            0.75rem   / 12px / timestamps, counters

LINE HEIGHT
  Tight           1.2       / for headings
  Normal          1.5       / for body text
  Loose           1.75      / for readable paragraphs

WEIGHT
  Regular         400       / body text
  Medium          500       / labels
  Semibold        600       / headings
  Bold            700       / emphasis
```

### Spacing system

8px base unit. Use multiples:
- 4px (0.5×) — tight inline gaps
- 8px (1×) — small spacing
- 16px (2×) — standard spacing
- 24px (3×) — section spacing
- 32px (4×) — major section gaps
- 48px (6×) — large breaks
- 64px (8×) — hero spacing

### Component patterns

**Status indicator dot**
- 10px circle, color per status
- Optional pulse animation when active
- Tooltip on hover with full status text

**Data badge**
- Rounded rectangle, monospace text
- Background: panel color with border
- Padding: 4px 8px
- Example: `[ ALPHA-7 | RECON ]`

**Action button (operator)**
- Solid background, semibold text
- Variants:
  - Primary: cyan background
  - Danger: red background
  - Warning: amber background
  - Neutral: panel background, border
- Hover: brightened by 10%
- Active/pressed: darkened by 10%
- Height: 40px standard, 48px touch-friendly

**Panel**
- Background: `Panel` color
- Border: 1px `Borders` color
- Border radius: 8px
- Padding: 16-24px depending on content
- Optional header with H3 title

**Telemetry row**
- Label in `Secondary` color, monospace
- Value in `Primary` color, monospace, right-aligned
- Separator: 1px `Borders` between rows

## Big Screen `/screen`

### Layout

Full-screen canvas (1920×1080 minimum, target up to 4K).

```
┌────────────────────────────────────────────────────────────────────┐
│ ┌──────────────────┐                                ┌────────────┐ │
│ │ TIMER / CYCLE    │                                │ TELEMETRY  │ │
│ │ 18:32:14 UTC     │                                │ Packets:   │ │
│ │ Cycle: 1247      │                                │   12,847   │ │
│ └──────────────────┘                                │ Drift:     │ │
│                                                     │   152ms    │ │
│                                                     │ AI status: │ │
│                                                     │   ACTIVE   │ │
│                                                     └────────────┘ │
│                                                                    │
│                                                                    │
│                                                                    │
│                                                                    │
│            [main canvas: nodes, drones, transmissions]             │
│                                                                    │
│                                                                    │
│                                                                    │
│                                                                    │
│                                                                    │
│ ┌──────────────────────────┐                                       │
│ │ AI REASONING (when active)│                                      │
│ │ "Detected: artillery     │                                       │
│ │ battery at coord X.      │                                       │
│ │ Recommendation: ..."     │                                       │
│ └──────────────────────────┘                                       │
└────────────────────────────────────────────────────────────────────┘
```

### Visual elements

**Background**: dark base color with subtle grid overlay (20% opacity, 50px grid)

**Map context** (optional, low-opacity geographic outline if relevant area is being depicted)

**Nodes** (rendered as positioned dots):
- Real soldier: 12px cyan dot with callsign label below
- Decoy: 8px gray dot, no label
- Honeypot: 10px amber dot with subtle pulse when active
- Selected/active: 14px with bright ring

**Drones**:
- Triangle icon, 24px, green
- Animated subtle bob/sway
- Fiber tether: thin line connecting drone to HQ corner, slight bezier curve
- Tether is solid green, fades to transparent at endpoints

**HQ**:
- Located at bottom-left corner of canvas
- Castle/building icon, 36px white
- Animated subtle glow

**Sync pulse animation**:
- During SYNC-α: 3px circle expanding from drone, fades over 200ms
- During SYNC-β: 8px wider expanding wave, more dramatic, 400ms duration
- Color: cyan (`Info cyan`)

**Transmission arcs**:
- During burst window: thin animated lines between transmitting node and receivers
- Animation: dot traveling along arc representing packet
- Duration: 50ms per arc
- Color: cyan with slight glow

**Jamming zones**:
- Semi-transparent red polygon overlay
- 30% opacity
- Animated red dashed border
- Label: "EW ZONE - ESTIMATED JAMMER POSITION" if known

**Honeypot trigger flash**:
- Honeypot icon flashes amber-to-red 3 times
- Radial pulse outward indicating triggered alert
- Caption appears: "HP-23: Acoustic — Artillery Class — DoA 287°"

**Telemetry panel (top-right)**:
- Live counters: packets, latency, sync drift, mesh hops, AI status, active scenarios
- Updates every 250ms
- Monospace font

**Cycle indicator (top-left)**:
- Current UTC time
- Current cycle number
- Visual countdown to next SYNC-α (small progress bar)

**AI reasoning panel (bottom-left, appears when active)**:
- Slides in from left when AI emits decision
- Shows last 2-3 AI reasoning entries
- Auto-dismisses after 30 seconds
- Includes timestamp, decision summary, confidence

### Animations and effects

- Use smooth easing (cubic-bezier(0.4, 0, 0.2, 1)) for transitions
- Frame budget: 60 FPS sustained
- Reduce motion if `prefers-reduced-motion` is set, but it's expected this is set OFF for operator displays

## Operator Dashboard `/ops`

### Layout

Designed for 1366×768 laptop screen minimum, scales up to 1920×1080.

```
┌─────────────────────────────────────────────────────────────────────┐
│ TACTICAL MESH OPERATOR DASHBOARD          [SYSTEM: ACTIVE] [reset]  │
├─────────────────────────────────────────────────────────────────────┤
│ Cycle: 1247 | Nodes: 87 | Packets/s: 42 | Drift: 152ms | AI: ON     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│ ┌──── SCENARIO TRIGGERS ────┐   ┌──── LIVE MINI-MAP ─────────────┐ │
│ │                            │   │                                 │ │
│ │ [ Inject Jamming         ] │   │                                 │ │
│ │ [ Drop Drone             ] │   │     (shrunken big-screen)       │ │
│ │ [ Activate Decoys        ] │   │                                 │ │
│ │ [ Start Wave Pattern     ] │   │                                 │ │
│ │ [ Trigger Honeypot       ] │   │                                 │ │
│ │ [ Force AI Adaptation    ] │   │                                 │ │
│ │ [ Pause Cycles           ] │   │                                 │ │
│ │ [ Reset State            ] │   └─────────────────────────────────┘ │
│ │                            │                                       │
│ │ Cycle period: [1000ms ▼]   │   ┌──── EVENT LOG ─────────────────┐ │
│ │ Active patterns:           │   │ 18:32:14 Honeypot HP-23 trig   │ │
│ │   ✓ linear_east            │   │ 18:32:13 AI broadcast queued   │ │
│ │   □ phantom_convoy         │   │ 18:32:12 Burst cycle 1247      │ │
│ │   □ radial_expansion       │   │ ...                            │ │
│ └────────────────────────────┘   └────────────────────────────────┘ │
│                                                                     │
│ ┌──── ADAPTER STATUS ───────┐   ┌──── AI REASONING ──────────────┐ │
│ │ wlan1 (drone)    [ ✓ OK ] │   │ Last decision: 18:32:14         │ │
│ │ wlan2 (ground 1) [ ✓ OK ] │   │ Input: HP-23 trigger + ...      │ │
│ │ wlan3 (ground 2) [ ⚠ DEG] │   │ Output: broadcast HIGH urg.     │ │
│ │ ConfidentialMind [ ✓ OK ] │   │ Confidence: 0.87                │ │
│ └────────────────────────────┘   └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### Components

**Status bar (top)**:
- Critical metrics at a glance
- Updates every 250ms
- Color-coded: green when nominal, amber for caution, red for alert

**Scenario triggers (left panel)**:
- Large buttons (48px height) for easy click during demo
- Color-coded by scenario type:
  - Red: jamming, drone loss, honeypot (adversarial scenarios)
  - Amber: pattern changes (deception scenarios)
  - Cyan: AI loop trigger (informational)
  - Neutral: pause, reset (control)
- Each button shows a small icon + label
- Disabled state for unavailable triggers (greyed)

**Cycle control**:
- Pause/resume button
- Cycle period selector (250ms, 500ms, 1000ms, 2000ms, 5000ms)
- Active patterns shown as checkbox list with current state

**Live mini-map**:
- Smaller version of big-screen visualization
- Useful for operator to verify what's happening on the big screen
- Click to switch big-screen scene

**Event log**:
- Most recent 20 events, newest at top
- Color-coded by severity
- Click to expand for detail
- Auto-scroll on new events (toggleable)

**Adapter status**:
- Lists all USB radio adapters and external dependencies
- Status indicators for each
- Click for detail / diagnostics

**AI reasoning panel**:
- Shows last AI decision with reasoning trace
- Click history to see previous decisions
- Useful for explaining the AI to onlookers

### Interactivity

- All triggers should provide immediate visual feedback (button briefly flashes)
- Confirmation dialogs for destructive operations (Reset State)
- Keyboard shortcuts for common operations (e.g., `j` for jamming, `h` for honeypot)
- Operator can adjust cycle parameters live without restart

## Audience Phone Client `/phone`

### Mobile-first design

Target devices: 320×568 (iPhone SE) through 414×896 (iPhone Pro Max), Android variants similar.

### State 1: Landing (first 2-3 seconds after page load)

```
┌─────────────────────┐
│                     │
│                     │
│                     │
│     [Animated       │
│      mesh           │
│      visualization] │
│                     │
│   TACTICAL MESH     │
│                     │
│  Connecting you to  │
│   the network...    │
│                     │
│   [pulse animation] │
│                     │
│                     │
└─────────────────────┘
```

- Beautiful, slightly cinematic
- Mesh visualization animates (small particle/network demo)
- Smooth transition to State 2

### State 2: Active node (main view)

```
┌─────────────────────┐
│ ALPHA-7             │
│ ┌─────────────────┐ │
│ │ RECON           │ │
│ └─────────────────┘ │
│                     │
│ ┌─────────────────┐ │
│ │                 │ │
│ │   ● LISTENING   │ │
│ │                 │ │
│ │     ─ 0.4s ─    │ │
│ │                 │ │
│ └─────────────────┘ │
│                     │
│ NEIGHBORS           │
│ • BRAVO-3           │
│ • FOXTROT-1         │
│ • DELTA-9           │
│                     │
│ RECENT              │
│ 18:32 ↑ to BRAVO-3  │
│ 18:32 ↓ from F-1    │
│ 18:31 ↑ to D-9      │
│                     │
└─────────────────────┘
```

**Top section**: Callsign (large, monospace) + role badge

**Center section**: Big state indicator
- States: LISTENING / SYNC / TX / RX / JAMMED / RELAYED / DEAD
- Color changes based on state:
  - LISTENING: cyan
  - SYNC: bright cyan with glow
  - TX: amber
  - RX: green
  - JAMMED: red, with shake animation
  - RELAYED: muted green
  - DEAD: gray
- Countdown to next burst window
- Animated state indicator (pulse, ring, etc.)

**Neighbors**: compact list of known neighbors (max 5 shown)

**Recent events**: last 3 events with direction (↑ outbound, ↓ inbound) and partner callsign

### State 3: Alert overlay

When critical alert (e.g., honeypot artillery warning):

```
┌─────────────────────┐
│ ╔═════════════════╗ │
│ ║                 ║ │
│ ║   ⚠ ALERT ⚠     ║ │
│ ║                 ║ │
│ ║   ARTILLERY     ║ │
│ ║   INCOMING      ║ │
│ ║                 ║ │
│ ║ Estimated impact║ │
│ ║   28-45 seconds ║ │
│ ║                 ║ │
│ ║   TAKE COVER    ║ │
│ ║                 ║ │
│ ╚═════════════════╝ │
│                     │
└─────────────────────┘
```

- Full-screen red takeover
- Strong vibration pattern (3 long pulses)
- Auto-dismisses after 30 seconds
- Optional: countdown timer

### Interaction patterns

- **Tap to wake**: tapping the screen reasserts wake lock if it released
- **Pull to refresh**: pull-down gesture re-fetches state from server
- **No login**: identity is assigned automatically from connection
- **Persistent connection**: WebSocket reconnects automatically if dropped
- **Background handling**: when page is backgrounded (user switches apps), state is preserved; on foreground, latest state is restored

### Accessibility

- Sufficient color contrast (WCAG AA minimum)
- Large tap targets (44×44px minimum)
- Reduced motion respected if requested
- Screen reader labels on all critical elements

## Landing Page `/`

### Purpose

Root URL of the system. What a partner or judge sees if they navigate to the system without scanning the QR.

### Layout

```
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│   TACTICAL MESH                                                │
│   Drone-Coordinated Resilient Communications                   │
│                                                                │
│ ─────────────────────────────────────────────────────────      │
│                                                                │
│   The architecture is anchored in a sync beacon you cannot     │
│   jam. Everything else is built on that.                       │
│                                                                │
│   ┌────────────────┐    [ Connect as Node ]                    │
│   │                │    [ View Operator Screen ]               │
│   │    [QR CODE]   │    [ View Dashboard ]                     │
│   │                │                                           │
│   └────────────────┘                                           │
│                                                                │
│ ─────────────────────────────────────────────────────────      │
│                                                                │
│   FOUR PILLARS                                                 │
│                                                                │
│   • Sync Beacon       Fiber-tethered drone, EW-immune timing   │
│   • Burst Mesh        Sub-50ms windows under cover signal      │
│   • Statistical       Decoys indistinguishable from real       │
│     Deception         soldiers                                 │
│   • Adaptive AI       Air-gappable, audit-first, ROE-bound     │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### Visual style

- Hero treatment with bold typography
- Sync beacon visualization in motion (subtle animation)
- QR code generated dynamically pointing to `/phone`
- Clean, minimal, professional
- Mirrors the operator aesthetic for consistency

### Content

- Project name + tagline
- Sync beacon as headline insight (matches pitch hook)
- QR code prominently displayed for sharing
- Quick links to other interfaces
- Brief explanation of the four pillars
- Footer: contact info, repo link, doc set link

## Cross-UI consistency

### Shared assets

- Common CSS variables for the design system (export from one shared file)
- Logo / icon if any (small, monospace text "TM" is enough)
- Sound effects (optional): subtle blip on burst, alert tone on honeypot
- Animation library: consistent easing functions

### Connection state

All interfaces show a small connection indicator (top-right corner, near-invisible when connected):
- Green: connected, fresh data
- Amber: stale data (>5s since last update)
- Red: disconnected

### Loading states

All interfaces show a brief skeleton/spinner during initial WebSocket handshake. Don't show empty state — always show "Connecting..." until first state update arrives.

### Error states

If the server is unreachable:
- Big screen: dim everything, show "DISCONNECTED" overlay
- Dashboard: red banner at top, controls disabled
- Phone: gentle reconnect attempt with visible status
- Landing: small banner indicating offline mode

## Performance targets

| Interface | Target |
|---|---|
| Big screen | 60 FPS sustained, < 16ms per frame budget |
| Dashboard | All interactions < 100ms perceived response |
| Phone client | First paint < 500ms on 4G; vibrate latency < 50ms |
| Landing | First paint < 300ms; LCP < 1s |

## Asset and font loading

- Use Google Fonts CDN for Inter and JetBrains Mono with `display: swap`
- Fall back to system fonts immediately to avoid FOIT
- All custom assets (icons, logos) inlined as SVG where possible
- No images larger than 50KB on any interface
- Phone client total weight target: < 100KB

## Browser support

- Big screen + dashboard: modern Chromium, Firefox, Safari (operator-controlled environment)
- Phone client: must work on iOS Safari 14+ and Android Chrome 90+
- Landing page: progressive enhancement, must work everywhere

## Production polish checklist

Before considering UI "done":

- [ ] All interfaces match the design system colors and typography
- [ ] No console errors in any interface
- [ ] All interactions provide visible feedback
- [ ] All animations respect prefers-reduced-motion
- [ ] All interfaces handle disconnect gracefully
- [ ] Mobile client tested on actual iOS + Android devices
- [ ] Big screen tested at 1080p and 4K
- [ ] Dashboard tested at 1366×768 minimum width
- [ ] Performance targets met on representative hardware
