// ── Decks: normalise, import, draw ───────────────────────────
// A deck is `{ title, source, answers: [{ text, tone }] }` and nothing in this
// file touches the DOM, so tests/deck.test.mjs runs it under plain node.
//
// Three ways in, one shape out:
//
//   the classic twenty          js/state.js CLASSIC
//   a link payload              state.decodeDeck, `#d=` / `?deck=`
//   Stack Rank                  fetchStackRankList, over Convex's HTTP query API
//   pasted text or JSON         parseDeckText
//
// Anything else a Neorgon tool wants to feed the ball goes through
// `normaliseDeck`, so a new source is an adapter, never a second data model.

import { TONES, classicDeck } from './state.js';
import { randomInt, safeJsonParse } from './utils.js';

/** The window is 500px of texture wide. Past this a line stops being readable. */
export const MAX_ANSWER_CHARS = 120;

export function normaliseAnswer(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return finish(raw, 'maybe');
  const text = raw.text ?? raw.answer ?? raw.label ?? raw.value ?? '';
  const tone = TONES.includes(raw.tone) ? raw.tone : 'maybe';
  return finish(text, tone);
}

function finish(text, tone) {
  let t = String(text).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length > MAX_ANSWER_CHARS) t = t.slice(0, MAX_ANSWER_CHARS - 1).trimEnd() + '…';
  return { text: t, tone };
}

/**
 * Turn anything deck-shaped into a deck, or return null. Duplicate answers are
 * kept: a deck that says yes twice is a deck with better odds of yes, and
 * silently collapsing that would change the visitor's own weighting.
 */
export function normaliseDeck(input, fallbackTitle = 'Imported deck', source = 'import') {
  const rows = Array.isArray(input) ? input : Array.isArray(input?.answers) ? input.answers
    : Array.isArray(input?.items) ? input.items : null;
  if (!rows) return null;
  const answers = rows.map(normaliseAnswer).filter(Boolean);
  if (!answers.length) return null;
  const title = String(input?.title || fallbackTitle).replace(/\s+/g, ' ').trim().slice(0, 80);
  return { title: title || fallbackTitle, source, answers };
}

/**
 * Paste-a-blob import. Accepts a deck JSON object, a bare JSON array, or plain
 * lines. In line mode a leading `+`, `~` or `-` sets the tone, which is the
 * shortest notation that still lets someone write a weighted deck by hand.
 */
export function parseDeckText(text, fallbackTitle = 'Pasted deck') {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    const parsed = safeJsonParse(trimmed, null);
    const deck = parsed && normaliseDeck(parsed, fallbackTitle, 'json');
    if (deck) return deck;
  }
  const answers = trimmed.split(/\r?\n/).map(line => {
    const m = /^\s*([+~-])\s+(.*)$/.exec(line);
    if (m) return finish(m[2], m[1] === '+' ? 'yes' : m[1] === '-' ? 'no' : 'maybe');
    return normaliseAnswer(line);
  }).filter(Boolean);
  if (!answers.length) return null;
  return { title: fallbackTitle, source: 'text', answers };
}

// ── Stack Rank ───────────────────────────────────────────────
// stackrank.neorgon.com keeps its lists in Convex and shares them as
// `#/<listId>/`. `lists:getList` is a public query with no auth, so the ball
// reads a list with one fetch and no client library:
//
//   POST https://industrious-hare-401.convex.cloud/api/query
//   {"path":"lists:getList","args":{"listId":"…"},"format":"json"}
//   → {"status":"success","value":{ title, items:[…] }}   (null when absent)
//
// Verified against the live deployment on 2026-09-18, including the CORS
// response header, which is why this needs no proxy. `connect-src
// https://*.convex.cloud` has to be in this site's CSP for it to work.
export const STACKRANK_CONVEX = 'https://industrious-hare-401.convex.cloud';

/** Pull a list id out of a raw id, a full share URL, or just the hash part. */
export function stackRankListId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const hash = raw.includes('#') ? raw.slice(raw.indexOf('#') + 1) : raw;
  const first = hash.split(/[/?&]/).filter(Boolean)[0] || '';
  return /^[A-Za-z0-9_-]{4,64}$/.test(first) ? first : null;
}

/**
 * A ranked list read as a deck. The mapping is the whole judgment call, so it
 * is stated in the UI too: your top priorities are what the ball says yes to.
 *
 *   P1, P2                → affirmative
 *   P3, P4                → non-committal
 *   P5, P6                → negative
 *   blocked               → negative, whatever its priority (it is a no today)
 *   completed             → dropped, it is not a live option any more
 */
export function stackRankItemsToAnswers(items) {
  return (Array.isArray(items) ? items : [])
    .filter(item => !item?.completedAt)
    .map(item => {
      const p = String(item?.priority || 'P3').toUpperCase();
      let tone = p === 'P1' || p === 'P2' ? 'yes' : p === 'P5' || p === 'P6' ? 'no' : 'maybe';
      if (item?.blockedMessage) tone = 'no';
      return finish(item?.text, tone);
    })
    .filter(Boolean);
}

export async function fetchStackRankList(input, { fetchImpl = globalThis.fetch, endpoint = STACKRANK_CONVEX } = {}) {
  const listId = stackRankListId(input);
  if (!listId) throw new Error('That does not look like a Stack Rank list id or share link.');
  let res;
  try {
    res = await fetchImpl(`${endpoint}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'lists:getList', args: { listId }, format: 'json' })
    });
  } catch {
    throw new Error('Could not reach Stack Rank. Check the connection and try again.');
  }
  if (!res.ok) throw new Error(`Stack Rank answered ${res.status}. The list may be on a different deployment.`);
  const body = await res.json().catch(() => null);
  if (!body || body.status !== 'success') throw new Error('Stack Rank refused that request.');
  if (!body.value) throw new Error(`No Stack Rank list called "${listId}". Open it once in Stack Rank first.`);
  const answers = stackRankItemsToAnswers(body.value.items);
  if (!answers.length) throw new Error('That list has no open items left, so there is nothing to answer with.');
  return { title: body.value.title || `Stack Rank ${listId}`, source: `stackrank:${listId}`, answers };
}

// ── The draw ─────────────────────────────────────────────────

/**
 * Pick an answer. Uniform over the deck, because a weighted deck should be
 * weighted by what is in it and not by a curve hidden in here. The one
 * concession to feel: a single re-roll when the draw repeats the last answer,
 * which the real toy does but which reads as a broken ball on a screen.
 */
export function drawAnswer(deck, previous = null, rng = randomInt) {
  const answers = deck?.answers?.length ? deck.answers : classicDeck().answers;
  let pick = answers[rng(answers.length)];
  if (answers.length > 2 && previous && pick.text === previous.text) {
    pick = answers[rng(answers.length)];
  }
  return { ...pick };
}

/** How the deck is skewed, for the deck sheet's readout. */
export function toneCounts(deck) {
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const a of deck?.answers || []) counts[a.tone] = (counts[a.tone] || 0) + 1;
  return counts;
}
