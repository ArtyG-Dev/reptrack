/* Hand-rolled SVG line chart. No chart library, no dependency, ~4 KB.
 *
 * computeChart() is pure geometry (unit-tested); renderChart() turns that into
 * SVG nodes plus a visually-hidden data table so screen readers get the numbers.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULTS = {
  width: 640,
  height: 260,
  padLeft: 46,
  padRight: 12,
  padTop: 14,
  padBottom: 30,
  yTicks: 4
};

function niceStep(range, ticks) {
  if (range <= 0) return 1;
  const rough = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return step * mag;
}

/**
 * @param {Array<{label: string, value: number, isPR?: boolean}>} points oldest → newest
 * @returns {{width,height,plot,points:Array<{x,y,...}>,yTicks:Array<{y,value}>,xLabels:Array<{x,label}>,min,max}}
 */
export function computeChart(points = [], options = {}) {
  const o = { ...DEFAULTS, ...options };
  const plot = {
    x: o.padLeft,
    y: o.padTop,
    w: Math.max(10, o.width - o.padLeft - o.padRight),
    h: Math.max(10, o.height - o.padTop - o.padBottom)
  };

  const values = points.map((p) => Number(p.value) || 0);
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;

  const span = rawMax - rawMin;
  const pad = span === 0 ? Math.max(1, rawMax * 0.1) : span * 0.12;
  const step = niceStep((rawMax + pad) - Math.max(0, rawMin - pad), o.yTicks);
  const min = Math.max(0, Math.floor((rawMin - pad) / step) * step);
  const max = Math.ceil((rawMax + pad) / step) * step;
  const range = max - min || 1;

  const xFor = (i) => (points.length <= 1 ? plot.x + plot.w / 2 : plot.x + (i / (points.length - 1)) * plot.w);
  const yFor = (v) => plot.y + plot.h - ((v - min) / range) * plot.h;

  const mapped = points.map((p, i) => ({
    ...p,
    value: Number(p.value) || 0,
    x: Math.round(xFor(i) * 100) / 100,
    y: Math.round(yFor(Number(p.value) || 0) * 100) / 100
  }));

  const yTicks = [];
  for (let v = min; v <= max + 1e-9; v += step) {
    yTicks.push({ value: Math.round(v * 100) / 100, y: Math.round(yFor(v) * 100) / 100 });
  }

  const labelIdx = points.length <= 1
    ? [0]
    : [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const xLabels = labelIdx.filter((i) => i >= 0 && i < mapped.length).map((i) => ({ x: mapped[i].x, label: mapped[i].label }));

  return { width: o.width, height: o.height, plot, points: mapped, yTicks, xLabels, min, max };
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/**
 * Renders into `container` (cleared first).
 * @param {HTMLElement} container
 * @param {Array<{label,value,isPR}>} points
 * @param {{title:string, unitLabel:string, formatValue?:Function}} options
 */
export function renderChart(container, points, options = {}) {
  const { title = 'Progress', unitLabel = '', formatValue = (v) => String(Math.round(v * 10) / 10) } = options;
  container.textContent = '';

  if (!points.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No data yet — log a few sessions and the chart appears here.';
    container.append(p);
    return;
  }

  const c = computeChart(points, options);
  const svg = el('svg', {
    class: 'chart',
    viewBox: `0 0 ${c.width} ${c.height}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
    'aria-label': `${title}. ${points.length} sessions, from ${formatValue(points[0].value)}${unitLabel} on ${points[0].label} to ${formatValue(points.at(-1).value)}${unitLabel} on ${points.at(-1).label}.`
  });

  for (const tick of c.yTicks) {
    svg.append(el('line', { class: 'grid-line', x1: c.plot.x, y1: tick.y, x2: c.plot.x + c.plot.w, y2: tick.y }));
    const label = el('text', { class: 'tick-label', x: c.plot.x - 6, y: tick.y + 4, 'text-anchor': 'end' });
    label.textContent = formatValue(tick.value);
    svg.append(label);
  }

  svg.append(el('line', { class: 'axis', x1: c.plot.x, y1: c.plot.y, x2: c.plot.x, y2: c.plot.y + c.plot.h }));
  svg.append(el('line', { class: 'axis', x1: c.plot.x, y1: c.plot.y + c.plot.h, x2: c.plot.x + c.plot.w, y2: c.plot.y + c.plot.h }));

  if (c.points.length > 1) {
    svg.append(el('polyline', { class: 'series', points: c.points.map((p) => `${p.x},${p.y}`).join(' ') }));
  }

  for (const p of c.points) {
    const dot = el('circle', { class: p.isPR ? 'point point-pr' : 'point', cx: p.x, cy: p.y, r: p.isPR ? 5.5 : 3.5 });
    const t = el('title');
    t.textContent = `${p.label}: ${formatValue(p.value)}${unitLabel}${p.isPR ? ' — personal record' : ''}`;
    dot.append(t);
    svg.append(dot);
  }

  for (const xl of c.xLabels) {
    const label = el('text', { class: 'tick-label', x: xl.x, y: c.height - 8, 'text-anchor': 'middle' });
    label.textContent = xl.label.slice(5);   // MM-DD
    svg.append(label);
  }

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.append(svg);
  container.append(wrap);

  const table = document.createElement('table');
  table.className = 'visually-hidden';
  table.innerHTML = `<caption>${title}</caption><thead><tr><th scope="col">Date</th><th scope="col">Value${unitLabel ? ` (${unitLabel.trim()})` : ''}</th><th scope="col">Personal record</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  for (const p of points) {
    const tr = document.createElement('tr');
    const td = (text) => { const d = document.createElement('td'); d.textContent = text; return d; };
    tr.append(td(p.label), td(formatValue(p.value)), td(p.isPR ? 'yes' : 'no'));
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
}
