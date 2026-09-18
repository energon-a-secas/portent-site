// ── Shared utilities ─────────────────────────────────────────
// Small, pure helper functions used across multiple modules. Nothing here
// touches state or the DOM tree beyond a lookup, so js/deck.js and the tests
// under tests/ can import it with no browser at all.

/** Cached element lookup by ID. */
const _els = {};
export function $(id) {
  return _els[id] || (_els[id] = document.getElementById(id));
}

/** Escape HTML special characters. */
export function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Show a temporary toast notification. */
let _toastTimer = null;
export function showToast(msg) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
}

/** Simple debounce. */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

export function safeJsonParse(raw, fallback = null) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ── base64url ────────────────────────────────────────────────
// Standard base64 carries `+`, `/` and `=`, all of which a chat client or a
// URL shortener is entitled to mangle. Deck payloads ride in a URL, so they
// use the URL alphabet and drop the padding.

export function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(str) {
  if (typeof str !== 'string' || !str) return '';
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  try {
    const bin = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

/**
 * A seeded 32-bit PRNG (mulberry32). The ball uses crypto randomness for real
 * draws, but a seeded stream is what lets `?seed=` reproduce a sequence, and
 * what lets the tests assert the draw is uniform instead of hoping.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform draw with no modulo bias, from crypto when the platform has it. */
export function randomInt(n) {
  if (n <= 0) return 0;
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const limit = Math.floor(4294967296 / n) * n;
    const buf = new Uint32Array(1);
    for (let i = 0; i < 12; i++) {
      c.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }
  return Math.floor(Math.random() * n);
}
