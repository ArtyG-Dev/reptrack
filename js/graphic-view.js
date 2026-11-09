/* The full-screen graphic view: the active skin's scene with every panel out
 * of the way, re-framed to fill the viewport.
 *
 * Exits, all of which land in close(): the close button, Esc, leaving native
 * fullscreen, and the Android back gesture — which is why opening pushes a
 * history entry, so "back" pops the view instead of leaving the app.
 *
 * Every safety rule still applies because none of them live here: the flash
 * limiter, the reduced-motion static frame and the background pause are all in
 * backdrop.js, and this only asks it for a different framing and frame cap.
 */

import * as backdrop from './backdrop.js';
import { el } from './ui.js';

const NAMES = { kemet: 'Kemet', forge: 'Forge', fractal: 'Fractal', terminal: 'Terminal' };
const DRAGGABLE = new Set(['kemet', 'forge']);
const TAP_SLOP_PX = 6;
const KEY_NUDGE_PX = 14;          // an arrow key turns the scene as far as a 14px drag
const SHELL = ['.app-bar', '#main', '.tabbar', '.skip-link'];

let root = null;
let openFor = null;          // skin name while open
let pushedHistory = false;
let returnFocusId = null;

export function skinLabel(skin) {
  return NAMES[skin] || 'theme';
}

/** "Tier 6 of 10 · 58% this month" — the current level, stated plainly. Only
 *  ever what has been earned; never a count of anything missed. */
export function levelText(skin, { streakLevel = 0, monthPercent = 0 } = {}) {
  const word = skin === 'kemet' ? 'Tier' : 'Level';
  return `${word} ${streakLevel} of 10 · ${Math.round(monthPercent * 100)}% this month`;
}

function build() {
  const stage = el('div', { class: 'graphic-stage', id: 'graphic-stage', 'aria-hidden': 'true' });
  const level = el('p', { class: 'graphic-level', id: 'graphic-level' });
  const toggle = el('button', {
    class: 'btn graphic-btn', id: 'graphic-level-toggle', type: 'button',
    'aria-controls': 'graphic-level', onclick: () => toggleLevel()
  }, 'Hide level');
  const close = el('button', {
    class: 'btn graphic-btn', id: 'graphic-close', type: 'button', 'aria-label': 'Close full-screen graphic',
    onclick: () => close_()
  }, '✕');
  root = el('div', { class: 'graphic-view', id: 'graphic-view', role: 'dialog', 'aria-modal': 'true', hidden: true },
    stage,
    el('div', { class: 'graphic-bar' }, toggle, close),
    level
  );
  document.body.append(root);

  wireDrag(stage);
  root.addEventListener('keydown', onKey);
  addEventListener('popstate', () => { if (openFor) { pushedHistory = false; close_(); } });
  document.addEventListener('fullscreenchange', () => {
    if (openFor && !document.fullscreenElement && root.dataset.fullscreen === '1') close_();
  });
}

function toggleLevel(force) {
  const level = document.getElementById('graphic-level');
  const toggle = document.getElementById('graphic-level-toggle');
  const show = force ?? level.hidden;
  level.hidden = !show;
  toggle.textContent = show ? 'Hide level' : 'Show level';
}

/** Drag turns Kemet and Forge about both axes through the one shared orbit
 *  (theme-engine.js, via backdrop.grab/dragBy/release) — nothing here knows
 *  which scene it is turning. A tap anywhere shows or hides the level overlay. */
function wireDrag(stage) {
  let start = null;
  let last = null;
  stage.addEventListener('pointerdown', (event) => {
    start = { x: event.clientX, y: event.clientY, moved: false };
    last = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture?.(event.pointerId);
    if (DRAGGABLE.has(openFor)) backdrop.grab();
  });
  stage.addEventListener('pointermove', (event) => {
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) start.moved = true;
    if (DRAGGABLE.has(openFor)) backdrop.dragBy(event.clientX - last.x, event.clientY - last.y);
    last = { x: event.clientX, y: event.clientY };
  });
  const end = () => {
    if (!start) return;
    if (!start.moved) toggleLevel();
    start = null;
    if (DRAGGABLE.has(openFor)) backdrop.release();
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
}

function onKey(event) {
  if (event.key === 'Escape') { event.preventDefault(); close_(); return; }
  const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (DRAGGABLE.has(openFor) && nudge) {
    event.preventDefault();
    backdrop.grab();
    backdrop.dragBy(nudge[0] * KEY_NUDGE_PX, nudge[1] * KEY_NUDGE_PX);
    backdrop.release();
    return;
  }
  if (event.key === 'Tab') {                 // keep focus inside the dialog
    const focusable = [...root.querySelectorAll('button')];
    const i = focusable.indexOf(document.activeElement);
    const next = event.shiftKey ? (i <= 0 ? focusable.length - 1 : i - 1) : (i + 1) % focusable.length;
    event.preventDefault();
    focusable[next].focus();
  }
}

export function isOpen() {
  return Boolean(openFor);
}

export function open(skin, { returnFocus = 'view-graphic' } = {}) {
  if (!NAMES[skin] || openFor) return;
  if (!root) build();
  openFor = skin;
  returnFocusId = returnFocus;

  // What the scene is drawing — app.js feeds it from state.activityVisual(),
  // so the label and the picture can never disagree.
  const { streakLevel, monthPercent } = backdrop.getDiagnostics().activity;
  document.getElementById('graphic-level').textContent = levelText(skin, { streakLevel, monthPercent });
  toggleLevel(true);
  root.setAttribute('aria-label', `${skinLabel(skin)} graphic, full screen`);
  root.dataset.skin = skin;
  root.hidden = false;
  document.documentElement.dataset.graphicView = '1';
  for (const sel of SHELL) document.querySelector(sel)?.setAttribute('inert', '');

  backdrop.setFullView(true);
  history.pushState({ graphicView: true }, '', location.href);
  pushedHistory = true;

  root.dataset.fullscreen = '0';
  const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  fs?.then(() => { root.dataset.fullscreen = '1'; }).catch(() => {});   // the fixed overlay is the fallback

  document.getElementById('graphic-close').focus();
}

function close_() {
  if (!openFor) return;
  openFor = null;
  root.hidden = true;
  delete document.documentElement.dataset.graphicView;
  for (const sel of SHELL) document.querySelector(sel)?.removeAttribute('inert');
  backdrop.release();
  backdrop.setFullView(false);
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  root.dataset.fullscreen = '0';
  if (pushedHistory) { pushedHistory = false; history.back(); }
  document.getElementById(returnFocusId)?.focus();
}

export { close_ as close };
