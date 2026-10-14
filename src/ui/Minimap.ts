import type { Box } from '../world/Collision';

/**
 * Warzone's minimap and compass. The map turns with you (up is where you
 * look): the yard's containers and walls, the objectives, your squad, and
 * enemies only when they give themselves away (firing an unsuppressed gun,
 * a recon sweep, a sensor). The compass strip along the top shows your
 * heading and where the objectives are.
 */

export interface Blip {
  x: number;
  z: number;
  kind: 'mate' | 'enemy' | 'objective' | 'us' | 'them' | 'flag-us' | 'flag-them';
  label?: string;
}

const SIZE = 168;
/** metres across the map's radius */
const RANGE = 34;

export class Minimap {
  el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private bounds = { x0: 0, z0: 0, x1: 1, z1: 1 };
  private scale = 4;
  compass: HTMLElement;
  private strip: HTMLElement;
  private pips: HTMLElement;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE * 2;
    this.canvas.className = 'wz-minimap__c';
    this.ctx = this.canvas.getContext('2d')!;
    this.el = document.createElement('div');
    this.el.className = 'wz-minimap';
    this.el.append(this.canvas);
    this.compass = document.createElement('div');
    this.compass.className = 'wz-compass';
    this.strip = document.createElement('div');
    this.strip.className = 'wz-compass__strip';
    this.pips = document.createElement('div');
    this.pips.className = 'wz-compass__pips';
    // two turns of ticks so the strip can slide without running out
    for (let k = -360; k <= 720; k += 15) {
      const t = document.createElement('i');
      const deg = ((k % 360) + 360) % 360;
      t.style.left = `${(k + 360) * 4}px`;
      const name = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
      t.className = name ? 'is-card' : deg % 45 ? '' : 'is-mid';
      t.textContent = name ?? (deg % 45 ? '' : String(deg));
      this.strip.append(t);
    }
    const mark = document.createElement('b');
    mark.className = 'wz-compass__mark';
    this.compass.append(this.strip, this.pips, mark);
  }

  /** Draw the yard once (the walls don't move). */
  setYard(boxes: Box[], b: { x0: number; z0: number; x1: number; z1: number }) {
    this.bounds = b;
    const s = this.scale;
    const c = document.createElement('canvas');
    c.width = Math.ceil((b.x1 - b.x0) * s);
    c.height = Math.ceil((b.z1 - b.z0) * s);
    const g = c.getContext('2d')!;
    g.fillStyle = 'rgba(30, 34, 40, 0.92)';
    g.fillRect(0, 0, c.width, c.height);
    for (const k of boxes) {
      if (k.maxY < 0.8) continue;
      const tall = k.maxY > 2.2;
      g.fillStyle = tall ? 'rgba(150, 156, 162, 0.85)' : 'rgba(110, 116, 122, 0.6)';
      g.fillRect((k.minX - b.x0) * s, (k.minZ - b.z0) * s, (k.maxX - k.minX) * s, (k.maxZ - k.minZ) * s);
    }
    g.strokeStyle = 'rgba(233, 229, 220, 0.5)';
    g.lineWidth = 2;
    g.strokeRect(1, 1, c.width - 2, c.height - 2);
    this.base = c;
  }

  /** One frame: you at (x, z) looking along `yaw` (atan2(dx, dz)). */
  draw(x: number, z: number, yaw: number, blips: Blip[]) {
    const g = this.ctx, W = this.canvas.width, R = W / 2, k = R / RANGE;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(12, 14, 17, 0.88)';
    g.fillRect(0, 0, W, W);
    // world → map: centred on you, turned so your heading points up.
    // forward (sin yaw, cos yaw) lands on (0, -1); your right (-cos yaw, sin yaw) on (1, 0)
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const a = -cy * k, cc = sy * k, b = -sy * k, d = -cy * k;
    g.setTransform(a, b, cc, d, R - (a * x + cc * z), R - (b * x + d * z));
    if (this.base) g.drawImage(this.base, this.bounds.x0, this.bounds.z0, this.base.width / this.scale, this.base.height / this.scale);
    g.restore();
    // blips, placed in the same turned frame (drawn upright)
    for (const b of blips) {
      const dx = (b.x - x) * k, dz = (b.z - z) * k;
      let px = -dx * cy + dz * sy, py = -dx * sy - dz * cy;
      const d = Math.hypot(px, py), edge = R - 10;
      const clamped = d > edge;
      if (clamped) {
        if (b.kind === 'mate' || b.kind === 'enemy') continue;
        px *= edge / d;
        py *= edge / d;
      }
      px += R;
      py += R;
      if (b.kind === 'mate' || b.kind === 'enemy') {
        g.fillStyle = b.kind === 'mate' ? '#5a9cff' : '#ff6a4a';
        g.beginPath();
        g.arc(px, py, 6, 0, Math.PI * 2);
        g.fill();
      } else {
        const col = b.kind === 'us' || b.kind === 'flag-us' ? '#5a9cff' : b.kind === 'them' || b.kind === 'flag-them' ? '#ff6a4a' : '#e9e5dc';
        g.fillStyle = 'rgba(10, 11, 12, 0.85)';
        g.strokeStyle = col;
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(px, py - 13);
        g.lineTo(px + 13, py);
        g.lineTo(px, py + 13);
        g.lineTo(px - 13, py);
        g.closePath();
        g.fill();
        g.stroke();
        g.fillStyle = col;
        g.font = '600 15px "IBM Plex Mono", monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(b.label ?? '', px, py + 1);
      }
    }
    // you: an arrow pointing up
    g.fillStyle = '#e9e5dc';
    g.beginPath();
    g.moveTo(R, R - 12);
    g.lineTo(R + 8, R + 9);
    g.lineTo(R, R + 4);
    g.lineTo(R - 8, R + 9);
    g.closePath();
    g.fill();
    // the rim
    g.strokeStyle = 'rgba(233, 229, 220, 0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(R, R, R - 2, 0, Math.PI * 2);
    g.stroke();
    // the compass: heading in degrees (0 = north = -z), objectives as pips
    const heading = ((((Math.PI - yaw) * 180) / Math.PI) % 360 + 360) % 360;
    this.strip.style.transform = `translateX(${-(heading + 360) * 4}px)`;
    const pips: string[] = [];
    for (const b of blips) {
      if (b.kind === 'mate' || b.kind === 'enemy') continue;
      const bear = ((((Math.PI - Math.atan2(b.x - x, b.z - z)) * 180) / Math.PI) % 360 + 360) % 360;
      let rel = bear - heading;
      if (rel > 180) rel -= 360;
      if (rel < -180) rel += 360;
      if (Math.abs(rel) > 60) continue;
      const cls = b.kind.includes('us') ? 'us' : b.kind.includes('them') ? 'them' : 'none';
      pips.push(`${rel.toFixed(1)}|${cls}|${b.label ?? ''}`);
    }
    const key = pips.join(',');
    if (this.pips.dataset.k !== key) {
      this.pips.dataset.k = key;
      this.pips.replaceChildren(
        ...pips.map((p) => {
          const [rel, cls, label] = p.split('|');
          const e = document.createElement('span');
          e.className = `is-${cls}`;
          e.style.left = `calc(50% + ${Number(rel) * 4}px)`;
          e.textContent = label;
          return e;
        }),
      );
    }
  }
}
