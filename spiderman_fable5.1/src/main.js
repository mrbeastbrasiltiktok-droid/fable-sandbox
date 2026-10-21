import { Game } from './core/Game.js';
import { installDevHarness } from './core/DevHarness.js';
import { Missions } from './missions/Missions.js';

const canvas = document.getElementById('game');
const loading = document.getElementById('loading');
const menu = document.getElementById('menu');
const btn = document.getElementById('btn-play');
const btnNew = document.getElementById('btn-new');

let game = null;
setTimeout(() => {
  try {
    game = new Game(canvas);
    window.game = game; // handy for tuning from the console
    if (location.search.includes('dev')) installDevHarness(game);
  } catch (err) {
    loading.querySelector('h2').textContent = 'Failed to start: ' + err.message;
    console.error(err);
    return;
  }
  loading.classList.add('hidden');
  menu.classList.remove('hidden');
  if (Missions.hasSave()) { btn.textContent = 'CONTINUE'; btnNew.classList.remove('hidden'); }
}, 30);

btn.addEventListener('click', () => { if (game) { game.start(); btn.textContent = 'RESUME'; btnNew.classList.add('hidden'); } });
btnNew.addEventListener('click', () => { if (game && !game._started) { game.start({ fresh: true }); btn.textContent = 'RESUME'; btnNew.classList.add('hidden'); } });
canvas.addEventListener('click', () => { if (game && game.paused && !game.uiPaused) game.start(); });
