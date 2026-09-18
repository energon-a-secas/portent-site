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
//   read it      the window has to be facing you, so you turn the ball over
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
import { buildEnvironment, buildBallParts, drawDieFace } from './ballart.js';
import { clamp } from './utils.js';

const TAU = Math.PI * 2;
const DIE_SUNK = -1.00;
const DIE_UP = -1.46;
const CALM = 0.55;              // rad/s below which the ball counts as still
const CALM_HOLD = 0.34;         // seconds of stillness before the die rises
const SHAKE_AGITATION = 2.6;    // the churn a shake adds, on top of its strength
const FACING_FORGIVING = 0.42;  // window this close to the camera eases the rest of the way
const DOWN = new THREE.Vector3(0, -1, 0);
const TOWARD_CAMERA = new THREE.Vector3(0, 0, 1);

// How the ball sits when nothing has touched it. The 8 is at the top pole and
// the window at the bottom, so at identity the camera sees the bare equator: a
// black sphere that could be anything. Tilting the top 36 degrees toward the
// viewer is how the toy sits on a desk, and it is what makes the thing on screen
// recognisably an eight ball before the first shake. It costs nothing afterwards,
// since a shake randomises the orientation completely.
const REST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.63);

function stub(reason) {
  return {
    supported: false, reason,
    impulse() {}, spin() {}, shake() {}, flip() {}, reset() {}, resize() {},
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
  renderer.toneMappingExposure = 1.06;
  renderer.domElement.className = 'ball-canvas';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
  camera.position.set(0, 0, 7.2);

  const env = buildEnvironment(renderer);
  scene.environment = env;

  scene.add(new THREE.HemisphereLight(0x9fb4dd, 0x131720, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-3.4, 4.2, 4.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec2ff, 0.55);
  rim.position.set(3.8, -1.6, -2.4);
  scene.add(rim);

  // pivot carries position (the idle float), ball carries orientation. Keeping
  // them apart means a bob can never leak into the physics quaternion.
  const pivot = new THREE.Group();
  const ball = new THREE.Group();
  ball.quaternion.copy(REST);
  pivot.add(ball);
  scene.add(pivot);

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
  let clock = 0;
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
      || !reduced();     // the idle float keeps one cheap frame going
  }

  function frame(now) {
    if (disposed) return;
    const dt = Math.min(0.05, (now - last) / 1000) || 0.016;
    last = now;
    clock += dt;
    step(dt);
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
      angVel.multiplyScalar(Math.exp(-2.2 * dt));
    } else {
      angVel.set(0, 0, 0);
    }

    if (flipTarget) {
      ball.quaternion.slerp(flipTarget, 1 - Math.exp(-7 * dt));
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

    if (!reduced()) {
      pivot.position.y = Math.sin(clock * 0.85) * 0.022;
      pivot.rotation.z = Math.sin(clock * 0.6) * 0.006;
    } else {
      pivot.position.y = 0;
      pivot.rotation.z = 0;
    }
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
        phase = 'awaiting-flip';
        if (opts.onNeedFlip) opts.onNeedFlip();
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
    die.rotation.y = Math.random() * TAU;   // a tumbled die does not land square
    dieTarget = DIE_UP;
    if (facing() >= FACING_FORGIVING) {
      easeToCamera();
    } else {
      phase = 'awaiting-flip';
      if (opts.onNeedFlip) opts.onNeedFlip();
    }
  }

  function easeToCamera() {
    normal.copy(DOWN).applyQuaternion(ball.quaternion);
    const align = new THREE.Quaternion().setFromUnitVectors(normal, TOWARD_CAMERA);
    flipTarget = align.multiply(ball.quaternion).normalize();
    if (reduced()) {
      ball.quaternion.copy(flipTarget);
      flipTarget = null;
      die.position.y = DIE_UP;
      reveal();
    }
    wake();
  }

  function reveal() {
    phase = 'revealed';
    if (answer && opts.onReveal) opts.onReveal(answer);
  }

  return {
    supported: true,
    reason: null,
    canvas: renderer.domElement,

    /** A drag: screen-space delta becomes a world-space spin about the camera axes. */
    impulse(dx, dy, scale = 1) {
      angVel.x += dy * 0.055 * scale;
      angVel.y += dx * 0.055 * scale;
      const cap = 26;
      if (angVel.length() > cap) angVel.setLength(cap);
      agitation += (Math.abs(dx) + Math.abs(dy)) * 0.012 * scale;
      if (phase === 'revealed' || phase === 'awaiting-flip') {
        // Touching a settled ball disturbs it. Any real shake will sink the die.
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
      liquidMat.opacity = on ? 0.28 : 0.62;
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
      // Keep the ball the same size on a tall phone as on a wide desktop: the
      // limiting dimension decides how far the camera sits.
      camera.position.z = 7.2 * Math.max(1, 1.35 / Math.min(1, camera.aspect));
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
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
