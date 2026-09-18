// ── The ball's art, generated at runtime ─────────────────────
// Every surface here is drawn with canvas or built from a primitive, so the
// site ships no model, no font file and no texture. That is deliberate: the
// only asset weight Portent adds over a static page is three.js itself.
//
// Anatomy of the real toy, which is what these builders reproduce:
//
//   a glossy black shell with a flat white "8" cap at the top
//   a hole at the bottom, housed in a raised black collar
//   a clear window in that collar
//   dark blue alcohol behind the window
//   a twenty-sided die floating in it, white letters on a blue face

import * as THREE from '../vendor/three/three.module.min.js';   // by path, see js/ball3d.js

export const R = 1.6;                 // shell radius, the unit everything else uses
export const HOLE = 0.42;             // polar angle of the opening at the south pole
export const RIM_Y = -R * Math.cos(HOLE);
export const RIM_R = R * Math.sin(HOLE);
export const WINDOW_Y = RIM_Y - 0.20; // the glass, on the underside of the collar

/** A canvas at device-sane resolution, returned with its 2D context. */
function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function asTexture(canvas, renderer) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 1;
  return tex;
}

/**
 * The studio the shell reflects. Two soft boxes and a floor bounce, painted
 * into an equirectangular canvas and run through PMREM. Without this the shell
 * is a flat black circle: the highlights are what make it read as plastic.
 */
export function buildEnvironment(renderer) {
  const [c, g] = canvas2d(1024, 512);
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#26304a');
  sky.addColorStop(0.48, '#141a2b');
  sky.addColorStop(0.52, '#0a0e18');
  sky.addColorStop(1, '#05070d');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);

  const box = (cx, cy, rx, ry, alpha) => {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry));
    grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.32})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.save();
    g.translate(cx, cy);
    g.scale(1, ry / rx);
    g.translate(-cx, -cy);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, rx, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  box(300, 120, 210, 130, 0.95);   // key light, upper left
  box(760, 175, 130, 95, 0.42);    // fill, upper right
  box(520, 470, 300, 90, 0.16);    // floor bounce

  const tex = asTexture(c, renderer);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/**
 * The numeral, on transparency. The white circle it sits in is a spherical cap
 * of real geometry rather than part of this texture: a flat disc wide enough to
 * read as the cap would either float above the shell at its rim or sink inside
 * it at the centre, and the numeral alone is small enough that neither shows.
 */
export function buildEightTexture(renderer) {
  const [c, g] = canvas2d(512, 512);
  g.fillStyle = '#0b0b0d';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 430px Georgia, "Times New Roman", serif';
  g.fillText('8', 256, 268);
  const tex = asTexture(c, renderer);
  tex.premultiplyAlpha = false;
  return tex;
}

/**
 * One die face: blue plastic with the answer in white. Text is wrapped into the
 * inscribed area of the triangle, then shrunk until it fits, because a deck
 * imported from somebody's task list has lines nothing like "Yes".
 */
export function drawDieFace(canvas, text) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  g.clearRect(0, 0, W, H);

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#1c3a86');
  bg.addColorStop(0.55, '#132a63');
  bg.addColorStop(1, '#0d1e4c');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  // Moulding marks: the face is not flat plastic, it has a shallow bevel.
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = W * 0.012;
  g.beginPath();
  g.moveTo(W * 0.5, H * 0.10);
  g.lineTo(W * 0.93, H * 0.86);
  g.lineTo(W * 0.07, H * 0.86);
  g.closePath();
  g.stroke();

  g.fillStyle = '#f2f6ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const boxW = W * 0.58;
  for (let size = Math.round(W * 0.115); size >= Math.round(W * 0.035); size -= 2) {
    g.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
    const lines = wrap(g, String(text || ''), boxW);
    const lineH = size * 1.16;
    if (lines.length * lineH > H * 0.36 && size > W * 0.036) continue;
    const top = H * 0.62 - ((lines.length - 1) * lineH) / 2;
    lines.forEach((line, i) => g.fillText(line, W * 0.5, top + i * lineH));
    break;
  }
  return canvas;
}

function wrap(g, text, maxWidth) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

export function buildDieFaceTexture(renderer, text) {
  const [c] = canvas2d(768, 768);
  drawDieFace(c, text);
  const tex = asTexture(c, renderer);
  tex.userData.canvas = c;
  return tex;
}

/**
 * The rounded triangle the answer is printed on, with UVs remapped into 0..1.
 * ShapeGeometry hands back the raw shape coordinates as UVs, which would tile
 * the face texture instead of fitting it once.
 */
export function buildDieFaceGeometry(radius = 0.46, corner = 0.07) {
  const shape = new THREE.Shape();
  const pts = [0, 1, 2].map(i => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return new THREE.Vector2(Math.cos(a) * radius, Math.sin(a) * radius);
  });
  shape.moveTo(pts[0].x, pts[0].y);
  for (let i = 0; i < 3; i++) {
    const from = pts[i], to = pts[(i + 1) % 3];
    const dir = to.clone().sub(from).normalize();
    shape.lineTo(to.x - dir.x * corner, to.y - dir.y * corner);
    const after = pts[(i + 2) % 3];
    const outDir = after.clone().sub(to).normalize();
    shape.quadraticCurveTo(to.x, to.y, to.x + outDir.x * corner, to.y + outDir.y * corner);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape, 24);
  const uv = geo.attributes.uv;
  const span = radius * 2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + radius) / span, (uv.getY(i) + radius * 0.9) / span);
  }
  uv.needsUpdate = true;
  return geo;
}

/** A soft round sprite, for the bubbles in the liquid. */
export function buildBubbleTexture(renderer) {
  const [c, g] = canvas2d(64, 64);
  const grad = g.createRadialGradient(32, 28, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.35, 'rgba(206,226,255,0.42)');
  grad.addColorStop(1, 'rgba(150,190,255,0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(32, 32, 32, 0, Math.PI * 2);
  g.fill();
  return asTexture(c, renderer);
}

// ── The ball's parts ─────────────────────────────────────────
// Every mesh, material and texture inside the shell, assembled onto `ball` and
// handed back so js/ball3d.js can move them. It builds the object and nothing
// else: what the die does, and when, belongs to the phase machine there.

const TAU = Math.PI * 2;
const BUBBLES = 70;

/**
 * @param {THREE.WebGLRenderer} renderer  for the canvas-backed textures
 * @param {THREE.Group} ball              the group everything is parented to
 * @param {number} dieRestY               where the die sits before it rises
 */
export function buildBallParts(renderer, ball, dieRestY) {
  // ── Shell, open at the south pole so the window looks into the liquid ──
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: 0x08080a, roughness: 0.17, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.15
  });
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(R, 112, 72, 0, TAU, 0, Math.PI - HOLE), shellMat
  );
  shell.material.side = THREE.FrontSide;
  ball.add(shell);

  // The white "8" cap: real geometry hugging the shell, with the numeral as a
  // small decal disc at the apex.
  const capMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f2ee, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08
  });
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(R + 0.004, 80, 26, 0, TAU, 0, Math.asin(0.56 / R)), capMat
  );
  ball.add(cap);
  const eight = new THREE.Mesh(
    new THREE.CircleGeometry(0.30, 64),
    new THREE.MeshBasicMaterial({ map: buildEightTexture(renderer), transparent: true, depthWrite: false })
  );
  eight.rotation.x = -Math.PI / 2;
  eight.position.y = R + 0.008;
  ball.add(eight);

  // ── Window housing: collar, bezel, glass ──
  const blackMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, roughness: 0.5, metalness: 0 });
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(RIM_R, RIM_R * 0.94, 0.20, 96, 1, true), blackMat
  );
  collar.material.side = THREE.DoubleSide;
  collar.position.y = RIM_Y - 0.10;
  ball.add(collar);

  const bezel = new THREE.Mesh(new THREE.RingGeometry(0.50, RIM_R * 0.94, 96), blackMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = WINDOW_Y + 0.004;
  ball.add(bezel);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.505, 96),
    new THREE.MeshPhysicalMaterial({
      color: 0xdce8ff, transparent: true, opacity: 0.28, roughness: 0.04,
      metalness: 0, transmission: 0.85, thickness: 0.25, ior: 1.48,
      clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false
    })
  );
  glass.rotation.x = Math.PI / 2;
  glass.position.y = WINDOW_Y + 0.010;
  glass.renderOrder = 3;
  ball.add(glass);

  // ── Liquid, die, bubbles ──
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: 0x0e2050, transparent: true, opacity: 0.62, roughness: 0.35,
    side: THREE.DoubleSide, depthWrite: false
  });
  const liquid = new THREE.Mesh(new THREE.SphereGeometry(1.50, 72, 52), liquidMat);
  liquid.renderOrder = 2;
  ball.add(liquid);

  const dieTex = buildDieFaceTexture(renderer, '');
  const die = new THREE.Mesh(
    buildDieFaceGeometry(0.46),
    new THREE.MeshStandardMaterial({ map: dieTex, roughness: 0.34, metalness: 0, side: THREE.DoubleSide })
  );
  die.rotation.x = Math.PI / 2;
  die.position.y = dieRestY;
  die.renderOrder = 1;
  ball.add(die);

  // The rest of the die, glimpsed as a silhouette while the liquid is churning.
  const hull = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.44, 0),
    new THREE.MeshStandardMaterial({ color: 0x16306e, roughness: 0.5, transparent: true, opacity: 0.55 })
  );
  hull.renderOrder = 1;
  ball.add(hull);

  const bubblePos = new Float32Array(BUBBLES * 3);
  const bubbleSeed = new Float32Array(BUBBLES);

  function seedBubble(i, height) {
    const a = Math.random() * TAU;
    const r = Math.sqrt(Math.random()) * 0.85;
    bubblePos[i * 3] = Math.cos(a) * r;
    bubblePos[i * 3 + 1] = -1.35 + height * 2.5;
    bubblePos[i * 3 + 2] = Math.sin(a) * r;
    bubbleSeed[i] = 0.35 + Math.random() * 0.9;
  }

  for (let i = 0; i < BUBBLES; i++) seedBubble(i, Math.random());
  const bubbleGeo = new THREE.BufferGeometry();
  bubbleGeo.setAttribute('position', new THREE.BufferAttribute(bubblePos, 3));
  const bubbles = new THREE.Points(bubbleGeo, new THREE.PointsMaterial({
    map: buildBubbleTexture(renderer), size: 0.075, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  }));
  bubbles.renderOrder = 2;
  ball.add(bubbles);

  /** Float the bubbles up one frame's worth, recycling the ones off the top. */
  function stirBubbles(dt, life) {
    for (let i = 0; i < BUBBLES; i++) {
      bubblePos[i * 3 + 1] += bubbleSeed[i] * dt * (0.4 + life);
      if (bubblePos[i * 3 + 1] > 1.15) seedBubble(i, 0);
    }
    bubbleGeo.attributes.position.needsUpdate = true;
  }

  return { die, hull, bubbles, dieTex, shellMat, capMat, liquidMat, stirBubbles };
}
