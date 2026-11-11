/* Small DOM toolkit: element builder, toasts, and <dialog>-based sheets.
 * No browser confirm()/alert() anywhere in the app — every prompt is one of
 * these, so it can be styled, focus-managed and screen-reader friendly.
 */

/**
 * el('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Label', childNode)
 * Text children are set with textContent, so nothing here can inject markup.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.textContent = '';
  return node;
}

let toastTimer = null;
/** A brief status message. `action` adds one button (e.g. "Export now") —
 *  still a toast: it never blocks anything and goes away on its own. */
export function toast(message, ms = 2600, { action = null } = {}) {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  if (action) {
    node.append(' ', el('button', {
      class: 'btn btn-sm toast-action', type: 'button',
      onclick: () => { node.hidden = true; action.onClick(); }
    }, action.label));
  }
  node.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.hidden = true; }, ms);
}

/**
 * Opens a modal sheet. `build(ctx)` returns the sheet body; call ctx.close(value)
 * to resolve. Escape resolves with `null`. Focus returns to the previous element.
 */
export function openSheet(dialogId, build, { labelledBy } = {}) {
  const dialog = document.getElementById(dialogId);
  if (!dialog) return Promise.resolve(null);

  const previous = document.activeElement;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.removeEventListener('close', onClose);
      clear(dialog);
      if (previous instanceof HTMLElement) previous.focus();
      resolve(value);
    };
    // dialog.close() queues its 'close' event, so a sheet opened in the same
    // dialog straight after another would receive the old one's event and
    // shut at once. A close event while the dialog is open again is that stale one.
    const onClose = () => { if (!dialog.open) finish(null); };

    const ctx = { close: (value) => { dialog.close(); finish(value); } };

    clear(dialog);
    const inner = el('div', { class: 'sheet-inner' });
    inner.append(build(ctx));
    dialog.append(inner);
    if (labelledBy) dialog.setAttribute('aria-labelledby', labelledBy);
    dialog.addEventListener('close', onClose);
    dialog.showModal();

    const focusTarget = dialog.querySelector('[data-autofocus]') || dialog.querySelector('button, input, select, textarea');
    focusTarget?.focus();
  });
}

/** Styled replacement for window.confirm. Resolves true/false. */
export async function confirmSheet({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  dialogId = 'confirm-sheet'
}) {
  const titleId = 'confirm-sheet-title';
  const result = await openSheet(dialogId, (ctx) => el('div', {},
    el('h2', { id: titleId, text: title }),
    message ? el('p', { class: 'muted', text: message }) : null,
    el('div', { class: 'sheet-actions' },
      el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(false), 'data-autofocus': '' }, cancelLabel),
      el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', onclick: () => ctx.close(true) }, confirmLabel)
    )
  ), { labelledBy: titleId });
  return result === true;
}

/** Styled replacement for window.prompt. Resolves the string, or null if cancelled. */
export async function promptSheet({
  title,
  label,
  value = '',
  placeholder = '',
  confirmLabel = 'Save',
  dialogId = 'prompt-sheet'
}) {
  const titleId = 'prompt-sheet-title';
  return openSheet(dialogId, (ctx) => {
    const input = el('input', { type: 'text', id: 'prompt-input', value, placeholder, 'data-autofocus': '' });
    const form = el('form', {
      method: 'dialog',
      onsubmit: (event) => { event.preventDefault(); ctx.close(input.value.trim()); }
    },
      el('h2', { id: titleId, text: title }),
      el('div', { class: 'field' }, el('label', { for: 'prompt-input', text: label }), input),
      el('div', { class: 'sheet-actions' },
        el('button', { class: 'btn', type: 'button', onclick: () => ctx.close(null) }, 'Cancel'),
        el('button', { class: 'btn btn-primary', type: 'submit' }, confirmLabel)
      )
    );
    return form;
  }, { labelledBy: titleId });
}

/**
 * One-tap share/save for generated text. Uses Web Share with a real .txt file
 * where the platform supports it (Android Chrome does), and falls back to a
 * plain download everywhere else. Never touches the network.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareOrDownloadText(text, filename, title = 'RepTrack') {
  const file = typeof File === 'function' ? new File([text], filename, { type: 'text/plain' }) : null;

  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      // Anything else (NotAllowedError, unsupported target) falls through to the download.
    }
  }

  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

/**
 * Accessible disclosure (show/hide) panel — the WAI-ARIA APG "Disclosure"
 * pattern. The trigger is a real `<button>`, so Enter/Space work for free with
 * no extra key handling. The panel is hidden with the `hidden` attribute (not
 * a CSS class), and `aria-expanded`/`aria-controls` stay in sync with it —
 * that combination is what makes this a real disclosure widget rather than
 * just visually hiding a div.
 * @param {{id:string, summary:string, expanded:boolean, onToggle:(next:boolean)=>void, content:Node}} options
 */
export function disclosure({ id, summary, expanded, onToggle, content }) {
  const panelId = `${id}-panel`;
  const triggerId = `${id}-trigger`;
  const trigger = el('button', {
    class: 'disclosure-trigger', type: 'button', id: triggerId,
    'aria-expanded': expanded ? 'true' : 'false', 'aria-controls': panelId,
    onclick: () => onToggle(!expanded)
  },
    el('span', { class: 'disclosure-chevron', 'aria-hidden': 'true' }, expanded ? '▾' : '▸'),
    el('span', { class: 'disclosure-summary' }, summary)
  );
  const panel = el('div', {
    id: panelId, class: 'disclosure-panel', role: 'region', 'aria-labelledby': triggerId,
    hidden: !expanded
  }, content);
  return el('div', { class: 'disclosure' }, trigger, panel);
}

/** "downward dog" → "Downward Dog". Used for category labels, which may be freeform. */
export function titleCase(text) {
  return String(text).replace(/\b\w/g, (c) => c.toUpperCase());
}

/* ---------- formatting ---------- */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function parseISO(dateISO) {
  const [y, m, d] = String(dateISO).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function monthLabel(year, monthIndex) {
  return `${MONTHS[monthIndex]} ${year}`;
}

export function humanDate(dateISO) {
  const d = parseISO(dateISO);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

export function longDate(dateISO) {
  const d = parseISO(dateISO);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function clockTime(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export { MONTHS, DOW };
