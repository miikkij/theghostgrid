'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { state } = require('./state');
const log = require('./log').child({ component: 'http' });

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use((req, _res, next) => {
    log.debug({ method: req.method, url: req.url }, 'request');
    next();
  });

  // --- Page routes ---

  const clientDir = path.join(__dirname, '..', 'client');

  app.get('/', (_req, res) => {
    res.sendFile(path.join(clientDir, 'landing', 'index.html'));
  });

  app.get('/screen', (_req, res) => {
    res.sendFile(path.join(clientDir, 'screen', 'index.html'));
  });

  app.get('/ops', (_req, res) => {
    res.sendFile(path.join(clientDir, 'ops', 'index.html'));
  });

  app.get('/phone', (_req, res) => {
    res.sendFile(path.join(clientDir, 'phone', 'index.html'));
  });

  // --- Static assets from client directory ---

  app.use('/static', express.static(clientDir));

  // --- Docs route (render markdown as styled HTML) ---

  const docsDir = path.join(__dirname, '..', 'docs');

  app.get('/docs/:file', (req, res) => {
    const file = req.params.file;
    if (!/^[\w.-]+\.md$/.test(file)) {
      return res.status(400).send('Invalid filename');
    }
    const filePath = path.join(docsDir, file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Document not found: ' + file);
    }
    const md = fs.readFileSync(filePath, 'utf-8');
    const html = renderMarkdownPage(file, md);
    res.type('html').send(html);
  });

  app.get('/docs', (_req, res) => {
    const hidden = new Set([
      'full-system-audit.md',
      'implementation-plan.md',
      'integration-issues.md',
      'COMPLIANCE-REPORT.md',
    ]);
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md') && !hidden.has(f)).sort();
    const list = files.map(f => {
      const label = f.replace('.md', '').replace(/^\d+-/, '').replace(/-/g, ' ');
      return `- [${label}](/docs/${f})`;
    }).join('\n');
    const md = `# Tactical Mesh — Documentation\n\n${files.length} documents.\n\n${list}`;
    const html = renderMarkdownPage('Documentation', md);
    res.type('html').send(html);
  });

  // --- API routes ---

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime_ms: Date.now() - state._startTime });
  });

  app.get('/api/state', (_req, res) => {
    res.json(state.snapshot());
  });

  app.post('/api/scenario/trigger', (req, res) => {
    const { scenario, parameters } = req.body || {};
    if (!scenario) {
      return res.status(400).json({ error: 'scenario field is required' });
    }
    log.info({ scenario, parameters }, 'scenario triggered via API');
    state.emit('ops.trigger_scenario', { scenario, parameters });
    res.json({ triggered: scenario });
  });

  return app;
}

function renderMarkdownPage(title, md) {
  // Escape the markdown content for safe embedding in a script tag
  const escaped = md.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Tactical Mesh</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --bg: #0A0E1A; --panel: #131826; --elev: #1B2235; --border: #2A3447; --text: #E2E8F0; --muted: #64748B; --cyan: #22D3EE; --green: #4ADE80; --bright: #F8FAFC; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; }
  .container { max-width: 860px; margin: 0 auto; padding: 2rem 2rem 4rem; }
  nav { margin-bottom: 2rem; font-size: 0.8125rem; color: var(--muted); display: flex; gap: 0.75rem; }
  nav a { color: var(--cyan); text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  #content h1 { font-size: 1.75rem; font-weight: 700; color: var(--bright); margin: 2rem 0 0.75rem; letter-spacing: 0.01em; }
  #content h1:first-child { margin-top: 0; }
  #content h2 { font-size: 1.375rem; font-weight: 600; color: var(--bright); margin: 2.5rem 0 0.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border); }
  #content h3 { font-size: 1.0625rem; font-weight: 600; color: var(--cyan); margin: 1.5rem 0 0.4rem; }
  #content h4 { font-size: 0.9375rem; font-weight: 600; color: var(--text); margin: 1.25rem 0 0.3rem; }
  #content p { margin: 0.6rem 0; }
  #content hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  #content code { font-family: 'JetBrains Mono', monospace; font-size: 0.8125em; background: var(--elev); padding: 0.15em 0.4em; border-radius: 3px; color: var(--cyan); }
  #content pre { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem 1.25rem; overflow-x: auto; margin: 1rem 0; line-height: 1.5; }
  #content pre code { background: none; padding: 0; color: var(--text); font-size: 0.8125rem; }
  #content strong { color: var(--bright); }
  #content em { color: var(--muted); font-style: italic; }
  #content a { color: var(--cyan); text-decoration: none; }
  #content a:hover { text-decoration: underline; }
  #content ul, #content ol { margin: 0.5rem 0 0.5rem 1.5rem; }
  #content li { margin: 0.2rem 0; }
  #content li > ul, #content li > ol { margin: 0.1rem 0 0.1rem 1.25rem; }
  #content blockquote { border-left: 3px solid var(--cyan); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--panel); border-radius: 0 6px 6px 0; color: var(--text); }
  #content blockquote p { margin: 0.3rem 0; }
  #content table { border-collapse: collapse; margin: 1rem 0; width: 100%; font-size: 0.8125rem; }
  #content th, #content td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; }
  #content th { background: var(--panel); color: var(--bright); font-weight: 600; white-space: nowrap; }
  #content tr:nth-child(even) { background: rgba(19, 24, 38, 0.5); }
  #content img { max-width: 100%; border-radius: 6px; }
  #content del { color: var(--muted); }
  #content input[type="checkbox"] { margin-right: 0.4rem; }
  .doc-index a { display: block; padding: 0.6rem 0; border-bottom: 1px solid var(--border); font-weight: 500; color: var(--cyan); text-decoration: none; }
  .doc-index a:hover { color: var(--bright); }
  .doc-index .fname { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 0.6875rem; margin-left: 0.75rem; }
</style>
</head>
<body>
<div class="container">
  <nav>
    <a href="/">← Home</a>
    <span>·</span>
    <a href="/docs">Docs Index</a>
    <span>·</span>
    <a href="/screen">Big Screen</a>
    <span>·</span>
    <a href="/ops">Operator</a>
    <span>·</span>
    <a href="/phone">Phone</a>
  </nav>
  <div id="content"></div>
</div>
<script src="https://cdn.jsdelivr.net/npm/marked@15/marked.min.js"></script>
<script>
  var raw = \`${escaped}\`;
  document.getElementById('content').innerHTML = marked.parse(raw);
</script>
</body>
</html>`;
}

module.exports = { createApp };
