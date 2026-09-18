// ── Deck tests ───────────────────────────────────────────────
// Plain node, no framework and no browser: `make test`.
//
// These cover the parts where being wrong is invisible in the UI. A bad tone
// mapping still shows an answer; a biased draw still shows an answer; a codec
// that drops a tone still shows an answer. The ball looks fine in all three
// cases, which is exactly why they are tested here instead of by eye.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseAnswer, normaliseDeck, parseDeckText, MAX_ANSWER_CHARS,
  stackRankListId, stackRankItemsToAnswers, fetchStackRankList,
  drawAnswer, toneCounts
} from '../js/deck.js';
import { CLASSIC, classicDeck, encodeDeck, decodeDeck, TONES } from '../js/state.js';
import { mulberry32 } from '../js/utils.js';

// ── The classic deck ─────────────────────────────────────────

test('the classic deck is the original 10 / 5 / 5 spread', () => {
  assert.equal(CLASSIC.length, 20);
  const counts = toneCounts(classicDeck());
  assert.deepEqual(counts, { yes: 10, maybe: 5, no: 5 });
});

// ── Normalising ──────────────────────────────────────────────

test('an answer accepts the field names other tools use', () => {
  for (const key of ['text', 'answer', 'label', 'value']) {
    assert.equal(normaliseAnswer({ [key]: 'Ship it' }).text, 'Ship it');
  }
  assert.equal(normaliseAnswer('Ship it').text, 'Ship it');
});

test('an unknown tone falls back to non-committal rather than being dropped', () => {
  assert.equal(normaliseAnswer({ text: 'Maybe', tone: 'wildcard' }).tone, 'maybe');
  assert.equal(normaliseAnswer({ text: 'Yes', tone: 'yes' }).tone, 'yes');
});

test('blank and whitespace-only answers are refused', () => {
  assert.equal(normaliseAnswer(''), null);
  assert.equal(normaliseAnswer('   \n  '), null);
  assert.equal(normaliseAnswer(null), null);
});

test('a long answer is truncated to something the window can hold', () => {
  const long = 'x'.repeat(400);
  const answer = normaliseAnswer(long);
  assert.equal(answer.text.length, MAX_ANSWER_CHARS);
  assert.ok(answer.text.endsWith('…'));
});

test('a deck can arrive as answers, items, or a bare array', () => {
  const rows = [{ text: 'Yes', tone: 'yes' }, 'Maybe'];
  for (const input of [rows, { answers: rows }, { items: rows }]) {
    const deck = normaliseDeck(input);
    assert.equal(deck.answers.length, 2);
  }
  assert.equal(normaliseDeck({ nothing: true }), null);
  assert.equal(normaliseDeck({ answers: ['', '  '] }), null, 'a deck of blanks is not a deck');
});

test('duplicate answers survive, because they are the visitor\'s own weighting', () => {
  const deck = normaliseDeck(['Yes', 'Yes', 'Yes']);
  assert.equal(deck.answers.length, 3);
});

// ── Pasted text ──────────────────────────────────────────────

test('a leading +, ~ or - sets the tone in line mode', () => {
  const deck = parseDeckText('+ Ship it\n~ Ask later\n- Never');
  assert.deepEqual(deck.answers.map(a => a.tone), ['yes', 'maybe', 'no']);
  assert.deepEqual(deck.answers.map(a => a.text), ['Ship it', 'Ask later', 'Never']);
});

test('pasted JSON is preferred over line mode when it parses', () => {
  const deck = parseDeckText('{"title":"Mine","answers":[{"text":"Yes","tone":"yes"}]}');
  assert.equal(deck.title, 'Mine');
  assert.equal(deck.source, 'json');
  assert.equal(deck.answers[0].tone, 'yes');
});

test('JSON that fails to parse falls through to line mode instead of vanishing', () => {
  const deck = parseDeckText('{ this is not json\n+ but this is a line');
  assert.ok(deck.answers.length >= 1);
  assert.equal(deck.source, 'text');
});

test('empty text is not a deck', () => {
  assert.equal(parseDeckText(''), null);
  assert.equal(parseDeckText('   '), null);
});

// ── Stack Rank ───────────────────────────────────────────────

test('a list id is read from an id, a share link, or a bare hash', () => {
  const id = 'k57abc123def456';
  assert.equal(stackRankListId(id), id);
  assert.equal(stackRankListId(`https://stackrank.neorgon.com/#/${id}/`), id);
  assert.equal(stackRankListId(`#/${id}`), id);
  assert.equal(stackRankListId('https://stackrank.neorgon.com/'), null);
  assert.equal(stackRankListId(''), null);
  assert.equal(stackRankListId('no spaces allowed here'), null);
});

test('priority becomes tone, blocked overrides it, and done items are dropped', () => {
  const answers = stackRankItemsToAnswers([
    { text: 'P1 thing', priority: 'P1' },
    { text: 'P2 thing', priority: 'P2' },
    { text: 'P3 thing', priority: 'P3' },
    { text: 'P4 thing', priority: 'P4' },
    { text: 'P5 thing', priority: 'P5' },
    { text: 'P6 thing', priority: 'P6' },
    { text: 'Blocked but urgent', priority: 'P1', blockedMessage: 'waiting on legal' },
    { text: 'Already done', priority: 'P1', completedAt: 1234 },
    { text: 'No priority at all' }
  ]);
  assert.deepEqual(answers.map(a => [a.text, a.tone]), [
    ['P1 thing', 'yes'],
    ['P2 thing', 'yes'],
    ['P3 thing', 'maybe'],
    ['P4 thing', 'maybe'],
    ['P5 thing', 'no'],
    ['P6 thing', 'no'],
    ['Blocked but urgent', 'no'],
    ['No priority at all', 'maybe']
  ]);
});

test('fetching a list posts the Convex query the deployment expects', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => {
    seen = { url, init };
    return {
      ok: true,
      json: async () => ({ status: 'success', value: { title: 'Roadmap', items: [{ text: 'Ship it', priority: 'P1' }] } })
    };
  };
  const deck = await fetchStackRankList('k57abc123def456', { fetchImpl, endpoint: 'https://example.convex.cloud' });
  assert.equal(seen.url, 'https://example.convex.cloud/api/query');
  assert.equal(seen.init.method, 'POST');
  assert.deepEqual(JSON.parse(seen.init.body), {
    path: 'lists:getList',
    args: { listId: 'k57abc123def456' },
    format: 'json'
  });
  assert.equal(deck.title, 'Roadmap');
  assert.equal(deck.source, 'stackrank:k57abc123def456');
  assert.deepEqual(deck.answers, [{ text: 'Ship it', tone: 'yes' }]);
});

test('every failure a list import can hit says what to do about it', async () => {
  const cases = [
    [{ ok: false, status: 404 }, /404/],
    [{ ok: true, json: async () => ({ status: 'error' }) }, /refused/],
    [{ ok: true, json: async () => ({ status: 'success', value: null }) }, /Open it once/],
    [{ ok: true, json: async () => ({ status: 'success', value: { items: [{ text: 'Done', completedAt: 1 }] } }) }, /no open items/]
  ];
  for (const [response, pattern] of cases) {
    await assert.rejects(
      fetchStackRankList('k57abc123def456', { fetchImpl: async () => response }),
      pattern
    );
  }
  await assert.rejects(fetchStackRankList('not a list id'), /list id or share link/);
  await assert.rejects(
    fetchStackRankList('k57abc123def456', { fetchImpl: async () => { throw new Error('offline'); } }),
    /Could not reach Stack Rank/
  );
});

// ── The draw ─────────────────────────────────────────────────

test('the draw reaches every answer and stays uniform', () => {
  const deck = classicDeck();
  const random = mulberry32(20260918);
  const rng = n => Math.floor(random() * n);
  const seen = new Map();
  const rounds = 20000;
  for (let i = 0; i < rounds; i++) {
    const answer = drawAnswer(deck, null, rng);
    seen.set(answer.text, (seen.get(answer.text) || 0) + 1);
  }
  assert.equal(seen.size, 20, 'every answer is reachable');
  const expected = rounds / 20;
  for (const [text, count] of seen) {
    assert.ok(Math.abs(count - expected) < expected * 0.25, `${text} came up ${count} times, expected about ${expected}`);
  }
});

test('a repeated answer is re-rolled once, and never for a two-answer deck', () => {
  // A forced-repeat rng: the first pick always lands on index 0.
  let calls = 0;
  const rng = () => (calls++ === 0 ? 0 : 1);
  const deck = normaliseDeck(['First', 'Second', 'Third']);
  const again = drawAnswer(deck, { text: 'First' }, rng);
  assert.equal(again.text, 'Second', 'the repeat is re-rolled');

  calls = 0;
  const pair = normaliseDeck(['First', 'Second']);
  const repeat = drawAnswer(pair, { text: 'First' }, rng);
  assert.equal(repeat.text, 'First', 'with two answers a repeat is unavoidable, so it is allowed');
});

test('an empty deck falls back to the classic twenty rather than saying nothing', () => {
  const answer = drawAnswer({ title: 'Empty', answers: [] });
  assert.ok(CLASSIC.some(a => a.text === answer.text));
});

test('a drawn answer is a copy, so editing the deck cannot rewrite history', () => {
  const deck = normaliseDeck(['Only answer']);
  const answer = drawAnswer(deck);
  answer.text = 'Tampered';
  assert.equal(deck.answers[0].text, 'Only answer');
});

// ── The share payload ────────────────────────────────────────

test('a deck survives the round trip through a URL payload', () => {
  const deck = normaliseDeck([
    { text: 'Yes, and quickly', tone: 'yes' },
    { text: 'Ask again después', tone: 'maybe' },   // non-ASCII has to survive too
    { text: 'No', tone: 'no' }
  ], 'Mixed feelings');
  const back = decodeDeck(encodeDeck(deck));
  assert.equal(back.title, 'Mixed feelings');
  assert.deepEqual(back.answers, deck.answers);
  assert.equal(back.source, 'link');
});

test('a payload is URL-safe, so no shortener or chat client can mangle it', () => {
  const payload = encodeDeck(normaliseDeck(['?? ~~ >>> ///', '+++ === ']));
  assert.match(payload, /^[A-Za-z0-9_-]+$/);
});

test('a broken payload decodes to null instead of an empty ball', () => {
  assert.equal(decodeDeck('not-base64-at-all!!'), null);
  assert.equal(decodeDeck(''), null);
  assert.equal(decodeDeck(encodeDeck({ title: 'Empty', answers: [] })), null);
});

test('a tone index the payload does not know becomes non-committal', () => {
  const forged = Buffer.from(JSON.stringify({ t: 'Forged', a: [['Yes', 99]] }))
    .toString('base64url');
  const deck = decodeDeck(forged);
  assert.equal(deck.answers[0].tone, 'maybe');
  assert.ok(TONES.includes(deck.answers[0].tone));
});
