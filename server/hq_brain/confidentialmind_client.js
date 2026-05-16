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
    const msg = data.choices?.[0]?.message;
    const finishReason = data.choices?.[0]?.finish_reason;

    log.debug({
      hasContent: !!msg?.content,
      hasReasoning: !!(msg?.reasoning || msg?.reasoning_content || msg?.thinking),
      contentLen: msg?.content?.length || 0,
      reasoningLen: (msg?.reasoning || msg?.reasoning_content || msg?.thinking || '').length,
      finishReason,
    }, 'LLM response fields');

    return extractResponse(msg);
  } finally {
    clearTimeout(timeout);
  }
}

function extractResponse(msg) {
  if (!msg) throw new Error('ConfidentialMind returned no message');

  const content = msg.content;
  const reasoning = msg.reasoning || msg.reasoning_content || msg.thinking;

  // Strategy: try fields in priority order based on USE_REASONING flag
  var primary = USE_REASONING ? [reasoning, content] : [content, reasoning];

  for (var text of primary) {
    if (!text) continue;

    // Strip markdown code fences (```json ... ```)
    var cleaned = text.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, '').replace(/\n?```[\s\S]*$/, '').trim();
    if (cleaned.startsWith('{')) {
      try { return JSON.parse(cleaned); } catch { /* not valid after stripping */ }
    }

    // Try direct JSON parse on raw text
    try { return JSON.parse(text); } catch { /* not raw JSON */ }

    // Try extracting JSON object from text
    var match = text.match(/\{[\s\S]*"urgency"[\s\S]*?\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* malformed */ }
    }

    // Try extracting any JSON object
    var anyJson = text.match(/\{[\s\S]*\}/);
    if (anyJson) {
      try { return JSON.parse(anyJson[0]); } catch { /* malformed */ }
    }
  }

  // Last resort: construct from whatever text we have, preserving full output
  var bestText = reasoning || content;
  if (bestText) {
    log.warn({ textLen: bestText.length }, 'Could not parse JSON — extracting fields from text');

    // Try to extract individual fields from the reasoning text
    var urgency = 'MEDIUM';
    var classification = 'ai_analysis';
    var confidence = 0.6;
    var broadcastContent = null;

    var urgMatch = bestText.match(/urgency["\s:]+["']?(HIGH|MEDIUM|LOW)/i);
    if (urgMatch) urgency = urgMatch[1].toUpperCase();

    var classMatch = bestText.match(/classification["\s:]+["']?([a-z_]+)/i);
    if (classMatch) classification = classMatch[1];

    var confMatch = bestText.match(/confidence["\s:]+(\d+\.?\d*)/i);
    if (confMatch) confidence = parseFloat(confMatch[1]);
    if (confidence > 1) confidence = confidence / 100;

    var broadcastMatch = bestText.match(/broadcast_content["\s:]+["']([^"']+)/i);
    if (broadcastMatch) broadcastContent = broadcastMatch[1];

    return {
      urgency,
      classification,
      confidence: Math.max(0, Math.min(1, confidence)),
      reasoning: bestText,
      broadcast_content: broadcastContent,
      affected_area: { center: { x: 0.5, y: 0.5 }, radius: 0.15 },
    };
  }

  throw new Error('ConfidentialMind returned empty response');
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
