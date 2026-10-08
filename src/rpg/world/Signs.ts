import * as THREE from 'three';
import type { Poi, PoiKind } from './Towns';

/**
 * Shop signs over the doors you can go through: enamel boards with the
 * name painted on (drawn to a canvas once per door), a lit glass door
 * beneath. They glow after dark, which is when you most need to find the
 * diner.
 */

const LOOK: Record<PoiKind, { bg: string; fg: string; label: string }> = {
  diner: { bg: '#1f5a5a', fg: '#f4ead2', label: 'DINER · OPEN LATE' },
  bar: { bg: '#5a1a18', fg: '#f0d9a8', label: 'BAR' },
  store: { bg: '#2a3a24', fg: '#f2ecd8', label: 'GROCERIES · SUNDRIES' },
  gas: { bg: '#b0761c', fg: '#1c1712', label: 'FUEL · SNACKS' },
  garage: { bg: '#2c2e32', fg: '#e8c070', label: 'MOTORS · REPAIRS' },
  clinic: { bg: '#e8e4da', fg: '#8a1c16', label: '✚ CLINIC' },
  hotel: { bg: '#3a1624', fg: '#e8cf98', label: 'HOTEL' },
  motel: { bg: '#1c2c4a', fg: '#ff8a5a', label: 'MOTEL · VACANCY' },
  police: { bg: '#18223a', fg: '#e8e4da', label: 'POLICE' },
  gunsmith: { bg: '#2e2a22', fg: '#d8b878', label: 'ARMS · AMMUNITION' },
  pawn: { bg: '#4a3a14', fg: '#f2dc8a', label: 'PAWN · LOANS · GOLD' },
  arcade: { bg: '#2a1440', fg: '#7af0e8', label: 'ARCADE' },
  club: { bg: '#141418', fg: '#ff5aa0', label: 'CLUB' },
  gym: { bg: '#262626', fg: '#e84a3a', label: 'GYM · BOXING' },
  church: { bg: '#e0dccf', fg: '#2a2620', label: 'ALL WELCOME' },
  bank: { bg: '#1e2a26', fg: '#d8c08a', label: 'BANK' },
  dock: { bg: '#1a3446', fg: '#f0ead8', label: 'BOATS · BAIT' },
  market: { bg: '#3a2a18', fg: '#f2dfb0', label: 'MARKET' },
  office: { bg: '#262a30', fg: '#c8ccd2', label: 'OFFICES' },
  station: { bg: '#1c3a2a', fg: '#f2ecd8', label: 'TRAINS' },
  workshop: { bg: '#3a2e20', fg: '#e8c888', label: 'WORKSHOP · SALVAGE' },
};

const PLANE = new THREE.PlaneGeometry(1, 1);

export interface SignSet {
  group: THREE.Group;
  mats: THREE.MeshStandardMaterial[];
  dispose(): void;
}

/** Glowing materials, all signs everywhere: the RPG turns them up at dusk. */
export const signMats = new Set<THREE.MeshStandardMaterial>();

/** lit glass doors: dark by day, warm at night (set by the RPG with the lamps) */
export const doorMat = new THREE.MeshStandardMaterial({ color: 0x15130f, emissive: new THREE.Color(1, 0.72, 0.42), emissiveIntensity: 0.05, roughness: 0.12, metalness: 0.3 });

export function signsFor(pois: Poi[]): SignSet {
  const group = new THREE.Group();
  const mats: THREE.MeshStandardMaterial[] = [];
  for (const p of pois) {
    const look = LOOK[p.kind];
    const tex = paint(p.name, look);
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.55, metalness: 0.05 });
    mats.push(mat);
    signMats.add(mat);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    // the wall is ~0.6 m behind the door spot
    const wx = p.x - fx * 0.55, wz = p.z - fz * 0.55;
    const w = Math.min(4.2, 1.6 + p.name.length * 0.13);
    const sign = new THREE.Mesh(PLANE, mat);
    sign.position.set(wx + fx * 0.08, p.y + 3.15, wz + fz * 0.08);
    sign.rotation.y = p.yaw;
    sign.scale.set(w, w / 4, 1);
    const door = new THREE.Mesh(PLANE, doorMat);
    door.position.set(wx + fx * 0.04, p.y + 1.1, wz + fz * 0.04);
    door.rotation.y = p.yaw;
    door.scale.set(1.3, 2.2, 1);
    group.add(sign, door);
  }
  group.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  return {
    group,
    mats,
    dispose() {
      for (const m of mats) {
        signMats.delete(m);
        m.map?.dispose();
        m.dispose();
      }
    },
  };
}

function paint(name: string, look: { bg: string; fg: string; label: string }) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = look.bg;
  g.fillRect(0, 0, 512, 128);
  // enamel: a rim and a soft sheen
  g.strokeStyle = look.fg;
  g.globalAlpha = 0.55;
  g.lineWidth = 4;
  g.strokeRect(8, 8, 496, 112);
  g.globalAlpha = 1;
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,0.10)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = look.fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '500 17px "IBM Plex Mono", monospace';
  g.fillText(look.label, 256, 30);
  let size = 58;
  g.font = `${size}px "Instrument Serif", Georgia, serif`;
  while (g.measureText(name).width > 470 && size > 26) {
    size -= 4;
    g.font = `${size}px "Instrument Serif", Georgia, serif`;
  }
  g.fillText(name, 256, 78);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
