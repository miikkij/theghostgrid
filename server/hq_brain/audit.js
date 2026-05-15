'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const log = require('../log').child({ component: 'hq_brain.audit' });

let state = null;
const entries = [];
const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'audit.log');
let writeStream = null;

function init(stateRef) {
  state = stateRef;

  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    writeStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
  } catch (err) {
    log.warn({ err }, 'Could not open audit log file; in-memory only');
  }
}

function append(entry) {
  const record = {
    log_id: randomUUID(),
    ts: Date.now(),
    ...entry,
  };

  entries.push(record);

  if (writeStream) {
    writeStream.write(JSON.stringify(record) + '\n');
  }

  if (state) {
    const auditLog = state.get('audit_log') || [];
    auditLog.push(record);
    state.set('audit_log', auditLog);
    state.emit('hq.audit_entry', record);
  }

  log.debug({ log_id: record.log_id, loop: record.loop }, 'Audit entry recorded');
  return record;
}

function query({ since, until, loop, limit } = {}) {
  let results = entries;

  if (since) {
    results = results.filter((e) => e.ts >= since);
  }
  if (until) {
    results = results.filter((e) => e.ts <= until);
  }
  if (loop) {
    results = results.filter((e) => e.loop === loop);
  }
  if (limit) {
    results = results.slice(-limit);
  }

  return results;
}

function count() {
  return entries.length;
}

function exportToFile(filePath) {
  const data = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(filePath, data, 'utf-8');
  log.info({ path: filePath, count: entries.length }, 'Audit log exported');
}

function reset() {
  entries.length = 0;
  state = null;
  if (writeStream) {
    writeStream.end();
    writeStream = null;
  }
}

module.exports = { init, log: append, query, count, exportToFile, reset };
