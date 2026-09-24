/**
 * Keyboard + mouse state. Mouse look accumulates while pointer-locked,
 * or while a button is held (fallback when pointer lock is refused).
 */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  lookX = 0;
  lookY = 0;
  /** mouse wheel notches this frame */
  wheel = 0;
  enabled = false;
  private dragging = false;

  constructor(private target: HTMLElement) {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select')) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      if (this.enabled && (e.code === 'Space' || e.code === 'Tab')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked || this.dragging) {
        this.lookX += e.movementX;
        this.lookY += e.movementY;
      }
    });
    target.addEventListener('mousedown', (e) => {
      this.dragging = true;
      // mouse buttons read like keys: Mouse0 (left), Mouse2 (right)
      this.down.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => {
      this.dragging = false;
      this.down.delete(`Mouse${e.button}`);
    });
    target.addEventListener('contextmenu', (e) => this.enabled && e.preventDefault());
    addEventListener('wheel', (e) => {
      if (this.enabled) this.wheel += Math.sign(e.deltaY);
    });
  }

  /** phones and tablets: no pointer lock; looking comes from the touch controls */
  touch = false;

  get locked(): boolean {
    return this.touch || document.pointerLockElement === this.target;
  }

  /** A button that isn't a key (touch controls): held while `down`. */
  setVirtual(code: string, down: boolean) {
    if (down) {
      this.down.add(code);
      this.pressed.add(code);
    } else this.down.delete(code);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical press; consumed on read. */
  consume(code: string): boolean {
    if (!this.pressed.has(code)) return false;
    this.pressed.delete(code);
    return true;
  }

  endFrame(): void {
    this.pressed.clear();
    this.lookX = 0;
    this.lookY = 0;
    this.wheel = 0;
  }

  async lock(): Promise<boolean> {
    if (this.touch || this.locked) return true;
    try {
      await (this.target.requestPointerLock() as unknown as Promise<void> | undefined);
      return true;
    } catch {
      return false;
    }
  }

  unlock(): void {
    if (!this.touch && this.locked) document.exitPointerLock();
  }
}
