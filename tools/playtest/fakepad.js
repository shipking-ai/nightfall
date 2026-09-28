// Injected before the page loads: a virtual Xbox (or DualSense) controller the
// test can press. navigator.getGamepads() returns it; rumble calls are logged.
(() => {
  const family = (window.__padFamily = window.__padFamily || 'xbox');
  const mk = (index, id) => ({
    id,
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    vibrationActuator: {
      effects: ['dual-rumble', 'trigger-rumble'],
      playEffect: async (type, p) => {
        (window.__rumbles = window.__rumbles || []).push([type, p.strongMagnitude, p.weakMagnitude]);
        return 'complete';
      },
    },
  });
  const ids = { xbox: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', playstation: 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)' };
  window.__pads = [mk(0, ids[family]), null, null, null];
  navigator.getGamepads = () => window.__pads;
  const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, View: 8, Menu: 9, LS: 10, RS: 11, Up: 12, Down: 13, Left: 14, Right: 15 };
  window.__hold = (name, on = true, pad = 0, value = 1) => {
    const b = window.__pads[pad].buttons[B[name]];
    b.pressed = on;
    b.value = on ? value : 0;
    window.__pads[pad].timestamp = performance.now();
  };
  window.__tap = (name, ms = 90, pad = 0) => new Promise((r) => { window.__hold(name, true, pad); setTimeout(() => { window.__hold(name, false, pad); setTimeout(r, 60); }, ms); });
  window.__stick = (which, x, y, pad = 0) => {
    const a = window.__pads[pad].axes;
    a[which * 2] = x;
    a[which * 2 + 1] = y;
    window.__pads[pad].timestamp = performance.now();
  };
  window.__addPad = (family2 = 'playstation') => {
    window.__pads[1] = mk(1, ids[family2]);
    window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: window.__pads[1] }));
  };
  addEventListener('load', () => window.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: window.__pads[0] })));
})();
