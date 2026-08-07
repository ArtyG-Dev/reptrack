/* App shell: boots state, wires the tab router, registers the service worker. */

import * as state from './state.js';
import { toast } from './ui.js';
import * as todayView from './views/today.js';
import * as diaryView from './views/diary.js';
import * as progressView from './views/progress.js';
import * as exercisesView from './views/exercises.js';
import * as settingsView from './views/settings.js';

const VIEWS = {
  today: { module: todayView, section: 'view-today', tab: 'tab-today' },
  diary: { module: diaryView, section: 'view-diary', tab: 'tab-diary' },
  progress: { module: progressView, section: 'view-progress', tab: 'tab-progress' },
  exercises: { module: exercisesView, section: 'view-exercises', tab: 'tab-exercises' },
  settings: { module: settingsView, section: 'view-settings', tab: 'tab-settings' }
};

const ORDER = Object.keys(VIEWS);
let active = 'today';

async function renderActive() {
  const entry = VIEWS[active];
  if (!entry) return;
  entry.module.render(document.getElementById(entry.section));
}

async function activate(name, { focus = false } = {}) {
  if (!VIEWS[name]) name = 'today';
  active = name;

  for (const [key, entry] of Object.entries(VIEWS)) {
    const isActive = key === name;
    const section = document.getElementById(entry.section);
    const tab = document.getElementById(entry.tab);
    if (section) section.hidden = !isActive;
    if (tab) {
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
      tab.tabIndex = isActive ? 0 : -1;
      if (isActive && focus) tab.focus();
    }
  }

  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  await renderActive();
}

function wireTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => activate(tab.dataset.view));
    tab.addEventListener('keydown', (event) => {
      const index = ORDER.indexOf(tab.dataset.view);
      let next = null;
      if (event.key === 'ArrowRight') next = ORDER[(index + 1) % ORDER.length];
      else if (event.key === 'ArrowLeft') next = ORDER[(index - 1 + ORDER.length) % ORDER.length];
      else if (event.key === 'Home') next = ORDER[0];
      else if (event.key === 'End') next = ORDER.at(-1);
      if (!next) return;
      event.preventDefault();
      activate(next, { focus: true });
    });
  }
}

function wireStatus() {
  const status = document.getElementById('app-status');
  const paint = () => {
    if (!status) return;
    status.textContent = navigator.onLine ? 'Offline ready' : 'Offline — everything still works';
  };
  addEventListener('online', paint);
  addEventListener('offline', paint);
  paint();
}

/** `?theme=light|neon` previews a scheme without changing the saved setting —
 * used by scripts/run-lighthouse.mjs to score both themes. */
function wireTheme() {
  const override = new URLSearchParams(location.search).get('theme');
  const theme = override === 'light' || override === 'neon' ? override : state.getState().settings.theme;
  settingsView.applyTheme(theme);
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;   // file:// has no SW
  try {
    await navigator.serviceWorker.register('sw.js', { scope: './' });
  } catch (error) {
    console.warn('Service worker registration failed — the app still runs, just without offline caching.', error);
  }
}

async function boot() {
  wireTabs();
  wireStatus();

  try {
    await state.init();
  } catch (error) {
    const main = document.getElementById('main');
    if (main) main.textContent = `RepTrack could not open its database: ${error.message}`;
    return;
  }

  wireTheme();
  todayView.startTicker();

  state.subscribe(() => { renderActive(); });

  const initial = location.hash.slice(1);
  await activate(VIEWS[initial] ? initial : 'today');

  addEventListener('hashchange', () => {
    const name = location.hash.slice(1);
    if (VIEWS[name] && name !== active) activate(name);
  });

  await registerServiceWorker();
}

boot().catch((error) => {
  console.error(error);
  toast('Something went wrong starting RepTrack.');
});
