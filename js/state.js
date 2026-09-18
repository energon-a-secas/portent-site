// ── Shared state ─────────────────────────────────────────────
// The live model: which deck is loaded, what the ball last said, and the
// visitor's settings. Every other module imports `state` and mutates it.
//
// Two things live here and nowhere else: CLASSIC, the twenty answers the
// original toy shipped with, and the payload codec that turns a deck into a
// URL fragment. Both are read by the embed, which has no UI of its own.

import { base64UrlEncode, base64UrlDecode, safeJsonParse } from './utils.js';

const STORAGE_KEY = 'portentState';
const SCHEMA = 1;

// The original 1950 spread: ten affirmative, five non-committal, five negative.
// The tone is what tints the window and what an imported deck has to be mapped
// onto, so it is part of the answer, not a label added later.
export const CLASSIC = [
  { text: 'It is certain', tone: 'yes' },
  { text: 'It is decidedly so', tone: 'yes' },
  { text: 'Without a doubt', tone: 'yes' },
  { text: 'Yes definitely', tone: 'yes' },
  { text: 'You may rely on it', tone: 'yes' },
  { text: 'As I see it, yes', tone: 'yes' },
  { text: 'Most likely', tone: 'yes' },
  { text: 'Outlook good', tone: 'yes' },
  { text: 'Yes', tone: 'yes' },
  { text: 'Signs point to yes', tone: 'yes' },
  { text: 'Reply hazy, try again', tone: 'maybe' },
  { text: 'Ask again later', tone: 'maybe' },
  { text: 'Better not tell you now', tone: 'maybe' },
  { text: 'Cannot predict now', tone: 'maybe' },
  { text: 'Concentrate and ask again', tone: 'maybe' },
  { text: 'Do not count on it', tone: 'no' },
  { text: 'My reply is no', tone: 'no' },
  { text: 'My sources say no', tone: 'no' },
  { text: 'Outlook not so good', tone: 'no' },
  { text: 'Very doubtful', tone: 'no' }
];

export const TONES = ['yes', 'maybe', 'no'];

export const TONE_LABEL = { yes: 'Affirmative', maybe: 'Non-committal', no: 'Negative' };

export function classicDeck() {
  return { title: 'The classic twenty', source: 'classic', answers: CLASSIC.map(a => ({ ...a })) };
}

export const state = {
  deck: classicDeck(),
  question: '',
  answer: null,          // the Answer object currently in the window
  history: [],           // [{ question, text, tone, at }], newest first, capped
  settings: {
    sound: true,
    haptics: true,
    motion: false,       // device-motion shaking, opt-in because iOS gates it
    mic: false,          // shout to shake, opt-in because it needs the mic
    xray: false          // see the die through the shell
  }
};

const HISTORY_CAP = 30;

export function recordAnswer(answer, question) {
  state.answer = answer;
  state.history.unshift({ question: question || '', text: answer.text, tone: answer.tone, at: Date.now() });
  if (state.history.length > HISTORY_CAP) state.history.length = HISTORY_CAP;
  save();
}

// ── Persistence ──────────────────────────────────────────────
// A deck the visitor built is worth keeping; a question is not, so it is left
// out deliberately. The embed never calls any of this: see js/embed.js.

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      v: SCHEMA,
      deck: state.deck,
      history: state.history.slice(0, 12),
      settings: state.settings
    }));
  } catch { /* private browsing, quota: the toy still works */ }
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { return false; }
  const saved = safeJsonParse(raw, null);
  if (!saved || saved.v !== SCHEMA) return false;
  if (saved.deck && Array.isArray(saved.deck.answers) && saved.deck.answers.length) {
    state.deck = saved.deck;
  }
  if (Array.isArray(saved.history)) state.history = saved.history;
  if (saved.settings) Object.assign(state.settings, saved.settings);
  return true;
}

// ── Payload codec ────────────────────────────────────────────
// A deck travels as base64url JSON, in `#d=` on the app and `?deck=` on the
// embed. Keys are shortened because the whole deck has to survive being pasted
// into a chat window: `t` title, `a` answers, each `[text, toneIndex]`.

export function encodeDeck(deck) {
  const payload = {
    t: deck.title || '',
    a: deck.answers.map(x => [x.text, Math.max(0, TONES.indexOf(x.tone))])
  };
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeDeck(raw) {
  const payload = safeJsonParse(base64UrlDecode(raw), null);
  if (!payload || !Array.isArray(payload.a)) return null;
  const answers = payload.a
    .map(row => Array.isArray(row)
      ? { text: String(row[0] ?? '').trim(), tone: TONES[row[1]] || 'maybe' }
      : { text: String(row ?? '').trim(), tone: 'maybe' })
    .filter(a => a.text);
  if (!answers.length) return null;
  return { title: String(payload.t || 'Shared deck'), source: 'link', answers };
}
