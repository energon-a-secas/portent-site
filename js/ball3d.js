// ── The ball ─────────────────────────────────────────────────
// Scene, physics and the reveal state machine. Everything visual is built in
// js/ballart.js; everything about *when* an answer appears is here.
//
// The loop it enforces is the real toy's loop, and it is the reason this is not
// a button that prints a random string:
//
//   shake        the die sinks into the liquid, no answer exists
//   let go       the ball spins down under damping
//   settle       the die rises to the window and an answer is drawn
//   read it      the window turns to face you and the answer becomes legible
//
// A shake that is too gentle does not count. That is faithful, and it is also
// what stops the page from being a click-a-second answer dispenser. That decision
// belongs to whatever is reading the input, not to this file: js/shake.js counts
// direction reversals, so a slow drag never fires a shake at all. Once shake() is
// called the ball owes an answer, and the wait for it is only about coming to rest.
//
// Frames are drawn on demand: while the ball is moving, an animation is in
// flight, or the bubbles are still alive. An idle ball costs nothing.

// three is imported by path, not by a bare specifier. A bare specifier needs an
// inline <script type="importmap">, and embed.html is framed by other people's
// pages, so its CSP has no 'unsafe-inline' to spare. A relative path resolves
// under any policy and needs no inline script at all.
import * as THREE from '../vendor/three/three.module.min.js';
import { R, buildEnvironment, buildBallParts, buildFractureTexture, drawDieFace } from './ballart.js';
import { clamp } from './utils.js';

const DIE_SUNK = -1.00;
const DIE_UP = -1.46;
const CALM = 0.55;              // rad/s below which the ball counts as still
const CALM_HOLD = 0.25;         // seconds of stillness before the die rises
const SHAKE_AGITATION = 2.6;    // the churn a shake adds, on top of its strength
const DOWN = new THREE.Vector3(0, -1, 0);
const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);

// How the ball sits when nothing has touched it. The 8 is at the top pole and
// the window at the bottom, so at identity the camera sees the bare equator: a
// black sphere that could be anything. Tilting the top 36 degrees toward the
// viewer is how the toy sits on a desk, and it is what makes the thing on screen
// recognisably an eight ball before the first shake. It costs nothing afterwards,
// since a shake randomises the orientation completely.
const REST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.63);
const FACE = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function stub(reason) {
  return {
    supported: false, reason,
    impulse() {}, spin() {}, shake() {}, flip() {}, reset() {}, resize() {},
    hitTest: () => false, grab() {}, dragMove() {}, drop() {},
    setXray() {}, setAnswer() {}, snapshot: () => null, dispose() {},
    facing: () => 1, phase: () => 'idle'
  };
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.container         where the canvas goes
 * @param {() => {text,tone}} opts.onNeedAnswer  called at settle, returns the answer to show
 * @param {(a) => void} opts.onReveal          the answer is now readable in the window
 * @param {() => void} opts.onShakeStart       the die just sank, there is no answer
 * @param {() => void} opts.onNeedFlip         settled with the window facing away
 * @param {(phase) => void} opts.onNoAnswer    settled with nothing to say (an empty deck)
 * @param {(intensity) => void} opts.onKnock   the die hit the window, for sound and haptics
 * @param {() => boolean} opts.reducedMotion
 */
export function createBall(opts) {
  const { container } = opts;
  const reduced = () => (opts.reducedMotion ? opts.reducedMotion() : false);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch (err) {
    return stub(err && err.message ? err.message : 'WebGL is unavailable');
  }
  if (!renderer.getContext()) return stub('WebGL context creation failed');

  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, coarse ? 1.6 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.22;
  renderer.domElement.className = 'ball-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 0, 7.2);

  const env = buildEnvironment(renderer);
  scene.environment = env;

  scene.add(new THREE.HemisphereLight(0xb9c9ef, 0x242037, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-3.4, 4.2, 4.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xb6a5ff, 1.05);
  rim.position.set(3.8, -1.6, -2.4);
  scene.add(rim);

  // Pivot carries drag, throw and shake movement; ball carries orientation.
  // Keeping them apart prevents a translation from changing the spin.
  const pivot = new THREE.Group();
  const ball = new THREE.Group();
  ball.quaternion.copy(REST);
  pivot.add(ball);
  scene.add(pivot);

  const fractureTex = buildFractureTexture(renderer);
  const fractureMat = new THREE.MeshBasicMaterial({
    map: fractureTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false
  });
  const fracture = new THREE.Mesh(new THREE.PlaneGeometry(R * 1.46, R * 1.46), fractureMat);
  fracture.position.z = R + 0.06;
  fracture.renderOrder = 10;
  fracture.visible = false;
  pivot.add(fracture);

  // Everything inside the shell is built in js/ballart.js. This file owns when
  // the die moves, not what it looks like.
  const { die, hull, bubbles, dieTex, shellMat, capMat, liquidMat, stirBubbles } =
    buildBallParts(renderer, ball, DIE_SUNK);

  // ── Physics and phase ──
  const angVel = new THREE.Vector3();
  const workAxis = new THREE.Vector3();
  const workQuat = new THREE.Quaternion();
  const normal = new THREE.Vector3();
  let phase = 'idle';           // idle | agitated | awaiting-flip | revealed
  let agitation = 0;
  let calmFor = 0;
  let dieTarget = DIE_SUNK;
  let shakePending = false;      // a shake is owed an answer, however long it takes to rest
  let bubbleLife = 0;
  let flipTarget = null;
  let answer = null;
  const dragOffset = new THREE.Vector2();
  const dragVelocity = new THREE.Vector2();
  let dragging = false;
  let shakeAmp = 0;
  let shakeClock = 0;
  let settlePulse = 0;
  let crackLife = 0;
  let running = false;
  let disposed = false;
  let last = 0;

  function facing() {
    normal.copy(DOWN).applyQuaternion(ball.quaternion);
    return normal.dot(TOWARD_CAMERA);
  }

  function wake() {
    if (running || disposed) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }

  function busy() {
    return angVel.lengthSq() > 0.0004
      || Math.abs(die.position.y - dieTarget) > 0.001
      || bubbleLife > 0.01
      || flipTarget !== null
      || phase === 'agitated'
      || dragging
      || dragOffset.lengthSq() > 0.0001
      || dragVelocity.lengthSq() > 0.0001
      || shakeAmp > 0.001
      || settlePulse > 0.001
      || crackLife > 0;
  }

  function frame(now) {
    if (disposed) return;
    const elapsed = Math.min(0.5, (now - last) / 1000) || 0.016;
    last = now;
    // Rendering can be slow on software WebGL. Advance the simulation through
    // the elapsed wall time in stable slices so a two-second shake still takes
    // about two seconds, rather than stretching with the frame rate.
    const slices = Math.ceil(elapsed / 0.05);
    for (let i = 0; i < slices; i++) step(elapsed / slices);
    renderer.render(scene, camera);
    if (busy()) requestAnimationFrame(frame);
    else running = false;
  }

  function step(dt) {
    // Orientation: integrate the angular velocity, then damp it. Premultiplying
    // applies the spin in world space, which is what a hand does to a ball.
    const speed = angVel.length();
    if (speed > 1e-4) {
      workAxis.copy(angVel).multiplyScalar(1 / speed);
      workQuat.setFromAxisAngle(workAxis, speed * dt);
      ball.quaternion.premultiply(workQuat).normalize();
      angVel.multiplyScalar(Math.exp(-3.7 * dt));
    } else {
      angVel.set(0, 0, 0);
    }

    if (flipTarget) {
      ball.quaternion.slerp(flipTarget, 1 - Math.exp(-10 * dt));
      angVel.multiplyScalar(0.2);
      if (ball.quaternion.angleTo(flipTarget) < 0.02) {
        ball.quaternion.copy(flipTarget);
        flipTarget = null;
        if (phase !== 'revealed') reveal();
      }
    }

    // The die: sinks the moment the ball is disturbed, rises when it is still.
    const rise = dieTarget > die.position.y ? 9 : 5.5;
    const before = die.position.y;
    die.position.y += (dieTarget - die.position.y) * (1 - Math.exp(-rise * dt));
    if (before > DIE_UP + 0.02 && die.position.y <= DIE_UP + 0.02 && opts.onKnock) {
      opts.onKnock(clamp(agitation / 12, 0.25, 1));
    }
    hull.position.y = die.position.y + 0.42;
    hull.visible = phase === 'agitated';
    hull.rotation.x += angVel.x * dt * 0.5 + dt * 0.25;
    hull.rotation.z += angVel.z * dt * 0.5;

    // Bubbles ride the agitation and settle out.
    bubbleLife = Math.max(0, bubbleLife - dt * 0.6);
    bubbles.material.opacity = reduced() ? 0 : Math.min(0.7, bubbleLife);
    if (bubbleLife > 0.01) stirBubbles(dt, bubbleLife);

    // Settling: still for long enough. `!flipTarget` because easeToCamera leaves
    // the phase agitated until the flip converges, and it damps the spin hard, so
    // without this the ball keeps re-settling every CALM_HOLD while the reveal
    // animation plays.
    if (phase === 'agitated' && !flipTarget) {
      calmFor = angVel.length() < CALM ? calmFor + dt : 0;
      if (calmFor >= CALM_HOLD) settle();
    }
    agitation = Math.max(0, agitation - dt * 1.4);

    if (!dragging && dragOffset.lengthSq() + dragVelocity.lengthSq() > 0.00001) {
      dragVelocity.addScaledVector(dragOffset, -42 * dt);
      dragVelocity.multiplyScalar(Math.exp(-11 * dt));
      dragOffset.addScaledVector(dragVelocity, dt);
      if (dragOffset.lengthSq() + dragVelocity.lengthSq() < 0.0001) {
        dragOffset.set(0, 0);
        dragVelocity.set(0, 0);
      }
    }
    shakeClock += dt;
    shakeAmp *= Math.exp(-5.8 * dt);
    settlePulse *= Math.exp(-9 * dt);
    crackLife = Math.max(0, crackLife - dt);
    fracture.visible = crackLife > 0;
    fractureMat.opacity = Math.min(0.92, crackLife * 1.3);
    const wobble = reduced() ? 0 : shakeAmp;
    pivot.position.x = dragOffset.x + Math.sin(shakeClock * 34) * wobble;
    pivot.position.y = dragOffset.y + Math.sin(shakeClock * 41) * wobble * 0.68;
    pivot.rotation.z = Math.sin(shakeClock * 29) * wobble * 0.12;
    ball.scale.setScalar(1 + settlePulse);
  }

  function settle() {
    calmFor = 0;

    // A shake is owed an answer. Whether the input counted as a shake at all is
    // decided before shake() is ever called (js/shake.js counts direction
    // reversals; a slow drag or an arrow-key nudge never fires it), and only
    // shake() puts the ball in the agitated phase that gets us here. So there is
    // no gentle input left to reject at this point: rejecting on how much churn
    // is still left would only discard a real shake for taking too long to rest,
    // which is what happens when a long drag keeps the ball spinning.
    if (!shakePending) {
      // Resting without owing an answer means a reveal that was already in flight
      // got interrupted: reset() straightens the ball and drops the flip it was
      // halfway through, which is reachable by pressing r while the answer rises.
      // The answer is drawn on the die regardless, so offer the turn instead of
      // leaving a still ball with nothing readable and no way forward.
      if (answer && phase !== 'revealed') {
        easeToCamera();
        return;
      }
      phase = answer ? 'revealed' : 'idle';
      if (opts.onNoAnswer) opts.onNoAnswer(phase);
      return;
    }
    shakePending = false;

    answer = opts.onNeedAnswer ? opts.onNeedAnswer() : null;
    if (!answer) {
      // Defensive: drawAnswer falls back to the classic twenty rather than
      // returning nothing, so this is unreachable through the app. It stays
      // because the cost of being wrong is a ball that rests forever under a hint
      // promising an answer, which is the one state this machine must not have.
      phase = 'idle';
      dieTarget = DIE_SUNK;
      if (opts.onNoAnswer) opts.onNoAnswer(phase);
      return;
    }
    drawDieFace(dieTex.userData.canvas, answer.text);
    dieTex.needsUpdate = true;
    // Keep the printed face square to the window. Rotating about Y turns the
    // plane edge-on, which made the answer look like a dark slash.
    die.rotation.y = 0;
    die.rotation.z = 0;
    dieTarget = DIE_UP;
    bubbleLife = Math.min(bubbleLife, 0.16);
    easeToCamera();
  }

  function easeToCamera() {
    // Align the window and its printed face upright. Aligning only the window
    // normal preserves a random roll from the tumble, leaving words sideways.
    flipTarget = FACE.clone();
    if (reduced()) {
      ball.quaternion.copy(flipTarget);
      flipTarget = null;
      die.position.y = DIE_UP;
      if (phase !== 'revealed') reveal();
    }
    wake();
  }

  function reveal() {
    phase = 'revealed';
    settlePulse = reduced() ? 0 : 0.045;
    if (answer && opts.onReveal) opts.onReveal(answer);
  }

  return {
    supported: true,
    reason: null,
    canvas: renderer.domElement,

    hitTest(clientX, clientY) {
      const rect = container.getBoundingClientRect();
      const scale = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (rect.height || 1);
      const x = clientX - rect.left - rect.width / 2 - dragOffset.x / scale;
      const y = clientY - rect.top - rect.height / 2 + dragOffset.y / scale;
      const radius = R / scale;
      return x * x + y * y <= radius * radius;
    },

    grab() {
      dragging = true;
      dragVelocity.set(0, 0);
      wake();
    },

    dragMove(dx, dy) {
      if (!dragging) return;
      const rect = container.getBoundingClientRect();
      const scale = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (rect.height || 1);
      const radius = R / scale;
      const limitX = Math.max(40, rect.width / 2 - radius * 0.65) * scale;
      const limitY = Math.max(40, rect.height / 2 - radius * 0.65) * scale;
      dragOffset.x = clamp(dragOffset.x + dx * scale, -limitX, limitX);
      dragOffset.y = clamp(dragOffset.y - dy * scale, -limitY, limitY);
      wake();
    },

    drop(vx = 0, vy = 0) {
      if (!dragging) return;
      dragging = false;
      const speed = Math.hypot(vx, vy);
      if (speed > 1.45 && dragOffset.length() > 0.32) {
        crackLife = reduced() ? 0.35 : 1.05;
        if (opts.onKnock) opts.onKnock(1);
      }
      if (reduced()) {
        dragOffset.set(0, 0);
        dragVelocity.set(0, 0);
      } else {
        const rect = container.getBoundingClientRect();
        const scale = (2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (rect.height || 1);
        dragVelocity.set(vx * scale * 230, -vy * scale * 230).clampLength(0, 5);
        shakeAmp = Math.max(shakeAmp, Math.min(0.25, speed * 0.09));
      }
      if (answer && (phase === 'revealed' || !shakePending)) easeToCamera();
      wake();
    },

    /** A drag: screen-space delta becomes a world-space spin about the camera axes. */
    impulse(dx, dy, scale = 1) {
      const torque = dragging ? 0.028 : 0.055;
      angVel.x += dy * torque * scale;
      angVel.y += dx * torque * scale;
      const cap = 26;
      if (angVel.length() > cap) angVel.setLength(cap);
      agitation += (Math.abs(dx) + Math.abs(dy)) * 0.012 * scale;
      if (flipTarget && (dx || dy)) {
        // A real drag takes control of the orientation until release.
        flipTarget = null;
      }
      wake();
    },

    /** A deliberate spin about one axis, for the keyboard and the gamepad sticks. */
    spin(x, y, z, agitate = 0) {
      angVel.x += x; angVel.y += y; angVel.z += z;
      agitation += agitate;
      wake();
    },

    /**
     * A full shake. `strength` 0..1 scales how violent it is; the die sinks
     * immediately and no answer exists again until the ball settles.
     */
    shake(strength = 1) {
      const s = clamp(strength, 0.15, 1);
      answer = null;
      phase = 'agitated';
      calmFor = 0;
      flipTarget = null;
      shakePending = true;
      agitation += SHAKE_AGITATION + 6 * s;
      dieTarget = DIE_SUNK;
      bubbleLife = 0.55 + s * 0.5;
      shakeAmp = reduced() ? 0 : 0.24 + 0.15 * s;
      shakeClock = 0;
      const mag = 7 + 16 * s;
      angVel.set(
        (Math.random() - 0.5) * mag,
        (Math.random() - 0.5) * mag,
        (Math.random() - 0.5) * mag * 0.6
      );
      if (opts.onShakeStart) opts.onShakeStart();
      if (reduced()) {
        // No tumble to watch, so go straight to the part that carries meaning.
        angVel.set(0, 0, 0);
        settle();
      }
      wake();
    },

    /** Turn the window toward the viewer. The forgiving half of the real toy. */
    flip() {
      easeToCamera();
    },

    reset() {
      // Back to REST, not to identity: identity is the anonymous equator-on pose
      // nothing else in the app ever shows, so straightening the ball would leave
      // it looking less like an eight ball than it did at load.
      ball.quaternion.copy(REST);
      angVel.set(0, 0, 0);
      flipTarget = null;
      agitation = 0;
      wake();
    },

    setAnswer(next) {
      answer = next;
      if (next) {
        drawDieFace(dieTex.userData.canvas, next.text);
        dieTex.needsUpdate = true;
        dieTarget = DIE_UP;
      }
      wake();
    },

    /** The easter egg: the shell goes translucent and the die is visible. */
    setXray(on) {
      shellMat.transparent = !!on;
      shellMat.opacity = on ? 0.24 : 1;
      shellMat.depthWrite = !on;
      capMat.transparent = !!on;
      capMat.opacity = on ? 0.35 : 1;
      liquidMat.opacity = on ? 0.28 : 0.09;
      shellMat.needsUpdate = capMat.needsUpdate = true;
      wake();
    },

    facing,
    phase: () => phase,

    resize() {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Fit the sphere to 80% of the limiting stage dimension. The old formula
      // multiplied the camera distance by at least 1.35, shrinking every ball.
      camera.position.z = R / (0.80 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
      camera.updateProjectionMatrix();
      wake();
    },

    snapshot() {
      renderer.render(scene, camera);
      try { return renderer.domElement.toDataURL('image/png'); } catch { return null; }
    },

    dispose() {
      disposed = true;
      running = false;
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) [].concat(obj.material).forEach(m => m.dispose());
      });
      env.dispose();
      fractureTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
