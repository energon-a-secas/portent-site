// ── Entry point ──────────────────────────────────────────────
// Everything real happens in js/events.js. This file exists to start it once the
// document is parsed, and to say something useful in the page if the module
// graph itself fails to load, which on a site with a vendored three.js is the
// one failure a visitor could otherwise mistake for a blank page.

import { initApp } from './events.js';

function boot() {
  try {
    initApp();
  } catch (err) {
    console.error('[portent]', err);
    const hint = document.getElementById('stageHint');
    if (hint) hint.textContent = 'The ball could not start in this browser.';
    const note = document.getElementById('fallbackNote');
    if (note) {
      note.hidden = false;
      note.textContent = `The ball could not start: ${err.message}`;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
