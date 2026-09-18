// ── Ways to shake a ball ─────────────────────────────────────
// Every input that can disturb the ball lives here, and nothing else does: the
// UI shortcuts (`?`, the deck sheet, sound) belong to js/events.js.
//
//   pointer      drag to spin, with inertia on release; shake the mouse and it
//                counts as a shake, the same way your wrist does
//   touch        the same path, plus a fling
//   wheel        spin it on the spot
//   keyboard     Space or Enter shakes, arrows nudge, always reachable
//   device       a real shake of a real phone, gated behind iOS permission
//   gamepad      any button shakes, the sticks spin it, the answer rumbles
//   microphone   shout at it, opt-in because it asks for the mic
//
// A source never draws an answer or touches state. It reports "the ball was
// disturbed this much", and js/ball3d.js decides whether that counts.

const REVERSAL_WINDOW = 620;   // ms in which direction changes accumulate
const REVERSALS_NEEDED = 3;
const MIN_FLICK = 0.55;        // px/ms, below this a wobble is not a shake
const MOTION_THRESHOLD = 17;   // m/s^2 of combined acceleration delta
const MOTION_COOLDOWN = 900;   // ms, or one phone shake fires twenty times
const MIC_THRESHOLD = 0.22;    // normalised RMS

/**
 * @param {object} o
 * @param {HTMLElement} o.stage   the element the pointer works on
 * @param {object} o.ball         a js/ball3d.js instance (or its stub)
 * @param {(strength, source) => void} o.onShake
 * @param {boolean} [o.bindKeys]  bind Space/Enter/arrows directly. The app leaves
 *   this off and registers them through NeoKeys instead, so they appear in the
 *   `?` sheet and can be remapped; the embed, which has no kit, leaves it on.
 */
export function createShaker({ stage, ball, onShake, onSource, isTyping, bindKeys = true }) {
  const typing = () => (isTyping ? isTyping() : false);
  let dragging = false;
  let lastX = 0, lastY = 0, lastT = 0;
  let dirX = 0, reversals = 0, reversalStart = 0, peak = 0;
  let pointerId = null;

  const capabilities = {
    motion: typeof DeviceMotionEvent !== 'undefined',
    motionNeedsPermission: typeof DeviceMotionEvent !== 'undefined'
      && typeof DeviceMotionEvent.requestPermission === 'function',
    gamepad: typeof navigator !== 'undefined' && 'getGamepads' in navigator,
    mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
    vibrate: typeof navigator !== 'undefined' && 'vibrate' in navigator
  };

  function fire(strength, source) {
    onShake(strength, source);
    if (onSource) onSource(source);
  }

  // ── Pointer ──
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    stage.setPointerCapture?.(e.pointerId);
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
    dirX = 0; reversals = 0; reversalStart = e.timeStamp; peak = 0;
    stage.classList.add('is-grabbed');
  }

  function onPointerMove(e) {
    if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
    const dt = Math.max(1, e.timeStamp - lastT);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;

    ball.impulse(dx, dy, 1);

    // A shake is a hand changing its mind quickly. Count sign changes in the
    // dominant axis rather than raw speed, or a fast straight swipe reads as one.
    const vx = dx / dt;
    const speed = Math.hypot(dx, dy) / dt;
    peak = Math.max(peak, speed);
    if (e.timeStamp - reversalStart > REVERSAL_WINDOW) {
      reversalStart = e.timeStamp; reversals = 0; peak = speed;
    }
    if (Math.abs(vx) > MIN_FLICK) {
      const dir = Math.sign(vx);
      if (dirX !== 0 && dir !== dirX) reversals++;
      dirX = dir;
    }
    if (reversals >= REVERSALS_NEEDED) {
      reversals = 0; reversalStart = e.timeStamp;
      fire(Math.min(1, 0.4 + peak / 6), 'pointer');
    }
  }

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    pointerId = null;
    if (e && e.pointerId !== undefined) stage.releasePointerCapture?.(e.pointerId);
    stage.classList.remove('is-grabbed');
  }

  function onWheel(e) {
    if (typing()) return;
    e.preventDefault();
    ball.spin(0, -e.deltaX * 0.004 || 0, 0, 0);
    ball.spin(-e.deltaY * 0.004, 0, 0, Math.abs(e.deltaY) * 0.004);
  }

  function onDblClick() {
    ball.flip();
  }

  // ── Keyboard ──
  // Space and Enter shake; the arrows nudge, so a keyboard visitor can also turn
  // the ball over by hand instead of only through the Flip control.
  function onKeyDown(e) {
    if (typing() || e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case ' ':
      case 'Enter':
        e.preventDefault();
        fire(1, 'keyboard');
        break;
      case 'ArrowLeft': e.preventDefault(); ball.spin(0, -3.2, 0, 0.5); break;
      case 'ArrowRight': e.preventDefault(); ball.spin(0, 3.2, 0, 0.5); break;
      case 'ArrowUp': e.preventDefault(); ball.spin(-3.2, 0, 0, 0.5); break;
      case 'ArrowDown': e.preventDefault(); ball.spin(3.2, 0, 0, 0.5); break;
      default: break;
    }
  }

  // ── Device motion ──
  let motionOn = false;
  let lastMotion = 0;
  function onDeviceMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
    // Gravity alone is about 9.8, so the threshold is a delta above resting.
    if (mag < MOTION_THRESHOLD) return;
    if (e.timeStamp - lastMotion < MOTION_COOLDOWN) return;
    lastMotion = e.timeStamp;
    fire(Math.min(1, (mag - MOTION_THRESHOLD) / 14 + 0.5), 'device');
  }

  async function enableMotion() {
    if (!capabilities.motion) throw new Error('This browser does not report device motion.');
    if (capabilities.motionNeedsPermission) {
      const verdict = await DeviceMotionEvent.requestPermission();
      if (verdict !== 'granted') throw new Error('Motion access was declined.');
    }
    if (!motionOn) {
      addEventListener('devicemotion', onDeviceMotion);
      motionOn = true;
    }
    return true;
  }

  function disableMotion() {
    if (!motionOn) return;
    removeEventListener('devicemotion', onDeviceMotion);
    motionOn = false;
  }

  // ── Gamepad ──
  // No event exists for a button press, so this polls, but only while a pad is
  // actually connected. An unplugged controller costs nothing.
  let padLoop = null;
  const padPrev = new Map();
  function pollPads() {
    padLoop = null;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let any = false;
    for (const pad of pads) {
      if (!pad) continue;
      any = true;
      const prev = padPrev.get(pad.index) || [];
      pad.buttons.forEach((b, i) => {
        if (b.pressed && !prev[i]) fire(1, 'gamepad');
      });
      padPrev.set(pad.index, pad.buttons.map(b => b.pressed));
      const [ax = 0, ay = 0] = pad.axes;
      if (Math.abs(ax) > 0.22 || Math.abs(ay) > 0.22) {
        ball.spin(ay * 0.9, ax * 0.9, 0, (Math.abs(ax) + Math.abs(ay)) * 0.15);
      }
    }
    if (any && !padLoop) padLoop = requestAnimationFrame(pollPads);
  }

  function onGamepadConnected() {
    if (!padLoop) padLoop = requestAnimationFrame(pollPads);
  }

  function rumble(ms = 180, strength = 0.6) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      pad?.vibrationActuator?.playEffect?.('dual-rumble', {
        duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.5
      }).catch(() => {});
    }
  }

  // ── Microphone ──
  let micStream = null, micCtx = null, micRaf = null, micLast = 0;
  async function enableMic() {
    if (!capabilities.mic) throw new Error('This browser has no microphone access.');
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = micCtx.createMediaStreamSource(micStream);
    const analyser = micCtx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      const rms = Math.sqrt(sum / buf.length);
      const now = performance.now();
      if (rms > MIC_THRESHOLD && now - micLast > 1200) {
        micLast = now;
        fire(Math.min(1, rms * 3), 'mic');
      }
      micRaf = requestAnimationFrame(tick);
    };
    tick();
    return true;
  }

  function disableMic() {
    if (micRaf) cancelAnimationFrame(micRaf);
    micRaf = null;
    micStream?.getTracks().forEach(t => t.stop());
    micStream = null;
    micCtx?.close().catch(() => {});
    micCtx = null;
  }

  function attach() {
    stage.addEventListener('pointerdown', onPointerDown);
    stage.addEventListener('pointermove', onPointerMove);
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);
    stage.addEventListener('pointerleave', endDrag);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDblClick);
    if (bindKeys) addEventListener('keydown', onKeyDown);
    addEventListener('gamepadconnected', onGamepadConnected);
    if (capabilities.gamepad) onGamepadConnected();
  }

  function detach() {
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', endDrag);
    stage.removeEventListener('pointercancel', endDrag);
    stage.removeEventListener('pointerleave', endDrag);
    stage.removeEventListener('wheel', onWheel);
    stage.removeEventListener('dblclick', onDblClick);
    if (bindKeys) removeEventListener('keydown', onKeyDown);
    removeEventListener('gamepadconnected', onGamepadConnected);
    if (padLoop) cancelAnimationFrame(padLoop);
    disableMotion();
    disableMic();
  }

  return {
    capabilities, attach, detach,
    enableMotion, disableMotion, enableMic, disableMic, rumble,
    isMotionOn: () => motionOn,
    isMicOn: () => !!micStream
  };
}

/** Counting reversals is the one piece of shake detection worth testing alone. */
export function countReversals(samples, minFlick = MIN_FLICK) {
  let dir = 0, count = 0;
  for (const v of samples) {
    if (Math.abs(v) <= minFlick) continue;
    const d = Math.sign(v);
    if (dir !== 0 && d !== dir) count++;
    dir = d;
  }
  return count;
}
