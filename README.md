# Tactical Mesh

Drone-coordinated resilient tactical mesh communications — proof of concept.

## Quick start

```bash
npm install
cp .env.example .env    # edit as needed
npm start               # http://localhost:3000
```

## Routes

| Path | View |
|---|---|
| `/` | Landing page with project overview and QR link |
| `/screen` | Big Screen visualization (operator display) |
| `/ops` | Operator Dashboard (scenario triggers, event log) |
| `/phone` | Audience phone client (mesh node) |

## Development

```bash
npm run dev   # starts with --watch for auto-reload
```

## Documentation

Full design specification and component inventory: [`docs/00-README.md`](docs/00-README.md)

Build components and interface contracts: [`docs/06-build-components.md`](docs/06-build-components.md)
