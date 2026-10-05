import * as THREE from 'three';

/** Canvas textures for the insides of places: signs, boards, labels. */

const SERIF = '"Instrument Serif", "Times New Roman", serif';
const SANS = '"IBM Plex Sans", "Helvetica Neue", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void) {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  draw(el.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export const itex = {
  reception: () =>
    canvas(512, 128, (c, w, h) => {
      c.fillStyle = '#16100b';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#d9b77a';
      c.font = `64px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('Reception', w / 2, h / 2 + 4);
    }),

  keyBoard: () =>
    canvas(512, 320, (c, w, h) => {
      c.fillStyle = '#2a1d14';
      c.fillRect(0, 0, w, h);
      c.font = `18px ${MONO}`;
      c.textAlign = 'center';
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 9; k++) {
          const x = 40 + k * 54, y = 40 + r * 72;
          c.fillStyle = '#b89a62';
          c.fillText(String(100 * (r + 1) + k + 1), x, y);
          // every hook has its key but one
          if (!(r === 2 && k === 4)) {
            c.fillStyle = '#8a7446';
            c.fillRect(x - 3, y + 8, 6, 26);
          }
        }
    }),

  floorDial: (n: string) =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#1b1510';
      c.beginPath();
      c.arc(w / 2, h / 2, 120, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#8a7446';
      c.lineWidth = 6;
      c.stroke();
      c.fillStyle = '#f0c070';
      c.font = `96px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(n, w / 2, h / 2 + 6);
    }),

  washerDoor: () =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#d7d8d3';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#9a9c98';
      c.beginPath();
      c.arc(w / 2, h / 2 + 10, 96, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1a2026';
      c.beginPath();
      c.arc(w / 2, h / 2 + 10, 78, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#2e3a44';
      c.fillRect(20, 12, 70, 16);
    }),

  washerRed: () =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#d7d8d3';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#9a9c98';
      c.beginPath();
      c.arc(w / 2, h / 2 + 10, 96, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#5a1712';
      c.beginPath();
      c.arc(w / 2, h / 2 + 10, 78, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#b8352a';
      c.beginPath();
      c.arc(w / 2 - 14, h / 2 + 2, 40, 0.4, 3.6);
      c.fill();
      c.fillStyle = '#c33';
      c.font = `22px ${MONO}`;
      c.fillText('7  12:00', 22, 30);
    }),

  notice: (lines: string[]) =>
    canvas(256, 320, (c, w, h) => {
      c.fillStyle = '#e9e3d4';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#2a2622';
      c.font = `20px ${SANS}`;
      lines.forEach((l, i) => c.fillText(l, 18, 40 + i * 30));
    }),

  clock317: () =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#efe9da';
      c.beginPath();
      c.arc(w / 2, h / 2, 118, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#2a2622';
      c.lineWidth = 8;
      c.stroke();
      c.translate(w / 2, h / 2);
      const hand = (a: number, len: number, wid: number) => {
        c.save();
        c.rotate(a);
        c.fillStyle = '#1a1714';
        c.fillRect(-wid / 2, -len, wid, len);
        c.restore();
      };
      hand(((3 + 17 / 60) / 12) * Math.PI * 2, 58, 9);
      hand((17 / 60) * Math.PI * 2, 92, 6);
    }),

  priceBoard: () =>
    canvas(512, 256, (c, w, h) => {
      c.fillStyle = '#1d2420';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8e2d2';
      c.font = `28px ${MONO}`;
      const items = [['Rye bread', '2.10'], ['Kabanos', '4.40'], ['Pierogi (12)', '6.90'], ['Pickles', '1.80'], ['Coffee', '1.20']];
      items.forEach(([n, p], i) => {
        c.fillText(n, 26, 46 + i * 42);
        c.fillText(p, 400, 46 + i * 42);
      });
    }),

  shelfGoods: (seed: number) =>
    canvas(512, 128, (c, w, h) => {
      let s = seed * 7919;
      const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
      c.fillStyle = '#e8eae6';
      c.fillRect(0, 0, w, h);
      let x = 4;
      while (x < w - 10) {
        const bw = 18 + rnd() * 30, bh = 40 + rnd() * 70;
        const hue = Math.floor(rnd() * 360);
        c.fillStyle = `hsl(${hue}, ${20 + rnd() * 40}%, ${45 + rnd() * 35}%)`;
        c.fillRect(x, h - bh, bw, bh);
        c.fillStyle = 'rgba(255,255,255,0.7)';
        c.fillRect(x + 3, h - bh + 10, bw - 6, 8);
        x += bw + 3;
      }
    }),

  pharmacyCross: () =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#0c1a12';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#4fe08a';
      c.fillRect(w / 2 - 28, 40, 56, h - 80);
      c.fillRect(40, h / 2 - 28, w - 80, 56);
    }),

  mailboxes: () =>
    canvas(512, 256, (c, w, h) => {
      c.fillStyle = '#4a4238';
      c.fillRect(0, 0, w, h);
      c.font = `16px ${MONO}`;
      for (let r = 0; r < 3; r++)
        for (let k = 0; k < 6; k++) {
          const x = 12 + k * 83, y = 12 + r * 80;
          c.fillStyle = '#6a6052';
          c.fillRect(x, y, 75, 70);
          c.fillStyle = '#d8d0bc';
          c.fillRect(x + 8, y + 8, 58, 16);
          c.fillStyle = '#2a2420';
          const flat = `${r + 1}${String.fromCharCode(65 + k)}`;
          // one name, on every box
          c.fillText(`${flat} · ${r === 1 && k === 3 ? 'you' : '—'}`, x + 12, y + 21);
        }
    }),

  /** a brass teller's name plate */
  bankPlate: (label: string) =>
    canvas(256, 88, (c, w, h) => {
      c.fillStyle = '#7a6a3a';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#c9b06a';
      c.lineWidth = 3;
      c.strokeRect(6, 6, w - 12, h - 12);
      c.fillStyle = '#241d12';
      c.font = `28px ${SERIF}`;
      c.textAlign = 'center';
      c.fillText(label, w / 2, h / 2 + 10);
    }),

  /** the ATM's screen */
  /** the bank's shop window, seen from the pavement */
  bankWindow: () =>
    canvas(512, 256, (c, w, h) => {
      c.fillStyle = '#141a1e';
      c.fillRect(0, 0, w, h);
      // a vault door, seen through the glass
      c.fillStyle = '#3a3c3e';
      c.fillRect(150, 30, 210, 200);
      c.fillStyle = '#2a2c2e';
      c.fillRect(168, 48, 174, 164);
      c.strokeStyle = '#6a6a68';
      c.lineWidth = 8;
      c.beginPath();
      c.arc(255, 130, 42, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        c.beginPath();
        c.moveTo(255 + Math.cos(a) * 42, 130 + Math.sin(a) * 42);
        c.lineTo(255 - Math.cos(a) * 42, 130 - Math.sin(a) * 42);
        c.stroke();
      }
      // the queue, as bars at the bottom
      c.fillStyle = '#2c3138';
      for (let i = 0; i < 7; i++) c.fillRect(20 + i * 68, 210, 40, 46);
    }),

  bankSign: () =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#0e1418';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#3f7f9f';
      c.fillRect(16, 16, w - 32, h - 60);
      c.fillStyle = '#c8d8e4';
      c.font = `22px ${MONO}`;
      c.fillText('MERROW', 34, 62);
      c.fillText('SAVINGS', 34, 92);
      c.fillStyle = '#e6b25c';
      c.fillRect(34, 130, 150, 6);
      c.fillStyle = '#7f9f6f';
      c.fillRect(34, 160, 110, 6);
    }),

  floorNumber: (n: string) =>
    canvas(256, 256, (c, w, h) => {
      c.fillStyle = '#d6cfbf';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#221d18';
      c.font = `160px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(n, w / 2, h / 2 + 10);
    }),

  doorSign: (text: string) =>
    canvas(256, 96, (c, w, h) => {
      c.fillStyle = '#1b1712';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9b48a';
      c.font = `40px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(text, w / 2, h / 2 + 3);
    }),
};
