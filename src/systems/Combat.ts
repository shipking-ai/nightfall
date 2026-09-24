/**
 * Your side of a fight: what you're holding, how much is in it, how hurt you
 * are, and how badly the police want you. The world (who got hit, who saw it)
 * is App's job; this only keeps the numbers honest.
 */

export interface Weapon {
  id: 'fists' | 'pistol' | 'smg';
  name: string;
  dmg: number;
  /** metres */
  range: number;
  /** seconds between shots */
  rate: number;
  auto: boolean;
  mag: number;
  reload: number;
  /** radians of random spread */
  spread: number;
}

export const WEAPONS: Weapon[] = [
  { id: 'fists', name: 'Fists', dmg: 24, range: 1.6, rate: 0.42, auto: false, mag: Infinity, reload: 0, spread: 0 },
  { id: 'pistol', name: 'Pistol', dmg: 34, range: 90, rate: 0.26, auto: false, mag: 12, reload: 1.3, spread: 0.008 },
  { id: 'smg', name: 'SMG', dmg: 15, range: 70, rate: 0.085, auto: true, mag: 30, reload: 1.8, spread: 0.03 },
];

export class Combat {
  health = 100;
  /** admin: nothing hurts */
  god = false;
  /** 0..5 (fractional: stars shown are ceil) */
  heat = 0;
  weapon = 0;
  ammo = WEAPONS.map((w) => w.mag);
  reloading = 0;
  private cool = 0;
  private sinceCrime = 99;
  private sinceHurt = 99;
  /** seconds since the last shot or punch (the arm stays up a moment) */
  sinceFire = 99;

  get w(): Weapon {
    return WEAPONS[this.weapon];
  }

  get stars(): number {
    return Math.min(5, Math.ceil(this.heat - 0.05));
  }

  get dead() {
    return this.health <= 0;
  }

  select(i: number) {
    if (i < 0 || i >= WEAPONS.length || i === this.weapon) return false;
    this.weapon = i;
    this.reloading = 0;
    this.cool = 0.25;
    return true;
  }

  cycle(d: number) {
    return this.select((this.weapon + d + WEAPONS.length) % WEAPONS.length);
  }

  reload() {
    const w = this.w;
    if (w.reload && !this.reloading && this.ammo[this.weapon] < w.mag) this.reloading = w.reload;
  }

  /** Can we fire this frame? (spends a round) */
  trigger(held: boolean, pressed: boolean): boolean {
    const w = this.w;
    if (this.dead || this.cool > 0 || this.reloading > 0) return false;
    if (!(w.auto ? held : pressed)) return false;
    if (this.ammo[this.weapon] <= 0) {
      this.reload();
      return false;
    }
    if (Number.isFinite(w.mag)) this.ammo[this.weapon]--;
    this.cool = w.rate;
    this.sinceFire = 0;
    if (this.ammo[this.weapon] === 0) this.reload();
    return true;
  }

  /** Something you did that the police care about. */
  crime(amount: number) {
    this.heat = Math.min(5, this.heat + amount);
    this.sinceCrime = 0;
  }

  /** Returns true if this killed you. */
  hurt(dmg: number): boolean {
    if (this.god || this.dead) return false;
    this.health = Math.max(0, this.health - dmg);
    this.sinceHurt = 0;
    return this.dead;
  }

  respawn() {
    this.health = 100;
    this.heat = 0;
    this.reloading = 0;
    this.ammo = WEAPONS.map((w) => w.mag);
  }

  update(dt: number, copsNear: boolean) {
    this.cool -= dt;
    this.sinceFire += dt;
    this.sinceCrime += dt;
    this.sinceHurt += dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        this.ammo[this.weapon] = this.w.mag;
      }
    }
    // lie low and it cools off (slower with police in sight)
    if (this.sinceCrime > 12 && this.heat > 0) this.heat = Math.max(0, this.heat - dt * (copsNear ? 0.02 : 0.09));
    // you heal if nobody's hurting you
    if (!this.dead && this.sinceHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 4);
  }
}
