'use strict';

/**
 * Operator Dashboard — Controls module.
 * Handles button clicks, keyboard shortcuts, and cycle control.
 * Initialized by script.js with a Socket.IO instance.
 */
var Controls = (function () {
  var socket = null;
  var paused = false;
  var activePatterns = new Set();

  // --- Scenario trigger handlers ---

  var triggers = {
    inject_jamming: function () {
      var area = {
        center: { x: 0.4 + Math.random() * 0.2, y: 0.4 + Math.random() * 0.2 },
        radius: 0.15,
      };
      socket.emit('ops.trigger_scenario', {
        scenario: 'inject_jamming',
        parameters: { area: area },
      });
    },

    drop_drone: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'drop_drone',
        parameters: {},
      });
    },

    deploy_drone: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'deploy_drone',
        parameters: {},
      });
    },

    trigger_honeypot: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'trigger_honeypot',
        parameters: {
          eventType: 'artillery',
          direction_of_arrival_deg: 270 + Math.random() * 30,
        },
      });
    },

    activate_decoys: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'activate_decoys',
        parameters: { count: 47 },
      });
    },

    pattern_linear: function () {
      if (activePatterns.has('pattern_linear')) {
        socket.emit('ops.trigger_scenario', {
          scenario: 'deactivate_pattern',
          parameters: { patternName: 'linear_translation' },
        });
        return;
      }
      socket.emit('ops.trigger_scenario', {
        scenario: 'activate_pattern',
        parameters: {
          patternName: 'linear_translation',
          direction: 'east',
          velocity: 0.01,
          band_width: 0.15,
        },
      });
    },

    pattern_convoy: function () {
      if (activePatterns.has('pattern_convoy')) {
        socket.emit('ops.trigger_scenario', {
          scenario: 'deactivate_pattern',
          parameters: { patternName: 'phantom_convoy' },
        });
        return;
      }
      socket.emit('ops.trigger_scenario', {
        scenario: 'activate_pattern',
        parameters: {
          patternName: 'phantom_convoy',
          path: [
            { x: 0.1, y: 0.5 },
            { x: 0.5, y: 0.3 },
            { x: 0.9, y: 0.6 },
          ],
          velocity: 0.015,
        },
      });
    },

    pattern_radial: function () {
      if (activePatterns.has('pattern_radial')) {
        socket.emit('ops.trigger_scenario', {
          scenario: 'deactivate_pattern',
          parameters: { patternName: 'radial_expansion' },
        });
        return;
      }
      socket.emit('ops.trigger_scenario', {
        scenario: 'activate_pattern',
        parameters: {
          patternName: 'radial_expansion',
          center: { x: 0.5, y: 0.5 },
          expansion_rate: 0.005,
        },
      });
    },

    trigger_ai_adaptation: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'trigger_ai_adaptation',
        parameters: {},
      });
    },

    pause_cycles: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'pause_cycles',
        parameters: {},
      });
    },

    resume_cycles: function () {
      socket.emit('ops.trigger_scenario', {
        scenario: 'resume_cycles',
        parameters: {},
      });
    },

    reset_state: function () {
      if (!confirm('Reset all state? This clears all decoys, patterns, and jamming.')) return;
      socket.emit('ops.trigger_scenario', {
        scenario: 'reset_state',
        parameters: {},
      });
    },

    run_full_pitch: function () {
      if (!confirm('Run full 5-minute pitch sequence?')) return;
      socket.emit('ops.trigger_scenario', {
        scenario: 'run_full_pitch',
        parameters: {},
      });
    },
  };

  // Keyboard shortcut map
  var shortcuts = {
    'j': 'inject_jamming',
    'd': 'drop_drone',
    'h': 'trigger_honeypot',
    'a': 'activate_decoys',
    'r': 'reset_state',
  };

  function flashButton(btn) {
    btn.classList.remove('triggered');
    void btn.offsetWidth;
    btn.classList.add('triggered');
    setTimeout(function () { btn.classList.remove('triggered'); }, 300);
  }

  function fireTrigger(name) {
    var btn = document.querySelector('[data-trigger="' + name + '"]');
    if (btn && btn.disabled) return;
    if (triggers[name]) {
      if (btn) flashButton(btn);
      triggers[name]();
    }
  }

  // --- Public API ---

  function setPaused(p) {
    paused = p;
    var pauseBtn = document.querySelector('[data-trigger="pause_cycles"]');
    var resumeBtn = document.querySelector('[data-trigger="resume_cycles"]');
    if (pauseBtn) pauseBtn.disabled = paused;
    if (resumeBtn) resumeBtn.disabled = !paused;
  }

  function setPatternActive(triggerName, active) {
    if (active) {
      activePatterns.add(triggerName);
    } else {
      activePatterns.delete(triggerName);
    }
    var btn = document.querySelector('[data-trigger="' + triggerName + '"]');
    if (btn) btn.classList.toggle('pattern-active', active);
  }

  function init(sock) {
    socket = sock;

    // Wire all trigger buttons
    document.querySelectorAll('button[data-trigger]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled) return;
        var name = btn.dataset.trigger;
        if (triggers[name]) {
          flashButton(btn);
          triggers[name]();
        }
      });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

      // Spacebar toggles pause/resume
      if (e.key === ' ') {
        e.preventDefault();
        fireTrigger(paused ? 'resume_cycles' : 'pause_cycles');
        return;
      }

      var triggerName = shortcuts[e.key.toLowerCase()];
      if (triggerName) {
        e.preventDefault();
        fireTrigger(triggerName);
      }
    });

    // Cycle period selector
    var periodSelect = document.querySelector('[data-cycle-period]');
    if (periodSelect) {
      periodSelect.addEventListener('change', function (e) {
        socket.emit('ops.set_cycle_period', { period_ms: parseInt(e.target.value, 10) });
      });
    }
  }

  function resetPatterns() {
    activePatterns.clear();
    document.querySelectorAll('.pattern-active').forEach(function (btn) {
      btn.classList.remove('pattern-active');
    });
  }

  var REQUIRES_DECOYS = ['pattern_linear', 'pattern_convoy', 'pattern_radial'];

  function setDecoysActive(active) {
    REQUIRES_DECOYS.forEach(function (name) {
      var btn = document.querySelector('[data-trigger="' + name + '"]');
      if (btn) btn.disabled = !active;
    });
  }

  return {
    init: init,
    setPaused: setPaused,
    setPatternActive: setPatternActive,
    setDecoysActive: setDecoysActive,
    resetPatterns: resetPatterns,
    getActivePatterns: function () { return activePatterns; },
  };
})();
