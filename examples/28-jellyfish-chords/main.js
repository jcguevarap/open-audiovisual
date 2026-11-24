// 28 · jellyfish bloom — a deep-water world that blooms on consonant chords.
//
// Performance semantics (the world listens to chord/event, never to keys):
//
//   single note       → a jellyfish rises out of the dark where the pitch sits; velocity is its size
//   consonant triad   → BLOOM: every bell swells and lights up in the chord root's colour, the whole
//                       swarm takes one stroke together, and sparks drift up from the tentacles
//   softer consonance → SHIMMER (7ths, 6ths…): a smaller glow, still in unison
//   mild dissonance   → FLINCH: bells snap shut and the swarm scatters
//   cluster           → DIM: the lights go out, bells sink, marine snow thickens; they recover slowly
//
// Everything continuous is a param (pulse rate, current, glow, colour, tentacle length, snow,
// population), so the timeline alone can perform the piece and any controller can be mapped to it.

import { createShow } from '@openav/show';
import { createCanvas } from '@openav/stage';

const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const rnd = (a, b) => a + Math.random() * (b - a);
const hsl = (h, s, l, a = 1) => `hsla(${(((h % 360) + 360) % 360).toFixed(1)},${s.toFixed(0)}%,${l.toFixed(0)}%,${clamp(a, 0, 1).toFixed(3)})`;
// shortest way round the colour wheel, so a bloom from 350° to 10° does not pass through green
const mixHue = (a, b, t) => a + ((((b - a) % 360) + 540) % 360 - 180) * t;

const LITE = Math.min(innerWidth, innerHeight) < 560 || matchMedia('(pointer:coarse)').matches;
const MAX_JELLIES = LITE ? 14 : 22;
const TENT_PTS = LITE ? 10 : 14;

// One stroke of the bell: a quick contraction (the push) and a slow relax (the glide).
// Real jellies spend most of the cycle relaxing; that is what makes them read as calm.
const stroke = (ph) => (ph < 0.28 ? Math.sin((ph / 0.28) * Math.PI / 2) : 1 - smooth((ph - 0.28) / 0.72));

class Jelly {
  constructor(x, y, size, z) {
    this.x = x; this.y = y; this.vx = rnd(-8, 8); this.vy = rnd(-14, -4);
    this.size = size; this.z = z;               // z: 0 far … 1 near (alpha, parallax, draw order)
    this.hueOff = rnd(-22, 22);
    this.phase = Math.random(); this.rate = rnd(0.8, 1.25);
    this.tilt = rnd(-0.25, 0.25); this.tiltV = 0;
    this.bloom = 0; this.bloomHue = 0; this.dim = 0; this.flinch = 0;
    this.fade = 0; this.leaving = false; this.age = 0; this.c = 0;
    const mk = (n, u, pts) => ({ u, ph: Math.random() * TAU, pts: Array.from({ length: pts }, (_, i) => ({ x, y: y + i * 2 })) });
    const nt = clamp(6 + Math.floor(size / 16), 6, 12);
    this.tents = Array.from({ length: nt }, (_, i) => mk(nt, ((i + 0.5) / nt) * 2 - 1, TENT_PTS));
    this.arms = Array.from({ length: 4 }, (_, i) => mk(4, (i - 1.5) * 0.18, Math.ceil(TENT_PTS * 0.6)));
  }

  shift(dx, dy) {
    this.x += dx; this.y += dy;
    for (const t of [...this.tents, ...this.arms]) for (const p of t.pts) { p.x += dx; p.y += dy; }
  }

  update(dt, w, T) {
    this.age += dt;
    this.fade = this.leaving ? Math.max(0, this.fade - dt / 4) : Math.min(1, this.fade + dt / 2.5);
    this.phase += dt * w.pulse * this.rate * (1 - 0.5 * this.dim);
    if (this.phase >= 1) this.phase -= 1;
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    this.bloom = Math.max(0, this.bloom - dt * 0.09);
    this.dim = Math.max(0, this.dim - dt * 0.06);
    this.c = Math.max(stroke(this.phase), this.flinch);
    // thrust only while the bell closes, along its heading
    if (this.phase < 0.28) {
      const k = this.size * 5.5 * w.pulse * (1 - 0.6 * this.dim) * dt;
      this.vx += Math.sin(this.tilt) * k; this.vy -= Math.cos(this.tilt) * k;
    }
    const drag = Math.exp(-1.6 * dt);
    this.vx = this.vx * drag + (w.current * 60 * (0.4 + 0.6 * this.z) - this.vx) * 0.25 * dt;
    this.vy = this.vy * drag + (8 + 30 * this.dim) * dt;   // a dimmed jelly stops swimming and sinks
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.tiltV += (rnd(-1, 1) * 0.6 - this.tilt * 0.8 - this.tiltV * 0.9) * dt;
    this.tilt = clamp(this.tilt + this.tiltV * dt, -0.55, 0.55);
    // tentacles: follow-the-leader chains hung from the rim, combed by the current
    const R = this.radius(), cs = Math.cos(this.tilt), sn = Math.sin(this.tilt);
    const seg = this.size * 0.2 * w.tentacle, armSeg = this.size * 0.12 * w.tentacle;
    for (const set of [this.tents, this.arms]) {
      const L = set === this.arms ? armSeg : seg;
      for (const t of set) {
        const lx = t.u * R * (set === this.arms ? 1 : 0.92), ly = 0;
        t.pts[0].x = this.x + lx * cs - ly * sn; t.pts[0].y = this.y + lx * sn + ly * cs;
        for (let i = 1; i < t.pts.length; i++) {
          const p = t.pts[i], q = t.pts[i - 1];
          p.x += (Math.sin(T * 1.7 + t.ph + i * 0.55) * this.size * 0.5 - w.current * 25) * dt;
          p.y += 30 * dt;
          let dx = p.x - q.x, dy = p.y - q.y; const d = Math.hypot(dx, dy) || 1;
          p.x = q.x + (dx / d) * L; p.y = q.y + (dy / d) * L;
        }
      }
    }
  }

  radius() { return this.size * (1 - 0.2 * this.c + 0.22 * smooth(this.bloom)); }

  draw(ctx, w, T) {
    const b = smooth(this.bloom), dim = this.dim;
    const hue = mixHue(w.hue + this.hueOff, this.bloomHue, b);
    const A = this.fade * (0.45 + 0.55 * this.z) * (1 - 0.65 * dim);
    const R = this.radius(), H = this.size * 0.78 * (1 + 0.14 * this.c - 0.08 * b);
    const lum = (0.2 + 0.8 * w.glow) * (1 - 0.8 * dim) + b * 0.9;
    // halo first, additive: the light the jelly throws into the water
    ctx.globalCompositeOperation = 'lighter';
    const gx = this.x - Math.sin(this.tilt) * H * 0.45, gy = this.y - Math.cos(this.tilt) * H * 0.45;
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, R * (2.2 + 1.4 * b));
    g.addColorStop(0, hsl(hue, 85, 60, 0.22 * lum * A)); g.addColorStop(1, hsl(hue, 85, 50, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, R * (2.2 + 1.4 * b), 0, TAU); ctx.fill();
    // tentacles: thin threads; in a bloom a light runs down each of them
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = hsl(hue, 70, 70, 0.35 * A * (0.5 + lum * 0.5)); ctx.lineWidth = Math.max(0.6, this.size * 0.018);
    ctx.beginPath();
    for (const t of this.tents) { const p = t.pts; ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2); }
    ctx.stroke();
    ctx.strokeStyle = hsl(hue + 25, 60, 65, 0.45 * A); ctx.lineWidth = Math.max(1.2, this.size * 0.07);
    ctx.beginPath();
    for (const t of this.arms) { const p = t.pts; ctx.moveTo(p[0].x, p[0].y); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y); }
    ctx.stroke();
    if (b > 0.05) {
      ctx.fillStyle = hsl(hue, 95, 80, b * A);
      for (const t of this.tents) {
        const i = Math.floor((T * 9 + t.ph * 3) % t.pts.length), p = t.pts[i];
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + this.size * 0.03, 0, TAU); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // the bell, in its own rotated frame: dome up, scalloped rim at y = 0
    ctx.save(); ctx.translate(this.x, this.y); ctx.rotate(this.tilt);
    const body = ctx.createLinearGradient(0, -H, 0, 0);
    body.addColorStop(0, hsl(hue, 70, 30 + 45 * lum, 0.55 * A));
    body.addColorStop(1, hsl(hue, 80, 25 + 30 * lum, 0.18 * A));
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.moveTo(-R, 0);
    ctx.bezierCurveTo(-R, -H * 1.1, R, -H * 1.1, R, 0);
    const lobes = 8;
    for (let k = lobes; k > 0; k--) {
      const x0 = R * ((k / lobes) * 2 - 1), x1 = R * (((k - 1) / lobes) * 2 - 1);
      ctx.quadraticCurveTo((x0 + x1) / 2, H * 0.12 * (1 - 0.6 * this.c), x1, 0);
    }
    ctx.fill();
    ctx.strokeStyle = hsl(hue, 80, 60 + 25 * lum, 0.5 * A); ctx.lineWidth = 1; ctx.stroke();
    // four gonads: the clover inside the bell, brightest part of a blooming jelly
    ctx.fillStyle = hsl(hue + 40, 85, 45 + 35 * lum, 0.5 * A);
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.ellipse((k - 1.5) * R * 0.22, -H * 0.42, R * 0.1, H * 0.16, (k - 1.5) * 0.35, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
}

const jellyWorld = {
  name: 'jellyfish',
  params: [
    { key: 'pulse',      label: 'Pulse rate',  min: 0.15, max: 2,   def: 0.6 },    // strokes per second
    { key: 'current',    label: 'Current',     min: -1,   max: 1,   def: 0.1 },
    { key: 'glow',       label: 'Glow',        min: 0,    max: 1,   def: 0.45 },
    { key: 'hue',        label: 'Colour',      min: 0,    max: 360, def: 195 },
    { key: 'tentacle',   label: 'Tentacles',   min: 0.3,  max: 1.8, def: 1 },
    { key: 'snow',       label: 'Marine snow', min: 0,    max: 1,   def: 0.35 },
    { key: 'population', label: 'Population',  min: 2,    max: 18,  def: 7, step: 1 },
    { key: 'bloom',      label: 'Bloom!',      pulse: true },
  ],

  init({ container, signals, params }) {
    this.view = createCanvas(container);
    this.jellies = []; this.sparks = []; this.T = 0; this.s = {}; this.spawnIn = 0; this.snowBoost = 0;
    this.snow = Array.from({ length: LITE ? 120 : 260 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), ph: Math.random() * TAU }));
    const { w, h } = this.view.fit();
    for (let i = 0; i < 5; i++) this.spawn(rnd(0.1, 0.9) * w, rnd(0.3, 0.9) * h, rnd(26, 52)).fade = 1;
    this._unsubs = [
      signals.on('chord/event', (a) => this.onChord(a)),
      params.onPulse('bloom', () => this.bloomAll(Math.floor(Math.random() * 12), 0.9)),
    ];
  },

  spawn(x, y, size) {
    const z = Math.random();
    const j = new Jelly(x, y, size * (0.6 + 0.4 * z), z);
    this.jellies.push(j);
    const alive = this.jellies.filter((q) => !q.leaving);
    if (alive.length > MAX_JELLIES) alive.reduce((m, q) => (q.age > m.age ? q : m)).leaving = true;
    return j;
  },

  bloomAll(root, vel) {
    const base = ((this.s.hue ?? 195) + 140 + (root % 12) * 30) % 360;
    for (const j of this.jellies) {
      j.bloom = 1; j.bloomHue = base + rnd(-18, 18); j.dim *= 0.2;
      j.phase = 0;   // one stroke together: a swarm in unison reads as a single body
      for (let i = 0; i < (LITE ? 3 : 6) * vel; i++) {
        const t = j.tents[(Math.random() * j.tents.length) | 0], p = t.pts[(Math.random() * t.pts.length) | 0];
        this.sparks.push({ x: p.x, y: p.y, vx: rnd(-10, 10), vy: rnd(-40, -15), life: 1, h: j.bloomHue });
      }
    }
  },

  onChord(a) {
    const { w, h } = this.view.fit();
    const vel = a.vel ?? 0.7, root = a.root ?? 60;
    if (a.count === 1) {
      const x = clamp(((root - 36) / 60) * w, w * 0.05, w * 0.95);
      this.spawn(x, h * rnd(0.75, 0.95), 20 + vel * 50);
    } else if (a.isTriad && a.thirdsFraction > 0.5) {
      this.bloomAll(root, vel);
      this.spawn(clamp(((root - 36) / 60) * w, w * 0.05, w * 0.95), h * 0.9, 18 + vel * 20);
    } else if (a.dissonanceLevel === 2) {
      for (const j of this.jellies) { j.dim = Math.min(1, j.dim + 0.55 + 0.3 * vel); j.flinch = 1; j.bloom *= 0.3; }
      this.snowBoost = 1;
    } else if (a.dissonanceLevel === 1) {
      for (const j of this.jellies) {
        j.flinch = 1; j.tiltV += rnd(-2, 2);
        const away = Math.sign(j.x - w / 2) || 1; j.vx += away * rnd(20, 50); j.vy += rnd(-20, 10);
      }
    } else if (a.isConsonant) {
      for (const j of this.jellies) { j.bloom = Math.max(j.bloom, 0.4); j.bloomHue = ((this.s.hue ?? 195) + 140 + (root % 12) * 30) % 360; j.phase = 0; }
    }
  },

  update(dt, s) {
    dt = Math.min(dt, 0.1);
    this.s = s; this.T += dt;
    const { w, h } = this.view.fit();
    const W = { pulse: s.pulse ?? 0.6, current: s.current ?? 0.1, tentacle: s.tentacle ?? 1 };
    for (const j of this.jellies) {
      j.update(dt, W, this.T);
      const m = j.size * 3;
      if (j.y < -m) j.shift(0, h + 2 * m);   // out the top → back in from the deep
      else if (j.y > h + m) j.shift(0, -(h + 2 * m));
      if (j.x < -m) j.shift(w + 2 * m, 0); else if (j.x > w + m) j.shift(-(w + 2 * m), 0);
    }
    // population: the param is how many drift by on their own; extras from notes leave after a while
    const alive = this.jellies.filter((j) => !j.leaving), target = Math.round(s.population ?? 7);
    this.spawnIn -= dt;
    if (alive.length < target && this.spawnIn <= 0) { this.spawn(rnd(0.05, 0.95) * w, h + 40, rnd(24, 56)); this.spawnIn = 1.2; }
    if (alive.length > target) { const old = alive.filter((j) => j.age > 25); if (old.length) old.reduce((m, j) => (j.age > m.age ? j : m)).leaving = true; }
    this.jellies = this.jellies.filter((j) => !(j.leaving && j.fade <= 0));
    this.snowBoost = Math.max(0, this.snowBoost - dt * 0.1);
    for (const p of this.sparks) { p.life -= dt * 0.35; p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= 1 - dt * 0.4; }
    this.sparks = this.sparks.filter((p) => p.life > 0);
  },

  background(w, h) {
    if (this._bg && this._bg.w === w && this._bg.h === h) return this._bg.c;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    const sea = x.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, '#06243a'); sea.addColorStop(0.45, '#03111f'); sea.addColorStop(1, '#010408');
    x.fillStyle = sea; x.fillRect(0, 0, w, h);
    // light shafts from the surface, fading with depth
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const cx = w * (0.1 + i * 0.16), spread = w * 0.05;
      const g = x.createLinearGradient(0, 0, 0, h * 0.75);
      g.addColorStop(0, 'rgba(120,190,230,0.07)'); g.addColorStop(1, 'rgba(120,190,230,0)');
      x.fillStyle = g; x.beginPath();
      x.moveTo(cx - spread * 0.4, 0); x.lineTo(cx + spread * 0.4, 0); x.lineTo(cx + spread * 2.6 - w * 0.08, h * 0.75); x.lineTo(cx - spread * 0.6 - w * 0.08, h * 0.75);
      x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    this._bg = { w, h, c };
    return c;
  },

  render() {
    const { ctx } = this.view, { w, h } = this.view.fit(), s = this.s || {};
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.background(w, h), 0, 0, w, h);
    const D = { hue: s.hue ?? 195, glow: s.glow ?? 0.45 };
    // marine snow: falling organic specks; a cluster makes it thicker for a while
    const ns = Math.round(this.snow.length * clamp((s.snow ?? 0.35) + this.snowBoost * 0.6, 0, 1));
    ctx.fillStyle = 'rgba(200,220,230,0.35)';
    for (let i = 0; i < ns; i++) {
      const p = this.snow[i];
      const y = ((p.y + this.T * (0.008 + 0.02 * p.z)) % 1) * h, x = ((p.x + Math.sin(this.T * 0.3 + p.ph) * 0.01 + this.T * (s.current ?? 0) * 0.01 * p.z) % 1 + 1) % 1 * w;
      const r = 0.5 + p.z * 1.3; ctx.fillRect(x, y, r, r);
    }
    for (const j of this.jellies.slice().sort((a, b) => a.z - b.z)) j.draw(ctx, D, this.T);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.sparks) { ctx.fillStyle = hsl(p.h, 90, 75, p.life * 0.8); ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
  },

  dispose() { this._unsubs?.forEach((u) => u()); this.view.dispose(); },
};

await createShow({
  world: jellyWorld,
  timeline: {
    total: 120,
    automation: {
      population: [[0, 3], [30, 7], [60, 12], [90, 10], [120, 4]],
      pulse:      [[0, 0.35], [30, 0.6], [60, 0.9], [90, 1.4], [110, 0.4]],
      glow:       [[0, 0.2], [60, 0.75], [90, 0.3], [120, 0.15]],
      current:    [[0, 0.05], [60, 0.2], [90, -0.6], [120, 0]],
      snow:       [[0, 0.2], [90, 0.8], [120, 0.3]],
    },
    scenes: [
      { id: 'abyss', t: 0,   title: 'Abyss',  note: 'single notes · one jelly each' },
      { id: 'swarm', t: 30,  title: 'Swarm',  note: 'more of them drift in' },
      { id: 'bloom', t: 60,  title: 'Bloom',  note: 'triads — every bell lights at once' },
      { id: 'storm', t: 90,  title: 'Storm',  note: 'tritones flinch · clusters put the lights out' },
      { id: 'after', t: 110, title: 'After',  note: 'let them recover' },
    ],
  },
  modules: { keys: { base: 48 }, chord: true, sound: true },
  hint: 'one NOTE → a jellyfish rises · a TRIAD → the swarm blooms · a tritone → they flinch · a CLUSTER → the lights go out<br>use the piano, tick "keyboard" for QWERTY, or "simulate performance" · Space plays the timeline',
});
