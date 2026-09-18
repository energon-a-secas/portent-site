// ── Sound, synthesised ───────────────────────────────────────
// Two noises carry the whole illusion: liquid moving, and a plastic die tapping
// the inside of a window. Both are made from noise and a filter, so the site
// ships no audio files and nothing loads before the visitor asks for it.
//
// The context is created on the first shake, never at boot: a page that builds
// an AudioContext before a gesture gets a suspended one on every browser, and a
// page that makes noise unasked deserves the tab closing.

let ctx = null;
let master = null;
let noiseBuffer = null;

function ensure() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // Two seconds of white noise, reused by every sound with a different filter.
  const len = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  return !!c;
}

function noiseSource(when, duration, playbackRate = 1) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  src.playbackRate.value = playbackRate;
  src.start(when);
  src.stop(when + duration + 0.05);
  return src;
}

/** Liquid: a band of noise swelling and dying, with the band sliding down. */
export function slosh(intensity = 1) {
  if (!ensure()) return;
  unlock();
  const now = ctx.currentTime;
  const dur = 0.55 + intensity * 0.75;
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(1500 + intensity * 900, now);
  band.frequency.exponentialRampToValueAtTime(380, now + dur);
  band.Q.value = 0.85;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16 * (0.5 + intensity * 0.5), now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

  noiseSource(now, dur, 0.85 + intensity * 0.4).connect(band);
  band.connect(gain);
  gain.connect(master);
}

/** The die hitting the window: a short click over a low thud. */
export function knock(intensity = 0.6) {
  if (!ensure()) return;
  unlock();
  const now = ctx.currentTime;

  const click = ctx.createBiquadFilter();
  click.type = 'bandpass';
  click.frequency.value = 2100;
  click.Q.value = 2.4;
  const clickGain = ctx.createGain();
  clickGain.gain.setValueAtTime(0.22 * intensity, now);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
  noiseSource(now, 0.09, 1.4).connect(click);
  click.connect(clickGain);
  clickGain.connect(master);

  const thud = ctx.createOscillator();
  thud.type = 'sine';
  thud.frequency.setValueAtTime(168, now);
  thud.frequency.exponentialRampToValueAtTime(72, now + 0.16);
  const thudGain = ctx.createGain();
  thudGain.gain.setValueAtTime(0.18 * intensity, now);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
  thud.connect(thudGain);
  thudGain.connect(master);
  thud.start(now);
  thud.stop(now + 0.24);
}

/** A quiet rising pair of notes when the answer becomes readable. */
export function chime(tone = 'maybe') {
  if (!ensure()) return;
  unlock();
  const now = ctx.currentTime;
  const roots = { yes: 392, maybe: 349.2, no: 293.7 };
  const root = roots[tone] || roots.maybe;
  const steps = tone === 'no' ? [1, 0.84] : [1, 1.5];
  steps.forEach((mult, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = root * mult;
    const gain = ctx.createGain();
    const at = now + i * 0.09;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.09, at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + 0.46);
  });
}

export function setMuted(muted) {
  if (!master) return;
  master.gain.value = muted ? 0 : 0.55;
}
