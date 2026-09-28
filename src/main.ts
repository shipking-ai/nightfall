import './styles/main.css';
import './styles/controller.css';
import './styles/fight.css';
import './styles/warzone.css';
import { App } from './core/App';

function supportsWebGL2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

if (!supportsWebGL2()) {
  const ui = document.getElementById('ui')!;
  ui.style.pointerEvents = 'auto';
  ui.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'intermission layer is-on';
  box.innerHTML =
    '<div class="intermission__inner"><h2 class="intermission__title">NIGHTFALL</h2><p class="intermission__tag">THIS CITY NEEDS WEBGL 2.<br>TRY A CURRENT DESKTOP BROWSER.</p></div>';
  ui.append(box);
} else {
  const app = new App();
  if (import.meta.env.DEV) {
    (window as unknown as { nf: App }).nf = app;
    import('./dev/lineup').then((m) => ((window as unknown as { nfLineup: unknown }).nfLineup = m.makeLineup));
  }
  app.boot().catch((err) => {
    console.error(err);
  });
}
