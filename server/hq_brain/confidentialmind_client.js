'use strict';

const config = require('../config');
const log = require('../log').child({ component: 'hq_brain.confidentialmind' });

async function chat({ systemPrompt, userMessage, responseFormat, maxTokens, temperature }) {
  const { endpoint, api_key, model } = config.confidentialmind;

  if (!endpoint || !api_key) {
    throw new Error('ConfidentialMind not configured (CM_ENDPOINT / CM_API_KEY missing)');
  }

  const url = endpoint.replace(/\/+$/, '') + '/v1/chat/completions';

  const body = {
    model: model || 'llama-3-70b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: maxTokens || 500,
    temperature: temperature ?? 0.3,
  };

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ConfidentialMind ${res.status}: ${text}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error('ConfidentialMind returned empty response');
    }

    return JSON.parse(content);
  } finally {
    clearTimeout(timeout);
  }
}

async function health() {
  const { endpoint, api_key } = config.confidentialmind;

  if (!endpoint || !api_key) {
    return { available: false, reason: 'not configured' };
  }

  const url = endpoint.replace(/\/+$/, '') + '/v1/models';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${api_key}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return { available: res.ok, status: res.status };
  } catch (err) {
    log.debug({ err: err.message }, 'ConfidentialMind health check failed');
    return { available: false, reason: err.message };
  }
}

module.exports = { chat, health };
