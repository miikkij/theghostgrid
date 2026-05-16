# Landing Page

Root page served at `/`. The first thing partners and judges see when navigating to the system URL.

## Structure

- **Hero** — project name, tagline, the sync beacon anchor statement, animated SVG visualization
- **CTA** — QR code (auto-generated, pointing to `/phone`), navigation links to all interfaces
- **Four Pillars** — Sync Beacon, Burst Mesh, Statistical Deception, Adaptive AI
- **Footer** — event attribution

## Visual Identity

The page leads with the sync beacon as the headline insight — this is the architectural anchor. The SVG visualization shows the fiber-tethered drone emitting sync pulses to ground nodes, with decoys visible as smaller gray dots.

The aesthetic signals serious defense-tech work: dark theme, technical typography, sparse layout, no stock photos or gratuitous gradients.

## QR Code

Generated client-side using `qrcode-generator` loaded from jsDelivr CDN. Falls back to a text display of the URL if the CDN is unreachable (e.g., offline demo).

The QR resolves to `{origin}/phone`, dynamically based on the current server address.

## Files

- `index.html` — semantic HTML with hero, CTA, pillars, footer
- `style.css` — responsive grid layout, defense-tech palette
- `script.js` — QR code generation with CDN fallback

## No Server Dependency

The landing page does not require Socket.IO or a WebSocket connection. It loads and renders fully from static files. The QR code is generated from `window.location.origin`.
