// ── Shake detection tests ────────────────────────────────────
// A drag can shake through quick reversals or through a brisk release. The
// velocity on release must come from real movement, even if pointerup is late.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countReversals, createShaker } from '../js/shake.js';

function withPointerRig(run) {
  const oldAdd = globalThis.addEventListener;
  const oldRemove = globalThis.removeEventListener;
  const hadNavigator = 'navigator' in globalThis;
  if (!hadNavigator) globalThis.navigator = {};
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};

  const handlers = new Map();
  const calls = [];
  const captured = new Set();
  const stage = {
    addEventListener(type, handler) { handlers.set(type, handler); },
    removeEventListener(type) { handlers.delete(type); },
    setPointerCapture(id) { captured.add(id); },
    hasPointerCapture(id) { return captured.has(id); },
    releasePointerCapture(id) { captured.delete(id); },
    classList: { add() {}, remove() {} }
  };
  const ball = {
    hitTest: () => true,
    grab() { calls.push('grab'); },
    dragMove() {}, impulse() {}, spin() {}, flip() {},
    drop(vx, vy) { calls.push({ type: 'drop', vx, vy }); }
  };
  const shaker = createShaker({
    stage, ball, bindKeys: false,
    onShake() { calls.push('shake'); }
  });
  const emit = (type, x, y, timeStamp) => handlers.get(type)({
    pointerId: 1, button: 0, isPrimary: true, clientX: x, clientY: y, timeStamp
  });

  try {
    shaker.attach();
    run({ emit, calls, captured });
  } finally {
    shaker.detach();
    if (oldAdd === undefined) delete globalThis.addEventListener;
    else globalThis.addEventListener = oldAdd;
    if (oldRemove === undefined) delete globalThis.removeEventListener;
    else globalThis.removeEventListener = oldRemove;
    if (!hadNavigator) delete globalThis.navigator;
  }
}

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

test('a stationary pointerup shortly after a fling keeps its release velocity', () => {
  withPointerRig(({ emit, calls, captured }) => {
    emit('pointerdown', 150, 150, 0);
    emit('pointermove', 190, 150, 20);
    emit('pointermove', 240, 150, 50);
    emit('pointerup', 240, 150, 230); // 180 ms after the last real movement

    assert.equal(calls.at(-2).type, 'drop', 'drop runs before the release shake');
    assert.ok(calls.at(-2).vx > 1.1, 'stationary pointerup preserves recent movement');
    assert.equal(calls.at(-1), 'shake');
    assert.equal(captured.size, 0);
  });
});

test('a deliberate throw survives sparse pointermove events without invented drop velocity', () => {
  withPointerRig(({ emit, calls }) => {
    emit('pointerdown', 150, 150, 0);
    emit('pointermove', 195, 150, 150);
    emit('pointermove', 255, 150, 360);
    emit('pointermove', 330, 150, 590); // 180 px net in 590 ms; each sample ages out
    emit('pointerup', 330, 150, 600);

    assert.deepEqual(calls.at(-2), { type: 'drop', vx: 0, vy: 0 });
    assert.equal(calls.at(-1), 'shake');
    assert.equal(calls.filter(call => call === 'shake').length, 1);
  });
});

test('a slow drag or a long pause before release does not shake', () => {
  withPointerRig(({ emit, calls }) => {
    emit('pointerdown', 150, 150, 0);
    emit('pointermove', 170, 150, 100);
    emit('pointermove', 190, 150, 200);
    emit('pointerup', 190, 150, 210);
    assert.equal(calls.filter(call => call === 'shake').length, 0);
    assert.ok(calls.at(-1).vx < 1.1);

    calls.length = 0;
    emit('pointerdown', 150, 150, 300);
    emit('pointermove', 200, 150, 320);
    emit('pointermove', 250, 150, 340);
    emit('pointerup', 250, 150, 600); // older than the release grace period
    assert.deepEqual(calls.at(-1), { type: 'drop', vx: 0, vy: 0 });
    assert.equal(calls.filter(call => call === 'shake').length, 0);
  });
});

test('a reversal shake and a brisk release count once for the gesture', () => {
  withPointerRig(({ emit, calls }) => {
    emit('pointerdown', 150, 150, 0);
    for (const [x, t] of [[190, 20], [150, 40], [190, 60], [150, 80], [300, 100]]) {
      emit('pointermove', x, 150, t);
    }
    emit('pointerup', 300, 150, 110);
    assert.equal(calls.filter(call => call === 'shake').length, 1);
    assert.equal(calls.at(-1).type, 'drop');
  });
});
