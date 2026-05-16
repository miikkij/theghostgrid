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
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md')).sort();
    const list = files.map(f =>
      `<li><a href="/docs/${f}">${f.replace('.md', '').replace(/^\d+-/, '')}</a> <span class="filename">${f}</span></li>`
    ).join('\n');
    const html = renderMarkdownPage('Documentation', `# Documentation\n\n${files.length} documents available.\n\n` + list, true);
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

function renderMarkdownPage(title, md, isIndex) {
  // Simple markdown to HTML (no dependency needed for basic rendering)
  let body = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
    .replace(/\| /g, '│ ')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^```(\w*)\n([\s\S]*?)```$/gm, '<pre><code>$2</code></pre>');

  if (isIndex) body = md.replace(/&/g, '&amp;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — Tactical Mesh</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root { --bg: #0A0E1A; --panel: #131826; --border: #2A3447; --text: #E2E8F0; --muted: #64748B; --cyan: #22D3EE; --green: #4ADE80; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.7; padding: 2rem; }
  .container { max-width: 900px; margin: 0 auto; }
  nav { margin-bottom: 2rem; font-size: 0.875rem; }
  nav a { color: var(--cyan); text-decoration: none; }
  nav a:hover { text-decoration: underline; }
  h1 { font-size: 2rem; font-weight: 700; color: #F8FAFC; margin: 1.5rem 0 0.75rem; letter-spacing: 0.02em; }
  h2 { font-size: 1.5rem; font-weight: 600; color: #F8FAFC; margin: 2rem 0 0.5rem; padding-top: 1rem; border-top: 1px solid var(--border); }
  h3 { font-size: 1.125rem; font-weight: 600; color: var(--cyan); margin: 1.5rem 0 0.5rem; }
  p { margin: 0.75rem 0; }
  hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }
  code { font-family: 'JetBrains Mono', monospace; font-size: 0.875em; background: var(--panel); padding: 0.15em 0.4em; border-radius: 3px; color: var(--cyan); }
  pre { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; overflow-x: auto; margin: 1rem 0; }
  pre code { background: none; padding: 0; color: var(--text); font-size: 0.8125rem; }
  strong { color: #F8FAFC; }
  li { margin: 0.25rem 0; margin-left: 1.5rem; }
  a { color: var(--cyan); }
  table { border-collapse: collapse; margin: 1rem 0; width: 100%; }
  th, td { border: 1px solid var(--border); padding: 0.5rem 0.75rem; text-align: left; font-size: 0.875rem; }
  th { background: var(--panel); color: #F8FAFC; font-weight: 600; }
  .filename { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; }
  ul { list-style: none; }
  ul li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  ul li a { font-weight: 500; font-size: 1.0625rem; }
</style>
</head>
<body>
<div class="container">
  <nav><a href="/">← Home</a> &middot; <a href="/docs">Documentation</a></nav>
  ${isIndex ? body : '<p>' + body + '</p>'}
</div>
</body>
</html>`;
}

module.exports = { createApp };
