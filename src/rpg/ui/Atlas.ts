import { h } from '../../ui/dom';
import type { Input } from '../../core/Input';
import { CELL, type WorldGen } from '../world/WorldGen';
import { SAMP, TILE } from './atlasTile';

/**
 * The atlas: the whole endless country as a surveyor's map, drawn from the
 * same generator that builds the world (so it can't disagree with it).
 * Relief shaded from the north-west, water, forest, towns, the roads as
 * lines on top. Where you haven't been is under a paper veil; settlements
 * there are unnamed until you've seen them. You, your jobs, the story and a
 * pin you can drop, which the compass then follows.
 *
 * North is up (−z). Tiles are drawn a few at a time and cached per zoom.
 */

export interface AtlasHooks {
  gen: WorldGen;
  pos(): { x: number; z: number };
  facing(): number;
  /** have you been near this 400 m cell? */
  seen(i: number, j: number): boolean;
  visited(): { name: string; x: number; z: number; kind: string }[];
  goals(): { x: number; z: number; label: string; kind: 'job' | 'story' }[];
  waypoint(): { x: number; z: number } | null;
  setWaypoint(p: { x: number; z: number } | null): void;
}

/** Fog cells, metres. */
export const SEEN_CELL = 400;
const MIN_MPP = 2, MAX_MPP = 96;


export class Atlas {
  el: HTMLElement;
  private base: HTMLCanvasElement;
  private cx: CanvasRenderingContext2D;
  private fog = document.createElement('canvas');
  private tiles = new Map<string, HTMLCanvasElement>();
  /** the land is drawn in a worker, a few tiles at a time */
  private worker: Worker | null = null;
  private asked = new Set<string>();
  private view = { x: 0, z: 0, mpp: 10 };
  private raf = 0;
  private open = false;
  private drag: { x: number; y: number; vx: number; vz: number; moved: boolean } | null = null;
  private scale: HTMLElement;
  private readout: HTMLElement;

  constructor(private hk: AtlasHooks) {
    this.base = h('canvas', { class: 'atlas__map', tabindex: '0', 'aria-label': 'Map' }) as HTMLCanvasElement;
    this.cx = this.base.getContext('2d')!;
    this.scale = h('span', { class: 'atlas__scale meta' });
    this.readout = h('span', { class: 'atlas__readout meta' });
    this.el = h(
      'div',
      { class: 'atlas' },
      h('div', { class: 'atlas__frame' }, this.base, h('span', { class: 'atlas__cross', 'aria-hidden': 'true' }), h('span', { class: 'atlas__north meta', 'aria-hidden': 'true' }, 'N')),
      h('div', { class: 'atlas__foot' }, this.scale, this.readout, h('span', { class: 'atlas__keys meta' }, h('span', { class: 'kbm-only' }, 'Drag / arrows: move · Wheel / + −: zoom · Click / Enter: pin · C: you'), h('span', { class: 'pad-only' }, 'Stick: move · LT / RT: zoom · A: pin · X: clear pin · Y: you'))),
    );
    // mouse: drag to move, wheel to zoom, a click (without dragging) drops the pin there
    this.base.addEventListener('pointerdown', (e) => {
      this.base.setPointerCapture(e.pointerId);
      this.drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vz: this.view.z, moved: false };
    });
    this.base.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) this.drag.moved = true;
      this.view.x = this.drag.vx - dx * this.view.mpp;
      this.view.z = this.drag.vz - dy * this.view.mpp;
    });
    this.base.addEventListener('pointerup', (e) => {
      if (this.drag && !this.drag.moved) {
        const r = this.base.getBoundingClientRect();
        this.pin(this.view.x + (e.clientX - r.left - r.width / 2) * this.view.mpp, this.view.z + (e.clientY - r.top - r.height / 2) * this.view.mpp);
      }
      this.drag = null;
    });
    this.base.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.zoom(e.deltaY > 0 ? 1.25 : 0.8);
    }, { passive: false });
  }

  show() {
    if (this.open) return;
    this.open = true;
    const p = this.hk.pos();
    this.view.x = p.x;
    this.view.z = p.z;
    const loop = () => {
      if (!this.open) return;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide() {
    this.open = false;
    this.asked.clear();
    cancelAnimationFrame(this.raf);
  }

  get isOpen() {
    return this.open && this.el.isConnected;
  }

  /** Stick, triggers, keys. Returns true if it used the input (so the menu doesn't also move focus). */
  input(dt: number, input: Input): boolean {
    if (!this.isOpen) return false;
    let used = false;
    let mx = 0, mz = 0, zoom = 0;
    const p = input.isPad ? input.pad : null;
    if (p) {
      const ax = p.axes[0] ?? 0, ay = p.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.18) (mx += ax), (mz += ay);
      if (p.held('Left')) mx -= 1;
      if (p.held('Right')) mx += 1;
      if (p.held('Up')) mz -= 1;
      if (p.held('Down')) mz += 1;
      zoom += p.value('LT') - p.value('RT');
      if (p.pressed('A')) (this.pin(this.view.x, this.view.z), (used = true));
      if (p.pressed('X')) (this.hk.setWaypoint(null), (used = true));
      if (p.pressed('Y')) (this.recentre(), (used = true));
    } else {
      const k = (c: string) => input.isDown(c);
      if (k('ArrowLeft') || k('KeyA')) mx -= 1;
      if (k('ArrowRight') || k('KeyD')) mx += 1;
      if (k('ArrowUp') || k('KeyW')) mz -= 1;
      if (k('ArrowDown') || k('KeyS')) mz += 1;
      if (k('Equal') || k('NumpadAdd') || k('KeyE')) zoom -= 1;
      if (k('Minus') || k('NumpadSubtract') || k('KeyQ')) zoom += 1;
      if (input.consume('Enter')) (this.pin(this.view.x, this.view.z), (used = true));
      if (input.consume('KeyC')) (this.recentre(), (used = true));
    }
    if (mx || mz) {
      const sp = 520 * this.view.mpp * dt;
      this.view.x += mx * sp;
      this.view.z += mz * sp;
      used = true;
    }
    if (Math.abs(zoom) > 0.05) {
      this.zoom(Math.pow(2, zoom * dt * 1.6));
      used = true;
    }
    return used;
  }

  private zoom(k: number) {
    this.view.mpp = Math.min(MAX_MPP, Math.max(MIN_MPP, this.view.mpp * k));
  }

  private recentre() {
    const p = this.hk.pos();
    this.view.x = p.x;
    this.view.z = p.z;
  }

  private pin(x: number, z: number) {
    const w = this.hk.waypoint();
    // pinning the pin again takes it away
    if (w && Math.hypot(w.x - x, w.z - z) < 14 * this.view.mpp) this.hk.setWaypoint(null);
    else this.hk.setWaypoint({ x, z });
  }

  /* ── drawing ─────────────────────────────────────────── */

  private draw() {
    const c = this.base, g = this.cx;
    const r = c.getBoundingClientRect();
    const W = Math.max(64, Math.round(r.width)), H = Math.max(64, Math.round(r.height));
    if (c.width !== W || c.height !== H) (c.width = W), (c.height = H);
    const { x: vx, z: vz, mpp } = this.view;
    const x0 = vx - (W / 2) * mpp, z0 = vz - (H / 2) * mpp;
    const sx = (x: number) => (x - x0) / mpp, sy = (z: number) => (z - z0) / mpp;
    g.fillStyle = '#d9d0ba';
    g.fillRect(0, 0, W, H);

    // ── the land: tiles at the power-of-two scale at or below this one
    const lv = Math.max(1, Math.pow(2, Math.floor(Math.log2(mpp))));
    const tw = TILE * lv;
    g.imageSmoothingEnabled = true;
    const missing: [number, number, string, number][] = [];
    for (let tj = Math.floor(z0 / tw); tj * tw < z0 + H * mpp; tj++) for (let ti = Math.floor(x0 / tw); ti * tw < x0 + W * mpp; ti++) {
      const key = `${lv}|${ti}|${tj}`;
      const t = this.tiles.get(key);
      if (!t) missing.push([ti, tj, key, Math.hypot(ti * tw + tw / 2 - vx, tj * tw + tw / 2 - vz)]);
      const dx = sx(ti * tw), dy = sy(tj * tw), ds = tw / mpp;
      if (t) g.drawImage(t, dx, dy, ds + 0.5, ds + 0.5);
      else {
        // (a coarser tile, if there is one, until this one is drawn)
        const lc = lv * 2, tc = TILE * lc;
        const ci = Math.floor((ti * tw) / tc), cj = Math.floor((tj * tw) / tc);
        const ct = this.tiles.get(`${lc}|${ci}|${cj}`);
        if (ct) {
          const ox = ((ti * tw - ci * tc) / tc) * SAMP, oy = ((tj * tw - cj * tc) / tc) * SAMP;
          g.drawImage(ct, ox, oy, SAMP / 2, SAMP / 2, dx, dy, ds + 0.5, ds + 0.5);
        }
      }
    }

    // (the tiles nearest the middle of the view are drawn first)
    missing.sort((a, b) => a[3] - b[3]);
    for (const [ti, tj, key] of missing.slice(0, 3)) this.ask(lv, ti, tj, key);

    // ── roads, as lines (they'd vanish in the tiles when zoomed out)
    const roads = new Map<string, { kind: string; pts: Float64Array; width: number }>();
    for (let z = z0 - CELL; z < z0 + H * mpp + CELL; z += CELL) for (let x = x0 - CELL; x < x0 + W * mpp + CELL; x += CELL) for (const rd of this.hk.gen.roadsNear(x, z)) roads.set(rd.id, rd);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pass of [0, 1]) for (const rd of roads.values()) {
      const wpx = Math.max(rd.kind === 'highway' ? 2.4 : rd.kind === 'road' ? 1.6 : 1, rd.width / mpp);
      g.strokeStyle = pass === 0 ? 'rgba(40,32,24,.55)' : rd.kind === 'highway' ? '#c9804a' : rd.kind === 'road' ? '#e8d9a8' : '#b8a888';
      g.lineWidth = pass === 0 ? wpx + 1.6 : wpx;
      if (rd.kind === 'track') g.setLineDash(pass ? [4, 3] : []);
      g.beginPath();
      for (let i = 0; i < rd.pts.length; i += 2) {
        const px = sx(rd.pts[i]), py = sy(rd.pts[i + 1]);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // ── the veil over where you haven't been (one pixel per fog cell, smoothed as it's stretched)
    const fi0 = Math.floor(x0 / SEEN_CELL) - 1, fj0 = Math.floor(z0 / SEEN_CELL) - 1;
    const fw = Math.ceil((W * mpp) / SEEN_CELL) + 3, fh = Math.ceil((H * mpp) / SEEN_CELL) + 3;
    if (fw * fh < 250000) {
      if (this.fog.width !== fw || this.fog.height !== fh) (this.fog.width = fw), (this.fog.height = fh);
      const fx = this.fog.getContext('2d')!;
      const img = fx.createImageData(fw, fh);
      for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
        const k = (j * fw + i) * 4;
        img.data[k] = 222;
        img.data[k + 1] = 212;
        img.data[k + 2] = 188;
        img.data[k + 3] = this.hk.seen(fi0 + i, fj0 + j) ? 0 : 168;
      }
      fx.putImageData(img, 0, 0);
      g.drawImage(this.fog, sx(fi0 * SEEN_CELL), sy(fj0 * SEEN_CELL), (fw * SEEN_CELL) / mpp, (fh * SEEN_CELL) / mpp);
    }

    // ── settlements: marks where you've seen them, names where you've been
    const visited = new Map(this.hk.visited().map((v) => [`${Math.round(v.x)},${Math.round(v.z)}`, v]));
    g.textAlign = 'center';
    for (let cj = Math.floor(z0 / CELL) - 1; cj * CELL < z0 + H * mpp + CELL; cj++) for (let ci = Math.floor(x0 / CELL) - 1; ci * CELL < x0 + W * mpp + CELL; ci++) {
      const s = this.hk.gen.settlement(ci, cj);
      if (s.kind === 'junction') continue;
      if (!this.hk.seen(Math.floor(s.x / SEEN_CELL), Math.floor(s.z / SEEN_CELL))) continue;
      const px = sx(s.x), py = sy(s.z);
      if (px < -80 || py < -40 || px > W + 80 || py > H + 40) continue;
      const big = s.kind === 'city' ? 7 : s.kind === 'town' ? 5 : 3.5;
      const rpx = Math.max(big, s.radius / mpp);
      // the town's extent, faintly; a dot (or a square for a base) at its heart
      g.fillStyle = s.kind === 'ruin' ? 'rgba(90,70,60,.12)' : 'rgba(60,48,40,.1)';
      g.strokeStyle = 'rgba(42,33,26,.45)';
      g.lineWidth = 1;
      g.setLineDash(s.kind === 'ruin' ? [3, 3] : []);
      g.beginPath();
      g.arc(px, py, rpx, 0, Math.PI * 2);
      g.fill();
      if (rpx > big + 2) g.stroke();
      g.setLineDash([]);
      g.fillStyle = s.kind === 'ruin' ? '#6a5a4a' : '#2a211a';
      g.strokeStyle = 'rgba(231,224,207,.9)';
      g.lineWidth = 1.5;
      g.beginPath();
      if (s.kind === 'military') g.rect(px - big * 0.7, py - big * 0.7, big * 1.4, big * 1.4);
      else g.arc(px, py, big * 0.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const been = visited.get(`${Math.round(s.x)},${Math.round(s.z)}`);
      const showName = been || s.kind === 'city' || mpp < 24;
      if (showName) {
        const size = s.kind === 'city' ? 17 : s.kind === 'town' ? 14 : 12;
        g.font = `${s.kind === 'city' ? '600 ' : 'italic '}${size}px "Cormorant Garamond", Georgia, serif`;
        g.lineWidth = 3.5;
        g.strokeStyle = 'rgba(231,224,207,.92)';
        const label = s.kind === 'ruin' ? `${s.name} (ruin)` : s.name;
        g.strokeText(label, px, py - big - 6);
        g.fillStyle = been ? '#1f1c17' : '#5a5346';
        g.fillText(label, px, py - big - 6);
      }
    }

    // ── what you're after: jobs (diamonds), the story (a star), your pin
    for (const q of this.hk.goals()) {
      const px = sx(q.x), py = sy(q.z);
      const cl = edge(px, py, W, H);
      g.fillStyle = q.kind === 'story' ? '#9a2f22' : '#b07a1a';
      g.strokeStyle = '#1f1c17';
      g.lineWidth = 1.5;
      g.beginPath();
      if (q.kind === 'story') star(g, cl.x, cl.y, 8);
      else g.moveTo(cl.x, cl.y - 8), g.lineTo(cl.x + 6, cl.y), g.lineTo(cl.x, cl.y + 8), g.lineTo(cl.x - 6, cl.y), g.closePath();
      g.fill();
      g.stroke();
      if (!cl.off) label(g, q.label, cl.x, cl.y + 20, 12);
    }
    const w = this.hk.waypoint();
    if (w) {
      const cl = edge(sx(w.x), sy(w.z), W, H);
      g.fillStyle = '#2a5a8a';
      g.strokeStyle = '#10202e';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(cl.x, cl.y - 12, 6, Math.PI, 0);
      g.lineTo(cl.x, cl.y);
      g.closePath();
      g.fill();
      g.stroke();
    }
    // ── you: an arrow the way you're facing
    const p = this.hk.pos();
    const me = edge(sx(p.x), sy(p.z), W, H);
    const f = this.hk.facing();
    const fx2 = Math.sin(f), fy = Math.cos(f);
    g.save();
    g.translate(me.x, me.y);
    g.rotate(Math.atan2(fy, fx2) - Math.PI / 2);
    g.fillStyle = '#9a2f22';
    g.strokeStyle = '#f3eee2';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 11);
    g.lineTo(7, -7);
    g.lineTo(0, -3);
    g.lineTo(-7, -7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();

    // ── the scale bar and where the cross-hair is
    const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000].find((m) => m / mpp > 70) ?? 50000;
    this.scale.textContent = '';
    const bar = h('span', { class: 'atlas__bar' });
    bar.style.width = `${nice / mpp}px`;
    this.scale.append(bar, ` ${nice >= 1000 ? `${nice / 1000} km` : `${nice} m`}`);
    const d = Math.hypot(vx - p.x, vz - p.z);
    this.readout.textContent = d < 30 ? 'You are here' : `${d < 1000 ? `${Math.round(d)} m` : `${(d / 1000).toFixed(1)} km`} ${compass(vx - p.x, vz - p.z)} of you`;
  }

  /** Ask the worker for a tile (at most a few at once; the nearest the middle go first as the view is drawn from the top). */
  private ask(lv: number, ti: number, tj: number, key: string) {
    if (this.asked.has(key) || this.asked.size >= 3) return;
    if (!this.worker) {
      this.worker = new Worker(new URL('./atlas.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<{ key: string; px: Uint8ClampedArray }>) => {
        this.asked.delete(e.data.key);
        const cv = document.createElement('canvas');
        cv.width = SAMP;
        cv.height = SAMP;
        cv.getContext('2d')!.putImageData(new ImageData(e.data.px as unknown as Uint8ClampedArray<ArrayBuffer>, SAMP, SAMP), 0, 0);
        this.tiles.set(e.data.key, cv);
        if (this.tiles.size > 420) this.tiles.delete(this.tiles.keys().next().value!);
      };
    }
    this.asked.add(key);
    this.worker.postMessage({ seed: this.hk.gen.seed, lv, ti, tj, key });
  }
}

function edge(x: number, y: number, W: number, H: number) {
  const m = 14;
  const cx = Math.min(W - m, Math.max(m, x)), cy = Math.min(H - m, Math.max(m, y));
  return { x: cx, y: cy, off: cx !== x || cy !== y };
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    if (i === 0) g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}

function label(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number) {
  g.font = `italic ${size}px "Cormorant Garamond", Georgia, serif`;
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(231,224,207,.92)';
  g.strokeText(t, x, y);
  g.fillStyle = '#1f1c17';
  g.fillText(t, x, y);
}

function compass(dx: number, dz: number) {
  const a = Math.atan2(dx, -dz);
  return ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][Math.round(((a / (Math.PI * 2)) * 8 + 8) % 8) % 8];
}
