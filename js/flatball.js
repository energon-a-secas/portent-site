// ── The flat ball ────────────────────────────────────────────
// What runs when the browser gives no WebGL context: a CSS ball with the same
// interface as js/ball3d.js, so js/events.js never branches on which one it got.
//
// It is not a placeholder. It shakes, it makes you wait for the die to settle,
// it settles, and it answers. The only thing missing is the 3D.

const SETTLE_MS = 780;

export function createFlatBall({ stage, ball: el, onNeedAnswer, onReveal, onShakeStart, onNoAnswer, onKnock, reducedMotion }) {
  let phase = 'idle';
  let answer = null;
  let timer = null;
  let tiltX = 0, tiltY = 0;
  let facingAway = false;
  let dragX = 0, dragY = 0;
  let crackTimer = null;

  function paint() {
    el.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${tiltY.toFixed(2)}deg`);
    el.style.setProperty('--drag-x', `${dragX.toFixed(1)}px`);
    el.style.setProperty('--drag-y', `${dragY.toFixed(1)}px`);
    el.dataset.phase = phase;
    el.dataset.away = facingAway ? 'true' : 'false';
  }

  function settle() {
    timer = null;
    answer = onNeedAnswer ? onNeedAnswer() : null;
    if (!answer) {
      // Defensive, same as the 3D ball: drawAnswer always returns something, and
      // the guard exists so a settled ball can never sit under a hint promising an
      // answer that will not arrive.
      phase = 'idle';
      facingAway = false;
      paint();
      if (onNoAnswer) onNoAnswer(phase);
      return;
    }
    if (onKnock) onKnock(0.6);
    reveal();
  }

  function reveal() {
    phase = 'revealed';
    facingAway = false;
    paint();
    if (answer && onReveal) onReveal(answer);
  }

  return {
    supported: true,
    flat: true,
    reason: null,

    hitTest(x, y) {
      const rect = el.getBoundingClientRect();
      return Math.hypot(x - rect.left - rect.width / 2, y - rect.top - rect.height / 2)
        <= Math.min(rect.width, rect.height) / 2;
    },

    grab() {
      el.classList.add('is-dragging');
    },

    dragMove(dx, dy) {
      const rect = stage.getBoundingClientRect();
      dragX = Math.max(-rect.width * 0.3, Math.min(rect.width * 0.3, dragX + dx));
      dragY = Math.max(-rect.height * 0.27, Math.min(rect.height * 0.27, dragY + dy));
      paint();
    },

    drop(vx = 0, vy = 0) {
      el.classList.remove('is-dragging');
      if (Math.hypot(vx, vy) > 1.45 && Math.hypot(dragX, dragY) > 35) {
        stage.classList.add('is-cracked');
        clearTimeout(crackTimer);
        crackTimer = setTimeout(() => stage.classList.remove('is-cracked'), 1050);
        if (onKnock) onKnock(1);
      }
      dragX = dragY = 0;
      paint();
    },

    impulse(dx, dy) {
      tiltY = Math.max(-22, Math.min(22, tiltY + dx * 0.22));
      tiltX = Math.max(-22, Math.min(22, tiltX - dy * 0.22));
      paint();
    },

    spin(x, y) {
      tiltY += y * 2; tiltX += x * 2;
      paint();
    },

    shake(strength = 1) {
      answer = null;
      phase = 'agitated';
      facingAway = false;
      paint();
      stage.classList.remove('is-shaking');
      void stage.offsetWidth;              // restart the CSS shake
      stage.classList.add('is-shaking');
      if (onShakeStart) onShakeStart();
      clearTimeout(timer);
      if (reducedMotion?.()) {
        stage.classList.remove('is-shaking');
        settle();
        return;
      }
      timer = setTimeout(settle, SETTLE_MS * (0.7 + 0.5 * (1 - strength)));
    },

    flip() {
      if (phase === 'awaiting-flip') reveal();
    },

    reset() { tiltX = tiltY = 0; paint(); },
    setAnswer(next) { answer = next; reveal(); },
    setXray(on) { el.dataset.xray = on ? 'true' : 'false'; },
    facing: () => (facingAway ? -1 : 1),
    phase: () => phase,
    resize() {},
    snapshot: () => null,
    dispose() { clearTimeout(timer); clearTimeout(crackTimer); }
  };
}
