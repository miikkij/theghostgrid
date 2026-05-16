'use strict';

const config = require('../config');
const log = require('../log').child({ component: 'hq_brain.confidentialmind' });

const USE_REASONING = process.env.CM_USE_REASONING === 'true';
const MAX_TOKENS = parseInt(process.env.CM_MAX_TOKENS) || 4000;

async function chat({ systemPrompt, userMessage, responseFormat, maxTokens, temperature }) {
  const { endpoint, api_key, model } = config.confidentialmind;

  if (!endpoint || !api_key) {
    throw new Error('ConfidentialMind not configured (CM_ENDPOINT / CM_API_KEY missing)');
  }

  const url = endpoint.replace(/\/+$/, '') + '/chat/completions';

  const body = {
    model: model || 'qwen3-32b',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: maxTokens || MAX_TOKENS,
    temperature: temperature ?? 0.3,
  };

  // Disable thinking mode unless explicitly enabled
  if (!USE_REASONING) {
    body.chat_template_kwargs = { enable_thinking: false };
  }

  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const controller = new AbortController();
  const timeoutMs = parseInt(process.env.CM_TIMEOUT_MS) || (USE_REASONING ? 60000 : 15000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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

    console.log('=== FULL API RESPONSE ===');
    console.log(JSON.stringify(data, null, 2));
    console.log('=== END ===');

    const msg = data.choices?.[0]?.message;
    return extractResponse(msg);
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponse(msg) {
  if (!msg) throw new Error('ConfidentialMind returned no message');

  const content = msg.content;
  const reasoning = msg.reasoning || msg.reasoning_content || msg.thinking;

  // Parse JSON from content field only — that's where the answer lives
  if (content) {
    // Strip markdown code fences
    var cleaned = content.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '').replace(/\n?```[\s\S]*$/, '').trim();
    if (cleaned.startsWith('{')) {
      try {
        var parsed = JSON.parse(cleaned);
        if (USE_REASONING && reasoning) parsed.thinking = reasoning;
        return parsed;
      } catch { /* not valid after stripping */ }
    }

    // Direct parse
    try {
      var direct = JSON.parse(content.trim());
      if (USE_REASONING && reasoning) direct.thinking = reasoning;
      return direct;
    } catch { /* not raw JSON */ }
  }

  throw new Error('Content field empty or not JSON');
}

async function health() {
  const { endpoint, api_key } = config.confidentialmind;

  if (!endpoint || !api_key) {
    return { available: false, reason: 'not configured' };
  }

  const url = endpoint.replace(/\/+$/, '') + '/models';

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
