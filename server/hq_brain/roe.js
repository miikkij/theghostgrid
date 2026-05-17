'use strict';

const log = require('../log').child({ component: 'roe' });

// Rules of Engagement state machine — constrains AI actions programmatically
const STATES = {
  PEACETIME:  'PEACETIME',
  DEFENSIVE:  'DEFENSIVE',
  ACTIVE:     'ACTIVE',
  EMERGENCY:  'EMERGENCY',
};

const ALLOWED_ACTIONS = {
  PEACETIME:  { maxUrgency: 'LOW',    autoBroadcast: false, choreographyUpdate: false },
  DEFENSIVE:  { maxUrgency: 'MEDIUM', autoBroadcast: false, choreographyUpdate: true },
  ACTIVE:     { maxUrgency: 'HIGH',   autoBroadcast: true,  choreographyUpdate: true },
  EMERGENCY:  { maxUrgency: 'HIGH',   autoBroadcast: true,  choreographyUpdate: true },
};

const URGENCY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };

let currentState = STATES.ACTIVE;

function setState(newState) {
  if (!STATES[newState]) {
    log.warn({ requested: newState }, 'invalid ROE state');
    return false;
  }
  const prev = currentState;
  currentState = newState;
  log.info({ from: prev, to: newState }, 'ROE state changed');
  return true;
}

function getState() {
  return currentState;
}

function enforce(decision) {
  const rules = ALLOWED_ACTIONS[currentState];
  if (!rules) return decision;

  const maxRank = URGENCY_RANK[rules.maxUrgency] ?? 2;
  const decisionRank = URGENCY_RANK[decision.urgency] ?? 0;

  if (decisionRank > maxRank) {
    log.warn({ roe: currentState, urgency: decision.urgency, capped: rules.maxUrgency },
      'ROE capped urgency');
    decision.urgency = rules.maxUrgency;
  }

  if (!rules.autoBroadcast && decision.broadcast_content) {
    log.warn({ roe: currentState }, 'ROE blocked auto-broadcast');
    decision.broadcast_content = null;
  }

  return decision;
}

function canUpdateChoreography() {
  return ALLOWED_ACTIONS[currentState]?.choreographyUpdate ?? false;
}

module.exports = { setState, getState, enforce, canUpdateChoreography };
