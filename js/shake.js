// ── Ways to shake a ball ─────────────────────────────────────
// Every input that can disturb the ball lives here, and nothing else does: the
// UI shortcuts (`?`, the deck sheet, sound) belong to js/events.js.
//
//   pointer      grab and drag the ball, then release it with inertia; a quick
//                fling or a few sharp reversals count as a shake
//   touch        follows the same pointer path
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
const FLING_WINDOW = 120;      // ms of recent movement used for release velocity
const FLING_RELEASE_GRACE = 220; // ms to allow a finger to lift after its last move
const FLING_MIN_SPEED = 1.1;   // px/ms: a deliberate throw, not a gentle drag
const FLING_MIN_TRAVEL = 48;   // px: a short click or tremor cannot shake the ball
const THROW_MIN_TRAVEL = 120;  // px: a clear throw even when WebGL delays move events
const THROW_MAX_DURATION = 750; // ms: a long inspection drag is not a throw
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
  let startX = 0, startY = 0, startT = 0;
  let dirX = 0, reversals = 0, reversalStart = 0, peak = 0;
  let shookThisDrag = false;
  let recentMoves = [];
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
  function overBall(x, y) {
    if (typeof ball.hitTest === 'function') return ball.hitTest(x, y);
    // The flat fallback has no scene to raycast. Use its rendered circle when
    // available; older ball implementations get the stage-centered estimate.
    const flat = stage.querySelector?.('.flat-ball');
    const flatRect = flat?.getBoundingClientRect();
    if (flatRect?.width && flatRect?.height) {
      return Math.hypot(x - (flatRect.left + flatRect.width / 2),
        y - (flatRect.top + flatRect.height / 2)) <= Math.min(flatRect.width, flatRect.height) / 2;
    }
    const rect = stage.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.43;
    return Math.hypot(x - (rect.left + rect.width / 2),
      y - (rect.top + rect.height / 2)) <= radius;
  }

  function rememberMove(x, y, t) {
    recentMoves.push({ x, y, t });
    while (recentMoves.length > 1 && t - recentMoves[0].t > FLING_WINDOW) {
      recentMoves.shift();
    }
  }

  function onPointerDown(e) {
    if (dragging || (e.button !== undefined && e.button !== 0)
      || e.isPrimary === false || !overBall(e.clientX, e.clientY)) return;
    dragging = true;
    pointerId = e.pointerId;
    if (e.pointerId !== undefined) {
      try { stage.setPointerCapture?.(e.pointerId); } catch { /* Window listeners still finish the drag. */ }
    }
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
    startX = lastX; startY = lastY; startT = lastT;
    recentMoves = [{ x: lastX, y: lastY, t: lastT }];
    dirX = 0; reversals = 0; reversalStart = e.timeStamp; peak = 0;
    shookThisDrag = false;
    ball.grab?.();
    stage.classList.add('is-grabbed');
  }

  function onPointerMove(e) {
    if (!dragging || (pointerId !== null && e.pointerId !== pointerId)) return;
    const dt = Math.max(1, e.timeStamp - lastT);
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
    if (dx || dy) rememberMove(lastX, lastY, lastT);

    ball.dragMove?.(dx, dy);
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
    if (reversals >= REVERSALS_NEEDED && !shookThisDrag) {
      shookThisDrag = true;
      reversals = 0; reversalStart = e.timeStamp;
      fire(Math.min(1, 0.4 + peak / 6), 'pointer');
    }
  }

  function endDrag(e, cancelled = false) {
    if (!dragging || (e?.pointerId !== undefined && pointerId !== null && e.pointerId !== pointerId)) return;
    if (!cancelled && e && Number.isFinite(e.clientX) && Number.isFinite(e.clientY)) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (dx || dy) {
        ball.dragMove?.(dx, dy);
        ball.impulse(dx, dy, 1);
        lastX = e.clientX; lastY = e.clientY; lastT = e.timeStamp;
        rememberMove(lastX, lastY, lastT);
      }
    }

    const oldest = recentMoves[0];
    const latest = recentMoves[recentMoves.length - 1];
    const elapsed = Math.max(1, (latest?.t ?? lastT) - (oldest?.t ?? lastT));
    // A stationary pointerup is not another motion sample. The last real move
    // still supplies release velocity if the finger lifted shortly afterward.
    const fresh = !cancelled && e && latest && e.timeStamp - latest.t <= FLING_RELEASE_GRACE;
    const vx = fresh && recentMoves.length > 1 ? (latest.x - oldest.x) / elapsed : 0;
    const vy = fresh && recentMoves.length > 1 ? (latest.y - oldest.y) / elapsed : 0;
    const speed = Math.hypot(vx, vy);
    const travel = Math.hypot(lastX - startX, lastY - startY);
    const duration = e ? e.timeStamp - startT : Infinity;
    // Slow rendering can leave just one sample in FLING_WINDOW. A substantial
    // forward throw still counts, but its physical drop keeps the measured speed.
    const deliberateThrow = fresh && travel >= THROW_MIN_TRAVEL && duration <= THROW_MAX_DURATION;
    const shouldShake = !cancelled && !shookThisDrag
      && ((travel >= FLING_MIN_TRAVEL && speed >= FLING_MIN_SPEED) || deliberateThrow);

    dragging = false;
    const releasedId = pointerId;
    pointerId = null;
    stage.classList.remove('is-grabbed');
    if (releasedId !== null && releasedId !== undefined) {
      try {
        if (!stage.hasPointerCapture || stage.hasPointerCapture(releasedId)) {
          stage.releasePointerCapture?.(releasedId);
        }
      } catch { /* Capture may already have been lost. */ }
    }
    ball.drop?.(vx, vy);
    if (shouldShake) fire(Math.min(1, 0.4 + Math.max(speed / 5, travel / 600)), 'pointer');
  }

  function onPointerUp(e) { endDrag(e); }
  function onPointerCancel(e) { endDrag(e, true); }
  function onPointerLeave(e) {
    if (!stage.hasPointerCapture?.(pointerId)) endDrag(e, true);
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
    stage.addEventListener('pointerup', onPointerUp);
    stage.addEventListener('pointercancel', onPointerCancel);
    stage.addEventListener('pointerleave', onPointerLeave);
    stage.addEventListener('lostpointercapture', onPointerCancel);
    addEventListener('pointerup', onPointerUp);
    addEventListener('pointercancel', onPointerCancel);
    stage.addEventListener('wheel', onWheel, { passive: false });
    stage.addEventListener('dblclick', onDblClick);
    if (bindKeys) addEventListener('keydown', onKeyDown);
    addEventListener('gamepadconnected', onGamepadConnected);
    if (capabilities.gamepad) onGamepadConnected();
  }

  function detach() {
    stage.removeEventListener('pointerdown', onPointerDown);
    stage.removeEventListener('pointermove', onPointerMove);
    stage.removeEventListener('pointerup', onPointerUp);
    stage.removeEventListener('pointercancel', onPointerCancel);
    stage.removeEventListener('pointerleave', onPointerLeave);
    stage.removeEventListener('lostpointercapture', onPointerCancel);
    removeEventListener('pointerup', onPointerUp);
    removeEventListener('pointercancel', onPointerCancel);
    if (dragging) endDrag(null, true);
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
