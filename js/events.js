// ── Wiring ───────────────────────────────────────────────────
// `initApp` is the only entry point. It owns the reveal chain (shake, settle,
// draw, read), the deck sheet, the importers and the shortcut registrations.
//
// No inline onclick anywhere: every listener is bound here.

import { state, load, save, recordAnswer, classicDeck, decodeDeck, encodeDeck } from './state.js';
import { drawAnswer, parseDeckText, fetchStackRankList, normaliseAnswer, MAX_ANSWER_CHARS } from './deck.js';
import { createBall } from './ball3d.js';
import { createFlatBall } from './flatball.js';
import { createShaker } from './shake.js';
import { init as initKeys } from './neokeys/index.js';
import * as sound from './sound.js';
import * as render from './render.js';
import { $, showToast, debounce, escHtml } from './utils.js';

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let ball = null;
let shaker = null;
let keys = null;
const typing = () => (keys ? keys.isTypingTarget(document.activeElement) : false);

export function initApp() {
  // Own the kit's init rather than loading js/neokeys/boot.js, so the registry
  // exists before the first registration and the typing guard is the kit's own.
  keys = initKeys();
  render.useEncoder(encodeDeck);
  load();
  applyUrl();

  const stage = $('stage');
  const hooks = {
    onNeedAnswer: () => drawAnswer(state.deck, state.answer),
    onReveal: answer => {
      recordAnswer(answer, state.question);
      render.renderAnswer();
      render.renderHistory();
      render.renderHint('revealed');
      render.setFallbackAnswer(answer, 'revealed');
      if (state.settings.sound) sound.chime(answer.tone);
      if (state.settings.haptics && navigator.vibrate) navigator.vibrate([12, 40, 22]);
      shaker?.rumble(200, 0.55);
    },
    onShakeStart: () => {
      state.answer = null;
      delete document.body.dataset.tone;
      render.renderAnswer();
      render.renderHint('agitated');
      render.setFallbackAnswer(null, 'agitated');
    },
    onNeedFlip: () => render.renderHint('awaiting-flip'),
    // Settled without an answer: it was a nudge. Put the hint back to the one
    // thing that would move it forward, rather than leaving "let it settle" up
    // over a ball that has stopped and is never going to answer.
    onNoAnswer: phase => render.renderHint(phase, { first: !state.history.length }),
    onKnock: intensity => {
      if (state.settings.sound) sound.knock(intensity);
      if (state.settings.haptics && navigator.vibrate) navigator.vibrate(14);
    },
    reducedMotion
  };

  ball = createBall({ container: $('ballHost'), ...hooks });
  if (!ball.supported) {
    render.showFallback(ball.reason);
    ball = createFlatBall({ stage, ball: $('flatBall'), ...hooks });
  }

  shaker = createShaker({
    stage,
    ball,
    bindKeys: false,          // NeoKeys owns the keyboard, see registerKeys
    isTyping: typing,
    onShake: doShake
  });
  shaker.attach();

  registerKeys();
  wireStage();
  wireDeck();
  wireShare();
  wireSettings();

  render.renderAll();
  render.renderSettings(shaker.capabilities);
  render.renderHint('idle', { first: !state.history.length });

  if (!ball.flat) {
    const resize = debounce(() => ball.resize(), 120);
    addEventListener('resize', resize);
    document.addEventListener('neo-chrome', resize);   // H reflows the stage
    ball.resize();
  }

  const params = new URLSearchParams(location.search);

  // The reveal loop is timing-dependent, so it cannot be covered by the node
  // tests the way the deck and the reversal counter are. `?debug=1` exposes the
  // phase machine so a browser check can assert on it instead of on pixels.
  if (params.get('debug') === '1') {
    window.Portent = { ball, state, shake: doShake, keys };
  }

  if (params.get('auto') === '1') {
    setTimeout(() => doShake(1, 'url'), 350);
  }
}

// ── The one action ───────────────────────────────────────────

function doShake(strength = 1, source = 'ui') {
  if (state.settings.sound) {
    sound.unlock();
    sound.slosh(strength);
  }
  ball.shake(strength);
  if (source === 'device' || source === 'gamepad') showToast('Shaken');
}

// ── URL on arrival ───────────────────────────────────────────
// A link can carry a deck, a question, or a Stack Rank list to pull in. A deck
// in the link wins over the stored one: the visitor followed that link on
// purpose, and their own deck is still in localStorage when they come back.

function applyUrl() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q) {
    state.question = q.slice(0, 160);
    const field = $('question');
    if (field) field.value = state.question;
  }
  const payload = (location.hash.match(/[#&]d=([A-Za-z0-9_-]+)/) || [])[1];
  if (payload) {
    const deck = decodeDeck(payload);
    if (deck) state.deck = deck;
    else showToast('That shared deck could not be read, so the classic twenty are loaded.');
  }
  const listId = params.get('stackrank');
  if (listId) importStackRank(listId, { quiet: true });
}

// ── Keyboard, through the kit ────────────────────────────────
// Registering here rather than in js/shake.js is what puts every key in the `?`
// sheet and inside the remap panel, which is what makes single-letter bindings
// acceptable at all (WCAG 2.1.4).

function registerKeys() {
  if (!keys) return;
  const nudge = (x, y) => () => ball.spin(x, y, 0, 0.5);
  keys.register([
    {
      key: ' ',
      label: 'Shake the ball',
      hint: 'The main event',
      group: 'Ball',
      run: e => {
        // A focused control owns Space. Let the browser press it.
        if (e.target?.closest?.('button, a[href], select, input, textarea')) return false;
        doShake(1, 'keyboard');
      }
    },
    { key: 'f', label: 'Turn the ball over', group: 'Ball', run: () => ball.flip() },
    { key: 'r', label: 'Straighten the ball', group: 'Ball', run: () => ball.reset() },
    { key: 'x', label: 'See through the shell', group: 'Ball', run: toggleXray },
    { key: 'ArrowLeft', label: 'Nudge it left', group: 'Ball', run: nudge(0, -3.2) },
    { key: 'ArrowRight', label: 'Nudge it right', group: 'Ball', run: nudge(0, 3.2) },
    { key: 'ArrowUp', label: 'Nudge it back', group: 'Ball', run: nudge(-3.2, 0) },
    { key: 'ArrowDown', label: 'Nudge it forward', group: 'Ball', run: nudge(3.2, 0) },
    { key: 'd', label: 'Answers deck', group: 'Deck', run: () => toggleSheet('deckSheet', 'deckBtn') },
    { key: '/', label: 'Ask a question', group: 'Deck', run: () => $('question')?.focus() },
    { key: 's', label: 'Copy the share link', group: 'Deck', run: copyShare },
    { key: 'e', label: 'Download the deck', group: 'Deck', run: downloadDeck },
    { key: 'm', label: 'Sound on or off', group: 'Ball', run: () => setSound(!state.settings.sound) }
  ]);
}

function toggleXray() {
  state.settings.xray = !state.settings.xray;
  ball.setXray(state.settings.xray);
  save();
  showToast(state.settings.xray ? 'The shell is translucent' : 'The shell is solid again');
}

// ── Stage ────────────────────────────────────────────────────

function wireStage() {
  $('shakeBtn').addEventListener('click', () => doShake(1, 'ui'));
  $('flipBtn').addEventListener('click', () => ball.flip());
  $('question').addEventListener('input', debounce(e => {
    state.question = e.target.value.slice(0, 160);
    render.renderShare();
  }, 200));
  // Enter in the question field is "ask it", which is the only sensible verb.
  $('question').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
      doShake(1, 'keyboard');
    }
  });
  if (state.settings.xray) ball.setXray(true);
}

// ── Deck sheet ───────────────────────────────────────────────

function toggleSheet(sheetId, buttonId, force) {
  const sheet = $(sheetId);
  const btn = $(buttonId);
  const open = force !== undefined ? force : sheet.hidden;
  sheet.hidden = !open;
  btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) sheet.querySelector('input, select, textarea, button')?.focus();
  if (!ball.flat) ball.resize();
}

function wireDeck() {
  $('deckBtn').addEventListener('click', () => toggleSheet('deckSheet', 'deckBtn'));
  $('deckClose').addEventListener('click', () => toggleSheet('deckSheet', 'deckBtn', false));
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('deckSheet').hidden) toggleSheet('deckSheet', 'deckBtn', false);
  });

  $('deckTitle').addEventListener('input', debounce(e => {
    state.deck.title = e.target.value.slice(0, 80);
    markEdited();
    render.renderShare();
    save();
  }, 250));

  const list = $('deckList');
  list.addEventListener('input', e => {
    const row = e.target.closest('[data-action]');
    if (!row || row.dataset.action !== 'edit-text') return;
    const i = Number(row.dataset.index);
    const text = row.value.slice(0, MAX_ANSWER_CHARS);
    if (state.deck.answers[i]) state.deck.answers[i].text = text;
    markEdited();
    save();
    render.renderShare();
  });
  list.addEventListener('change', e => {
    const row = e.target.closest('[data-action]');
    if (!row || row.dataset.action !== 'edit-tone') return;
    const i = Number(row.dataset.index);
    if (state.deck.answers[i]) state.deck.answers[i].tone = row.value;
    markEdited();
    save();
    render.renderDeck();
  });
  list.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="remove"]');
    if (!btn) return;
    state.deck.answers.splice(Number(btn.dataset.index), 1);
    markEdited();
    save();
    render.renderDeck();
  });

  $('deckAddForm').addEventListener('submit', e => {
    e.preventDefault();
    const answer = normaliseAnswer({ text: $('deckAddText').value, tone: $('deckAddTone').value });
    if (!answer) { showToast('An answer needs some words in it.'); return; }
    state.deck.answers.push(answer);
    $('deckAddText').value = '';
    markEdited();
    save();
    render.renderDeck();
    $('deckAddText').focus();
  });

  $('deckClassicBtn').addEventListener('click', () => {
    state.deck = classicDeck();
    save();
    render.renderDeck();
    showToast('Back to the original twenty.');
  });

  $('stackrankForm').addEventListener('submit', e => {
    e.preventDefault();
    importStackRank($('stackrankInput').value);
  });

  $('pasteForm').addEventListener('submit', e => {
    e.preventDefault();
    const deck = parseDeckText($('pasteText').value, 'Pasted deck');
    if (!deck) { showToast('Nothing in there looked like a list of answers.'); return; }
    state.deck = deck;
    save();
    render.renderDeck();
    showToast(`${deck.answers.length} answers loaded.`);
  });

  $('fileInput').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const deck = parseDeckText(await file.text(), file.name.replace(/\.[^.]+$/, ''));
    e.target.value = '';
    if (!deck) { showToast('That file did not contain a deck.'); return; }
    state.deck = deck;
    save();
    render.renderDeck();
    showToast(`${deck.answers.length} answers loaded from ${file.name}.`);
  });
}

/** Editing a deck makes it yours, so it stops claiming somebody else's source. */
function markEdited() {
  if (state.deck.source !== 'custom') state.deck.source = 'custom';
}

async function importStackRank(input, { quiet = false } = {}) {
  const btn = $('stackrankBtn');
  const status = $('stackrankStatus');
  if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
  if (status) status.textContent = '';
  try {
    const deck = await fetchStackRankList(input);
    state.deck = deck;
    save();
    render.renderDeck();
    render.renderShare();
    showToast(`${deck.answers.length} answers from "${deck.title}".`);
    if (status) status.textContent = `Loaded ${deck.answers.length} open items.`;
  } catch (err) {
    if (status) status.textContent = err.message;
    if (!quiet) showToast(err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
  }
}

// ── Share and embed ──────────────────────────────────────────

function wireShare() {
  $('shareCopyBtn').addEventListener('click', copyShare);
  $('embedCopyBtn').addEventListener('click', () => copy(render.embedSnippet(), 'Embed snippet copied.'));
  $('downloadBtn').addEventListener('click', downloadDeck);
}

function copyShare() {
  copy(render.shareUrl(), 'Share link copied.');
}

async function copy(text, ok) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(ok);
  } catch {
    showToast('Copying was blocked. The text is selected instead, so use your own copy shortcut.');
    const field = $('shareLink');
    if (field) { field.focus(); field.select(); }
  }
}

function downloadDeck() {
  const body = JSON.stringify({ title: state.deck.title, answers: state.deck.answers }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(state.deck.title || 'portent-deck').replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Deck downloaded.');
}

// ── Settings ─────────────────────────────────────────────────

function setSound(on) {
  state.settings.sound = on;
  sound.setMuted(!on);
  save();
  render.renderSettings(shaker.capabilities);
  showToast(on ? 'Sound on' : 'Sound off');
}

function wireSettings() {
  $('soundBtn').addEventListener('click', () => setSound(!state.settings.sound));

  $('motionBtn').addEventListener('click', async () => {
    if (shaker.isMotionOn()) {
      shaker.disableMotion();
      state.settings.motion = false;
      showToast('Phone shaking off.');
    } else {
      try {
        await shaker.enableMotion();
        state.settings.motion = true;
        showToast('Shake the phone.');
      } catch (err) {
        state.settings.motion = false;
        showToast(err.message);
      }
    }
    save();
    render.renderSettings(shaker.capabilities);
  });

  $('micBtn').addEventListener('click', async () => {
    if (shaker.isMicOn()) {
      shaker.disableMic();
      state.settings.mic = false;
      showToast('The microphone is off again.');
    } else {
      try {
        await shaker.enableMic();
        state.settings.mic = true;
        showToast('Shout at it.');
      } catch {
        state.settings.mic = false;
        showToast('Microphone access was declined.');
      }
    }
    save();
    render.renderSettings(shaker.capabilities);
  });

  sound.setMuted(!state.settings.sound);
  // Device motion is remembered but never resumed silently: iOS discards the
  // permission per page load, and asking again unprompted is a dark pattern.
  if (state.settings.motion) {
    const note = $('inputNote');
    if (note) note.insertAdjacentHTML('beforeend',
      ` <button type="button" class="linklike" id="resumeMotion">Turn phone shaking back on</button>`);
    $('resumeMotion')?.addEventListener('click', () => $('motionBtn').click());
  }
}

export { escHtml };
