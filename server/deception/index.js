'use strict';

const decoySimulator = require('./decoy_simulator');
const wavePatterns = require('./wave_patterns');
const honeypot = require('./honeypot');

function init(state) {
  decoySimulator.init(state);
}

function spawnDecoys(count, area) {
  return decoySimulator.spawnDecoys(count, area);
}

function spawnHoneypot(position, sensors) {
  return decoySimulator.spawnHoneypot(position, sensors);
}

function activatePattern(patternName, parameters) {
  return wavePatterns.activate({ patternName, parameters });
}

function deactivatePattern(patternId) {
  return wavePatterns.deactivate(patternId);
}

function getActivePatterns() {
  return wavePatterns.getActivePatterns();
}

function triggerHoneypot(nodeId, eventType, eventData) {
  return honeypot.trigger(nodeId, eventType, eventData);
}

function getDecoyStates() {
  return decoySimulator.getStates();
}

module.exports = {
  init,
  spawnDecoys,
  spawnHoneypot,
  activatePattern,
  deactivatePattern,
  getActivePatterns,
  triggerHoneypot,
  getDecoyStates,
};
