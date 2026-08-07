/* Settings — units, rest timer, theme, and the backup path (there is no cloud). */

import * as state from '../state.js';
import * as store from '../store.js';
import { el, clear, toast, confirmSheet } from '../ui.js';

let containerRef = null;
let storageInfo = null;

function bytesToMB(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

async function doExport() {
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

/** Only 'light' and 'neon' are real schemes — anything else (including an old
 * saved 'auto'/'dark' from before this toggle existed) falls back to light. */
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'neon' ? 'neon' : 'light');
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

  const themeSelect = el('select', {
    id: 'set-theme',
    onchange: async (e) => { await state.updateSettings({ theme: e.target.value }); applyTheme(e.target.value); }
  }, ...[['light', 'Light'], ['neon', 'High-Contrast Neon']]
    .map(([value, label]) => el('option', { value, selected: (s.settings.theme === 'neon' ? 'neon' : 'light') === value }, label)));

  containerRef.append(el('div', { class: 'card stack' },
    el('h3', { text: 'Preferences' }),
    el('div', { class: 'field' }, el('label', { for: 'set-unit', text: 'Default unit' }), unitSelect),
    el('div', { class: 'field' }, el('label', { for: 'set-rest', text: 'Rest timer (seconds)' }), restInput),
    el('div', { class: 'field' }, el('label', { for: 'set-theme', text: 'Theme' }), themeSelect)
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
    el('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: doExport }, 'Export backup (JSON)'),
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
    el('p', { class: 'small muted', text: `${s.allSets.length} sets and ${s.exercises.length} exercises stored. No audio is ever written to storage.` })
  );
  containerRef.append(storageCard);

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
