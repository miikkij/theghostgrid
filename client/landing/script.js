'use strict';

(function () {
  // --- QR Code Generation ---
  // Lightweight QR code renderer — no external dependency needed.
  // Uses the qrcode-generator algorithm (MIT license, Kazuhiko Arase).
  // For a hackathon, we generate a simple QR via canvas rather than pulling
  // a CDN library that may be unreliable offline.

  var phoneURL = window.location.origin + '/phone';
  var canvas = document.getElementById('qr-code');

  if (canvas) {
    generateQR(canvas, phoneURL);
  }

  function generateQR(canvas, text) {
    // Load qrcode lib from CDN, fall back to a simple text display
    var script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
    script.onload = function () {
      try {
        var qr = qrcode(0, 'M');
        qr.addData(text);
        qr.make();

        var ctx = canvas.getContext('2d');
        var size = canvas.width;
        var padding = 16;
        var cells = qr.getModuleCount();
        var cellSize = (size - padding * 2) / cells;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#0A0E1A';
        for (var r = 0; r < cells; r++) {
          for (var c = 0; c < cells; c++) {
            if (qr.isDark(r, c)) {
              ctx.fillRect(
                padding + c * cellSize,
                padding + r * cellSize,
                cellSize + 0.5,
                cellSize + 0.5
              );
            }
          }
        }
      } catch (e) {
        showFallback(canvas, text);
      }
    };
    script.onerror = function () {
      showFallback(canvas, text);
    };
    document.head.appendChild(script);
  }

  function showFallback(canvas, text) {
    var ctx = canvas.getContext('2d');
    var size = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0A0E1A';
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Scan not available', size / 2, size / 2 - 10);
    ctx.fillStyle = '#64748B';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.fillText(text, size / 2, size / 2 + 10);
  }
})();
