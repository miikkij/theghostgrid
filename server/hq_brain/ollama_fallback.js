'use strict';

const log = require('../log').child({ component: 'hq_brain.ollama' });

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3:8b';

async function chat({ systemPrompt, userMessage, responseFormat, maxTokens, temperature }) {
  const url = OLLAMA_URL.replace(/\/+$/, '') + '/api/chat';

  const body = {
    model: OLLAMA_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    stream: false,
    options: {
      num_predict: maxTokens || parseInt(process.env.CM_MAX_TOKENS) || 4000,
      temperature: temperature ?? 0.3,
    },
  };

  if (responseFormat?.type === 'json_object') {
    body.format = 'json';
  }

  const timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS) || 120000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content = data.message?.content;

    if (!content) {
      throw new Error('Ollama returned empty response');
    }

    return JSON.parse(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function health() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(OLLAMA_URL.replace(/\/+$/, '') + '/api/tags', {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return { available: res.ok, status: res.status };
  } catch (err) {
    log.debug({ err: err.message }, 'Ollama health check failed');
    return { available: false, reason: err.message };
  }
}

module.exports = { chat, health };
