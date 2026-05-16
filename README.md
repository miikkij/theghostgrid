# The Ghost Grid

Drone-coordinated resilient tactical mesh communications — proof of concept.

## Quick start

```bash
npm install
cp .env.example .env    # edit as needed
npm start               # http://localhost:7620
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

## Radio Bridge (Rust)

Requires **Rust 1.85+** (edition2024 support). Check your version:

```bash
rustc --version
```

If you're below 1.85, install or update via [rustup](https://rustup.rs):

```bash
# Install rustup (if you don't have it)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Or update an existing rustup installation
rustup update stable
```

On Windows, if you have an older Rust from Chocolatey alongside rustup, make sure `%USERPROFILE%\.cargo\bin` comes first in your PATH:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

Then build and run:

```bash
cd radios
cargo build --release
cargo test
cargo run -- --simulate     # no hardware required
```

See [`radios/README.md`](radios/README.md) for USB WiFi adapter setup and server integration.

## Testing

```bash
npm test                    # all tests (protocol + deception + hq-brain)
npm run test:protocol       # protocol modules only
npm run test:deception      # deception engine only
npm run test:hq-brain       # HQ brain (stub LLM, no dependencies)
npm run test:hq-brain-live  # HQ brain with real LLM (needs Ollama or ConfidentialMind)
npm run lint                # ESLint
```

For live HQ Brain tests, either configure `CM_ENDPOINT` + `CM_API_KEY` in `.env` for ConfidentialMind, or run [Ollama](https://ollama.com) locally (`ollama pull llama3:8b && ollama serve`).

## Documentation

Full design specification and component inventory: [`docs/00-README.md`](docs/00-README.md)

Build components and interface contracts: [`docs/06-build-components.md`](docs/06-build-components.md)
