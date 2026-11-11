/* Settings — units, rest timer, theme, and the backup path (there is no cloud). */

import * as state from '../state.js';
import * as store from '../store.js';
import * as backdrop from '../backdrop.js';
import { isGlassSkin } from '../backdrop.js';
import { el, clear, toast, confirmSheet } from '../ui.js';

let containerRef = null;
let storageInfo = null;

function bytesToMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/** Whether the browser has promised not to clear RepTrack's data under
 *  storage pressure. Everything lives on this device, so this matters. */
async function showPersistence() {
  const kept = await store.isPersisted();
  const line = document.getElementById('persist-line');
  const ask = document.getElementById('persist-request');
  if (!line) return;
  line.textContent = kept === true
    ? 'Protected: this browser will keep your data even when the device is low on space.'
    : kept === false
      ? 'Not yet protected: if the device runs very low on space, the browser may clear site data. Exporting backups keeps you safe either way.'
      : 'This browser does not say whether it will keep your data. Exporting backups keeps you safe.';
  if (ask) ask.hidden = kept !== false;
}

function lastBackupText(at) {
  if (!at) return 'Never backed up';
  return `Last backup: ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

export async function doExport() {
  const data = await store.exportAll();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `reptrack-backup-${store.todayISO()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Exported ${data.sessions.length} sessions and ${data.sets.length} sets.`);
  await state.updateSettings({ lastExportAt: Date.now() });
}

async function doImport(file, mode) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const { ok, errors } = store.validateBackup(data);
    if (!ok) { toast(errors[0]); return; }
    const counts = await store.importAll(data, { mode });
    await state.reloadAll();
    toast(`Imported ${counts.sessions} sessions, ${counts.sets} sets, ${counts.exercises} exercises.`);
    render(containerRef);
  } catch (error) {
    toast(`Import failed: ${error.message}`);
  }
}

export const THEMES = [
  ['light', 'Light'],
  ['neon', 'High-Contrast Neon'],
  ['terminal', 'Terminal (frosted glass)'],
  ['fractal', 'Fractal (frosted glass)'],
  ['forge', 'Forge (frosted glass)'],
  ['kemet', 'Kemet (frosted glass)'],
  ['monolith', 'Monolith (frosted glass)'],
  ['constellation', 'Constellation (frosted glass)'],
  ['orrery', 'Orrery (frosted glass)']
];

const THEME_IDS = new Set(THEMES.map(([id]) => id));

/** Anything unrecognised — including an old saved 'auto'/'dark' from before the
 *  picker changed — falls back to light rather than leaving a broken theme. */
export function normaliseTheme(theme) {
  return THEME_IDS.has(theme) ? theme : 'light';
}

/** Sets the palette, and flags whether panels should use the glass treatment.
 *  `data-glass` is what css/styles.css keys the frosted panels and the backdrop
 *  canvas off, so the two never disagree about which mode we are in. */
export function applyTheme(theme) {
  const resolved = normaliseTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', resolved);
  if (isGlassSkin(resolved)) root.setAttribute('data-glass', '1');
  else root.removeAttribute('data-glass');
  backdrop.setSkin(isGlassSkin(resolved) ? resolved : null);
}

export function render(container) {
  containerRef = container || containerRef;
  if (!containerRef) return;
  const s = state.getState();

  clear(containerRef);
  containerRef.append(el('h2', { class: 'visually-hidden', text: 'Settings' }));

  /* --- preferences --- */
  const unitSelect = el('select', {
    id: 'set-unit',
    onchange: async (e) => { await state.updateSettings({ unit: e.target.value }); toast(`Default unit is now ${e.target.value}.`); }
  },
    el('option', { value: 'kg', selected: s.settings.unit === 'kg' }, 'Kilograms (kg)'),
    el('option', { value: 'lb', selected: s.settings.unit === 'lb' }, 'Pounds (lb)')
  );

  const restInput = el('input', {
    type: 'number', id: 'set-rest', min: '0', max: '600', step: '15', value: String(s.settings.defaultRestSec),
    onchange: async (e) => { await state.updateSettings({ defaultRestSec: Number(e.target.value) || 0 }); toast('Rest timer updated.'); }
  });

  const currentTheme = normaliseTheme(s.settings.theme);
  const themeSelect = el('select', {
    id: 'set-theme',
    onchange: async (e) => { await state.updateSettings({ theme: e.target.value }); applyTheme(e.target.value); render(containerRef); }
  }, ...THEMES.map(([value, label]) => el('option', { value, selected: currentTheme === value }, label)));

  const figureSelect = el('select', {
    id: 'set-body-figure',
    onchange: async (e) => { await state.updateSettings({ bodyFigure: e.target.value }); toast('Body map figure changed.'); }
  }, ...[['neutral', 'Neutral'], ['male', 'Male'], ['female', 'Female']]
    .map(([value, label]) => el('option', { value, selected: (s.settings.bodyFigure || 'neutral') === value }, label)));

  containerRef.append(el('div', { class: 'card stack' },
    el('h3', { text: 'Preferences' }),
    el('div', { class: 'field' }, el('label', { for: 'set-unit', text: 'Default unit' }), unitSelect),
    el('div', { class: 'field' }, el('label', { for: 'set-body-figure', text: 'Body map figure' }), figureSelect),
    el('div', { class: 'field' }, el('label', { for: 'set-rest', text: 'Rest timer (seconds)' }), restInput),
    el('div', { class: 'field row' },
      el('input', {
        type: 'checkbox', id: 'set-vibrate-rest', style: 'width:auto;min-height:auto', checked: s.settings.vibrateOnRest !== false,
        onchange: async (e) => { await state.updateSettings({ vibrateOnRest: e.target.checked }); }
      }),
      el('label', { for: 'set-vibrate-rest', style: 'margin:0', text: 'Vibrate when rest ends' })),
    el('div', { class: 'field row' },
      el('input', {
        type: 'checkbox', id: 'set-keep-screen-on', style: 'width:auto;min-height:auto', checked: s.settings.keepScreenOn !== false,
        onchange: async (e) => { await state.updateSettings({ keepScreenOn: e.target.checked }); }
      }),
      el('label', { for: 'set-keep-screen-on', style: 'margin:0', text: 'Keep screen on during a session' })),
    el('div', { class: 'field' },
      el('label', { for: 'set-theme', text: 'Theme' }), themeSelect,
      isGlassSkin(currentTheme)
        ? el('p', { class: 'small muted', style: 'margin:4px 0 0', text: 'Frosted glass over a slow background animation. It pauses when the app is in the background and while the mic is listening.' })
        : null
    )
  ));

  /* --- appearance + activity effects --- */
  const reduceToggle = el('input', {
    type: 'checkbox', id: 'set-reduce-effects', style: 'width:auto;min-height:auto',
    checked: Boolean(s.settings.reduceBackgroundEffects),
    onchange: async (e) => {
      await state.updateSettings({ reduceBackgroundEffects: e.target.checked });
      backdrop.setReduceEffects(e.target.checked);
      toast(e.target.checked ? 'Background animation off.' : 'Background animation on.');
    }
  });

  const pauseToggle = el('input', {
    type: 'checkbox', id: 'set-pause-activity', style: 'width:auto;min-height:auto',
    checked: Boolean(s.settings.pauseActivityEffects),
    onchange: async (e) => {
      // Stamp the pause date so the visuals freeze exactly where they are;
      // clearing it resumes from the real clock. Training history is untouched
      // either way — this only affects what the skin draws.
      await state.updateSettings({
        pauseActivityEffects: e.target.checked,
        activityPausedAt: e.target.checked ? store.todayISO() : null
      });
      toast(e.target.checked ? 'Activity effects paused.' : 'Activity effects resumed.');
      render(containerRef);
    }
  });

  containerRef.append(el('div', { class: 'card stack' },
    el('h3', { text: 'Background effects' }),
    el('div', { class: 'field row' }, reduceToggle,
      el('label', { for: 'set-reduce-effects', style: 'margin:0', text: 'Reduce background effects — keep the colours, hold the animation still' })),
    el('p', { class: 'small muted', style: 'margin:0', text: 'Also applied automatically if your device asks for reduced motion.' }),

    el('div', { class: 'field row', style: 'margin-top:14px' }, pauseToggle,
      el('label', { for: 'set-pause-activity', style: 'margin:0', text: 'Pause activity effects' })),
    el('p', { class: 'small muted', style: 'margin:0', text: 'Holds the Forge and Fractal skins where they are — for illness, injury, holidays, or a planned deload. Your training history is kept exactly as it is, and you can switch this back off whenever you like.' }),

    el('div', { class: 'field row', style: 'margin-top:14px' },
      el('button', {
        class: 'btn', id: 'set-reset-fractal-colours', type: 'button',
        onclick: async () => { await state.updateSettings({ fractalColour: { hue: 0, warmth: 0 } }); toast('Fractal colours reset.'); }
      }, 'Reset Fractal colours')),
    el('p', { class: 'small muted', style: 'margin:0', text: 'In the Fractal theme’s full-screen view, dragging changes its colours. This puts them back to the theme’s own.' })
  ));

  /* --- data --- */
  const fileInput = el('input', {
    type: 'file', id: 'import-file', accept: 'application/json,.json',
    onchange: async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const replace = await confirmSheet({
        title: 'Replace or merge?',
        message: 'Replace wipes what is here and restores the backup. Merge keeps existing data and overwrites only matching entries.',
        confirmLabel: 'Replace',
        cancelLabel: 'Merge',
        danger: true
      });
      await doImport(file, replace ? 'replace' : 'merge');
      e.target.value = '';
    }
  });

  containerRef.append(el('div', { class: 'card stack' },
    el('h3', { text: 'Your data' }),
    el('p', { class: 'small muted', text: 'Everything lives in this browser on this device. There is no account and nothing is uploaded, so an export is your only backup.' }),
    el('p', { class: 'small muted', id: 'last-backup', style: 'margin:0', text: lastBackupText(s.settings.lastExportAt) }),
    el('button', { class: 'btn btn-primary btn-block', id: 'export-json', type: 'button', onclick: doExport }, 'Export backup (JSON)'),
    el('div', { class: 'field' }, el('label', { for: 'import-file', text: 'Import a backup' }), fileInput),
    el('button', {
      class: 'btn btn-danger btn-block', type: 'button',
      onclick: async () => {
        const yes = await confirmSheet({
          title: 'Wipe all data?',
          message: 'Every session, set and custom exercise is deleted from this device. Export a backup first if you want to keep it.',
          confirmLabel: 'Wipe everything',
          danger: true
        });
        if (!yes) return;
        await store.wipeAll();
        await state.init();
        toast('All data wiped.');
        render(containerRef);
      }
    }, 'Wipe all data')
  ));

  /* --- storage + about --- */
  const storageCard = el('div', { class: 'card stack' },
    el('h3', { text: 'Storage' }),
    el('p', { class: 'small muted', id: 'storage-line', text: storageInfo
      ? `Using ${bytesToMB(storageInfo.usage)} MB of an available ${bytesToMB(storageInfo.quota)} MB.`
      : 'Checking…' }),
    el('p', { class: 'small muted', text: `${s.allSets.length} sets and ${s.exercises.length} exercises stored. No audio is ever written to storage.` }),
    el('p', { class: 'small', id: 'persist-line', text: 'Checking whether this browser will keep your data…' }),
    el('button', {
      class: 'btn btn-block', id: 'persist-request', type: 'button', hidden: true,
      onclick: async () => { await store.requestPersistence(); showPersistence(); }
    }, 'Ask the browser to keep my data')
  );
  containerRef.append(storageCard);
  showPersistence();

  store.estimateUsage().then((info) => {
    storageInfo = info;
    const line = document.getElementById('storage-line');
    if (!line) return;
    line.textContent = info
      ? `Using ${bytesToMB(info.usage)} MB of an available ${bytesToMB(info.quota)} MB.`
      : 'Storage estimate is unavailable in this browser.';
  });

  containerRef.append(el('div', { class: 'card stack' },
    el('h3', { text: 'About' }),
    el('p', { class: 'small muted', text: 'RepTrack — voice-first, offline gym tracker. Vanilla HTML/CSS/JS, no framework, no build step, no network calls at runtime.' }),
    el('p', { class: 'small muted', text: 'Voice input runs one phrase at a time on an explicit mic tap. The transcript is parsed and the audio is never captured or stored.' })
  ));
}
