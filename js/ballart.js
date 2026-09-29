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
export const HOLE = 0.59;             // a generous window that can actually be read
export const RIM_Y = -R * Math.cos(HOLE);
export const RIM_R = R * Math.sin(HOLE);
export const WINDOW_Y = RIM_Y - 0.17; // the glass, on the underside of the collar

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
  sky.addColorStop(0, '#35405d');
  sky.addColorStop(0.48, '#20253b');
  sky.addColorStop(0.52, '#141827');
  sky.addColorStop(1, '#090b14');
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
  box(300, 120, 245, 160, 0.95);   // key light, upper left
  box(760, 175, 165, 125, 0.56);   // fill, upper right
  box(520, 470, 300, 90, 0.25);    // floor bounce

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
  bg.addColorStop(0, '#3154ba');
  bg.addColorStop(0.55, '#25449e');
  bg.addColorStop(1, '#142f77');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.fillStyle = '#f7f8ff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return canvas;
  const minSize = Math.round(W * 0.055);
  // Each lower line gets less width because the die narrows toward its tip.
  // A rectangular text box clips a phrase like "You may rely on it" at the
  // second line, even when the canvas says that the line fits.
  const widths = [[0.43], [0.52, 0.35], [0.55, 0.42, 0.27]];
  let chosen = null;
  for (let size = Math.round(W * 0.13); size >= minSize; size -= 2) {
    g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
    for (const ratios of widths) {
      if (ratios.length * size * 1.1 > H * 0.36) continue;
      const lines = fitTriangleLines(g, words, ratios.map(ratio => ratio * W));
      if (lines) {
        chosen = { lines, size };
        break;
      }
    }
    if (chosen) break;
  }
  // An imported answer can be 120 characters long. Keep its complete text in
  // the readout and show the longest legible opening on the die.
  if (!chosen) {
    g.font = `700 ${minSize}px "Helvetica Neue", Arial, sans-serif`;
    for (let count = Math.min(words.length, 8); count > 0 && !chosen; count--) {
      const preview = words.slice(0, count);
      if (count < words.length) preview[preview.length - 1] += '…';
      for (const ratios of widths) {
        const lines = fitTriangleLines(g, preview, ratios.map(ratio => ratio * W));
        if (lines) { chosen = { lines, size: minSize }; break; }
      }
    }
  }
  if (!chosen) chosen = { lines: ['Read below'], size: minSize };
  const { lines, size } = chosen;
  g.font = `700 ${size}px "Helvetica Neue", Arial, sans-serif`;
  const lineH = size * 1.1;
  const center = lines.length === 3 ? 0.60 : 0.56;
  const top = H * center - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => g.fillText(line, W * 0.5, top + i * lineH));
  return canvas;
}

function fitTriangleLines(g, words, widths, at = 0, line = 0) {
  if (line === widths.length - 1) {
    const tail = words.slice(at).join(' ');
    return tail && g.measureText(tail).width <= widths[line] ? [tail] : null;
  }
  for (let end = words.length - (widths.length - line - 1); end > at; end--) {
    const part = words.slice(at, end).join(' ');
    if (g.measureText(part).width > widths[line]) continue;
    const rest = fitTriangleLines(g, words, widths, end, line + 1);
    if (rest) return [part, ...rest];
  }
  return null;
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

/** A brief impact crack, drawn in front of the shell after a hard throw. */
export function buildFractureTexture(renderer) {
  const [c, g] = canvas2d(512, 512);
  g.save();
  g.beginPath();
  g.arc(256, 256, 236, 0, Math.PI * 2);
  g.clip();
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.shadowColor = 'rgba(153, 174, 255, 0.8)';
  g.shadowBlur = 13;
  for (let i = 0; i < 9; i++) {
    const a = i * TAU / 9 + (i % 2 ? 0.12 : -0.08);
    const path = [[256, 256]];
    for (let j = 1; j <= 4; j++) {
      const r = j * 55;
      const bend = Math.sin(i * 3.7 + j * 2.4) * 17;
      path.push([256 + Math.cos(a) * r - Math.sin(a) * bend,
        256 + Math.sin(a) * r + Math.cos(a) * bend]);
    }
    g.strokeStyle = 'rgba(222, 231, 255, 0.9)';
    g.lineWidth = i % 3 === 0 ? 3.5 : 2.2;
    g.beginPath();
    path.forEach(([x, y], j) => j ? g.lineTo(x, y) : g.moveTo(x, y));
    g.stroke();
    const [bx, by] = path[2];
    const side = i % 2 ? 1 : -1;
    g.strokeStyle = 'rgba(157, 180, 255, 0.72)';
    g.lineWidth = 1.7;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + Math.cos(a + side * 0.65) * 48, by + Math.sin(a + side * 0.65) * 48);
    g.stroke();
  }
  g.restore();
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
    color: 0x181820, roughness: 0.21, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.45
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
    new THREE.CylinderGeometry(RIM_R, RIM_R * 0.94, 0.17, 96, 1, true), blackMat
  );
  collar.material.side = THREE.DoubleSide;
  collar.position.y = RIM_Y - 0.085;
  ball.add(collar);

  const bezel = new THREE.Mesh(new THREE.RingGeometry(0.76, RIM_R * 0.94, 96), blackMat);
  bezel.rotation.x = Math.PI / 2;
  bezel.position.y = WINDOW_Y + 0.004;
  ball.add(bezel);

  const glass = new THREE.Mesh(
    new THREE.CircleGeometry(0.765, 96),
    new THREE.MeshBasicMaterial({
      color: 0xe5edff, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  glass.rotation.x = Math.PI / 2;
  glass.position.y = WINDOW_Y + 0.010;
  glass.renderOrder = 3;
  ball.add(glass);

  // ── Liquid, die, bubbles ──
  const liquidMat = new THREE.MeshBasicMaterial({
    color: 0x1d397e, transparent: true, opacity: 0.09,
    side: THREE.DoubleSide, depthWrite: false
  });
  const liquid = new THREE.Mesh(new THREE.SphereGeometry(1.50, 72, 52), liquidMat);
  liquid.renderOrder = 2;
  ball.add(liquid);

  const dieTex = buildDieFaceTexture(renderer, '');
  const die = new THREE.Mesh(
    buildDieFaceGeometry(0.72),
    new THREE.MeshBasicMaterial({ map: dieTex, side: THREE.DoubleSide })
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
