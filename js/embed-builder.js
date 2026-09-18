// ── Embed builder ────────────────────────────────────────────
// Builds the iframe snippet, and is itself the worked example of a host page:
// it frames the real embed.html, posts messages into it, and logs what comes
// back. If this page works, a visitor's page works, because it is doing exactly
// what their page would do.

import { state, load, classicDeck, encodeDeck } from './state.js';
import { parseDeckText } from './deck.js';
import { $, showToast, debounce, escHtml } from './utils.js';

const preview = $('preview');
const log = $('log');

load();                                  // so "the deck saved in this browser" is real
const storedDeck = state.deck;

function chosenDeck() {
  switch ($('deckMode').value) {
    case 'stored': return storedDeck;
    case 'text': return parseDeckText($('deckText').value, 'Typed deck');
    default: return null;                // classic and stackrank carry no payload
  }
}

function buildUrl() {
  const params = new URLSearchParams();
  const mode = $('deckMode').value;
  if (mode === 'stackrank') {
    const id = $('stackrankInput').value.trim();
    if (id) params.set('stackrank', id);
  } else {
    const deck = chosenDeck();
    if (deck && deck.answers?.length) params.set('deck', encodeDeck(deck));
  }
  const question = $('questionInput').value.trim();
  if (question) params.set('q', question);
  const bg = $('bgInput').value.trim().replace(/^#/, '');
  if (bg && bg !== 'transparent') params.set('bg', bg);
  if (!$('controlsInput').checked) params.set('controls', 'off');
  if ($('autoInput').checked) params.set('auto', '1');
  const qs = params.toString();
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}embed.html${qs ? `?${qs}` : ''}`;
}

function snippetFor(url) {
  return `<iframe src="${url}" title="Portent" width="100%" height="520"\n        style="border:0;border-radius:16px" loading="lazy"\n        allow="accelerometer; gamepad"></iframe>`;
}

function refresh(reloadPreview = true) {
  const url = buildUrl();
  $('snippet').value = snippetFor(url);
  $('openBtn').href = url;
  // Only reload the frame when the URL actually changed: retyping a question
  // should not throw away an answer the visitor is still reading.
  if (reloadPreview && preview.getAttribute('src') !== url) preview.setAttribute('src', url);
}

function showFields() {
  const mode = $('deckMode').value;
  $('stackrankField').hidden = mode !== 'stackrank';
  $('textField').hidden = mode !== 'text';
}

// ── Wiring ───────────────────────────────────────────────────

$('deckMode').addEventListener('change', () => { showFields(); refresh(); });
['stackrankInput', 'deckText', 'questionInput', 'bgInput'].forEach(id => {
  $(id).addEventListener('input', debounce(() => refresh(), 400));
});
['controlsInput', 'autoInput'].forEach(id => {
  $(id).addEventListener('change', () => refresh());
});

$('copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('snippet').value);
    showToast('Snippet copied.');
  } catch {
    $('snippet').focus();
    $('snippet').select();
    showToast('Copying was blocked. The snippet is selected, so use your own copy shortcut.');
  }
});

// ── Host to embed ────────────────────────────────────────────
// '*' as the target origin: same reasoning as js/embed.js, and here the frame is
// on this very origin anyway.

function post(message) {
  preview.contentWindow?.postMessage(message, '*');
  addLog('sent', JSON.stringify(message));
}

$('postShake').addEventListener('click', () => post({ type: 'portent:shake' }));
$('postDeck').addEventListener('click', () => post({
  type: 'portent:deck',
  deck: { title: 'Sent by the host', answers: [
    { text: 'The host page said yes', tone: 'yes' },
    { text: 'The host page is unsure', tone: 'maybe' },
    { text: 'The host page said no', tone: 'no' }
  ] }
}));
$('postQuestion').addEventListener('click', () => post({
  type: 'portent:question',
  question: 'Did the host page reach the ball?'
}));

// ── Embed to host ────────────────────────────────────────────

addEventListener('message', event => {
  const msg = event.data;
  if (!msg || msg.source !== 'portent') return;      // a page can frame many things
  const detail = { ...msg };
  delete detail.source;
  delete detail.type;
  addLog(msg.type, Object.keys(detail).length ? JSON.stringify(detail) : '');
});

function addLog(kind, body) {
  const row = document.createElement('li');
  row.className = 'log__row';
  row.dataset.kind = kind;
  row.innerHTML = `<span class="log__kind">${escHtml(kind)}</span><span class="log__body">${escHtml(body)}</span>`;
  log.prepend(row);
  while (log.children.length > 14) log.lastElementChild.remove();
}

showFields();
if (!storedDeck || storedDeck.source === 'classic') state.deck = classicDeck();
refresh();
