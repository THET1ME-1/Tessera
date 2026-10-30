/* Общие кирпичи оформления: значки, карточка, форматы чисел. Ими рисуют и
   вкладки ядра (core-views.js), и заготовки модулей (blocks.js). */

const ICON = {
  overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  screens: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2"/>',
  funnels: '<path d="M3.5 4.5h17l-6.5 8v6l-4 2v-8z"/>',
  versions: '<path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/>',
  apps: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M3.5 9.5h17"/>',
  chart: '<path d="M4 20V10M9.3 20V4M14.6 20v-7M20 20V8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l9-11h-6z"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M15 9c-.6-1.2-1.7-1.8-3-1.8-1.8 0-3 1-3 2.4 0 3.3 6 1.8 6 5 0 1.5-1.3 2.4-3 2.4-1.4 0-2.6-.7-3.1-1.9M12 5.5v13"/>',
  calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4.5V11h-6.5"/>',
  export: '<path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4.5 19.5h15"/>',
  heart: '<path d="M12 19.5s-7.5-4.4-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.6-7.5 10-7.5 10z"/>',
  spark: '<path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.6 2.6M15.4 15.4 18 18M6 18l2.6-2.6M15.4 8.6 18 6"/>',
  brush: '<path d="M19.5 4.5 10 14"/><path d="M10 14c-2-.5-4 .5-4.5 2.5S4 20 4 20s3.5.5 5.5-1 1.5-3 .5-5z"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8.5 8.5"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  card: '<rect x="3.5" y="6" width="17" height="12" rx="2"/><path d="M3.5 10h17M7 14.5h3"/>',
  ad: '<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M7.5 15l2.5-6 2.5 6M8.3 13.2h3.4M15 9v6h1.2a2.2 2.2 0 0 0 0-4.4H15"/>',
  gift: '<rect x="4" y="9" width="16" height="11" rx="1.5"/><path d="M12 9v11M4 13h16M12 9c-1.5-4-6-4.5-6-2s4 2 6 2c2 0 6 .5 6-2s-4.5-2-6 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>',
  note: '<path d="M6 3.5h9l4 4v13H6z"/><path d="M14.5 3.5v4.5H19M9 12h7M9 15.5h7"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1"/><circle cx="4.8" cy="12" r="1"/><circle cx="4.8" cy="17.5" r="1"/>',
};
const svg = (name, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${ICON[name] || ICON.grid}</svg>`;

const nf = new Intl.NumberFormat('ru-RU'), nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = v => nf.format(Math.round(v || 0));
const money = v => nf2.format(v || 0) + ' $';
/* прирост к прошлому: «+12,4 %», «−3,0 %» */
const pctd = v => (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %';
const dec = (v, d = 1) => (v || 0).toFixed(d).replace('.', ',');
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MONTH_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTH_IN = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const day = d => +d.slice(8) + ' ' + MON[+d.slice(5, 7) - 1];
const short = v => v >= 1e6 ? (v / 1e6).toFixed(1).replace('.0', '').replace('.', ',') + ' млн' : v >= 1000 ? String(+(v / 1000).toFixed(1)).replace('.', ',') + ' тыс' : String(Math.round(v * 100) / 100).replace('.', ',');
const plural = (k, one, few, many) => { const a = k % 10, b = k % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
const avgOf = (list, f) => list.length ? list.reduce((s, x) => s + f(x), 0) / list.length : 0;
/* круглый шаг: 1, 2, 2,5, 5 на степень десяти */
const nice = raw => { if (!(raw > 0)) return 1; const p = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw); };
/* доли на целое число клеток без потери суммы */
function share(values, total) {
  const sum = values.reduce((a, b) => a + b, 0) || 1, raw = values.map(v => v / sum * total), out = raw.map(Math.floor);
  const left = total - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0]).slice(0, left).forEach(([, i]) => out[i]++);
  return out;
}
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/* Карточка: серая оболочка, шапка со значком, белая вкладка с данными. */
const card = (icon, h, sub, right, body, attrs = '') => `<section class="card" ${attrs}><header class="ch"><span class="it">${svg(icon)}</span><div><h2>${h}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="cr">${right || ''}</div></header><div class="in">${body}</div></section>`;
const strip = items => `<div class="strip">${items.map(i => `<div><span class="k">${i.k}</span><b class="v ${i.cls || ''}">${i.v}</b>${i.s ? `<span class="s">${i.s}</span>` : ''}</div>`).join('')}</div>`;
const pie = (p, cls = 't1') => { const r = 8, c = 2 * Math.PI * r; return `<svg class="pie" viewBox="0 0 34 34"><circle cx="17" cy="17" r="15.5" fill="var(--sunk)" stroke="var(--line)"/><circle cx="17" cy="17" r="11" fill="var(--b5)"/><circle cx="17" cy="17" r="${r}" fill="none" stroke-width="${r * 2}" stroke-dasharray="${(p * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 17 17)" style="stroke:var(--${cls.replace('t', 'b')})"/></svg>`; };
