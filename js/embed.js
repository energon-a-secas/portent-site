// ── The embeddable ball ──────────────────────────────────────
// What runs inside embed.html when another page frames the ball. No header, no
// footer, no localStorage, no shortcuts sheet: an iframe is a component, and a
// component that writes to the host's storage or steals its keys is a bad guest.
//
// URL contract (all optional):
//
//   deck=<base64url>     a deck, the same payload the app puts in #d=
//   stackrank=<id|url>   pull the deck from a Stack Rank list instead
//   q=<text>             the question to show above the ball
//   auto=1               shake once on load
//   controls=off         hide the Shake button (the host drives it)
//   title=off            hide the question line
//   bg=<hex|transparent> background, hex without the #, default transparent
//
// Host to embed, via postMessage:
//
//   { type: 'portent:shake' }                    shake it
//   { type: 'portent:deck', deck: {…} | string } swap the deck (object or payload)
//   { type: 'portent:question', question: '…' }  set the question line
//
// Embed to host, via postMessage to `parent`:
//
//   { source: 'portent', type: 'ready',  answers: 20 }
//   { source: 'portent', type: 'shake' }
//   { source: 'portent', type: 'answer', text, tone, question }
//   { source: 'portent', type: 'error',  message }
//
// A shake the host asked for (`portent:shake` or `auto=1`) always ends in an
// `answer`. A shake the visitor performed inside the frame keeps the real toy's
// last step and waits for them to turn the ball over, so the answer arrives when
// they read it. See `hostDriven` below.
//
// The target origin is '*' on purpose. Nothing here is private: the payload is
// an answer the host page just asked for, and it already knows the deck because
// it supplied it. Pinning an origin would mean the snippet had to carry the
// host's own URL, which is a worse contract for no gain.

import { state, classicDeck, decodeDeck } from './state.js';
import { drawAnswer, normaliseDeck, fetchStackRankList } from './deck.js';
import { createBall } from './ball3d.js';
import { createFlatBall } from './flatball.js';
import { createShaker } from './shake.js';
import * as sound from './sound.js';

const params = new URLSearchParams(location.search);
const el = id => document.getElementById(id);
const noControls = params.get('controls') === 'off';

// Turning the ball over is the visitor's move, and the embed keeps it for a
// visitor who shook the ball themselves inside the frame. It cannot keep it for a
// shake the host asked for: the host cannot reach into the frame to click, so
// waiting for a click there means the `answer` message it was promised never
// arrives and nothing says why. Same with controls=off, where there is no button
// to click at all. So a host-driven shake resolves its own flip.
let hostDriven = false;

function post(type, extra = {}) {
  try {
    parent.postMessage({ source: 'portent', type, ...extra }, '*');
  } catch { /* a sandboxed frame with no parent access: the ball still works */ }
}

function setAnswerText(answer) {
  const out = el('answer');
  out.textContent = answer ? answer.text : '';
  out.dataset.tone = answer ? answer.tone : '';
}

function applyQuestion(text) {
  state.question = String(text || '').slice(0, 160);
  const line = el('question');
  line.textContent = state.question;
  line.hidden = !state.question || params.get('title') === 'off';
}

function setDeck(deck) {
  const clean = normaliseDeck(deck);
  if (!clean) return false;
  state.deck = clean;
  return true;
}

// ── Boot ─────────────────────────────────────────────────────

const bg = params.get('bg');
if (bg && bg !== 'transparent') document.body.style.background = `#${bg.replace(/^#/, '')}`;

state.deck = classicDeck();
const payload = params.get('deck');
if (payload) {
  const deck = decodeDeck(payload);
  if (deck) state.deck = deck;
  else post('error', { message: 'The deck in the URL could not be read, so the classic twenty are loaded.' });
}
applyQuestion(params.get('q'));

const stage = el('stage');
const hooks = {
  onNeedAnswer: () => drawAnswer(state.deck, state.answer),
  onReveal: answer => {
    state.answer = answer;
    setAnswerText(answer);
    sound.chime(answer.tone);
    post('answer', { text: answer.text, tone: answer.tone, question: state.question });
  },
  onShakeStart: () => {
    state.answer = null;
    setAnswerText(null);
    // A "turn it over" left over from the last answer must not sit there over a
    // churning ball with nothing behind the window to read.
    el('flipBtn').hidden = true;
    post('shake');
  },
  onNeedFlip: () => {
    if (hostDriven || noControls) { ball.flip(); return; }
    el('flipBtn').hidden = false;
  },
  onKnock: intensity => sound.knock(intensity),
  reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches
};

let ball = createBall({ container: el('ballHost'), ...hooks });
if (!ball.supported) {
  stage.dataset.fallback = 'true';
  ball = createFlatBall({ stage, ball: el('flatBall'), ...hooks });
}

// The embed keeps the shaker's own key bindings: there is no NeoKeys here, and a
// keyboard visitor who has tabbed into the frame should still be able to shake it.
const shaker = createShaker({
  stage,
  ball,
  bindKeys: true,
  isTyping: () => false,
  onShake: strength => {
    hostDriven = false;
    sound.unlock();
    sound.slosh(strength);
    ball.shake(strength);
  }
});
shaker.attach();

el('shakeBtn').addEventListener('click', () => {
  hostDriven = false;
  sound.unlock();
  sound.slosh(1);
  ball.shake(1);
});
el('flipBtn').addEventListener('click', () => {
  el('flipBtn').hidden = true;
  ball.flip();
});
if (noControls) el('controls').hidden = true;

if (!ball.flat) {
  addEventListener('resize', () => ball.resize());
  ball.resize();
}

// ── The host's side of the contract ──────────────────────────

addEventListener('message', event => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'portent:shake':
      hostDriven = true;
      sound.unlock();
      ball.shake(typeof msg.strength === 'number' ? msg.strength : 1);
      break;
    case 'portent:deck': {
      const deck = typeof msg.deck === 'string' ? decodeDeck(msg.deck) : msg.deck;
      if (setDeck(deck)) post('ready', { answers: state.deck.answers.length });
      else post('error', { message: 'That deck had no usable answers in it.' });
      break;
    }
    case 'portent:question':
      applyQuestion(msg.question);
      break;
    default:
      break;
  }
});

// A Stack Rank list is fetched after the ball exists, so a slow network shows a
// working classic ball rather than an empty frame.
const listId = params.get('stackrank');
if (listId) {
  fetchStackRankList(listId)
    .then(deck => {
      setDeck(deck);
      post('ready', { answers: state.deck.answers.length });
    })
    .catch(err => post('error', { message: err.message }));
}

post('ready', { answers: state.deck.answers.length });
if (params.get('auto') === '1') setTimeout(() => { hostDriven = true; ball.shake(1); }, 300);
