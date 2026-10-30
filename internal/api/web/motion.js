/* Движение панели.
 *
 * Одна кривая на всё: быстрый старт и долгое мягкое торможение, без отскоков.
 * Анимации идут через Web Animations: если они не запустятся (фоновая вкладка,
 * снимок без экрана), блок просто стоит на своём месте — ни одна карточка не
 * спрятана классом, который снимает таймер. «Уменьшить движение» в системе
 * гасит всё. */

const EASE = 'cubic-bezier(.22,1,.36,1)', EASE_IO = 'cubic-bezier(.65,0,.35,1)';
const CALM = matchMedia('(prefers-reduced-motion: reduce)');
const anim = (el, frames, opt) => el && el.animate && !CALM.matches ? el.animate(frames, { easing: EASE, fill: 'backwards', ...opt }) : null;
const RISE = [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }];
const FADE = [{ opacity: 0 }, { opacity: 1 }];
const GROW_X = [{ transform: 'scaleX(0)' }, { transform: 'none' }], GROW_Y = [{ transform: 'scaleY(0)' }, { transform: 'none' }];

/* Числа перетекают. Разбираем «16 508 209», «4 169,28 $», «16,5 млн» на число,
   знаки после запятой и подписи вокруг. Диапазоны, время и даты не трогаем:
   «09–12», «14:00» и «14 авг» не величины. */
const NUM_SEL = [
  '.act-sum > b', '.mtab .v', '.strip .v', '.ph-big b', '.ph-r b', '.ds b', '.li .r b', '.wl .num',
  '.at-r > span', '.od-r .num', '.ls-r .r b', '.tl-r .amt', '.dial .mid .num', '.pad b.num', '.age-l b',
  '#sel-n', '#sel-sum', '.mt-r b', '.sp-k b', '.wv-t b', '#wk-v', '.ib-big > b', '.ib-leg b', '.db-v b',
  '.mb-v', '.ab-r b.v', '.mr-l b', '.stat-val', '.lrow b', '.fval', '.tbl td.r',
].join(', ');
function numParts(text) {
  if (/[–:]/.test(text) || /\d\s(янв|фев|мар|апр|мая|июн|июл|авг|сен|окт|ноя|дек)/.test(text)) return null;
  const m = text.match(/\d+(?:[\s  ]\d{3})*(?:,\d+)?/);
  if (!m) return null;
  const v = parseFloat(m[0].replace(/[\s  ]/g, '').replace(',', '.'));
  return isFinite(v) ? { v, dec: (m[0].split(',')[1] || '').length, pre: text.slice(0, m.index), post: text.slice(m.index + m[0].length) } : null;
}
function tween(el, from, to, p, ms = 900, delay = 0) {
  if (CALM.matches || from === to || el.children.length) return;
  const f = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec });
  const final = el.textContent, t0 = performance.now() + delay;
  cancelAnimationFrame(el._tw);
  el.textContent = p.pre + f.format(from) + p.post;
  const step = t => {
    const k = Math.max(0, Math.min(1, (t - t0) / ms));
    if (k >= 1) { el.textContent = final; return; }
    el.textContent = p.pre + f.format(from + (to - from) * (1 - Math.pow(1 - k, 4))) + p.post;
    el._tw = requestAnimationFrame(step);
  };
  el._tw = requestAnimationFrame(step);
}
/* Поставить новый текст, а число в нём довести от старого значения. */
function tweenText(el, text, ms = 420) {
  if (!el) return;
  const a = numParts(el.textContent), b = numParts(text);
  cancelAnimationFrame(el._tw);
  el.textContent = text;
  if (a && b && a.pre === b.pre && a.post === b.post) tween(el, a.v, b.v, b, ms);
}
const countIn = (root, d) => root.querySelectorAll(NUM_SEL).forEach(e => { const p = numParts(e.textContent); if (p && p.v) tween(e, 0, p.v, p, 1100, d); });

/* Графики прорисовываются каждый по-своему: квадратики волной, лучи из центра,
   столбики от основания, полосы слева направо. */
function drawIn(root, d = 0) {
  const stag = (sel, frames, step, dur = 520, cap = 700, off = 0) => root.querySelectorAll(sel).forEach((e, i) => anim(e, frames, { duration: dur, delay: d + off + Math.min(i * step, cap) }));
  // люди по дням: волна слева направо, внутри суток сверху вниз
  const rects = [...root.querySelectorAll('.mx-plot rect:not(.hov)')];
  if (rects.length) {
    const max = Math.max(...rects.map(r => +r.getAttribute('x'))) || 1;
    rects.forEach(r => anim(r, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: 600, delay: d + r.getAttribute('x') / max * 720 + r.getAttribute('y') * 1.6 }));
  }
  stag('.mx .ry, .mx-x', FADE, 0, 600, 0, 200);
  root.querySelectorAll('.br-plot svg').forEach(e => anim(e, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 1200, delay: d + 200, easing: EASE_IO }));
  stag('.br-hd, .br-x span', FADE, 0, 500, 0, 1100);
  stag('.mtab', RISE, 70, 600, 300, 120);
  stag('.plat i', GROW_X, 90, 800, 200, 300);
  // сутки: лучи вырастают из центра по ходу часовой стрелки
  root.querySelectorAll('.dial .bar').forEach(e => anim(e, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 700, delay: d + e.dataset.k * 26 }));
  stag('.dial .track, .dial .face', FADE, 0, 500);
  stag('.dial .lbl, .dial .now, .dial .mid', FADE, 40, 500, 200, 300);
  stag('.ds', RISE, 70, 560, 300, 150);
  // сборки: полоски набираются снизу вверх, колонка за колонкой
  root.querySelectorAll('.ver').forEach((col, c) => [...col.children].reverse().forEach((e, k) => anim(e, [{ opacity: 0, transform: 'scaleX(.3)' }, { opacity: 1, transform: 'none' }], { duration: 440, delay: d + c * 60 + k * 32 })));
  root.querySelectorAll('.pie circle:last-of-type').forEach((e, i) => { const to = e.getAttribute('stroke-dasharray'); anim(e, [{ strokeDasharray: `0 ${to.split(' ')[1]}` }, { strokeDasharray: to }], { duration: 1000, delay: d + 250 + i * 120 }); });
  stag('.li', RISE, 45, 520, 400, 100);
  // телефон: плитки выкладываются от крупной к мелкой
  root.querySelectorAll('.ph-screen .tile').forEach(e => anim(e, [{ opacity: 0, transform: 'scale(.9)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 640, delay: d + e.dataset.i * 60 }));
  stag('.ph-side > *', RISE, 50, 520, 400, 200);
  drawAct(root, d);
  // люди
  stag('.td-row.up i', GROW_Y, 7, 640, 620);
  stag('.td-row.dn i', GROW_Y, 7, 640, 620, 60);
  stag('.tide .pin, .td-y, .td-x', FADE, 0, 600, 0, 700);
  stag('.mt-sq', [{ transform: 'scale(0)' }, { transform: 'none' }], 180, 900, 400);
  stag('.mt-r, .mt-pl', RISE, 70, 560, 400, 200);
  stag('.mt-pl .plat i', GROW_X, 90, 800, 200, 500);
  stag('.wv-line', [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 260, 1500, 300, 100);
  stag('.wv-end', FADE, 260, 500, 300, 1300);
  stag('.wv .ry, .wv-x', FADE, 0, 600);
  stag('.wv-t > *', FADE, 25, 500, 400, 300);
  root.querySelectorAll('.wk i').forEach(c => anim(c, [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], { duration: 520, delay: d + c.dataset.h * 16 + c.dataset.d * 34 }));
  stag('.wk > span, .wk-read', FADE, 0, 600, 0, 300);
  stag('.sp-line', [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], 160, 1200, 400, 100);
  stag('.sp-a, .sp-dot', FADE, 80, 600, 400, 700);
  stag('.sp-r, .sp-day, .sp-x', RISE, 70, 520, 400);
  // экраны
  stag('.strip > div', RISE, 70, 520, 300);
  stag('.tl-r', RISE, 30, 500, 360);
  stag('.track .bar', GROW_X, 30, 820, 360, 120);
  stag('.track .ring', FADE, 30, 400, 360, 600);
  stag('.hist i', GROW_Y, 18, 600, 400);
  stag('.fsec', RISE, 60, 520, 300);
  // заготовки модулей
  stag('.ib-bar i', GROW_X, 90, 800, 400, 100);
  stag('.ib-leg > span, .ib-none', RISE, 50, 500, 300, 250);
  stag('.db-r', RISE, 60, 520, 400, 150);
  root.querySelectorAll('.db-r').forEach((r, i) => {
    anim(r.querySelector('.db-line'), GROW_X, { duration: 800, delay: d + 300 + i * 60 });
    anim(r.querySelector('.db-dot'), [{ opacity: 0, transform: 'translate(-50%,-50%) scale(0)' }, { opacity: 1, transform: 'translate(-50%,-50%)' }], { duration: 500, delay: d + 700 + i * 60 });
  });
  stag('.waffle i', [{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'none' }], 12, 460, 650);
  stag('.wl', RISE, 40, 500, 300, 200);
  stag('.mb-c i', GROW_Y, 70, 760, 500, 100);
  stag('.mb-v, .mb .ry, .mb-x', FADE, 70, 500, 500, 600);
  stag('.ab-r, .lrow', RISE, 50, 500, 400, 120);
  stag('.ab-bar i, .ab-e i, .rowbar span', GROW_X, 40, 760, 400, 250);
  stag('.mr i', [{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'none' }], 2, 460, 700);
  stag('.mr-l', RISE, 50, 500, 400, 200);
  stag('.nt-i', RISE, 70, 520, 400);
  stag('.fstep .fill', GROW_X, 80, 800, 500, 100);
  stag('.tbl tbody tr', RISE, 30, 480, 400, 80);
  stag('.stat-parts, .stat-sub', RISE, 60, 500, 200, 200);
  stag('.shelf figure', [{ opacity: 0, transform: 'scale(.94)', filter: 'blur(4px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], 16, 560, 600, 100);
  stag('.shelf-bar > *, .search-row, .search-hint, .shelf-nav', RISE, 50, 500, 300);
}
function drawAct(root, d = 0) {
  const stag = (sel, frames, step, dur, off = 0) => root.querySelectorAll(sel).forEach((e, i) => anim(e, frames, { duration: dur, delay: d + off + Math.min(i * step, 500) }));
  stag('.act-sum > *', RISE, 60, 500);
  stag('.rc-cols i', GROW_Y, 110, 820, 80);
  stag('.rc-cols i > *', FADE, 110, 400, 620);
  stag('.rc .ry, .rc-x', FADE, 0, 500, 100);
  stag('.at-r, .od-r, .ls-r', [{ opacity: 0, transform: 'translateX(-8px)' }, { opacity: 1, transform: 'none' }], 55, 540, 140);
  root.querySelectorAll('.od-r').forEach((r, ri) => r.querySelectorAll('.od-c i span').forEach((e, k) => anim(e, GROW_X, { duration: 380, delay: d + 180 + ri * 70 + k * 45 })));
  stag('.ls-bar i', GROW_X, 55, 820, 220);
}
/* Высота блока перетекает от старой к новой, а не прыгает. */
function morph(box, paint) {
  const h0 = box.offsetHeight;
  paint();
  if (CALM.matches || !h0) return;
  const h1 = box.offsetHeight;
  if (Math.abs(h1 - h0) < 2) return;
  box.style.overflow = 'hidden';
  box.animate([{ height: h0 + 'px' }, { height: h1 + 'px' }], { duration: 480, easing: EASE }).finished.then(() => box.style.overflow = '');
}

/* Выбранный пункт в переключателях: подложка переезжает к новому пункту, даже
   если блок перерисован целиком. Место подложки помнится по имени группы. */
const thumbAt = {};
function segThumbs() {
  document.querySelectorAll('.segc, .seg, .theme, .tabs').forEach((g, gi) => {
    const key = g.id || g.getAttribute('aria-label') || 'g' + gi;
    let th = g.querySelector(':scope > .thumb');
    if (!th) { th = document.createElement('span'); th.className = 'thumb'; g.prepend(th); }
    const on = g.querySelector(':scope > [aria-pressed="true"], :scope > [aria-selected="true"]');
    if (!on || !on.offsetWidth) { th.style.opacity = 0; return; }
    const to = { x: on.offsetLeft, y: on.offsetTop, w: on.offsetWidth, h: on.offsetHeight }, from = thumbAt[key] || to;
    const tabs = g.classList.contains('tabs');
    const put = p => { th.style.width = p.w + 'px'; th.style.transform = `translate(${p.x}px,${tabs ? 0 : p.y - 3}px)`; if (!tabs) th.style.height = p.h + 'px'; };
    th.style.opacity = '';
    th.style.transition = 'none';
    if (!tabs) { th.style.top = '3px'; th.style.bottom = 'auto'; }
    put(from);
    if (from !== to && !CALM.matches) { th.offsetWidth; th.style.transition = ''; }
    put(to);
    thumbAt[key] = to;
  });
}

/* Вход карточки: подъём с лёгким расфокусом, потом заголовок выходит из-под
   маски и прорисовываются данные. */
function enterCard(card, d, skeleton) {
  anim(card, [{ opacity: 0, transform: 'translateY(18px) scale(.985)', filter: 'blur(6px)' }, { opacity: 1, transform: 'none', filter: 'blur(0)' }], { duration: 780, delay: d });
  if (!skeleton) revealInside(card, d + 160);
}
function revealInside(card, d) {
  card.querySelectorAll(':scope > .ch h2, :scope > .ch p').forEach((t, i) => anim(t, [{ opacity: 0, transform: 'translateY(.7em)', clipPath: 'inset(0 0 100% 0)' }, { opacity: 1, transform: 'none', clipPath: 'inset(0 0 -30% 0)' }], { duration: 700, delay: d + i * 80 }));
  card.querySelectorAll(':scope > .ch .it, :scope > .ch .cr > *').forEach((t, i) => anim(t, [{ opacity: 0, transform: 'translateY(4px) scale(.96)' }, { opacity: 1, transform: 'none' }], { duration: 560, delay: d + 100 + i * 70 }));
  drawIn(card, d + 120);
  countIn(card, d + 160);
}
/* Карточки на экране входят по очереди, нижние ждут, пока до них долистают. */
let watcher = null;
function enterView(view, skeleton) {
  if (CALM.matches) return [];
  watcher && watcher.disconnect();
  watcher = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    const c = e.target, grid = c.parentElement.getBoundingClientRect();
    watcher.unobserve(c); c.classList.remove('wait');
    enterCard(c, c.getBoundingClientRect().left > grid.left + 20 ? 110 : 0);
  }), { rootMargin: '0px 0px -6% 0px' }) : null;
  const seen = [];
  view.querySelectorAll('.card').forEach(c => {
    if (c.getBoundingClientRect().top < innerHeight * .94 || !watcher) { enterCard(c, Math.min(seen.length, 5) * 90, skeleton); seen.push(c); }
    else { c.classList.add('wait'); watcher.observe(c); }
  });
  anim(view.querySelector('.foot-note'), FADE, { duration: 600, delay: 600 });
  return seen;
}
/* Мягкая перерисовка: изменившиеся блоки проступают из лёгкого расфокуса,
   числа доходят от старых значений. was — снимок до перерисовки. */
function snapshot(view) {
  return { cards: [...view.querySelectorAll('.card')].map(c => (c.querySelector('.in') || c).innerHTML), nums: [...view.querySelectorAll(NUM_SEL)].map(e => e.textContent) };
}
function settle(view, was) {
  if (!was || CALM.matches) return;
  view.querySelectorAll('.card').forEach((c, i) => { const box = c.querySelector('.in') || c; if (was.cards[i] !== undefined && was.cards[i] !== box.innerHTML) anim(box, [{ opacity: .35, filter: 'blur(4px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 500 }); });
  view.querySelectorAll(NUM_SEL).forEach((e, i) => { const a = numParts(was.nums[i] || ''), b = numParts(e.textContent); if (a && b && a.post === b.post && a.v !== b.v) tween(e, a.v, b.v, b, 700); });
}
/* Смена темы: цвета перетекают полсекунды, а не щёлкают. */
let themeTimer = 0;
function themeFlow() {
  document.documentElement.classList.add('theming');
  clearTimeout(themeTimer);
  themeTimer = setTimeout(() => document.documentElement.classList.remove('theming'), 650);
}
