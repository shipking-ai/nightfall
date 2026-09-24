import * as THREE from 'three';

/**
 * Where the tracked side quest wants you: a faint amber column you can see
 * over the rooftops, and a small turning diamond at head height. It fades as
 * you arrive so it never sits in your face.
 */
export class QuestMarker {
  group = new THREE.Group();
  private beamMat = new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  private gemMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0, depthWrite: false, fog: false });
  private gem: THREE.Mesh;
  private fade = 0;

  constructor() {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 60, 10, 1, true).translate(0, 30, 0), this.beamMat);
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), this.gemMat);
    this.gem.scale.set(1, 1.5, 1);
    beam.renderOrder = this.gem.renderOrder = 6;
    this.group.add(beam, this.gem);
    this.group.visible = false;
  }

  update(dt: number, t: number, target: THREE.Vector3 | null, from: THREE.Vector3, indoors: boolean) {
    this.fade += ((target ? 1 : 0) - this.fade) * Math.min(1, dt * 3);
    this.group.visible = this.fade > 0.01 && !!target;
    if (!target) return;
    this.group.position.copy(target);
    const d = Math.hypot(target.x - from.x, target.z - from.z);
    const near = THREE.MathUtils.smoothstep(d, 2.5, 9);
    this.beamMat.opacity = this.fade * near * (indoors ? 0 : 0.22);
    this.gemMat.opacity = this.fade * (0.35 + 0.55 * near);
    this.gem.position.y = 2.3 + Math.sin(t * 2) * 0.12;
    this.gem.rotation.y = t * 1.4;
  }
}
