// Keyboard + pointer state polling.

export class Input {
  constructor(target = window) {
    this.down = new Set();
    this.pressed = new Set(); // went down since last endFrame()
    this.mouse = { x: 0, y: 0, buttons: 0 };

    target.addEventListener('keydown', (e) => {
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
    });
    target.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointermove', (e) => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; });
    target.addEventListener('pointerdown', (e) => { this.mouse.buttons = e.buttons; });
    target.addEventListener('pointerup', (e) => { this.mouse.buttons = e.buttons; });
  }
  isDown(code) { return this.down.has(code); }
  wasPressed(code) { return this.pressed.has(code); }
  endFrame() { this.pressed.clear(); }
}
