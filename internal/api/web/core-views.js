/* Вкладки ядра: перенесены из принятого макета v2 (30.10.2026) — разметка,
   подписи, порядок карточек и помощники. Данные приходят с сервера одним
   набором DATA (/api/core). Каркас и движение живут в panel.js и motion.js,
   общие кирпичи — в kit.js, заготовки модулей — в blocks.js.

   Каждая вкладка — функция, которая кладёт разметку в #view и оживляет её.
   Перерисовка того же вида с новыми данными идёт через перерисоватьЯдро():
   там изменившиеся блоки проступают, а числа перетекают. */

/* Подпись периода берётся из выбранной кнопки, а не пишется в блоке числом:
   иначе «за 30 дней» остаётся стоять и когда открыты семь суток. */
const периодСловами = () => {
  const [с, по] = String(state.range).split('..');
  if (по) return day(с) + ' – ' + day(по);
  return ({ '7d': '7 суток', '15d': '15 суток', '30d': '30 суток', all: 'всё время' })[state.range] || state.range;
};
/* Окно под сеткой «Люди по дням» — период всего обзора: сутки, сборки,
   платформы, экраны и действия считаются за те же дни. Ядро спрашивается
   заново, когда окно отпустили, а не на каждый сдвиг ручки. */
let окноТаймер = 0, окноЗапрос = 0;
/* срезы ядра, которые зависят от дней окна; история, часы и когорты — нет */
const ЗАВИСИТ_ОТ_ОКНА = 'totals,days,screens,actions,versions,platforms,ads,funnels';
function синхронизироватьОкно() {
  const H = ИСТОРИЯ();
  if (state.tab !== 'overview' || !H.length || winFrom < 0) return;
  const нужно = `${H[winFrom].d}..${H[winTo - 1].d}`;
  clearTimeout(окноТаймер);
  if (state.range === нужно) return;
  окноТаймер = setTimeout(async () => {
    const мой = ++окноЗапрос;
    // карточки, которые ждут новых чисел, сразу приглушаются: без этого
    // казалось, что окно ничего не меняет
    const ждут = [...document.querySelectorAll('#view .card')].slice(1);
    ждут.forEach(c => c.classList.add('пересчёт'));
    try {
      const часть = await взять(адрес('/api/core') + '?range=' + encodeURIComponent(нужно) +
        (state.app ? '&app=' + encodeURIComponent(state.app) : '') + '&only=' + ЗАВИСИТ_ОТ_ОКНА);
      if (мой !== окноЗапрос || state.tab !== 'overview') return;
      Object.assign(DATA, часть);
      state.range = нужно;
      ядроКогда = Date.now();
      перерисоватьЯдро();
    } catch (e) {
      if (мой === окноЗапрос) ждут.forEach(c => c.classList.remove('пересчёт'));
    }
  }, 300);
}
const виду = html => { document.getElementById('view').innerHTML = html + подвал(); };
const подвал = () => {
  const своё = (DATA.apps || []).find(a => a.id === state.app);
  return `<p class="foot-note">${своё ? esc(своё.name) + ' · ' : ''}данные с этого сервера${своё && своё.sdk ? ' · SDK ' + esc(своё.sdk) : ''}</p>`;
};
/* Имя экрана или действия: человеческое из словаря, иначе ключ из кода. */
const titleOf = k => (labels[k] || k);
const экраны = () => (DATA.screens || []).map(s => ({ ...s, t: named(s.n) ? labels[s.n] : '', h: (s.min || 0) / 60 }));
const действия = () => (DATA.actions || []).map(a => ({ ...a, t: titleOf(a.n) }));
const ИСТОРИЯ = () => DATA.history || [];

/* ---------- часовой пояс ---------- */
/* Часы на сервере лежат в UTC; в местное время их переводит браузер, переход
   на зимнее время учитывается сам. Выбор пояса помнится в этом браузере. */
const TZ_NAMES = {
  'UTC': 'UTC', 'Etc/UTC': 'UTC',
  'Europe/Chisinau': 'Кишинёв', 'Europe/Moscow': 'Москва', 'Europe/Kyiv': 'Киев', 'Europe/Kiev': 'Киев', 'Europe/Minsk': 'Минск',
  'Europe/Bucharest': 'Бухарест', 'Europe/Warsaw': 'Варшава', 'Europe/Berlin': 'Берлин', 'Europe/Paris': 'Париж', 'Europe/London': 'Лондон',
  'Europe/Madrid': 'Мадрид', 'Europe/Rome': 'Рим', 'Europe/Istanbul': 'Стамбул', 'Europe/Riga': 'Рига', 'Europe/Vilnius': 'Вильнюс',
  'Europe/Tallinn': 'Таллин', 'Europe/Helsinki': 'Хельсинки', 'Europe/Prague': 'Прага', 'Europe/Vienna': 'Вена', 'Europe/Amsterdam': 'Амстердам',
  'Europe/Lisbon': 'Лиссабон', 'Europe/Athens': 'Афины', 'Europe/Sofia': 'София', 'Europe/Belgrade': 'Белград', 'Europe/Budapest': 'Будапешт',
  'Europe/Samara': 'Самара', 'Europe/Kaliningrad': 'Калининград', 'Europe/Volgograd': 'Волгоград',
  'Asia/Yekaterinburg': 'Екатеринбург', 'Asia/Omsk': 'Омск', 'Asia/Novosibirsk': 'Новосибирск', 'Asia/Krasnoyarsk': 'Красноярск',
  'Asia/Irkutsk': 'Иркутск', 'Asia/Yakutsk': 'Якутск', 'Asia/Vladivostok': 'Владивосток', 'Asia/Magadan': 'Магадан', 'Asia/Kamchatka': 'Камчатка',
  'Asia/Tbilisi': 'Тбилиси', 'Asia/Yerevan': 'Ереван', 'Asia/Baku': 'Баку', 'Asia/Almaty': 'Алматы', 'Asia/Tashkent': 'Ташкент',
  'Asia/Bishkek': 'Бишкек', 'Asia/Dubai': 'Дубай', 'Asia/Jerusalem': 'Иерусалим', 'Asia/Kolkata': 'Калькутта', 'Asia/Bangkok': 'Бангкок',
  'Asia/Singapore': 'Сингапур', 'Asia/Shanghai': 'Шанхай', 'Asia/Seoul': 'Сеул', 'Asia/Tokyo': 'Токио',
  'America/New_York': 'Нью-Йорк', 'America/Chicago': 'Чикаго', 'America/Denver': 'Денвер', 'America/Los_Angeles': 'Лос-Анджелес',
  'America/Toronto': 'Торонто', 'America/Mexico_City': 'Мехико', 'America/Sao_Paulo': 'Сан-Паулу', 'America/Argentina/Buenos_Aires': 'Буэнос-Айрес',
  'Africa/Cairo': 'Каир', 'Australia/Sydney': 'Сидней', 'Pacific/Auckland': 'Окленд'
};
const REGION_NAMES = { Europe: 'Европа', America: 'Америка', Asia: 'Азия', Africa: 'Африка', Australia: 'Австралия', Pacific: 'Тихий океан', Atlantic: 'Атлантика', Indian: 'Индийский океан', Antarctica: 'Антарктида', Arctic: 'Арктика' };
const LOCAL_TZ = (() => { try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; return z === 'Etc/UTC' ? 'UTC' : z; } catch (_) { return 'UTC'; } })();
const tzName = z => TZ_NAMES[z] || z.split('/').pop().replace(/_/g, ' ');
/* сдвиг от UTC на сегодня в минутах */
const offsetMin = z => {
  try {
    const s = new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value;
    const m = s.match(/GMT([+-])(\d+)(?::(\d+))?/);
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0;
  } catch (_) { return 0; }
};
const offsetLabel = m => m === 0 ? 'UTC' : `UTC${m < 0 ? '−' : '+'}${Math.floor(Math.abs(m) / 60)}${Math.abs(m) % 60 ? ':' + String(Math.abs(m) % 60).padStart(2, '0') : ''}`;
let tz = (() => {
  try { const v = localStorage.getItem('tessera-tz'); if (v) { new Intl.DateTimeFormat('en', { timeZone: v }); return v; } } catch (_) {}
  return LOCAL_TZ;
})();
let TZ_ALL = null;
function tzAll() {
  if (TZ_ALL) return TZ_ALL;
  let ids = [];
  try { ids = Intl.supportedValuesOf('timeZone'); } catch (_) {}
  if (!ids.length) ids = Object.keys(TZ_NAMES);
  ids = [...new Set(['UTC', LOCAL_TZ, ...ids].filter(z => z !== 'Etc/UTC'))];
  const now = new Date();
  TZ_ALL = ids.map(z => {
    const off = offsetMin(z);
    // область пояса по-русски от браузера, например «Восточная Европа»; если он знает только сдвиг, берём часть света
    let area = '';
    try { area = new Intl.DateTimeFormat('ru-RU', { timeZone: z, timeZoneName: 'longGeneric' }).formatToParts(now).find(p => p.type === 'timeZoneName').value; } catch (_) {}
    if (!area || /^GMT|^UTC/.test(area)) area = z === 'UTC' ? 'Всемирное время' : REGION_NAMES[z.split('/')[0]] || '';
    const label = offsetLabel(off);
    const find = [tzName(z), z.replace(/[/_]/g, ' '), area, label, label.replace('−', '-'), 'gmt' + label.slice(3)].join(' ').toLowerCase().replace(/ё/g, 'е');
    return { z, off, area, label, find };
  }).sort((a, b) => a.off - b.off || tzName(a.z).localeCompare(tzName(b.z), 'ru'));
  return TZ_ALL;
}
const HEAT_LEG = `<div class="heat-leg">меньше<i class="z"></i><i class="t5"></i><i class="t4"></i><i class="t3"></i><i class="t2"></i><i class="t1"></i>больше</div>`;
const tzControl = () => `<div class="tzp"><button class="btn tz-btn" id="tz-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Часовой пояс: ${tzName(tz)}">${svg('clock')}${tzName(tz)}<span class="k">${offsetLabel(offsetMin(tz))}</span>${svg('down')}</button><div class="tz-pop" id="tz-pop" hidden></div></div>`;
function tzPicker() {
  const btn = document.getElementById('tz-btn'), pop = document.getElementById('tz-pop'); if (!btn) return;
  let hl = 0;
  const row = t => `<button class="tz-row" role="option" data-z="${t.z}" aria-selected="${t.z === tz}"><span class="nm"><b>${tzName(t.z)}</b><small>${t.area}</small></span><span class="off">${t.label}</span></button>`;
  const fill = q => {
    const all = tzAll(), key = q.trim().toLowerCase().replace(/ё/g, 'е');
    const list = document.getElementById('tz-list');
    if (key) {
      const hits = all.filter(t => key.split(/\s+/).every(w => t.find.includes(w)));
      list.innerHTML = hits.length ? `<div class="tz-sec"><span>Найдено</span><span>${hits.length}</span></div>${hits.map(row).join('')}`
        : `<p class="tz-empty">Такого пояса нет. Попробуйте город по-английски или сдвиг, например UTC+3.</p>`;
    } else {
      const pinned = [...new Set([tz, LOCAL_TZ, 'UTC'])].map(z => all.find(t => t.z === z)).filter(Boolean);
      list.innerHTML = `<div class="tz-sec"><span>Выбран и ваш</span></div>${pinned.map(row).join('')}<div class="tz-sec"><span>Все пояса</span><span>${all.length}</span></div>${all.map(row).join('')}`;
    }
    hl = 0; mark();
  };
  const rows = () => [...pop.querySelectorAll('.tz-row')];
  const mark = () => rows().forEach((r, i) => r.classList.toggle('hl', i === hl));
  const phone = () => matchMedia('(max-width:640px)').matches;
  // список сначала тает, потом вкладка перерисовывается в новом поясе
  const pick = z => { tz = z; try { localStorage.setItem('tessera-tz', z); } catch (_) {} close().then(() => { перерисоватьЯдро(); document.getElementById('tz-btn')?.focus(); }); };
  const close = () => {
    btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside);
    const a = anim(pop, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: phone() ? 'translateY(16px)' : 'translateY(-4px) scale(.98)' }], { duration: 170, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
    return (a ? a.finished : Promise.resolve()).then(() => { pop.hidden = true; a && a.cancel(); });
  };
  const outside = e => { if (!e.target.closest('.tzp')) close(); };
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.innerHTML = `<label class="tz-q">${svg('search')}<input id="tz-q" type="search" placeholder="Город, область или UTC+3" autocomplete="off" aria-label="Найти часовой пояс"></label><div class="tz-list" id="tz-list" role="listbox" aria-label="Часовые пояса"></div>`;
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true');
    const input = document.getElementById('tz-q');
    fill('');
    anim(pop, [{ opacity: 0, transform: phone() ? 'translateY(24px)' : 'translateY(-6px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
    anim(pop.querySelector('.tz-list'), FADE, { duration: 360, delay: 60 });
    input.addEventListener('input', () => fill(input.value));
    input.addEventListener('keydown', e => {
      const r = rows();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hl = Math.max(0, Math.min(r.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1))); mark(); r[hl]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter' && r[hl]) { e.preventDefault(); pick(r[hl].dataset.z); }
      else if (e.key === 'Escape') { close(); btn.focus(); }
    });
    pop.querySelector('.tz-list').addEventListener('click', e => { const r = e.target.closest('.tz-row'); if (r) pick(r.dataset.z); });
    setTimeout(() => document.addEventListener('pointerdown', outside));
    if (!phone()) input.focus();
  });
}
const tzCache = {};
/* люди в час по местным суткам: { 'ГГГГ-ММ-ДД': [24 значения или null] } */
function localHours(zone) {
  const H = DATA.hourly || { start: '', rows: [] };
  const ключ = zone + '|' + H.start + '|' + (H.rows || []).length + '|' + state.app;
  if (tzCache[ключ]) return tzCache[ключ];
  const out = {};
  if (!H.start) return tzCache[ключ] = out;
  const fmtz = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const base = Date.parse(H.start + 'T00:00:00Z'), acc = {};
  H.rows.forEach((row, di) => (row || []).forEach((v, h) => {
    if (v === null || v === undefined) return;
    const p = Object.fromEntries(fmtz.formatToParts(new Date(base + (di * 24 + h) * 3600e3)).map(x => [x.type, x.value]));
    const d = `${p.year}-${p.month}-${p.day}`, hr = +p.hour % 24;
    // в ночь перевода часов один местный час встречается дважды: берём среднее
    const cellAcc = (acc[d] ||= Array.from({ length: 24 }, () => [0, 0]))[hr];
    cellAcc[0] += v; cellAcc[1]++;
  }));
  for (const d in acc) out[d] = acc[d].map(([s, c]) => c ? s / c : null);
  return tzCache[ключ] = out;
}
/* восемь трёхчасовых отрезков дня: среднее людей в час, null — часов ещё не было */
const slotsOf = (hours, d) => Array.from({ length: 8 }, (_, k) => {
  const hs = (hours[d] || []).slice(k * 3, k * 3 + 3).filter(v => v !== null && v !== undefined);
  return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : null;
});
const SLOT = k => `${String(k * 3).padStart(2, '0')}:00–${String(k * 3 + 3).padStart(2, '0')}:00`;
const MONTH_START = m => MON[+m - 1];

/* ================================ Обзор ================================ */
let tmKey = 'h', tmOn = 0, actV = 'reach', actKey = 'hits';
const MIN_WIN = 14;
let winTo = 0, winFrom = -1, maxWin = 56, winApp = '';

function viewOverview() {
  const H = ИСТОРИЯ();
  // окно — по всей истории; при смене приложения встаёт на её конец
  if (winApp !== state.app || winTo > H.length || !winTo) { winTo = H.length; winFrom = -1; winApp = state.app; }
  // колонками — шесть свежих сборок: дальше подписи налезают друг на друга, а старые сборки — хвост в сотни человек
  const всеСборки = [...(DATA.versions || [])].sort((a, b) => String(b.v).localeCompare(String(a.v), 'ru', { numeric: true }));
  const vs = всеСборки.slice(0, 6);
  const vMax = Math.max(1, ...vs.map(v => v.u)), vSum = всеСборки.reduce((s, v) => s + v.u, 0);
  const tones = ['t1', 't1', 't2', 't2', 't3', 't4', 't4', 't5', 't5', 't5'];
  const plat = DATA.platforms || [], pSum = plat.reduce((s, p) => s + p.u, 0) || 1;
  const scr = экраны(), act = действия();
  const h = peopleHours(), hMax = Math.max(...h), hMin = Math.min(...h.filter(v => v > 0).concat([hMax]));
  const есть = H.length > 0;
  виду(
    card('people', 'Люди по дням', '<span id="pd-range"></span>', HEAT_LEG + tzControl(),
      есть ? `<div id="people-days"></div><div id="brush"></div><div class="mtabs" id="pd-tabs"></div>`
           : '<p class="block-empty">Людей пока не видели: включите счёт людей в SDK, и столбики появятся со следующих суток.</p>') +
    `<div class="grid g-75">` +
      card('clock', 'Сутки', `Людей в час · ${tzName(tz)} · среднее за ${winFrom >= 0 && H[winTo - 1] ? day(H[winFrom].d) + ' – ' + day(H[winTo - 1].d) : '14 дней'}`, hMax ? `<span class="badge">пик ${String(h.indexOf(hMax)).padStart(2, '0')}:00</span>` : '',
        hMax ? `<div class="dial-wrap"><div class="dial" id="hours"></div>
          <div class="dial-side">
            <div class="ds"><span class="k">Пик</span><b>${String(h.indexOf(hMax)).padStart(2, '0')}:00</b><span class="s">≈ ${n(hMax)} человек в час</span></div>
            <div class="ds"><span class="k">Провал</span><b>${String(h.indexOf(hMin)).padStart(2, '0')}:00</b><span class="s">≈ ${n(hMin)} человек в час</span></div>
            <div class="ds"><span class="k">Разница</span><b class="blue">${dec(hMax / (hMin || 1))} раза</b><span class="s">между пиком и провалом</span></div>
            <div class="ds" id="dial-now"></div>
          </div></div>` : '<p class="block-empty">Часов ещё нет: сводка по часам наберётся за первые сутки.</p>') +
      card('versions', 'Сборки', `Сборка последнего дня человека · ${периодСловами()}`, `<span class="badge">${всеСборки.length} ${plural(всеСборки.length, 'сборка', 'сборки', 'сборок')}</span>`,
        vs.length ? `<div class="pad"><div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:16px"><b class="num" style="font:400 26px var(--mono);letter-spacing:-.01em">${n(vSum)}</b><span class="num blue" style="font-size:13px">${esc(String(vs[0].v).split('+')[0])} уже у ${n(vs[0].u)}</span></div>
        <div class="ages" style="--n:${vs.length}">${vs.map((v, i) => { const f = Math.max(1, Math.round(v.u / vMax * 10)); return `<div><div class="ver" title="${esc(v.v)}: ${n(v.u)}">${Array.from({ length: 10 }, (_, k) => `<i class="${10 - k <= f ? tones[i] : 'e'}"></i>`).join('')}</div><div class="age-l"><span${подписьСборки(v.v, vs).length > 7 ? ' class="long"' : ''}>${esc(подписьСборки(v.v, vs))}</span><b>${short(v.u)}</b></div></div>`; }).join('')}</div></div>
        <div class="hr"><div class="lh"><span>Платформы · ${периодСловами()}</span><span>Доля</span></div>
        ${plat.map((p, i) => `<div class="li">${pie(p.u / pSum, i ? 't3' : 't1')}<div class="nm"><b>${p.p === 'ios' ? 'iOS' : p.p === 'android' ? 'Android' : esc(p.p)}</b><small>${n(p.u)} человек${p.d !== undefined ? ` · ${n(p.d)} сегодня` : ''}</small></div><div class="r"><b>${Math.round(p.u / pSum * 100)} %</b></div></div>`).join('')}</div>`
        : '<p class="block-empty">Сборок не видно: приложение не присылает версию.</p>') +
    `</div><div class="grid g-57">` +
      card('screens', 'Куда уходит время', `${scr.length} ${plural(scr.length, 'экран', 'экрана', 'экранов')} · площадь плитки — доля на экране телефона`,
        `<div class="segc" role="group" aria-label="Что меряет площадь"><button data-tm="h" aria-pressed="${tmKey === 'h'}">Время</button><button data-tm="hits" aria-pressed="${tmKey === 'hits'}">Открытия</button></div>`,
        scr.length ? `<div class="ph-wrap"><div class="phone"><span class="island"></span><div class="ph-screen" id="ph-screen"></div></div><div class="ph-side" id="ph-side"></div></div>` : '<p class="block-empty">Экраны не размечены.</p>') +
      card('bolt', 'Действия', `${act.length} ${plural(act.length, 'событие', 'события', 'событий')} в коде · ${периодСловами()}`,
        `<div class="segc" role="group" aria-label="Вид действий">${[['reach', 'Охват'], ['orders', 'Порядки'], ['list', 'Список']].map(([k, l]) => `<button data-av="${k}" aria-pressed="${actV === k}">${l}</button>`).join('')}</div>`,
        `<div id="act-body"></div>`) +
    `</div>`);

  if (есть) { peopleDays(); brush(); }
  if (hMax) dial(document.getElementById('hours'), h);
  attention();
  actions();
  tzPicker();
  document.querySelectorAll('[data-av]').forEach(b => b.addEventListener('click', () => {
    actV = b.dataset.av; document.querySelectorAll('[data-av]').forEach(x => x.setAttribute('aria-pressed', x === b));
    const box = document.getElementById('act-body'); morph(box, actions); drawAct(box); segThumbs();
  }));
}

/* Подпись сборки под колонкой: «1.40.0». Если у одной версии две сборки
   (1.37.0+250 и 1.37.0+249), без номера сборки колонки неотличимы — тогда
   «1.37+250». */
function подписьСборки(v, все) {
  const [осн, сб] = String(v).split('+');
  const двойник = все.filter(x => String(x.v).split('+')[0] === осн).length > 1;
  return двойник && сб ? осн.split('.').slice(0, 2).join('.') + '+' + сб : осн;
}

function peopleDays() {
  const el = document.getElementById('people-days'); if (!el) return;
  const HISTORY = ИСТОРИЯ();
  const narrow = innerWidth < 640;
  const width = el.clientWidth - (narrow ? 60 : 84);
  // квадратик постоянного размера: окно меняет число дней, а не масштаб;
  // между сутками зазор шире, чем между часами внутри суток, перед понедельником ещё просвет недели
  const cell = narrow ? 7 : 12, gap = narrow ? 3 : 5, pitch = cell + gap, wgap = narrow ? 5 : 12, rows = 8, vp = cell + 2, h = rows * vp - 2;
  maxWin = Math.max(MIN_WIN, Math.floor(width / (pitch + wgap / 7)));
  if (winFrom < 0 || winTo - winFrom > maxWin) winFrom = Math.max(0, winTo - maxWin);
  const list = HISTORY.slice(winFrom, winTo), cols = list.length, hours = localHours(tz);
  const monday = x => new Date(x.d + 'T00:00:00Z').getUTCDay() === 1;
  const colX = []; list.forEach((x, i) => colX.push(i ? colX[i - 1] + pitch + (monday(x) ? wgap : 0) : 0));
  const grid = list.map(x => slotsOf(hours, x.d));
  // ступени цвета по квинтилям всей истории в этом поясе, чтобы окно не перекрашивало шкалу
  const all = Object.keys(hours).flatMap(d => slotsOf(hours, d)).filter(v => v > 0).sort((a, b) => a - b);
  const q = [.2, .4, .6, .8].map(f => all[Math.floor(f * (all.length - 1))] || 0);
  const level = v => v === null ? 'e' : v <= 0 ? 'z' : v < q[0] ? 't5' : v < q[1] ? 't4' : v < q[2] ? 't3' : v < q[3] ? 't2' : 't1';
  let rects = '';
  grid.forEach((slots, i) => slots.forEach((v, r) => {
    rects += `<rect class="${level(v)}" x="${colX[i].toFixed(2)}" y="${(r * vp).toFixed(2)}" width="${cell}" height="${cell}" rx="${(cell * .24).toFixed(2)}"/>`;
  }));
  el.innerHTML = `<div class="mx"><div class="ry" style="height:${h}px">${[0, 2, 4, 6].map(r => `<span style="top:${(r * vp + cell / 2) / h * 100}%">${String(r * 3).padStart(2, '0')}</span>`).join('')}</div>
    <div class="mx-plot" style="height:${h}px"><svg width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${rects}<rect class="hov" width="${cell + 3}" height="${cell + 3}" rx="${(cell * .3).toFixed(2)}"/></svg><div class="mx-line"></div><div class="mx-tip"></div></div></div>
    <div class="mx-x" style="margin-left:${narrow ? 44 : 58}px">${list.map((x, i) => {
      // начало месяца подписано жирно, понедельники — датой, если не жмутся к месяцу
      const month = x.d.endsWith('-01');
      const nearMonth = list.slice(Math.max(0, i - 3), i + 4).some(y => y.d.endsWith('-01'));
      if (month) return `<span class="m" style="left:${colX[i]}px">${MONTH_START(x.d.slice(5, 7))}</span>`;
      if (monday(x) && !nearMonth && pitch * 7 > 64) return `<span style="left:${colX[i]}px">${day(x.d)}</span>`;
      return '';
    }).join('')}</div>`;

  const plot = el.querySelector('.mx-plot'), line = el.querySelector('.mx-line'), tip = el.querySelector('.mx-tip'), hov = plot.querySelector('rect.hov');
  const show = (i, r) => {
    const x = list[i], v = grid[i][r], cx = colX[i] + cell / 2;
    tip.innerHTML = `<b>${day(x.d)}, ${SLOT(r)}</b>
      <span><i class="${level(v)}"></i>Людей в час<em>${v === null ? 'ещё нет' : '≈ ' + n(v)}</em></span>
      <span class="g">За сутки<em>${n(x.nw + x.ret)}</em></span><span class="g">Из них новых<em>${n(x.nw)}</em></span>`;
    const left = cx + 14 + tip.offsetWidth > plot.clientWidth ? cx - 14 - tip.offsetWidth : cx + 14;
    const top = Math.max(-6, Math.min(h - tip.offsetHeight, r * vp - 10));
    // первое появление встаёт сразу на место и проявляется, дальше линия, рамка и подсказка едут за указателем
    const fresh = !plot.classList.contains('hovering');
    [line, tip, hov].forEach(e => e.style.transition = fresh ? 'none' : '');
    line.style.transform = `translateX(${cx}px)`;
    hov.style.transform = `translate(${colX[i] - 1.5}px,${r * vp - 1.5}px)`;
    tip.style.transform = `translate(${Math.max(-36, left)}px,${top}px)`;
    if (fresh) { tip.offsetWidth; [line, tip, hov].forEach(e => e.style.transition = ''); plot.classList.add('hovering'); }
  };
  plot.addEventListener('pointermove', e => {
    const b = plot.getBoundingClientRect();
    show(Math.max(0, colX.findLastIndex(x => x <= e.clientX - b.left)), Math.max(0, Math.min(rows - 1, Math.floor((e.clientY - b.top) / vp))));
  });
  plot.addEventListener('pointerleave', () => plot.classList.remove('hovering'));

  // подвал: итоги окна против такого же отрезка перед ним
  const before = HISTORY.slice(Math.max(0, winFrom - cols), winFrom);
  const busiest = l => { const s = Array(8).fill(0), c = Array(8).fill(0); l.forEach(x => slotsOf(hours, x.d).forEach((v, k) => { if (v !== null) { s[k] += v; c[k]++; } })); const a = s.map((v, k) => c[k] ? v / c[k] : 0); const k = a.indexOf(Math.max(...a)); return { k, v: a[k] }; };
  const peak = busiest(list);
  const полных = l => l.filter(x => !x.partial);
  const stats = [
    { k: 'Новые', icon: 'spark', now: list.reduce((s, x) => s + x.nw, 0), was: before.length && before.reduce((s, x) => s + x.nw, 0) },
    { k: 'Вернувшихся в день', icon: 'refresh', now: avgOf(полных(list), x => x.ret), was: before.length && avgOf(полных(before), x => x.ret) }];
  document.getElementById('pd-tabs').innerHTML = онлайнЯчейка() + stats.map(m => { const d = m.was ? (m.now / m.was - 1) * 100 : null; return `<div class="mtab"><span class="k"><span class="ti">${svg(m.icon)}</span>${m.k}</span><b class="v">${n(m.now)}</b>
      <span class="s">${d === null ? 'раньше данных нет' : `<b class="${d < 0 ? 'dn' : ''}">${pctd(d)}</b> к прошлым ${cols} дн.`}</span></div>`; }).join('') +
    `<div class="mtab"><span class="k"><span class="ti">${svg('clock')}</span>Самые людные часы</span><b class="v">${peak.v ? SLOT(peak.k).replace(/:00/g, '') : '—'}</b><span class="s">${peak.v ? `≈ ${n(peak.v)} человек в час · ${tzName(tz)}` : 'часов ещё нет'}</span></div>`;
  document.getElementById('pd-range').textContent = `${day(list[0].d)} – ${day(list.at(-1).d)} · столбик = сутки, квадратик = 3 часа · время: ${tzName(tz)}`;
  живойОнлайн();
  синхронизироватьОкно();
}
/* Сейчас в приложении: живое число модуля с разбивкой по системам. У
   приложения без такого модуля — люди за сегодня из сводки ядра. */
let онлайнЧисло = null;
function онлайнЯчейка() {
  if (!DATA.moderation) {
    return `<div class="mtab"><span class="k"><span class="ti">${svg('people')}</span>Заходили сегодня</span><b class="v">${n((DATA.totals || {}).dau || 0)}</b><span class="s">людей с полуночи по UTC</span></div>`;
  }
  const o = онлайнЧисло || { value: null, parts: [] };
  const части = (o.parts || []).slice(0, 2), тона = ['t1', 't3'];
  return `<div class="mtab live-cell" id="online-cell"><span class="k"><span class="ti live-ti"><i></i></span>Сейчас в приложении</span>
    <b class="v">${o.value === null ? '…' : n(o.value)}</b>
    <span class="plat">${части.map((p, i) => `<i class="${тона[i]}" style="flex:${p.value || 0}"></i>`).join('')}</span>
    <span class="s">${части.map((p, i) => `<span class="pl"><i class="dotk ${тона[i]}"></i>${esc(p.name)} ${n(p.value)}</span>`).join('') || 'спрашиваю приложение'}</span></div>`;
}

/* вся история: сглаженный силуэт людей в день; выбранный отрезок залит синим, ручки с датами */
function brush() {
  const el = document.getElementById('brush'); if (!el) return;
  const HISTORY = ИСТОРИЯ(), len = HISTORY.length, MIN = Math.min(MIN_WIN, len);
  if (len < 2) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="br"><div class="br-plot" id="br-plot"></div><div class="br-x"></div></div>`;
  const plot = document.getElementById('br-plot'), xs = el.querySelector('.br-x');
  const W = plot.clientWidth, H = plot.clientHeight;
  // трёхдневное среднее снимает зубцы, форма волны остаётся
  const vals = HISTORY.map((_, i) => { const s = HISTORY.slice(Math.max(0, i - 1), i + 2); return s.reduce((a, x) => a + x.nw + x.ret, 0) / s.length; });
  const max = Math.max(1, ...vals), X = i => i / (len - 1) * W, Y = v => H - 3 - v / max * (H - 8);
  let line = `M0 ${Y(vals[0]).toFixed(1)}`;
  for (let i = 1; i < len; i++) { const mx = (X(i - 1) + X(i)) / 2; line += ` C${mx.toFixed(1)} ${Y(vals[i - 1]).toFixed(1)} ${mx.toFixed(1)} ${Y(vals[i]).toFixed(1)} ${X(i).toFixed(1)} ${Y(vals[i]).toFixed(1)}`; }
  const area = `${line} L${W} ${H} L0 ${H}Z`;
  const months = HISTORY.map((x, i) => x.d.endsWith('-01') ? i : -1).filter(i => i > 0);
  plot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><clipPath id="br-clip"><rect id="br-cr" x="0" y="-4" width="0" height="${H + 8}"/></clipPath></defs>
      ${months.map(i => `<line class="mt" x1="${X(i)}" x2="${X(i)}" y1="0" y2="${H}"/>`).join('')}
      <path class="base" d="${area}"/><path class="sel" d="${area}" clip-path="url(#br-clip)"/>
      <line class="floor" x1="0" x2="${W}" y1="${H - .5}" y2="${H - .5}"/></svg>
    <span class="br-hd" data-h="l"><i></i></span><span class="br-hd" data-h="r"><i></i></span>`;
  const cr = document.getElementById('br-cr'), hl = plot.querySelector('[data-h="l"]'), hr = plot.querySelector('[data-h="r"]');
  const place = () => {
    const a = X(winFrom), b = X(winTo - 1);
    cr.setAttribute('x', a); cr.setAttribute('width', b - a);
    hl.style.left = a + 'px'; hr.style.left = b + 'px';
    // месяц прячется, если под ним встала дата ручки
    const near = i => Math.abs(X(i) - a) < 46 || Math.abs(X(i) - b) < 46;
    const clamp = x => Math.max(22, Math.min(W - 26, x));
    xs.innerHTML = months.filter(i => !near(i)).map(i => `<span style="left:${X(i)}px">${MONTH_START(HISTORY[i].d.slice(5, 7))}</span>`).join('') +
      // ручки близко — одна подпись посередине, иначе по дате под каждой
      (b - a < 110 ? `<span class="d" style="left:${Math.max(60, Math.min(W - 60, (a + b) / 2))}px">${day(HISTORY[winFrom].d)} – ${day(HISTORY[winTo - 1].d)}</span>`
        : `<span class="d" style="left:${clamp(a)}px">${day(HISTORY[winFrom].d)}</span><span class="d" style="left:${clamp(b)}px">${day(HISTORY[winTo - 1].d)}</span>`);
  };
  place();
  let grab = null;
  const at = e => { const r = plot.getBoundingClientRect(); return Math.max(0, Math.min(len - 1, Math.round((e.clientX - r.left) / r.width * (len - 1)))); };
  const move = e => {
    if (!grab) return;
    const i = at(e), size = winTo - winFrom;
    let from = winFrom, to = winTo;
    if (grab.mode === 'move') { from = Math.max(0, Math.min(len - size, i - grab.off)); to = from + size; }
    // ручки ходят от двух недель до ширины графика
    else if (grab.mode === 'l') from = Math.max(0, winTo - maxWin, Math.min(winTo - MIN, i));
    else to = Math.min(len, winFrom + maxWin, Math.max(winFrom + MIN, i + 1));
    if (from !== winFrom || to !== winTo) { winFrom = from; winTo = to; place(); peopleDays(); }
  };
  plot.addEventListener('pointerdown', e => {
    const i = at(e), edge = e.target.closest('.br-hd');
    // ручка меняет ширину окна, синий отрезок двигается целиком, клик мимо ставит окно центром под палец
    if (edge) grab = { mode: edge.dataset.h };
    else if (i >= winFrom && i < winTo) grab = { mode: 'move', off: i - winFrom };
    else grab = { mode: 'move', off: Math.floor((winTo - winFrom) / 2) };
    plot.setPointerCapture(e.pointerId); plot.classList.add('drag'); move(e);
  });
  plot.addEventListener('pointermove', move);
  plot.addEventListener('pointerup', () => { grab = null; plot.classList.remove('drag'); });
}

/* куда уходит время: экраны плитками на экране телефона, площадь — доля времени или открытий */
function squarify(items, x, y, w, h) {
  // раскладка «квадратнее»: ряд копится, пока худшее соотношение сторон в нём улучшается
  const out = [], total = items.reduce((s, it) => s + it.v, 0) || 1, scale = w * h / total;
  const rest = items.map(it => ({ ...it, a: it.v * scale }));
  while (rest.length) {
    const side = Math.min(w, h), row = [];
    const worst = r => { const s = r.reduce((a, b) => a + b.a, 0); return Math.max(...r.map(it => Math.max(side * side * it.a / (s * s), s * s / (side * side * it.a)))); };
    while (rest.length && (!row.length || worst([...row, rest[0]]) <= worst(row))) row.push(rest.shift());
    const s = row.reduce((a, b) => a + b.a, 0), thick = s / side;
    let off = 0;
    row.forEach(it => {
      const len = it.a / thick;
      out.push(w >= h ? { ...it, x, y: y + off, w: thick, h: len } : { ...it, x: x + off, y, w: len, h: thick });
      off += len;
    });
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
  }
  return out;
}
function attention() {
  const box = document.getElementById('ph-screen'); if (!box) return;
  const scr = экраны().filter(s => s[tmKey] > 0).sort((a, b) => b[tmKey] - a[tmKey]), top = scr.slice(0, 8), rest = scr.slice(8);
  if (!top.length) { box.innerHTML = ''; return; }
  const title = s => s.t || s.n;
  const items = top.map((s, i) => ({ s, v: s[tmKey], i }));
  if (rest.length) items.push({ s: null, rest, v: rest.reduce((a, s) => a + s[tmKey], 0), i: 8 });
  // сверху строка состояния, плитки начинаются под ней; отступ от края экрана равен зазору, нижние углы повторяют скругление
  const G = 4, TOP = 30, SR = 22, W = box.clientWidth, H = box.clientHeight, sum = items.reduce((a, b) => a + b.v, 0);
  const tone = i => i === 8 ? 'tr' : ['t1', 't1', 't2', 't2', 't3', 't3', 't4', 't4'][i];
  const near = (a, b) => Math.abs(a - b) < 1;
  const tiles = squarify(items, G / 2, TOP + G / 2 - G, W - G, H - TOP).map(t => {
    const x = t.x + G / 2, y = t.y + G / 2, w = t.w - G, h = t.h - G;
    const bl = near(x, G) && near(y + h, H - G), br = near(x + w, W - G) && near(y + h, H - G);
    const r = `7px 7px ${br ? SR - G : 7}px ${bl ? SR - G : 7}px`;
    // название пишем, только если самое длинное слово влезает целиком
    const name = t.s ? title(t.s) : `Ещё ${t.rest.length}`, word = Math.max(...name.split(' ').map(s => s.length));
    const lines = name.length * 6.8 > w - 16 ? 2 : 1;
    const showName = w - 16 >= word * 6.8 && h >= 18 + lines * 15 + 14, showPct = w > 34 && h > 24;
    return `<button class="tile ${tone(t.i)}" data-i="${t.i}" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;border-radius:${r}" aria-label="${esc(name)}">
      ${showName ? `<b>${esc(name)}</b>` : ''}${showPct ? `<span>${Math.round(t.v / sum * 100)} %</span>` : ''}</button>`;
  }).join('');
  const сейчас = new Date();
  box.innerHTML = `<div class="ph-status"><span>${String(сейчас.getHours()).padStart(2, '0')}:${String(сейчас.getMinutes()).padStart(2, '0')}</span><span class="ph-icons"><i></i><i></i><i></i></span></div>${tiles}`;
  const side = document.getElementById('ph-side');
  const show = i => {
    tmOn = i;
    box.querySelectorAll('.tile').forEach(t => t.classList.toggle('on', +t.dataset.i === i));
    const it = items.find(x => x.i === i), s = it.s, доля = it.v / sum * 100;
    const rows = s ? [['Часы внимания', n(s.h) + ' ч'], ['Открытий', n(s.hits)], ['Людей·дней', n(s.u)], ['В среднем за раз', s.sec >= 60 ? `${Math.floor(s.sec / 60)} мин` + (Math.round(s.sec % 60) ? ` ${Math.round(s.sec % 60)} с` : '') : Math.round(s.sec) + ' с']]
      // у остатка те же четыре строки, что у экрана: список из трёх десятков имён
      // раздувал колонку, телефон рядом съезжал по центру и уводил плитку из-под курсора
      : [['Часы внимания', n(it.rest.reduce((a, x) => a + x.h, 0)) + ' ч'], ['Открытий', n(it.rest.reduce((a, x) => a + x.hits, 0))], ['Людей·дней', n(it.rest.reduce((a, x) => a + x.u, 0))], ['Экранов', n(it.rest.length)]];
    // прежние числа и длина полосы: от них новые значения доедут, а не встанут скачком
    const was = [...side.querySelectorAll('.ph-big b, .ph-r b')].map(e => e.textContent), barWas = side.querySelector('.ph-bar i')?.style.width;
    side.innerHTML = `<div class="ph-h"><span class="ph-sw ${tone(i)}"></span><div><b>${esc(s ? title(s) : 'Остальные экраны')}</b><small>${s ? esc(s.n) : rest.length + ' шт.'}</small></div></div>
      <div class="ph-big"><b>${dec(доля)} %</b><span>${tmKey === 'h' ? 'всего времени в приложении' : 'всех открытий экранов'}</span></div>
      <div class="ph-bar"><i style="width:${barWas || доля + '%'}"></i></div>
      ${rows.map(([k, v]) => `<div class="ph-r"><span>${k}</span><b>${v}</b></div>`).join('')}`;
    if (!barWas) return;
    side.querySelectorAll('.ph-big b, .ph-r b').forEach((e, k) => { const text = e.textContent; if (was[k] !== undefined) { e.textContent = was[k]; tweenText(e, text, 380); } });
    anim(side.querySelector('.ph-h'), [{ opacity: .3, transform: 'translateX(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 300 });
    const bar = side.querySelector('.ph-bar i');
    bar.offsetWidth; bar.style.width = доля + '%';
  };
  box.querySelectorAll('.tile').forEach(t => { t.addEventListener('pointerenter', () => show(+t.dataset.i)); t.addEventListener('focus', () => show(+t.dataset.i)); });
  show(items.some(x => x.i === tmOn) ? tmOn : 0);
  document.querySelectorAll('[data-tm]').forEach(b => b.onclick = () => {
    // плитки переезжают на новые места по названию экрана, новые проявляются
    const old = {};
    box.querySelectorAll('.tile').forEach(t => old[t.getAttribute('aria-label')] = { left: t.style.left, top: t.style.top, width: t.style.width, height: t.style.height });
    tmKey = b.dataset.tm; document.querySelectorAll('[data-tm]').forEach(x => x.setAttribute('aria-pressed', x === b)); tmOn = 0;
    attention(); segThumbs();
    box.querySelectorAll('.tile').forEach(t => {
      const o = old[t.getAttribute('aria-label')], now = { left: t.style.left, top: t.style.top, width: t.style.width, height: t.style.height };
      if (o) anim(t, [o, now], { duration: 650 }); else anim(t, [{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 500, delay: 150 });
    });
  });
}

/* действия: три вида. Охват — ширина столбика люди, высота раз в день на человека, площадь все нажатия;
   порядки — клетка на каждый десяток, клетки сгруппированы по тысячам, как цифры в числе; список — по строке на событие */
const ACT_ICON = { miss_you_sent: 'heart', vibe_sent: 'spark', canvas_shared: 'brush', memory_added: 'image', canvas_solo: 'pencil' };
function actions() {
  const box = document.getElementById('act-body'); if (!box) return;
  const days = Math.max(1, (DATA.totals || {}).days || 15);
  const act = действия().filter(a => a.hits > 0).sort((a, b) => b.hits - a.hits).map((a, i) => ({ ...a, tone: ['t1', 't2', 't3', 't4', 't5'][Math.min(i, 4)], day: a.u ? a.hits / a.u / days : 0 }));
  if (!act.length) { box.innerHTML = '<p class="block-empty">Действия не размечены: Tessera.action(\'имя\') в коде приложения.</p>'; return; }
  const total = act.reduce((s, a) => s + a.hits, 0), topTwo = (act[0].hits + (act[1] ? act[1].hits : 0)) / total * 100;
  const code = a => `${esc(a.n)}${a.hits <= 1 ? ' · проверьте разметку' : ''}`;
  const keySwitch = actV === 'reach' ? '' : `<div class="segc" role="group" aria-label="Что считать"><button data-ak="hits" aria-pressed="${actKey === 'hits'}">Раз</button><button data-ak="u" aria-pressed="${actKey === 'u'}">Людей</button></div>`;
  const head = `<div class="act-sum"><b>${n(total)}</b><span>нажатий</span>${act.length > 1 ? `<span class="blue">${dec(topTwo)} % у первых двух</span>` : ''}${keySwitch}</div>`;
  let body = '';
  const withPeople = act.some(a => a.u > 0);
  if (actV === 'reach' && withPeople) {
    const sumU = act.reduce((s, a) => s + a.u, 0), maxDay = Math.max(...act.map(a => a.day));
    const step = nice(maxDay / 4), top = Math.ceil(maxDay / step) * step || 1, H = 190;
    const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
    // столбик уже трёх тысячных ширины не разглядеть: такое событие остаётся только в таблице
    const shown = act.filter(a => a.u / sumU >= .003);
    body = `<div class="rc"><div class="ry" style="height:${H}px">${ticks.map(t => `<span style="top:${(1 - t / top) * 100}%">${dec(t, t % 1 ? 1 : 0)}</span>`).join('')}</div>
      <div class="rc-plot" style="height:${H}px">${ticks.map(t => `<div class="gl" style="bottom:${t / top * 100}%"></div>`).join('')}
        <div class="rc-cols">${shown.map(a => { const lab = a.day / top > .4 && a.u / sumU > .15; return `<i class="${a.tone} ${lab ? 'lab' : ''}" data-a="${esc(a.n)}" style="flex:${a.u} 1 0;height:${a.day / top * 100}%" title="${esc(a.t)}: ${n(a.u)} человек·дней, ${dec(a.day)} раза в день">${lab ? `<b>${esc(a.t)}</b><span>${dec(a.day)} в день</span>` : ''}</i>`; }).join('')}</div></div></div>
      <div class="rc-x"><span>← ширина: сколько людей →</span><span>высота: раз в день на человека</span></div>
      <div class="at"><div class="at-h"><span></span><span>Событие</span><span>Людей</span><span>В день на чел.</span><span>Нажатий</span></div>
        ${act.map(a => `<div class="at-r" data-a="${esc(a.n)}"><span class="at-sw ${a.tone}"></span><div class="act-nm"><b>${esc(a.t)}</b><small>${code(a)}</small></div><span data-k="людей">${short(a.u)}</span><span data-k="в день">${dec(a.day)}</span><span data-k="нажатий">${short(a.hits)}</span></div>`).join('')}</div>`;
  } else if (actV === 'orders') {
    // клетка i — от 10^i до 10^(i+1), заливка — сколько пройдено внутри этого десятка
    const fill = (v, i) => { if (v < 1) return 0; const f = Math.max(0, Math.min(1, Math.log10(v) - i)); return i === 0 && f === 0 ? .1 : f; };
    const cells = (v, tone) => [[0, 1, 2], [3, 4, 5], [6, 7]].map(g => `<span class="od-g">${g.map(i => `<i><span class="${tone}" style="width:${fill(v, i) * 100}%"></span></i>`).join('')}</span>`).join('');
    body = `<div class="od"><div class="od-h"><span></span><div class="od-c"><span class="od-g">1</span><span class="od-g">1 тыс</span><span class="od-g">1 млн</span></div><span></span></div>
      ${act.map(a => `<div class="od-r" data-a="${esc(a.n)}"><div class="act-nm"><b>${esc(a.t)}</b><small>${code(a)}</small></div><div class="od-c">${cells(a[actKey], a.tone)}</div><b class="num">${n(a[actKey])}</b></div>`).join('')}</div>
      <p class="od-note">Каждая клетка в десять раз больше предыдущей.${act.length > 2 ? ` «${esc(act[0].t)}» случается в ${n(act[0].hits / act[2].hits)} раз чаще, чем «${esc(act[2].t)}».` : ''}</p>`;
  } else {
    const max = Math.max(1, ...act.map(a => a[actKey]));
    body = `<div class="ls">${act.map(a => { const v = a[actKey], доля = actKey === 'hits' ? v / total * 100 : v / max * 100;
      return `<div class="ls-r" data-a="${esc(a.n)}"><span class="ls-ic">${svg(ACT_ICON[a.n] || 'bolt')}</span>
        <div class="act-nm"><b>${esc(a.t)}</b><small>${code(a)}</small><span class="ls-bar"><i class="${a.tone}" style="width:${Math.max(.8, доля)}%"></i></span></div>
        <div class="r"><b>${n(v)}</b><small>${actKey === 'hits' ? (доля < .1 ? '<0,1' : dec(доля)) + ' %' : dec(a.day) + ' раза в день'}</small></div></div>`; }).join('')}</div>`;
  }
  box.innerHTML = head + body;
  box.classList.remove('focus');
  box.querySelectorAll('[data-ak]').forEach(b => b.addEventListener('click', () => { actKey = b.dataset.ak; morph(box, actions); drawAct(box); segThumbs(); }));
  // наведение на столбик или строку подсвечивает это событие везде в карточке
  box.querySelectorAll('[data-a]').forEach(x => {
    x.addEventListener('pointerenter', () => { box.classList.add('focus'); box.querySelectorAll('[data-a]').forEach(y => y.classList.toggle('on', y.dataset.a === x.dataset.a)); });
    x.addEventListener('pointerleave', () => box.classList.remove('focus'));
  });
}

/* сутки циферблатом: 24 луча, полночь сверху, полдень снизу, длина луча — людей в час */
function dial(el, h) {
  if (!el) return;
  const C = 150, R0 = 62, R1 = 132, max = Math.max(...h) || 1, peak = h.indexOf(max);
  const sorted = [...h].sort((a, b) => a - b), q = [.2, .4, .6, .8].map(f => sorted[Math.floor(f * 23)]);
  const tone = v => v >= max ? 'b1' : v < q[0] ? 'b5' : v < q[1] ? 'b4' : v < q[2] ? 'b3' : 'b2';
  const pt = (k, r) => { const a = (k / 24) * 2 * Math.PI - Math.PI / 2; return [C + Math.cos(a) * r, C + Math.sin(a) * r]; };
  // сектор часа: края параллельны границе соседа, поэтому просвет одинаковый от центра до обода;
  // углы скругляет обводка того же цвета: сектор ужат на её половину со всех сторон
  const GAP = 3.2, RND = 4;
  const ray = (k, r, cls, extra = '') => {
    const a0 = (k - .5) / 24 * 2 * Math.PI - Math.PI / 2, a1 = (k + .5) / 24 * 2 * Math.PI - Math.PI / 2;
    const at = (a, rr) => [C + Math.cos(a) * rr, C + Math.sin(a) * rr].map(v => v.toFixed(2)).join(' ');
    const inset = cls === 'hit' ? 0 : RND, g = GAP + 2 * inset;
    const ri = R0 + inset, ro = Math.max(ri + .5, r - inset);
    const off = rr => Math.asin(g / 2 / rr);
    const [il, ir, ol, or] = [a0 + off(ri), a1 - off(ri), a0 + off(ro), a1 - off(ro)];
    return `<path class="${cls}" d="M${at(il, ri)} L${at(ol, ro)} A${ro} ${ro} 0 0 1 ${at(or, ro)} L${at(ir, ri)} A${ri} ${ri} 0 0 0 ${at(il, ri)}Z" ${extra}/>`;
  };
  // местный час смотрящего: отметка «сейчас» на ободе
  let now = 0;
  try { now = +new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()) % 24; } catch (_) {}
  const [nx, ny] = pt(now, R1 + 11);
  el.innerHTML = `<svg viewBox="0 0 300 300" role="img" aria-label="Людей в час по часам суток">
      <circle class="face" cx="${C}" cy="${C}" r="${R0 - 6}"/>
      ${h.map((v, k) => ray(k, R1, 'track')).join('')}
      ${h.map((v, k) => ray(k, R0 + Math.max(.04, v / max) * (R1 - R0), 'bar', `data-k="${k}" style="fill:var(--${tone(v)});stroke:var(--${tone(v)})"`)).join('')}
      ${h.map((v, k) => ray(k, R1, 'hit', `data-k="${k}"`)).join('')}
      ${[0, 6, 12, 18].map(k => { const [x, y] = pt(k, R1 + 26); return `<text class="lbl" x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}">${String(k).padStart(2, '0')}</text>`; }).join('')}
      <circle class="now" cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="3.5"/>
      <g class="mid"><rect class="pill" x="${C - 25}" y="${C - 36}" width="50" height="19" rx="6"/><text class="hr" x="${C}" y="${C - 22.5}"></text>
        <text class="num" x="${C}" y="${C + 11}"></text><text class="unit" x="${C}" y="${C + 29}">человек в час</text></g>
    </svg>`;
  const hrT = el.querySelector('.mid .hr'), numT = el.querySelector('.mid .num'), bars = [...el.querySelectorAll('.bar')];
  const show = k => {
    hrT.textContent = String(k).padStart(2, '0') + ':00';
    tweenText(numT, n(h[k]), 260);
    bars.forEach(b => b.classList.toggle('dim', +b.dataset.k !== k));
  };
  const rest = () => { show(peak); bars.forEach(b => b.classList.remove('dim')); };
  el.querySelectorAll('.hit').forEach(x => x.addEventListener('pointerenter', () => show(+x.dataset.k)));
  el.querySelector('svg').addEventListener('pointerleave', rest);
  rest();
  document.getElementById('dial-now').innerHTML = `<span class="k"><i class="nowdot"></i>Сейчас у вас</span><b>${String(now).padStart(2, '0')}:00</b><span class="s">обычно ≈ ${n(h[now])} человек в час</span>`;
}
/* среднее людей в каждый местный час за полные сутки выбранного окна
   (пока окно не встало — за последние 14) */
function peopleHours() {
  const H = ИСТОРИЯ(), окно = winFrom >= 0 ? H.slice(winFrom, winTo) : H.slice(-14);
  const hours = localHours(tz), ds = окно.filter(x => !x.partial).map(x => x.d);
  return Array.from({ length: 24 }, (_, k) => { const v = ds.map(d => hours[d]?.[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; });
}

/* ================================ Экраны ================================ */
const scr = { tab: 'all', sel: new Set(), lo: 0, hi: null, named: false, applied: null };
function viewScreens() {
  const все = экраны().sort((a, b) => b.h - a.h || b.hits - a.hits);
  const SCALE = nice(Math.max(60, ...все.map(s => s.sec)) / 4) * 4;
  if (scr.hi === null || scr.hi > SCALE) { scr.hi = SCALE; scr.applied = { lo: 0, hi: SCALE, named: false }; }
  const passes = (s, f) => s.sec >= f.lo && s.sec <= f.hi && (!f.named || s.t);
  const secs = все.map(s => s.sec).sort((a, b) => a - b);
  const MED = Math.round(secs.length ? (secs[Math.floor((secs.length - 1) / 2)] + secs[Math.ceil((secs.length - 1) / 2)]) / 2 : 0);
  const отбор = все.filter(s => passes(s, scr.applied)), сНазв = отбор.filter(s => s.t).length;
  const list = отбор.filter(s => scr.tab === 'all' || (scr.tab === 'named' ? s.t : !s.t));
  const tick = [0, .25, .5, .75, 1].map(f => Math.round(SCALE * f)), label = tick.filter(t => Math.abs(t - MED) > SCALE / 5);
  const BIN = SCALE / 16;
  const histVals = Array.from({ length: 16 }, (_, b) => все.filter(s => s.sec >= b * BIN && (s.sec < (b + 1) * BIN || b === 15)).reduce((a, s) => a + s.h, 0));
  const hm = Math.max(1, ...histVals);
  const сколько = () => все.filter(s => passes(s, scr)).length;
  const экранов = k => `${k} ${plural(k, 'экран', 'экрана', 'экранов')}`;
  const row = s => { const on = scr.sel.has(s.n); return `<div class="tl-r ${on ? 'on' : ''}">
      <button class="cb" role="checkbox" aria-checked="${on}" data-sel="${esc(s.n)}" aria-label="Выбрать ${esc(s.t || s.n)}">${svg('check', 'stroke-width="3"')}</button>
      <div class="nm"><span class="nm-edit"><b>${esc(s.t || s.n)}</b><button data-rename="${esc(s.n)}" title="Переименовать">имя</button></span><small>${s.t ? esc(s.n) : 'без названия'} · ${n(s.hits)} откр.</small></div>
      <div class="track">${tick.slice(1, -1).map(t => `<i class="grid-v" style="left:${t / SCALE * 100}%"></i>`).join('')}<i class="med" style="left:${MED / SCALE * 100}%"></i>
        <i class="bar ${s.t ? '' : 'dash'}" style="left:0;width:${Math.min(100, s.sec / SCALE * 100)}%"></i><i class="ring ${s.t ? '' : 'g'}" style="left:${Math.min(100, s.sec / SCALE * 100)}%"></i></div>
      <span class="r amt">${n(s.h)} ч</span></div>`; };
  const ПЕРИОДЫ = [['7d', '7 дней'], ['15d', '15 дней'], ['30d', '30 дней'], ['all', 'Всё']];
  виду(`<div class="grid" style="grid-template-columns:minmax(0,8fr) minmax(280px,4fr)" id="scr-grid">` +
    card('screens', 'Экраны', `${подписьПериода()} · ${экранов(все.length)}, по часам внимания`, `<span class="badge">${все.filter(s => !s.t).length} без названия</span>`,
      `<div class="tabs" role="tablist" aria-label="Экраны по названию">${[['all', 'Все', отбор.length], ['named', 'С названием', сНазв], ['raw', 'Без названия', отбор.length - сНазв]].map(([id, l, c]) => `<button role="tab" data-tab-s="${id}" aria-selected="${scr.tab === id}">${l}<span class="c">${c}</span></button>`).join('')}</div>
      <div class="tl-wrap"><div class="tl">
        <div class="tl-h"><span></span><span>Экран</span><div class="ticks">${label.map(t => `<span style="left:${t / SCALE * 100}%;${t === 0 ? 'transform:none' : t === SCALE ? 'transform:translateX(-100%)' : ''}">${t} с</span>`).join('')}<span class="med" style="left:${MED / SCALE * 100}%">${MED} с</span></div><span class="r">Внимание</span></div>
        ${list.map(row).join('') || `<div class="hint" style="padding:22px 18px">Под фильтр не попал ни один экран. Расширьте время на экране или выключите «Только с названием».</div>`}
      </div></div>
      <div class="tl-leg"><span class="k"><i class="t1"></i>Среднее время за открытие</span><span class="k"><i class="d"></i>Без названия в коде</span><span class="k"><i class="o"></i>Конец среднего</span><span class="k"><i style="width:0;height:14px;border-left:1.5px dashed var(--b1);border-radius:0"></i>Медиана по экранам</span></div>`) +
    `<section class="card" id="filter"><header class="ch"><span class="it">${svg('filter')}</span><div><h2>Фильтр</h2><p>Экраны и время на них</p></div></header>
      <div class="in">
        <div class="fsec"><div class="h">Период</div><div class="segc" role="group" aria-label="Период экранов">${ПЕРИОДЫ.map(([k, l]) => `<button data-range-s="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}</div></div>
        <div class="fsec"><div class="h">Среднее время на экране<b id="rng-l">${scr.lo} – ${scr.hi} с</b></div>
          <div class="hist" id="hist">${histVals.map(v => `<i style="height:${v ? Math.max(6, v / hm * 100) : 4}%"></i>`).join('')}</div>
          <div class="range" id="range"><div class="rail"></div><div class="fill"></div><span class="hd" data-h="lo"></span><span class="hd" data-h="hi"></span></div>
          <div class="rl"><span>0 с</span><span>${SCALE / 2} с</span><span>${SCALE} с</span></div></div>
        <div class="fsec"><div class="ck" style="padding:0">Только с названием<button class="sw" role="switch" id="sw-named" aria-checked="${scr.named}" aria-label="Только с названием" style="margin-left:auto"></button></div></div>
        <div class="foot hr"><button class="btn" data-reset>Сбросить</button><button class="btn dark" data-apply style="flex:1;justify-content:center" id="apply">Показать ${экранов(сколько())}</button></div>
      </div></section></div>` +
    `<div class="card" style="padding:0"><div class="foot" id="sel-foot"></div></div>`);

  const selFoot = () => {
    const sel = все.filter(s => scr.sel.has(s.n)), foot = document.getElementById('sel-foot');
    const was = ['#sel-n', '#sel-sum'].map(q => foot.querySelector(q)?.textContent);
    foot.innerHTML = `<b id="sel-n">${sel.length} выбрано</b><span class="num" id="sel-sum" style="color:var(--ink-2)">${n(sel.reduce((a, s) => a + s.h, 0))} ч · ${n(sel.reduce((a, s) => a + s.hits, 0))} откр.</span><span class="gap"></span><button class="btn" data-clear ${sel.length ? '' : 'disabled'}>Снять выбор</button>`;
    ['#sel-n', '#sel-sum'].forEach((q, k) => { const e = foot.querySelector(q), text = e.textContent; if (was[k]) { e.textContent = was[k]; tweenText(e, text, 380); } });
  };
  selFoot();
  const sync = () => {
    const r = document.getElementById('range'); if (!r) return;
    const lo = scr.lo / SCALE * 100, hi = scr.hi / SCALE * 100;
    r.querySelector('[data-h="lo"]').style.left = lo + '%'; r.querySelector('[data-h="hi"]').style.left = hi + '%';
    Object.assign(r.querySelector('.fill').style, { left: lo + '%', width: hi - lo + '%' });
    document.querySelectorAll('#hist i').forEach((b, i) => b.classList.toggle('out', (i + 1) * BIN <= scr.lo || i * BIN >= scr.hi));
    document.getElementById('rng-l').textContent = `${scr.lo} – ${scr.hi} с`;
    tweenText(document.getElementById('apply'), `Показать ${экранов(сколько())}`, 260);
  };
  sync();
  const r = document.getElementById('range');
  let which = null;
  const at = e => { const b = r.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * SCALE / 10) * 10; };
  const move = e => { if (!which) return; const v = at(e); if (which === 'lo') scr.lo = Math.min(v, scr.hi - 10); else scr.hi = Math.max(v, scr.lo + 10); sync(); };
  r.addEventListener('pointerdown', e => { const v = at(e); which = Math.abs(v - scr.lo) <= Math.abs(v - scr.hi) ? 'lo' : 'hi'; r.setPointerCapture(e.pointerId); move(e); });
  r.addEventListener('pointermove', move);
  r.addEventListener('pointerup', () => which = null);
  document.getElementById('sw-named').addEventListener('click', e => { scr.named = !scr.named; e.currentTarget.setAttribute('aria-checked', scr.named); sync(); });
  document.querySelector('[data-apply]').addEventListener('click', () => { scr.applied = { lo: scr.lo, hi: scr.hi, named: scr.named }; перерисоватьЯдро(); });
  document.querySelector('[data-reset]').addEventListener('click', () => { Object.assign(scr, { lo: 0, hi: SCALE, named: false, applied: { lo: 0, hi: SCALE, named: false } }); перерисоватьЯдро(); });
  document.querySelectorAll('[data-tab-s]').forEach(b => b.addEventListener('click', () => { scr.tab = b.dataset.tabS; перерисоватьЯдро(); }));
  document.querySelectorAll('[data-range-s]').forEach(b => b.addEventListener('click', () => сменитьПериод(b.dataset.rangeS)));
  // выбор меняется на месте: галочка дорисовывается, строка подсвечивается, итоги внизу доезжают
  document.querySelectorAll('[data-sel]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.sel; scr.sel.has(k) ? scr.sel.delete(k) : scr.sel.add(k);
    b.setAttribute('aria-checked', scr.sel.has(k)); b.closest('.tl-r').classList.toggle('on', scr.sel.has(k)); selFoot();
  }));
  document.getElementById('sel-foot').addEventListener('click', e => {
    if (!e.target.closest('[data-clear]')) return;
    scr.sel.clear();
    document.querySelectorAll('[data-sel]').forEach(b => { b.setAttribute('aria-checked', false); b.closest('.tl-r').classList.remove('on'); });
    selFoot();
  });
}

/* ================================ Люди ================================ */
const WAVE_DAYS = 45;
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/* Волна прихода — день, когда новых больше вчетверо против пяти дней до него;
   две волны не ближе трёх недель. Доля вернувшихся — оценка: возвраты сверх
   прежнего уровня ÷ новые сверх прежнего уровня с начала волны. */
function waves() {
  const H = ИСТОРИЯ(), found = [];
  H.forEach((x, i) => {
    if (i < 5 || x.partial) return;
    const pre = H.slice(i - 5, i), bn = pre.reduce((a, y) => a + y.nw, 0) / 5;
    if (x.nw > Math.max(50, bn * 4) && (!found.length || i - found.at(-1).i > 21)) found.push({ i, bn, br: pre.reduce((a, y) => a + y.ret, 0) / 5 });
  });
  return found.slice(-3).map(w => {
    let cum = 0;
    const pts = [];
    for (let k = 0; k < WAVE_DAYS && w.i + k < H.length; k++) {
      const x = H[w.i + k];
      if (x.partial) break;
      cum += Math.max(0, x.nw - w.bn);
      pts.push({ k, d: x.d, cum, p: cum ? Math.max(0, (x.ret - w.br) / cum * 100) : 0 });
    }
    return { ...w, d: H[w.i].d, pts };
  });
}
/* среднее людей в час по дням недели и часам местных суток за последние восемь полных недель */
function weekHours() {
  const hours = localHours(tz), acc = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [0, 0]));
  ИСТОРИЯ().filter(x => !x.partial).slice(-56).forEach(x => {
    const wd = (new Date(x.d + 'T00:00:00Z').getUTCDay() + 6) % 7;
    (hours[x.d] || []).forEach((v, h) => { if (v != null) { acc[wd][h][0] += v; acc[wd][h][1]++; } });
  });
  return acc.map(r => r.map(([s, c]) => c ? s / c : 0));
}
function viewPeople() {
  const H = ИСТОРИЯ();
  if (!H.length) {
    виду(card('people', 'Люди', 'Удержание и приход считаются по людям', '', '<p class="block-empty">Людей пока не видели. Включите счёт людей в SDK: он шлёт хеш установки с серверной солью, и сводки наберутся со следующих суток.</p>'));
    return;
  }
  const week = (DATA.days || []).filter(x => !x.partial).slice(-7), daily = avgOf(week, x => x.people);
  const act = (DATA.totals || {}).people || 0, acc = (DATA.totals || {}).accounts || 0;
  const top = H.reduce((a, x) => x.nw > a.nw ? x : a);
  const W = waves(), tones = ['t3', 't1', 't2'].slice(-W.length);
  const plat = DATA.platforms || [], pSum = plat.reduce((s, p) => s + p.u, 0) || 1;
  const levels = [
    acc ? { k: 'Все аккаунты', v: acc, s: 'с первого дня', cls: 'z' } : null,
    { k: `Заходили за ${периодСловами()}`, v: act, s: acc ? `${dec(act / acc * 100)} % аккаунтов` : 'по счёту SDK', cls: 't3' },
    { k: 'В обычный день', v: daily, s: daily ? `каждый ${Math.round(act / daily)}-й из них` : '', cls: 't1' }].filter(Boolean);
  const at = (w, k) => w.pts[k];
  const peakOf = w => w.pts.slice(1).reduce((a, p) => p.p > a.p ? p : a, w.pts[1] || w.pts[0]);
  const cell = p => p ? `${dec(p.p)} %` : '<span class="g">рано судить</span>';
  const weekH = week.length ? week : (DATA.days || []);
  виду(card('people', 'Приход и возврат', `${day(H[0].d)} – ${day(H.at(-1).d)} · по дням: новые вверх от оси, вернувшиеся вниз`,
      `<div class="legend"><span class="lg"><i class="t1"></i>Новые</span><span class="lg"><i class="t3"></i>Вернувшиеся</span></div>`,
      strip([
        { k: 'Пришло за всё время', v: n(H.reduce((a, x) => a + x.nw, 0)), s: `новых с ${day(H[0].d)}`, cls: 'big' },
        { k: 'Новых в обычный день', v: n(avgOf(weekH, x => x.nw)), s: 'среднее за неделю' },
        { k: 'Вернувшихся в обычный день', v: n(avgOf(weekH, x => x.ret)), s: 'среднее за неделю' },
        { k: 'Самый большой приход', v: day(top.d), s: `${n(top.nw)} новых за день`, cls: 'blue' }]) +
      `<div id="tide"></div>`) +
    `<div class="grid g-57">` +
      card('grid', 'Аудитория', 'Площадь квадрата — число людей', '',
        `<div class="mt-wrap"><div class="mt" id="mt"></div><div class="mt-side">
          ${levels.map((l, i) => `<div class="mt-r" data-lv="${i}"><i class="${l.cls}"></i><span>${l.k}</span><b>${n(l.v)}</b>${l.s ? `<small>${l.s}</small>` : ''}</div>`).join('')}
          ${plat.length ? `<div class="mt-pl"><span class="k">Платформы за ${периодСловами()}</span><span class="plat">${plat.map((p, i) => `<i class="${i ? 't3' : 't1'}" style="flex:${p.u}"></i>`).join('')}</span>
            <span class="s">${plat.map((p, i) => `<span class="pl"><i class="dotk ${i ? 't3' : 't1'}"></i>${p.p === 'ios' ? 'iPhone' : p.p === 'android' ? 'Android' : esc(p.p)} ${Math.round(p.u / pSum * 100)} %</span>`).join('')}</span></div>` : ''}
        </div></div>`) +
      card('chart', 'Как держатся волны', 'Сколько пришедших с волной вернулось в этот день · оценка', '',
        W.length ? `<div id="waves"></div>
        <div class="wv-t" style="--n:${W.length}"><span></span>${W.map((w, i) => `<span class="h"><i class="dotk ${tones[i]}"></i>${day(w.d)}</span>`).join('')}
          <span>Пришло за первые 9 дней</span>${W.map(w => `<b>${at(w, 8) ? n(at(w, 8).cum) : '—'}</b>`).join('')}
          <span>Больше всего вернулось</span>${W.map(w => { const p = peakOf(w); return p ? `<b>${dec(p.p)} %<small>через ${p.k} ${plural(p.k, 'день', 'дня', 'дней')}</small></b>` : '<b>—</b>'; }).join('')}
          <span>Через 8 дней</span>${W.map(w => `<b>${cell(at(w, 8))}</b>`).join('')}
          <span>Через 30 дней</span>${W.map(w => `<b>${cell(at(w, 30))}</b>`).join('')}</div>
        <p class="hint" style="padding-top:12px">Считаем возвраты сверх обычного уровня до волны и делим на новых сверх обычного с её начала. Это оценка, а не когорта: кто именно вернулся, сводка по дням не хранит.</p>`
        : '<p class="block-empty">Волн прихода пока не было: волной считается день, когда новых вчетверо больше обычного.</p>') +
    `</div><div class="grid g-75">` +
      card('calendar', 'Неделя по часам', `Людей в час · ${tzName(tz)} · среднее за 8 недель`, HEAT_LEG + tzControl(), `<div class="wk-wrap" id="week"></div>`) +
      card('bolt', 'На одного человека', `В день · ${периодСловами()}`, '', `<div class="per" id="per"></div>`) +
    `</div>`);
  tide(); matryoshka(); wavesChart(); weekGrid(); perPerson(); tzPicker();
}

/* приход и возврат: столбик дня вверх — новые, вниз — вернувшиеся, шкала общая */
function tide() {
  const el = document.getElementById('tide'); if (!el) return;
  const L = ИСТОРИЯ(), max = Math.max(1, ...L.map(x => Math.max(x.nw, x.ret))), narrow = innerWidth < 640;
  // верх шкалы — ближайшее круглое над самым высоким днём, подписи через круглый шаг
  const top = nice(max * 1.05), step = nice(top / 3), H = narrow ? 90 : 120;
  const ticks = Array.from({ length: Math.floor(top / step) }, (_, i) => (i + 1) * step);
  const xp = i => (i + .5) / L.length * 100;
  // подпись у края встаёт внутрь графика, а не вылезает за карточку
  const pinShift = i => xp(i) > 75 ? 'transform:translate(calc(-100% + 10px),calc(-100% - 10px))' : xp(i) < 25 ? 'transform:translate(-10px,calc(-100% - 10px))' : '';
  const pins = waves().map(w => { let b = w.i; for (let k = w.i; k < Math.min(L.length, w.i + 5); k++) if (L[k].nw > L[b].nw) b = k; return b; });
  const months = L.map((x, i) => x.d.endsWith('-01') ? i : -1).filter(i => i >= 0);
  el.innerHTML = `<div class="tide"><div class="td-y" style="height:${H * 2 + 5}px">${ticks.map(t => `<span style="top:${(1 - t / top) * H}px">${short(t)}</span><span style="top:${H + 5 + t / top * H}px">${short(t)}</span>`).join('')}<span style="top:${H + 2.5}px">0</span></div>
    <div class="td-plot mx-plot">
      <div class="td-half" style="height:${H}px">${ticks.map(t => `<div class="gl" style="bottom:${t / top * 100}%"></div>`).join('')}
        <div class="td-row up">${L.map(x => `<i class="t1 ${x.partial ? 'part' : ''}" style="height:${x.nw / top * 100}%"></i>`).join('')}</div>
        ${pins.map(i => `<div class="pin" style="left:${xp(i)}%;top:${(1 - L[i].nw / top) * 100}%;${pinShift(i)}">${day(L[i].d)}${narrow ? '' : ` · ${short(L[i].nw)} новых`}</div>`).join('')}</div>
      <div class="td-axis"></div>
      <div class="td-half" style="height:${H}px">${ticks.map(t => `<div class="gl" style="top:${t / top * 100}%"></div>`).join('')}
        <div class="td-row dn">${L.map(x => `<i class="t3 ${x.partial ? 'part' : ''}" style="height:${x.ret / top * 100}%"></i>`).join('')}</div></div>
      <div class="mx-line"></div><div class="mx-tip"></div></div></div>
    <div class="td-x">${months.map(i => `<span class="m" style="left:${xp(i)}%">${MONTH_START(L[i].d.slice(5, 7))}</span>`).join('')}</div>`;
  const plot = el.querySelector('.td-plot'), ups = plot.querySelectorAll('.up i'), dns = plot.querySelectorAll('.dn i');
  let cur = -1;
  plot.addEventListener('pointermove', e => {
    const b = plot.getBoundingClientRect(), i = Math.max(0, Math.min(L.length - 1, Math.floor((e.clientX - b.left) / b.width * L.length)));
    if (i !== cur) { ups[cur]?.classList.remove('on'); dns[cur]?.classList.remove('on'); ups[i].classList.add('on'); dns[i].classList.add('on'); cur = i; }
    const x = L[i];
    tipAt(plot, xp(i) / 100 * b.width, Math.max(-6, Math.min(b.height - 120, e.clientY - b.top - 40)),
      `<b>${day(x.d)}${x.partial ? ', день ещё идёт' : ''}</b><span><i class="t1"></i>Новых<em>${n(x.nw)}</em></span><span><i class="t3"></i>Вернувшихся<em>${n(x.ret)}</em></span><span class="g">Всего за день<em>${n(x.nw + x.ret)}</em></span>`);
  });
  plot.addEventListener('pointerleave', () => { plot.classList.remove('hovering'); ups[cur]?.classList.remove('on'); dns[cur]?.classList.remove('on'); cur = -1; });
}
/* подсказка у указателя: первое появление встаёт на место, дальше едет следом */
function tipAt(plot, x, y, html) {
  const line = plot.querySelector('.mx-line'), tip = plot.querySelector('.mx-tip');
  tip.innerHTML = html;
  const left = x + 14 + tip.offsetWidth > plot.clientWidth ? x - 14 - tip.offsetWidth : x + 14;
  const fresh = !plot.classList.contains('hovering');
  [line, tip].forEach(e => e.style.transition = fresh ? 'none' : '');
  line.style.transform = `translateX(${x}px)`;
  tip.style.transform = `translate(${Math.max(-36, left)}px,${y}px)`;
  if (fresh) { tip.offsetWidth; [line, tip].forEach(e => e.style.transition = ''); plot.classList.add('hovering'); }
  return fresh;
}
/* аудитория: квадраты вложены от одного угла, площадь — число людей */
function matryoshka() {
  const el = document.getElementById('mt'); if (!el) return;
  const week = (DATA.days || []).filter(x => !x.partial).slice(-7), S = 220;
  const t = DATA.totals || {}, vals = [t.accounts, t.people, avgOf(week, x => x.people)].filter(v => v > 0);
  const big = vals[0] || 1;
  const sides = vals.map(v => S * Math.sqrt(v / big)), cls = vals.length === 3 ? ['z', 't3', 't1'] : ['t3', 't1'];
  el.innerHTML = `<svg viewBox="0 0 ${S} ${S}" role="img" aria-label="Сколько людей на каждом уровне">${sides.map((s, i) => `<rect class="mt-sq ${cls[i]}" data-lv="${i}" x="0" y="${(S - s).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}" rx="${[14, 11, 8][i]}"/>`).join('')}</svg>`;
  const wrap = el.closest('.mt-wrap');
  wrap.querySelectorAll('[data-lv]').forEach(x => {
    x.addEventListener('pointerenter', () => { wrap.classList.add('focus'); wrap.querySelectorAll('[data-lv]').forEach(y => y.classList.toggle('on', y.dataset.lv === x.dataset.lv)); });
    x.addEventListener('pointerleave', () => wrap.classList.remove('focus'));
  });
}
/* волны: доля вернувшихся по дням после начала, линии от одного нуля */
function wavesChart() {
  const el = document.getElementById('waves'); if (!el) return;
  const W = waves(), tones = ['b3', 'b1', 'b2'].slice(-W.length), names = W.map(w => day(w.d));
  const width = el.clientWidth - 64, H = 180;
  const maxP = Math.max(10, ...W.flatMap(w => w.pts.slice(1).map(p => p.p))), top = Math.ceil(maxP / 10) * 10;
  const X = k => k / (WAVE_DAYS - 1) * width, Y = p => H - p / top * H;
  const ticks = Array.from({ length: top / 10 + 1 }, (_, i) => i * 10);
  // первый день волны не рисуем: новых ещё мало, доля скачет от случайных возвратов
  const path = w => w.pts.slice(1).map((p, j) => `${j ? 'L' : 'M'}${X(p.k).toFixed(1)} ${Y(p.p).toFixed(1)}`).join(' ');
  el.innerHTML = `<div class="wv"><div class="ry" style="height:${H}px">${ticks.map(t => `<span style="top:${(1 - t / top) * 100}%">${t} %</span>`).join('')}</div>
    <div class="wv-plot mx-plot" style="height:${H}px"><svg width="${width}" height="${H}" viewBox="0 0 ${width} ${H}">
      ${ticks.map(t => `<line class="gl" x1="0" x2="${width}" y1="${Y(t)}" y2="${Y(t)}"/>`).join('')}
      ${W.map((w, i) => w.pts.length > 1 ? `<path class="wv-line" pathLength="1" d="${path(w)}" style="stroke:var(--${tones[i]})"/>` : '').join('')}
      ${W.map((w, i) => { const p = w.pts.at(-1), right = X(p.k) > width - 60; return `<g class="wv-end"><circle cx="${X(p.k)}" cy="${Y(p.p)}" r="4" style="fill:var(--${tones[i]})"/><text class="wv-lab" x="${X(p.k) + (right ? 0 : 4)}" y="${Y(p.p) - 12}" text-anchor="${right ? 'end' : 'start'}">${names[i]}</text></g>`; }).join('')}
      ${W.map((w, i) => `<circle class="wv-hd" r="4.5" style="fill:var(--${tones[i]})"/>`).join('')}
    </svg><div class="mx-line"></div><div class="mx-tip"></div></div></div>
    <div class="wv-x">${(width < 360 ? [1, 14, 28, 42] : [1, 7, 14, 21, 28, 35, 42]).map(k => `<span style="left:${X(k)}px">${k} ${k === 1 ? 'день' : 'дн.'}</span>`).join('')}</div>`;
  const plot = el.querySelector('.wv-plot'), heads = [...plot.querySelectorAll('.wv-hd')];
  plot.addEventListener('pointermove', e => {
    const b = plot.getBoundingClientRect(), k = Math.max(1, Math.min(WAVE_DAYS - 1, Math.round((e.clientX - b.left) / width * (WAVE_DAYS - 1))));
    const fresh = tipAt(plot, X(k), Math.max(-6, Math.min(H - 90, e.clientY - b.top - 40)),
      `<b>Через ${k} ${plural(k, 'день', 'дня', 'дней')}</b>${W.map((w, i) => `<span><i class="${tones[i].replace('b', 't')}"></i>Волна ${names[i]}<em>${w.pts[k] ? dec(w.pts[k].p) + ' %' : 'ещё нет'}</em></span>`).join('')}`);
    heads.forEach((c, i) => {
      const p = W[i].pts[k];
      c.style.transition = fresh ? 'none' : '';
      c.style.visibility = p ? '' : 'hidden';
      if (p) c.style.transform = `translate(${X(k)}px,${Y(p.p)}px)`;
    });
    if (fresh) { plot.offsetWidth; heads.forEach(c => c.style.transition = ''); }
  });
  plot.addEventListener('pointerleave', () => plot.classList.remove('hovering'));
}
/* неделя по часам: строка — день недели, клетка — час, цвет — людей в час */
function weekGrid() {
  const el = document.getElementById('week'); if (!el) return;
  const wh = weekHours(), flat = wh.flat().filter(v => v > 0).sort((a, b) => a - b);
  if (!flat.length) { el.innerHTML = '<p class="block-empty">Часов ещё нет: сводка по часам наберётся за первые сутки.</p>'; return; }
  const q = [.2, .4, .6, .8].map(f => flat[Math.floor(f * (flat.length - 1))]);
  const level = v => v <= 0 ? 'z' : v < q[0] ? 't5' : v < q[1] ? 't4' : v < q[2] ? 't3' : v < q[3] ? 't2' : 't1';
  let peak = { v: -1 };
  wh.forEach((r, d) => r.forEach((v, h) => { if (v > peak.v) peak = { v, d, h }; }));
  const hh = h => String(h).padStart(2, '0') + ':00';
  el.innerHTML = `<div class="wk"><span></span>${Array.from({ length: 24 }, (_, h) => `<span class="hh">${h % 6 ? '' : String(h).padStart(2, '0')}</span>`).join('')}
    ${wh.map((r, d) => `<span>${WEEKDAYS[d]}</span>${r.map((v, h) => `<i class="${level(v)} ${d === peak.d && h === peak.h ? 'pk' : ''}" data-d="${d}" data-h="${h}"></i>`).join('')}`).join('')}</div>
    <div class="wk-read"><span id="wk-k">Больше всего людей</span><b id="wk-t">${WEEKDAYS[peak.d]}, ${hh(peak.h)}</b><em id="wk-v">≈ ${n(peak.v)} в час</em></div>`;
  const grid = el.querySelector('.wk'), cells = grid.querySelectorAll('i');
  const read = (d, h, label) => {
    document.getElementById('wk-k').textContent = label;
    document.getElementById('wk-t').textContent = `${WEEKDAYS[d]}, ${hh(h)}`;
    tweenText(document.getElementById('wk-v'), `≈ ${n(wh[d][h])} в час`, 240);
  };
  cells.forEach(c => c.addEventListener('pointerenter', () => { grid.classList.add('focus'); cells.forEach(x => x.classList.toggle('on', x === c)); read(+c.dataset.d, +c.dataset.h, 'В это время'); }));
  grid.addEventListener('pointerleave', () => { grid.classList.remove('focus'); cells.forEach(x => x.classList.remove('on')); read(peak.d, peak.h, 'Больше всего людей'); });
}
/* на одного человека: три линии по дням с общей указкой — наводишь на любую, двигаются все */
function perPerson() {
  const el = document.getElementById('per'); if (!el) return;
  const L = (DATA.days || []).filter(x => !x.partial && x.people > 0);
  if (L.length < 2) { el.innerHTML = '<p class="block-empty">Нужно хотя бы двое полных суток со счётом людей.</p>'; return; }
  const wave = L.findIndex(x => x.d === waves().at(-1)?.d);
  const M = [{ k: 'Действий в приложении', f: x => x.events / x.people, d: 0 }, { k: 'Открытий экранов', f: x => x.screens / x.people, d: 1 }, { k: 'Показов рекламы', f: x => x.ads / x.people, d: 2 }]
    .filter(m => L.some(x => m.f(x) > 0));
  el.innerHTML = `<div class="sp-day"><span>Выбран день</span><b id="sp-d">${day(L.at(-1).d)}</b></div>
    ${M.map((m, i) => { const a = m.f(L[0]), z = m.f(L.at(-1)), g = a ? (z / a - 1) * 100 : 0; return `<div class="sp-r"><div class="sp-k"><span>${m.k}</span><b>${dec(z, m.d)}</b><small class="${g < 0 ? 'dn' : ''}">${pctd(g)} к ${day(L[0].d)}</small></div><div class="sp" data-m="${i}"></div></div>`; }).join('')}
    <div class="sp-x"><span>${day(L[0].d)}</span>${wave > 0 ? `<span class="w" style="left:${wave / (L.length - 1) * 100}%">волна</span>` : ''}<span class="e">${day(L.at(-1).d)}</span></div>`;
  const boxes = [...el.querySelectorAll('.sp')], H = 56;
  const geo = boxes.map((box, i) => {
    const w = box.clientWidth, vals = L.map(M[i].f), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * .18 || 1;
    const X = j => j / (L.length - 1) * w, Y = v => H - (v - lo + pad) / (hi - lo + 2 * pad) * H;
    const line = vals.map((v, j) => `${j ? 'L' : 'M'}${X(j).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ');
    box.innerHTML = `<svg width="${w}" height="${H}" viewBox="0 0 ${w} ${H}">
      ${wave > 0 ? `<line class="sp-w" x1="${X(wave)}" x2="${X(wave)}" y1="0" y2="${H}"/>` : ''}
      <path class="sp-a" d="${line} L${w} ${H} L0 ${H}Z"/><path class="sp-line" pathLength="1" d="${line}"/>
      <circle class="sp-dot" r="4" style="transform:translate(${X(L.length - 1)}px,${Y(vals.at(-1))}px)"/></svg>`;
    return { X, Y, vals };
  });
  const pick = j => {
    tweenText(document.getElementById('sp-d'), day(L[j].d));
    boxes.forEach((box, i) => {
      const g = geo[i];
      box.querySelector('.sp-dot').style.transform = `translate(${g.X(j)}px,${g.Y(g.vals[j])}px)`;
      tweenText(box.parentElement.querySelector('.sp-k b'), dec(g.vals[j], M[i].d), 260);
    });
  };
  boxes.forEach(box => box.addEventListener('pointermove', e => { const b = box.getBoundingClientRect(); pick(Math.max(0, Math.min(L.length - 1, Math.round((e.clientX - b.left) / b.width * (L.length - 1))))); }));
  el.addEventListener('pointerleave', () => pick(L.length - 1));
}

/* ================================ Воронки ================================ */
function viewFunnels() {
  const f = DATA.funnels || [];
  const ПЕРИОДЫ = `<div class="segc" role="group" aria-label="Период воронок">${[['7d', '7 дней'], ['15d', '15 дней'], ['30d', '30 дней'], ['all', 'Всё']].map(([k, l]) => `<button data-range-s="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}</div>`;
  const pairs = (DATA.days || []);
  const pMax = Math.max(1, ...pairs.map(d => d.pairs || 0));
  виду((f.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))">` + f.map((x, i) => card('funnels', esc(x.title), `люди · ${периодСловами()}`, i === 0 ? ПЕРИОДЫ : '',
      `<div class="funnel">${x.steps.map((s, j) => {
        const base = x.steps[0].v || 1, conv = s.v === null ? null : s.v / base * 100, prev = j > 0 ? x.steps[j - 1].v : null;
        return (j > 0 ? `<div class="fdrop">${s.v === null || !prev ? 'нет данных' : '↓ ' + dec(s.v / prev * 100, 0) + ' % от прошлого шага'}</div>` : '') +
          `<div class="fstep">${conv !== null ? `<span class="fill" style="width:${conv.toFixed(1)}%"></span>` : ''}<span class="ftxt">${esc(titleOf(s.n))}${s.note ? `<br><span style="font-size:11.5px;color:var(--ink-3)">${esc(s.note)}</span>` : ''}</span><span class="fval">${s.v === null ? '—' : n(s.v)}</span></div>`;
      }).join('')}</div>`)).join('') + `</div>`
      : card('funnels', 'Воронки', 'Шаги, размеченные в коде', ПЕРИОДЫ, '<p class="block-empty">Шагов воронки нет: Tessera.funnel(\'шаг\') в коде приложения.</p>')) +
    (pairs.some(d => d.pairs) ? card('chart', 'Последний шаг по дням', `${подписьПериода()}`, '',
      `<div class="mb" style="padding-top:28px"><div class="ry" style="height:160px"><span style="top:0%">${short(pMax)}</span><span style="top:100%">0</span></div><div class="mb-plot" style="height:160px"><div class="gl" style="bottom:100%"></div><div class="gl" style="bottom:50%"></div>
        <div class="mb-cols" style="gap:4px">${pairs.map(d => `<div class="mb-c ${d.partial ? '' : ''}" title="${day(d.d)}: ${n(d.pairs)}"><i class="${d.partial ? 't4' : 't2'}" style="height:${(d.pairs || 0) / pMax * 100}%"></i></div>`).join('')}</div></div></div>
      <div class="mb-x" style="gap:4px">${pairs.map((d, i) => `<span>${i % Math.ceil(pairs.length / 8) ? '' : day(d.d)}</span>`).join('')}</div><p class="hint" style="padding-top:12px">Последний день неполный: сводка за него ещё считается.</p>`) : ''));
  document.querySelectorAll('[data-range-s]').forEach(b => b.addEventListener('click', () => сменитьПериод(b.dataset.rangeS)));
}

/* ================================ Версии ================================ */
function viewVersions() {
  const vs = DATA.versions || [], total = vs.reduce((s, v) => s + v.u, 0) || 1, eMax = Math.max(1, ...vs.map(v => v.e || 0));
  const plat = DATA.platforms || [], pTotal = plat.reduce((s, p) => s + p.u, 0) || 1;
  const ПЕРИОДЫ = `<div class="segc" role="group" aria-label="Период версий">${[['7d', '7 дней'], ['15d', '15 дней'], ['30d', '30 дней'], ['all', 'Всё']].map(([k, l]) => `<button data-range-s="${k}" aria-pressed="${state.range === k}">${l}</button>`).join('')}</div>`;
  виду(`<div class="grid g-75">` +
    card('versions', 'Версии в бою', `последняя сборка человека · ${периодСловами()}`, ПЕРИОДЫ,
      vs.length ? `<div class="ls">${vs.map((v, i) => `<div class="ls-r"><span class="ls-ic" style="font:500 11px var(--mono)">${i + 1}</span>
        <div class="act-nm"><b class="mono">${esc(v.v)}</b><small>${n(v.e || 0)} событий</small><span class="ls-bar"><i class="${i ? 't3' : 't1'}" style="width:${v.u / total * 100}%"></i></span></div>
        <div class="r"><b>${n(v.u)}</b><small>${dec(v.u / total * 100)} %</small></div></div>`).join('')}</div>
        <p class="hint" style="padding-top:6px">Человек считается один раз, по той сборке, с которой его видели последним.</p>`
        : '<p class="block-empty">Сборок не видно: приложение не присылает версию.</p>') +
    card('apps', 'Платформы', `люди · ${периодСловами()}`, '',
      `<div class="pad"><div class="ib-bar" style="margin:0 0 14px">${plat.map((p, i) => `<i class="${i ? 't3' : 't1'}" style="flex:${p.u}"></i>`).join('')}</div>
        ${plat.map((p, i) => `<div class="lrow"><i class="${i ? 't3' : 't1'}"></i><span>${p.p === 'ios' ? 'iOS' : p.p === 'android' ? 'Android' : esc(p.p)}</span><b>${n(p.u)}</b><small>${dec(p.u / pTotal * 100)} %</small></div>`).join('')}</div>`) +
    `</div>`);
  document.querySelectorAll('[data-range-s]').forEach(b => b.addEventListener('click', () => сменитьПериод(b.dataset.rangeS)));
}

/* ================================ Приложения ================================ */
function viewApps() {
  const apps = DATA.apps || [];
  виду(card('apps', 'Приложения в этой установке', 'один сервер, один пароль', `<span class="badge">${apps.length} ${plural(apps.length, 'приложение', 'приложения', 'приложений')}</span>`,
      `<div class="table-wrap"><table class="tbl"><thead><tr><th>Приложение</th><th>Платформы</th><th>SDK</th><th class="r">События</th><th class="r">Люди</th><th class="r">Сегодня</th></tr></thead><tbody>
      ${apps.map(a => `<tr><td><b style="font-weight:500">${esc(a.name)}</b>${a.id === state.app ? ' <span class="badge">открыто</span>' : ''}</td><td style="color:var(--ink-2)">${esc(a.plat || '—')}</td>
        <td class="mono" style="font-size:12px;color:var(--ink-2)">${a.live ? esc(a.sdk || '—') : 'не подключён'}</td>
        <td class="r">${a.live ? n(a.events) : '—'}</td><td class="r">${a.live ? n(a.people) : '—'}</td><td class="r">${a.live ? n(a.dau) : '—'}</td></tr>`).join('')}</tbody></table></div>`) +
    `<div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">` +
      card('bolt', 'Подключить приложение', 'события по HTTP', '',
        `<pre class="mono pad" style="margin:0;font-size:12px;line-height:1.8;color:var(--ink-2);overflow-x:auto">POST /api/tessera/i
X-Tessera-Key: ключ приложения

{"events":[{"kind":"screen","name":"home"}]}</pre>`) +
      card('note', 'Как имя попадает в панель', 'ключ из кода и подпись для людей', '',
        `<p class="pad" style="font-size:13px;color:var(--ink-2);line-height:1.55">Ключ приходит из кода и человеку ни о чём не говорит. Имя задаётся кнопкой «имя» в строке экрана: словарь ложится на сервер, и его видят все, кто открыл панель.</p>`) +
    `</div>`);
}

/* сменить период: ядро пересобирается с сервера, вкладка перерисовывается мягко */
async function сменитьПериод(range) {
  if (range === state.range) return;
  state.range = range;
  ядроКогда = 0;
  await загрузитьЯдро();
  перерисоватьЯдро();
}
