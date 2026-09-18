// ── Shake detection tests ────────────────────────────────────
// One thing is tested here, and it is the one thing in js/shake.js that can be
// wrong without looking wrong: telling a shake apart from a swipe.
//
// A fast straight drag across the stage produces large speeds and no direction
// changes. If the detector keyed on speed, dragging the ball to look at the back
// of it would fire a shake and wipe the answer being read.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countReversals } from '../js/shake.js';

test('a straight swipe has no reversals, however fast it is', () => {
  assert.equal(countReversals([4, 9, 14, 20, 11, 3]), 0);
});

test('a shake is counted by direction changes', () => {
  assert.equal(countReversals([3, -3, 3, -3]), 3);
});

test('slow wobble below the flick threshold is ignored', () => {
  assert.equal(countReversals([0.2, -0.3, 0.4, -0.2]), 0);
  assert.equal(countReversals([0.2, -0.3, 0.4, -0.2], 0.1), 3, 'and counted once the threshold drops');
});

test('a slow drift between two hard flicks does not hide the reversal', () => {
  // The samples under the threshold are skipped, not treated as a direction.
  assert.equal(countReversals([3, 0.1, -0.1, -3]), 1);
});

test('an idle pointer is not a shake', () => {
  assert.equal(countReversals([]), 0);
  assert.equal(countReversals([0, 0, 0]), 0);
});

test('three reversals is reachable inside one back-and-forth-and-back', () => {
  // This is the gesture the stage requires (REVERSALS_NEEDED = 3): right, left,
  // right, left. Anything shorter is a drag with a change of mind.
  assert.ok(countReversals([2, -2, 2, -2]) >= 3);
  assert.ok(countReversals([2, -2, 2]) < 3, 'and two changes of direction is not enough');
});
