// ── DOM rendering ────────────────────────────────────────────
// Every write to the page goes through here. The ball is not the accessible
// surface: a WebGL canvas is a picture, so the answer is also written into a
// live region and the hint line says what to do next in words.

import { $, escHtml } from './utils.js';
import { state, TONE_LABEL, TONES } from './state.js';
import { toneCounts } from './deck.js';

const TONE_WORD = { yes: 'yes', maybe: 'maybe', no: 'no' };

export function renderAnswer() {
  const out = $('answerReadout');
  const chip = $('answerTone');
  if (!out) return;
  if (!state.answer) {
    out.textContent = '';
    out.dataset.empty = 'true';
    chip.hidden = true;
    return;
  }
  delete out.dataset.empty;
  out.textContent = state.answer.text;
  chip.hidden = false;
  chip.textContent = TONE_LABEL[state.answer.tone] || '';
  chip.dataset.tone = state.answer.tone;
  document.body.dataset.tone = state.answer.tone;
}

/**
 * The hint is the tutorial. It never nags: it states the one thing that would
 * move the ball forward from wherever it is now.
 */
export function renderHint(phase, opts = {}) {
  const el = $('stageHint');
  if (!el) return;
  const flip = $('flipBtn');
  let text;
  switch (phase) {
    case 'agitated': text = 'Let it settle'; break;
    case 'awaiting-flip': text = 'Turn the ball over to read it'; break;
    case 'revealed': text = 'Shake again for another answer'; break;
    default: text = opts.first ? 'Ask something, then shake' : 'Shake it';
  }
  el.textContent = text;
  if (flip) flip.hidden = phase !== 'awaiting-flip';
}

export function renderHistory() {
  const list = $('historyList');
  if (!list) return;
  const rows = state.history.slice(0, 8);
  $('historyPanel').hidden = rows.length === 0;
  list.innerHTML = rows.map(row => `
    <li class="history__row" data-tone="${escHtml(row.tone)}">
      <span class="history__answer">${escHtml(row.text)}</span>
      ${row.question ? `<span class="history__q">${escHtml(row.question)}</span>` : ''}
    </li>`).join('');
}

// ── The deck sheet ───────────────────────────────────────────

export function renderDeck() {
  const list = $('deckList');
  if (!list) return;
  $('deckTitle').value = state.deck.title || '';
  $('deckSource').textContent = sourceLabel(state.deck);

  const counts = toneCounts(state.deck);
  $('deckCounts').innerHTML = TONES.map(tone => `
    <span class="tone-chip" data-tone="${tone}">${counts[tone]} ${TONE_WORD[tone]}</span>
  `).join('');

  list.innerHTML = state.deck.answers.map((a, i) => `
    <li class="deck__row">
      <input class="deck__text" type="text" value="${escHtml(a.text)}"
             data-action="edit-text" data-index="${i}" aria-label="Answer ${i + 1}">
      <select class="deck__tone" data-action="edit-tone" data-index="${i}" aria-label="Tone of answer ${i + 1}">
        ${TONES.map(t => `<option value="${t}"${t === a.tone ? ' selected' : ''}>${TONE_LABEL[t]}</option>`).join('')}
      </select>
      <button type="button" class="btn btn--ghost btn--icon" data-action="remove" data-index="${i}"
              aria-label="Remove answer ${i + 1}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </li>`).join('');

  $('deckEmpty').hidden = state.deck.answers.length > 0;
  renderShare();
}

function sourceLabel(deck) {
  const src = deck.source || 'custom';
  if (src === 'classic') return 'The original twenty';
  if (src.startsWith('stackrank:')) return `Imported from Stack Rank list ${src.slice(10)}`;
  if (src === 'link') return 'Loaded from a shared link';
  if (src === 'json') return 'Imported from JSON';
  if (src === 'text') return 'Typed in';
  if (src === 'host') return 'Sent in by the page hosting this ball';
  return 'Edited here';
}

// ── Sharing ──────────────────────────────────────────────────

export function renderShare() {
  const link = $('shareLink');
  const snippet = $('embedSnippet');
  if (!link && !snippet) return;
  const url = shareUrl();
  if (link) link.value = url;
  if (snippet) snippet.value = embedSnippet();
  const preview = $('embedPreviewLink');
  // Set the href here rather than on click: a link whose target is written by
  // its own click handler is a race, and this one is cheap to keep current.
  if (preview) preview.href = embedUrl();
}

let _encode = null;
/** state.js owns the codec; render.js is handed it at boot to avoid a cycle. */
export function useEncoder(fn) { _encode = fn; }

export function shareUrl() {
  const base = location.origin + location.pathname;
  const payload = _encode ? _encode(state.deck) : '';
  const q = state.question ? `?q=${encodeURIComponent(state.question)}` : '';
  return state.deck.source === 'classic' && !state.question
    ? base
    : `${base}${q}#d=${payload}`;
}

export function embedUrl() {
  const params = new URLSearchParams();
  if (state.deck.source !== 'classic' && _encode) params.set('deck', _encode(state.deck));
  if (state.question) params.set('q', state.question);
  const qs = params.toString();
  // Sibling of the current page, so the snippet a visitor copies from a local
  // server points at that server and not at the live domain.
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}embed.html${qs ? `?${qs}` : ''}`;
}

export function embedSnippet() {
  const src = embedUrl();
  return `<iframe src="${src}" title="Portent" width="100%" height="520"
        style="border:0;border-radius:16px" loading="lazy"
        allow="accelerometer; gamepad"></iframe>`;
}

// ── Settings and capabilities ────────────────────────────────

export function renderSettings(capabilities) {
  toggle('soundBtn', state.settings.sound, 'Sound on', 'Sound off');
  toggle('motionBtn', state.settings.motion, 'Phone shake on', 'Phone shake off');
  toggle('micBtn', state.settings.mic, 'Shout to shake on', 'Shout to shake off');
  if (!capabilities) return;
  hide('motionBtn', !capabilities.motion);
  hide('micBtn', !capabilities.mic);
  const note = $('inputNote');
  if (note) {
    const has = [];
    if (capabilities.motion) has.push('shake the phone');
    if (capabilities.gamepad) has.push('any gamepad button');
    if (capabilities.mic) has.push('shout at it');
    note.textContent = has.length
      ? `This browser can also do it if you ${has.join(', ')}.`
      : 'Drag it, or press Space.';
  }
}

function toggle(id, on, onLabel, offLabel) {
  const el = $(id);
  if (!el) return;
  el.setAttribute('aria-pressed', on ? 'true' : 'false');
  el.title = on ? onLabel : offLabel;
  el.setAttribute('aria-label', on ? onLabel : offLabel);
}

function hide(id, hidden) {
  const el = $(id);
  if (el) el.hidden = !!hidden;
}

/** The no-WebGL path: a flat ball that still shakes, still answers, still reads. */
export function showFallback(reason) {
  const stage = $('stage');
  if (!stage) return;
  stage.dataset.fallback = 'true';
  const note = $('fallbackNote');
  if (note) {
    note.hidden = false;
    note.textContent = `Showing the flat ball: this browser gave no 3D canvas (${reason || 'WebGL unavailable'}).`;
  }
}

export function setFallbackAnswer(answer, phase) {
  const win = $('fallbackWindow');
  if (!win) return;
  win.dataset.phase = phase;
  win.textContent = phase === 'agitated' ? '' : (answer ? answer.text : '');
}

export function renderAll() {
  renderAnswer();
  renderDeck();
  renderHistory();
}
