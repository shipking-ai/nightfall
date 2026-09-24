import * as THREE from 'three';

/**
 * Procedural canvas textures for signage, posters and markings.
 * Everything that carries words in the world is drawn here, so a real
 * texture set can replace these one-for-one later.
 */

const SERIF = '"Instrument Serif", "Times New Roman", serif';
const SANS = '"IBM Plex Sans", "Helvetica Neue", sans-serif';
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const c = el.getContext('2d')!;
  draw(c, w, h);
  const t = new THREE.CanvasTexture(el);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function grime(c: CanvasRenderingContext2D, w: number, h: number, amount = 0.25, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 900 * amount; i++) {
    c.fillStyle = `rgba(20,16,12,${rnd() * 0.12})`;
    const x = rnd() * w, y = rnd() * h, rr = rnd() * (w / 40);
    c.beginPath();
    c.arc(x, y, rr, 0, Math.PI * 2);
    c.fill();
  }
  // rain run
  for (let i = 0; i < 40 * amount; i++) {
    c.fillStyle = `rgba(10,8,6,${rnd() * 0.1})`;
    c.fillRect(rnd() * w, rnd() * h * 0.3, 1 + rnd() * 2, h * (0.3 + rnd() * 0.7));
  }
}

function tornEdge(c: CanvasRenderingContext2D, w: number, h: number, seed = 3) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  c.globalCompositeOperation = 'destination-out';
  c.beginPath();
  c.moveTo(0, h);
  for (let x = 0; x <= w; x += w / 24) c.lineTo(x, h - rnd() * h * 0.08 - (x > w * 0.6 ? h * 0.12 * rnd() : 0));
  c.lineTo(w, h);
  c.fill();
  c.globalCompositeOperation = 'source-over';
}

export const tex = {
  hotelSign: () =>
    canvas(128, 640, (c, w, h) => {
      c.fillStyle = '#0c0b0a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#ffd9a0';
      c.textAlign = 'center';
      c.font = `500 20px ${SANS}`;
      c.fillText('H O T E L', w / 2, 44);
      c.font = `76px ${SERIF}`;
      const word = 'MERIDIAN';
      for (let i = 0; i < word.length; i++) {
        // one letter has been dark for years
        c.fillStyle = i === 5 ? '#2a2016' : '#ffd9a0';
        c.fillText(word[i], w / 2, 124 + i * 64);
      }
    }),

  pharmacy: () =>
    canvas(512, 96, (c, w, h) => {
      c.fillStyle = '#07090a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#dff3ee';
      c.font = `500 44px ${SANS}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.letterSpacing = '14px';
      c.fillText('PHARMACY', w / 2 + 7, h / 2 + 2);
    }),

  launderette: () =>
    canvas(512, 96, (c, w, h) => {
      c.fillStyle = '#08080a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#f2ead8';
      c.font = `italic 50px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('Launderette', w / 2 - 40, h / 2 + 4);
      c.font = `500 18px ${MONO}`;
      c.fillText('24H', w - 70, h / 2 + 2);
    }),

  deli: () =>
    canvas(512, 96, (c, w, h) => {
      c.fillStyle = '#1b2420';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9b98f';
      c.font = `46px ${SERIF}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('Kowalczyk & Sons', w / 2, h / 2 - 6);
      c.font = `500 13px ${SANS}`;
      c.letterSpacing = '6px';
      c.fillText('DELICATESSEN · EST. 1961', w / 2, h - 16);
      grime(c, w, h, 0.4, 5);
    }),

  stationName: () =>
    canvas(1024, 128, (c, w, h) => {
      c.fillStyle = '#6f675c';
      c.fillRect(0, 0, w, h);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 64px ${SANS}`;
      c.letterSpacing = '38px';
      c.fillStyle = '#2c2822';
      c.fillText('CENTRAL STATION', w / 2 + 19, h / 2 + 3);
      c.fillStyle = '#8b8275';
      c.fillText('CENTRAL STATION', w / 2 + 18, h / 2 + 1);
      grime(c, w, h, 0.8, 11);
    }),

  departures: () =>
    canvas(1024, 384, (c, w, h) => {
      c.fillStyle = '#050505';
      c.fillRect(0, 0, w, h);
      c.font = `500 26px ${MONO}`;
      c.textBaseline = 'middle';
      c.fillStyle = '#8f6a3a';
      c.fillText('DEPARTURES', 36, 40);
      c.fillText('LINE 3', w - 150, 40);
      const rows: [string, string, string, string][] = [
        ['03:17', 'ASHFORD', '2', 'DELAYED'],
        ['03:42', 'HARBOR JUNCTION', '1', 'CANCELLED'],
        ['04:05', 'ASHFORD', '2', 'CANCELLED'],
        ['04:31', 'NORTHGATE', '1', 'CANCELLED'],
        ['—', '', '', ''],
      ];
      rows.forEach((row, i) => {
        const y = 110 + i * 56;
        c.fillStyle = i === 0 ? '#ffb45a' : '#a07542';
        c.fillText(row[0], 36, y);
        c.fillText(row[1], 190, y);
        c.fillText(row[2], 640, y);
        c.fillText(row[3], 780, y);
      });
      // dot-matrix mask
      c.fillStyle = 'rgba(0,0,0,0.55)';
      for (let x = 0; x < w; x += 4) c.fillRect(x, 0, 1, h);
      for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
    }),

  clockFace: () =>
    canvas(512, 512, (c, w, h) => {
      const cx = w / 2, cy = h / 2;
      c.fillStyle = '#e8dcc2';
      c.beginPath();
      c.arc(cx, cy, 250, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#1a1714';
      c.lineWidth = 10;
      c.stroke();
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2;
        const l = i % 5 === 0 ? 34 : 12;
        c.lineWidth = i % 5 === 0 ? 9 : 3;
        c.beginPath();
        c.moveTo(cx + Math.sin(a) * 228, cy - Math.cos(a) * 228);
        c.lineTo(cx + Math.sin(a) * (228 - l), cy - Math.cos(a) * (228 - l));
        c.stroke();
      }
      const hand = (a: number, len: number, wdt: number) => {
        c.lineWidth = wdt;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx - Math.sin(a) * 24, cy + Math.cos(a) * 24);
        c.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
        c.stroke();
      };
      // 03:17 — always
      hand(((3 + 17 / 60) / 12) * Math.PI * 2, 130, 14);
      hand((17 / 60) * Math.PI * 2, 196, 9);
      c.fillStyle = '#1a1714';
      c.beginPath();
      c.arc(cx, cy, 14, 0, Math.PI * 2);
      c.fill();
      grime(c, w, h, 0.5, 21);
    }),

  missing: () =>
    canvas(256, 360, (c, w, h) => {
      c.fillStyle = '#d9d3c4';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#141210';
      c.textAlign = 'center';
      c.font = `500 44px ${SANS}`;
      c.letterSpacing = '6px';
      c.fillText('MISSING', w / 2 + 3, 58);
      // portrait
      c.fillStyle = '#9a9387';
      c.fillRect(48, 80, 160, 150);
      c.fillStyle = '#4a4640';
      c.beginPath();
      c.ellipse(128, 138, 34, 42, 0, 0, Math.PI * 2);
      c.fill();
      c.fillRect(74, 184, 108, 46);
      c.letterSpacing = '0px';
      c.font = `30px ${SERIF}`;
      c.fillText('Elena Marsh', w / 2, 270);
      c.font = `400 13px ${SANS}`;
      c.fillText('Last seen at Central Station', w / 2, 296);
      c.fillText('shortly after 3 a.m.', w / 2, 314);
      c.font = `500 12px ${MONO}`;
      c.fillText('ANY INFORMATION — PLATFORM 2', w / 2, 344);
      grime(c, w, h, 0.9, 4);
      tornEdge(c, w, h, 7);
    }),

  timePoster: () =>
    canvas(256, 360, (c, w, h) => {
      c.fillStyle = '#16181a';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#d8d2c4';
      c.textAlign = 'center';
      c.font = `92px ${SERIF}`;
      c.fillText('03:17', w / 2, 170);
      c.font = `500 14px ${MONO}`;
      c.letterSpacing = '4px';
      c.fillText('HAVE YOU', w / 2, 72);
      c.fillText('SEEN THIS TIME?', w / 2, 94);
      c.font = `italic 20px ${SERIF}`;
      c.letterSpacing = '0px';
      c.fillText('It has seen you.', w / 2, 250);
      grime(c, w, h, 0.7, 9);
    }),

  concert: () =>
    canvas(256, 360, (c, w, h) => {
      c.fillStyle = '#6e5a44';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e4d6bb';
      c.textAlign = 'left';
      c.font = `64px ${SERIF}`;
      c.fillText('The', 24, 90);
      c.fillText('Late', 24, 150);
      c.fillText('Hours', 24, 210);
      c.font = `500 13px ${MONO}`;
      c.letterSpacing = '3px';
      c.fillText('ONE NIGHT ONLY', 24, 262);
      c.fillText('THE PALAIS · 11 PM', 24, 284);
      grime(c, w, h, 1.2, 13);
      tornEdge(c, w, h, 19);
    }),

  closedCard: () =>
    canvas(256, 160, (c, w, h) => {
      c.fillStyle = '#e7e0cf';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1e1b17';
      c.textAlign = 'center';
      c.font = `italic 38px ${SERIF}`;
      c.fillText('Back in 5 minutes', w / 2, 76);
      c.font = `500 12px ${MONO}`;
      c.fillText('— K.', w / 2, 118);
      grime(c, w, h, 0.5, 23);
    }),

  bridgeNotice: () =>
    canvas(512, 320, (c, w, h) => {
      c.fillStyle = '#d8d0bc';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#16140f';
      c.fillRect(0, 0, w, 70);
      c.fillStyle = '#d8d0bc';
      c.textAlign = 'center';
      c.font = `500 36px ${SANS}`;
      c.letterSpacing = '10px';
      c.fillText('BRIDGE CLOSED', w / 2 + 5, 48);
      c.fillStyle = '#16140f';
      c.letterSpacing = '0px';
      c.font = `22px ${SERIF}`;
      c.fillText('Ashford Bridge is closed to all traffic', w / 2, 130);
      c.fillText('while essential repairs are carried out.', w / 2, 160);
      c.font = `italic 22px ${SERIF}`;
      c.fillText('We apologise for any inconvenience.', w / 2, 204);
      c.font = `500 13px ${MONO}`;
      c.fillText('DISTRICT WORKS DEPT. · NOTICE 03/17', w / 2, 272);
      grime(c, w, h, 1.4, 31);
    }),

  stencil: (text: string, sub?: string) =>
    canvas(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(210,200,180,0.62)';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 150px ${MONO}`;
      c.fillText(text, w / 2, sub ? h / 2 - 20 : h / 2);
      if (sub) {
        c.font = `500 34px ${MONO}`;
        c.letterSpacing = '10px';
        c.fillText(sub, w / 2, h - 30);
      }
      c.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 1400; i++) {
        c.fillStyle = `rgba(0,0,0,${Math.random() * 0.8})`;
        c.fillRect(Math.random() * w, Math.random() * h, Math.random() * 10, Math.random() * 3);
      }
      c.globalCompositeOperation = 'source-over';
    }),

  graffiti: (text: string, color = 'rgba(225,220,205,0.7)') =>
    canvas(1024, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = color;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `italic 96px ${SERIF}`;
      c.save();
      c.translate(w / 2, h / 2);
      c.rotate(-0.04);
      c.fillText(text, 0, 0);
      c.restore();
      // drips
      for (let i = 0; i < 16; i++) {
        const x = w * 0.15 + Math.random() * w * 0.7;
        c.fillRect(x, h / 2 + 20, 2, 20 + Math.random() * 60);
      }
    }),

  /** The recurring mark: a circle split by a vertical line. */
  mark: () =>
    canvas(256, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(232,226,212,0.82)';
      c.lineWidth = 9;
      c.lineCap = 'round';
      const jitter = () => (Math.random() - 0.5) * 4;
      c.beginPath();
      for (let i = 0; i <= 40; i++) {
        const a = (i / 40) * Math.PI * 2 * 0.97;
        const x = w / 2 + Math.cos(a) * 78 + jitter(), y = h / 2 + Math.sin(a) * 78 + jitter();
        i ? c.lineTo(x, y) : c.moveTo(x, y);
      }
      c.stroke();
      c.beginPath();
      c.moveTo(w / 2 + jitter(), 22);
      c.lineTo(w / 2 + jitter(), h - 22);
      c.stroke();
    }),

  streetSign: (name: string) =>
    canvas(256, 64, (c, w, h) => {
      c.fillStyle = '#1b2026';
      c.fillRect(0, 0, w, h);
      c.strokeStyle = '#c9c4b8';
      c.lineWidth = 2;
      c.strokeRect(4, 4, w - 8, h - 8);
      c.fillStyle = '#e4dfd3';
      c.font = `500 24px ${SANS}`;
      c.letterSpacing = '4px';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(name.toUpperCase(), w / 2 + 2, h / 2 + 1);
    }),

  busAd: () =>
    canvas(256, 400, (c, w, h) => {
      c.fillStyle = '#e6e1d6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1d1b18';
      c.font = `500 12px ${MONO}`;
      c.letterSpacing = '4px';
      c.fillText('CITY MUSEUM', 24, 40);
      c.letterSpacing = '0px';
      c.font = `56px ${SERIF}`;
      c.fillText('What', 24, 150);
      c.fillText('the city', 24, 204);
      c.fillText('keeps.', 24, 258);
      c.font = `400 14px ${SANS}`;
      c.fillText('Closed indefinitely.', 24, 330);
      c.fillText('Thank you for remembering.', 24, 352);
    }),

  kestrel: () =>
    canvas(1024, 160, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#d9cfb8';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.font = `500 84px ${SANS}`;
      c.letterSpacing = '40px';
      c.fillText('KESTREL MARKET', w / 2 + 20, h / 2);
    }),

  newspaper: () =>
    canvas(256, 320, (c, w, h) => {
      c.fillStyle = '#d6d0c2';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1a1814';
      c.textAlign = 'center';
      c.font = `30px ${SERIF}`;
      c.fillText('The Evening Ledger', w / 2, 40);
      c.fillRect(20, 52, w - 40, 2);
      c.font = `500 26px ${SANS}`;
      c.fillText('CITY SLEEPS', w / 2, 100);
      c.fillText('THROUGH', w / 2, 132);
      c.fillText('BLACKOUT', w / 2, 164);
      c.font = `italic 17px ${SERIF}`;
      c.fillText('“Clocks disagree,” say residents', w / 2, 200);
      for (let i = 0; i < 7; i++) c.fillRect(24, 226 + i * 12, w - 48 - (i % 3) * 30, 4);
    }),

  polaroid: (seed: number) =>
    canvas(160, 190, (c, w, h) => {
      c.fillStyle = '#e8e2d4';
      c.fillRect(0, 0, w, h);
      const g = c.createLinearGradient(0, 12, 0, 150);
      g.addColorStop(0, '#1d2230');
      g.addColorStop(1, '#3a3026');
      c.fillStyle = g;
      c.fillRect(12, 12, w - 24, 136);
      // same street corner, a lamp, a figure that may or may not be there
      c.fillStyle = '#0b0c0e';
      c.fillRect(12, 60 + (seed % 3) * 4, 46, 88);
      c.fillRect(100, 40, 48, 108);
      c.fillStyle = '#ffcf8a';
      c.beginPath();
      c.arc(78, 58, 5, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,207,138,0.15)';
      c.beginPath();
      c.moveTo(78, 60);
      c.lineTo(58, 148);
      c.lineTo(98, 148);
      c.fill();
      if (seed % 2 === 0) {
        c.fillStyle = '#060607';
        c.fillRect(74, 118, 7, 26);
        c.beginPath();
        c.arc(77.5, 114, 4.5, 0, Math.PI * 2);
        c.fill();
      }
      c.fillStyle = '#39352e';
      c.font = `italic 15px ${SERIF}`;
      c.textAlign = 'center';
      c.fillText('3:17', w / 2, 174);
    }),

  terminal: () =>
    canvas(512, 384, (c, w, h) => {
      c.fillStyle = '#0a0806';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e0a458';
      c.font = `500 18px ${MONO}`;
      const lines = [
        'PIER 9 YARD — MANIFEST',
        '',
        'CTR 4471-0  STACK B  CLEARED',
        'CTR 4472-3  STACK B  CLEARED',
        'CTR 0317-X  STACK ?  UNDECLARED',
        '',
        'LAST SCAN   03:17',
        'OPERATOR    —',
        '',
        '> _',
      ];
      lines.forEach((l, i) => c.fillText(l, 28, 44 + i * 32));
      c.fillStyle = 'rgba(0,0,0,0.35)';
      for (let y = 0; y < h; y += 3) c.fillRect(0, y, w, 1);
    }),

  vending: () =>
    canvas(256, 512, (c, w, h) => {
      c.fillStyle = '#d9e4e6';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#20282c';
      c.fillRect(16, 16, 150, 420);
      for (let r = 0; r < 6; r++)
        for (let k = 0; k < 4; k++) {
          const lit = (r * 4 + k) % 7 !== 3;
          c.fillStyle = lit ? ['#7a3e2e', '#2e4a5a', '#8c7a4a', '#4a5a3a'][(r + k) % 4] : '#12181a';
          c.fillRect(26 + k * 35, 30 + r * 66, 24, 44);
        }
      c.fillStyle = '#1a1f22';
      c.fillRect(184, 60, 52, 90);
      c.fillStyle = '#e0a458';
      c.font = `500 14px ${MONO}`;
      c.fillText('0.00', 190, 90);
      c.fillStyle = '#20282c';
      c.fillRect(16, 450, 220, 44);
    }),

  radioDial: () =>
    canvas(256, 64, (c, w, h) => {
      c.fillStyle = '#231a10';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#e8b36a';
      c.font = `500 11px ${MONO}`;
      ['88', '92', '96', '100', '104', '108'].forEach((s, i) => c.fillText(s, 14 + i * 40, 20));
      for (let x = 14; x < w - 10; x += 8) c.fillRect(x, 30, 1, x % 40 === 14 ? 12 : 6);
      c.fillStyle = '#ff9a4a';
      c.fillRect(231, 24, 2, 30); // beyond the end of the dial
    }),
};
