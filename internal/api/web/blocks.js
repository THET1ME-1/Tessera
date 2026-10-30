/* Заготовки блоков.
 *
 * Каждая функция получает данные ровно в той форме, что описана в договоре, и
 * возвращает узел. Ни одна из них не знает, кто эти данные посчитал: ядро,
 * модуль дохода или чужой плагин — для панели это одинаковые числа. */

/* Один общий словарь имён на всю панель: ключ из кода → то, что читает
   человек. Заполняется с сервера, правится кнопкой в строке. */
const labels = {};
const nameOf = k => (state.rawNames ? k : (labels[k] || k));
const named = k => Object.prototype.hasOwnProperty.call(labels, k);

/* Подпись строки: имя сверху, ключ снизу мелким. */
function nameCell(k, editable) {
  if (state.rawNames) return '<span class="nm raw-only"><b>' + k + "</b></span>";
  return '<span class="nm"><span class="nm-edit"><b>' + nameOf(k) + "</b>" +
    (editable ? '<button data-rename="' + k + '" title="Переименовать">имя</button>' : "") +
    "</span>" + (named(k) ? "<small>" + k + "</small>" : "") + "</span>";
}

/* Число по формату блока. Деньги показываем с копейками, пока сумма мала:
   у дохода в 0,69 доллара округление до целого превращает его в ноль. */
function число(v, формат) {
  if (v === null || v === undefined) return "—";
  if (формат === "money") {
    const abs = Math.abs(v);
    const s = abs >= 1000 ? fmt(v) : v.toFixed(2).replace(".", ",");
    return s + NBSP + "$";
  }
  if (формат === "hours") return fmt(v) + NBSP + "ч";
  return fmt(v);
}

/* ── stat: крупное число, разбивка, прирост ─────────────────────────────── */
function блокStat(host, d, блок, шапка) {
  const части = (d.parts || []).map(p =>
    '<span class="stat-part"><i></i>' + esc(p.name) + " <b>" + число(p.value, d.format) + "</b></span>").join("");
  if (d.delta !== undefined && d.delta !== null && шапка)
    шапка.insertAdjacentHTML("beforeend", '<span class="delta' + (d.delta < 0 ? " down" : "") + '">' + pctd(d.delta) + "</span>");
  host.innerHTML = '<div class="stat">' +
    '<div class="stat-val num">' + число(d.value, d.format) + "</div>" +
    (d.sub ? '<div class="stat-sub">' + esc(d.sub) + "</div>" : "") +
    (части ? '<div class="stat-parts">' + части + "</div>" : "") + "</div>";
  if (d.spark && d.spark.length) {
    const s = document.createElement("span");
    s.className = "spark";
    host.firstChild.appendChild(s);
    spark(s, d.spark);
  }
}

/* Подпись карточки под заголовком: блок вправе уточнить, что он показывает,
   вместо имени модуля. */
function подписать(шапка, текст) {
  const p = шапка && шапка.parentElement.querySelector("h2 + p");
  if (p && текст) p.textContent = текст;
  else if (шапка && текст) шапка.previousElementSibling.insertAdjacentHTML("beforeend", "<p>" + esc(текст) + "</p>");
}
/* Ступень цвета по месту в рейтинге: темнее — больше. «Прочее» и
   «не определено» — серым: это не величина, а остаток. */
const ОСТАТОК = /^(прочее|остальное|не определено|неизвестно|другое)$/i;
const тонМеста = (имя, i) => ОСТАТОК.test(String(имя).trim()) ? "z" : ["t1", "t2", "t3", "t4", "t5"][Math.min(i, 4)];

/* ── columns: столбики по дням ──────────────────────────────────────────── */
/* Столбики с подписями. Блок может принести `with.now` — текущее число того
   же ряда (у дохода месяц по нашим чекам больше, чем в архиве магазинов):
   тогда над последним столбиком встаёт пунктир до него. `with.year` — итог
   года плашкой в шапке. Мелкие ряды (до года назад, по 0,1 доллара) не
   рисуются: столбик в один пиксель ничего не говорит. */
function блокColumns(host, d, блок, шапка) {
  const все = (d.items || []).map(it => ({ label: it.label, v: (it.parts || []).reduce((s, p) => s + (p.v || 0), 0), parts: it.parts || [] }));
  const крупный = Math.max(0, ...все.map(i => i.v));
  const items = все.length > 4 && d.format === "money" ? все.filter(i => i.v > крупный / 1000) : все;
  if (!items.length) return пусто(host, "за этот период ничего не пришло");
  const с = d.with || {}, сейчас = с.now && typeof с.now.value === "number" ? с.now.value : null;
  if (с.year && typeof с.year.value === "number" && шапка)
    шапка.insertAdjacentHTML("beforeend", '<span class="badge">за год ' + число(с.year.value, с.year.format || d.format) + "</span>");
  // Один день-всплеск делает остальные неразличимыми, поэтому шкала режется
  // по медиане, а срезанный столбик подписан своим числом.
  const суммы = items.map(i => i.v).sort((a, b) => a - b);
  const медиана = суммы[Math.floor(суммы.length / 2)] || 0, максимум = суммы.at(-1) || 0;
  const последнийСамый = items.at(-1).v === максимум;
  const режем = медиана > 0 && максимум > медиана * 5 && items.length >= 10 && !последнийСамый;
  const верх = nice((режем ? медиана * 5 : Math.max(максимум, сейчас || 0)) * 1.05), шаг = nice(верх / 4), H = 190;
  const подписи = items.length <= 14;
  const деления = Array.from({ length: Math.floor(верх / шаг) + 1 }, (_, i) => i * шаг);
  const кратко = v => d.format === "money" ? число(v, "money").replace(/,\d+/, "") : short(v);
  host.innerHTML = '<div class="mb"><div class="ry" style="height:' + H + 'px">' +
      деления.map(t => '<span style="top:' + (1 - t / верх) * 100 + '%">' + short(t) + "</span>").join("") + "</div>" +
    '<div class="mb-plot" style="height:' + H + 'px">' + деления.slice(1).map(t => '<div class="gl" style="bottom:' + t / верх * 100 + '%"></div>').join("") +
    '<div class="mb-cols" style="gap:' + (items.length > 20 ? 3 : items.length > 10 ? 6 : 14) + 'px">' + items.map((it, i) => {
      const last = i === items.length - 1, ext = last && сейчас !== null && сейчас > it.v;
      const v = Math.min(it.v, верх), сверху = ext ? сейчас : it.v;
      return '<div class="mb-c' + (last ? " on" : "") + '" title="' + подписьДня(it.label) + ": " + число(it.v, d.format) + '">' +
        (ext ? '<i class="mb-ext" style="height:' + Math.min(100, сейчас / верх * 100) + '%"></i>' : "") +
        '<i class="' + (last ? "t1" : "t4") + '" style="height:' + (v / верх * 100) + '%"></i>' +
        (подписи || (it.v > верх && it.v === максимум) ? '<span class="mb-v" style="bottom:' + Math.min(100, сверху / верх * 100) + '%">' + кратко(сверху) + "</span>" : "") + "</div>";
    }).join("") + "</div></div></div>" +
    '<div class="mb-x" style="gap:' + (items.length > 20 ? 3 : items.length > 10 ? 6 : 14) + 'px">' +
      items.map((it, i) => "<span>" + (подписи || i % Math.ceil(items.length / 8) === 0 ? подписьДня(it.label) : "") + "</span>").join("") + "</div>" +
    (сейчас !== null && сейчас > items.at(-1).v
      ? '<p class="hint" style="padding:12px 18px 14px">Пунктир над последним столбиком — то, что уже посчитано сейчас, но ещё не легло в архив: столбик дорастёт сам.</p>'
      : режем ? '<p class="hint" style="padding:12px 18px 14px">Шкала обрезана по медиане: иначе всплеск в ' + fmt(максимум) + " кладёт остальные дни в плинтус.</p>" : '<div style="height:12px"></div>');
}

/* Шаг растра: круглое число, при котором у лидера выходит десяток-другой
   кусочков. Считать их глазами приятно до сорока, дальше это уже полоса. */
function подобратьШаг(наибольшее) {
  if (!наибольшее) return 1;
  const порядок = Math.pow(10, Math.floor(Math.log10(наибольшее / 20)));
  for (const множитель of [1, 2, 5, 10]) {
    const шаг = порядок * множитель;
    if (шаг > 0 && наибольшее / шаг <= 40) return шаг;
  }
  return порядок * 10;
}

function подписьДня(l) {
  if (/^\d{4}-\d{2}$/.test(l)) return MONS[Number(l.slice(5)) - 1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l)) return l;
  const [, m, d] = l.split("-");
  return Number(d) + NBSP + MONTHS[Number(m) - 1];
}

/* ── raster: ряды кусочков ──────────────────────────────────────────────── */
/* Растр: всё целое кусочками одного размера, цвет — место в рейтинге,
   подписи сбоку (широкий блок) или снизу (узкий). Наведение на строку
   подсвечивает её кусочки. Шаг кусочка круглый, чтобы целого выходило от
   шестидесяти до четырёхсот: меньше — не на что смотреть, больше — каша. */
function блокRaster(host, d, блок, шапка) {
  const rows = (d.rows || []).filter(r => r.value > 0).sort((a, b) =>
    (ОСТАТОК.test(String(a.name).trim()) - ОСТАТОК.test(String(b.name).trim())) || b.value - a.value);
  if (!rows.length) return пусто(host, "нечего показывать");
  const всего = rows.reduce((s, r) => s + r.value, 0);
  let unit = d.unit || 1;
  if (всего / unit < 60 || всего / unit > 400) {
    unit = Math.pow(10, Math.floor(Math.log10(всего / 400)));
    for (const м of [1, 2, 5, 10, 20, 50]) if (всего / (unit * м) <= 400) { unit *= м; break; }
  }
  const кусков = Math.max(1, Math.round(всего / unit)), доли = share(rows.map(r => r.value), кусков);
  const узкий = (блок && блок.span || 12) <= 7;
  const колонок = Math.max(16, Math.min(узкий ? 31 : 34, Math.round(Math.sqrt(кусков * (узкий ? 6 : 4)))));
  const ед = (d.unitLabel || "").replace(/ на кусочек$/, "") || "единиц";
  подписать(шапка, "Кусочек — " + (d.format === "money" ? число(unit, "money") : fmt(unit) + " " + ед) + " · всего " + число(всего, d.format));
  const крохотный = (блок && блок.span || 12) <= 4;
  host.innerHTML = '<div class="mr-wrap' + (узкий ? " narrow" : "") + (крохотный ? " tiny" : "") + '"><div class="mr" style="--mr-cols:' + колонок + '">' +
      доли.flatMap((c, i) => Array(c).fill('<i class="' + тонМеста(rows[i].name, i) + '" data-k="' + i + '"></i>')).join("") + "</div>" +
    '<div class="mr-side">' + rows.map((r, i) => '<div class="mr-l" data-k="' + i + '"><i class="' + тонМеста(r.name, i) + '"></i><span>' + esc(nameOf(r.name)) + "</span>" +
      "<b>" + число(r.value, d.format) + "</b><small>" + (r.value / всего * 100 < 1 ? dec(r.value / всего * 100) : Math.round(r.value / всего * 100)) + " %</small></div>").join("") + "</div></div>";
  const wrap = host.firstChild;
  wrap.querySelectorAll("[data-k]").forEach(x => {
    x.addEventListener("pointerenter", () => { wrap.classList.add("focus"); wrap.querySelectorAll("[data-k]").forEach(y => y.classList.toggle("on", y.dataset.k === x.dataset.k)); });
    x.addEventListener("pointerleave", () => wrap.classList.remove("focus"));
  });
}

/* ── table: таблица с полосой ───────────────────────────────────────────── */
/* Ячейка — число, только если она число и есть. Раньше в формат чисел шло всё
   после первой колонки: почта, магазин и дата участия превращались в NaN, а
   денежный формат на тексте ронял блок целиком (18.09.2026). */
const числоЛи = v => typeof v === "number" ||
  (typeof v === "string" && v.trim() !== "" && isFinite(v));

function блокTable(host, d) {
  const rows = d.rows || [];
  if (!rows.length) return пусто(host, "строк нет");
  // barCol < 0 — модуль просит таблицу без полосы: делить нечего, одни строки.
  const bar = d.barCol === undefined ? 1 : d.barCol;
  const сПолосой = bar >= 0;
  const max = сПолосой ? Math.max(...rows.map(r => Number(r[bar]) || 0)) || 1 : 1;
  // `formats` задаёт форму каждой колонки: «Штук» рядом с «Денег» не должны
  // получать знак доллара. Без него вся таблица живёт по одному `format`.
  const форма = i => d.formats ? d.formats[i] : d.format;
  // Колонку прижимаем вправо, когда в ней числа: текст читается слева.
  // Колонка из одних прочерков числовой не считается — иначе «Пара» прыгала
  // бы влево, как только у кого-то появится «есть».
  const справа = (d.cols || []).map((_, i) => i > 0 &&
    rows.some(r => числоЛи(r[i])) &&
    rows.every(r => числоЛи(r[i]) || r[i] === null || r[i] === undefined || r[i] === "—"));
  host.innerHTML = '<div class="table-wrap"><table class="tbl"><thead><tr>' +
    (d.cols || []).map((c, i) => "<th" + (справа[i] ? ' class="r"' : "") + ">" + c + "</th>").join("") +
    (сПолосой ? '<th class="barcell">Доля</th>' : "") + "</tr></thead><tbody>" +
    rows.map(r => "<tr>" +
      r.map((v, i) => i === 0 ? "<td>" + nameCell(String(v), true) + "</td>"
        : "<td" + (справа[i] ? ' class="r"' : "") + ">" +
          (числоЛи(v) ? число(Number(v), форма(i)) : текстом(v === null || v === undefined ? "—" : v)) +
          "</td>").join("") +
      (сПолосой
        ? '<td class="barcell"><span class="rowbar"><span style="width:' +
          ((Number(r[bar]) || 0) / max * 100).toFixed(1) + '%"></span></span></td>'
        : "") +
    "</tr>").join("") + "</tbody></table></div>";
}

/* ── list: строки «имя — число» ─────────────────────────────────────────── */
/* Список: доля каждого полосой сверху и строки с числом и процентом. */
function блокList(host, d) {
  const items = d.items || [];
  if (!items.length) return пусто(host, "пусто");
  const всего = items.reduce((s, i) => s + (Number(i.value) || 0), 0) || 1, видно = items.filter(i => i.value > 0);
  host.innerHTML = (видно.length > 1 ? '<div class="pad" style="padding-bottom:6px"><div class="ib-bar" style="margin:0">' +
      видно.map((i, k) => '<i class="' + тонМеста(i.name, k) + '" style="flex:' + Math.max(i.value, всего * .006) + '"></i>').join("") + "</div></div>" : "") +
    '<div class="lrows">' + items.map((i, k) =>
      '<div class="lrow"><i class="' + тонМеста(i.name, k) + '"></i><span>' + esc(nameOf(i.name)) + "</span><b>" +
      число(i.value, d.format) + "</b><small>" + (i.value ? dec(i.value / всего * 100) + " %" : "—") + "</small></div>").join("") + "</div>";
}

/* Строки с полосой: таблица, у которой первая колонка — имя, одна колонка —
   величина (barCol), а остальные идут мелкой строкой под именем. Так покупки
   читаются как список, а не как бухгалтерская ведомость. */
function блокRows(host, d, блок, шапка) {
  const rows = d.rows || [], cols = d.cols || [];
  if (!rows.length) return пусто(host, "строк нет");
  const bar = d.barCol === undefined ? cols.length - 1 : d.barCol;
  const форма = i => d.formats ? d.formats[i] : d.format;
  const max = Math.max(1, ...rows.map(r => Number(r[bar]) || 0));
  const штук = cols.findIndex(c => /^(штук|шт|раз|покупок)$/i.test(c));
  if (штук > 0 && шапка) шапка.insertAdjacentHTML("beforeend", '<span class="badge">' + n(rows.reduce((s, r) => s + (Number(r[штук]) || 0), 0)) + " " + cols[штук].toLowerCase() + "</span>");
  const мелко = r => r.map((v, i) => i === 0 || i === bar || v === null || v === "" ? null
    : числоЛи(v) ? (форма(i) === "money" ? cols[i].toLowerCase() + " " + число(Number(v), "money") : fmt(Number(v)) + " " + cols[i].toLowerCase()) : esc(v)).filter(Boolean).join(" · ");
  host.innerHTML = '<div class="ls">' + rows.map(r => '<div class="ls-r"><span class="ls-ic">' + svg(/подар/i.test(r[0]) ? "gift" : (блок && блок.icon) || "card") + "</span>" +
    '<div class="act-nm"><b>' + esc(r[0]) + "</b><small>" + мелко(r) + '</small><span class="ls-bar"><i class="t1" style="width:' + ((Number(r[bar]) || 0) / max * 100) + '%"></i></span></div>' +
    '<div class="r"><b>' + число(Number(r[bar]) || 0, форма(bar)) + "</b></div></div>").join("") + "</div>";
}

/* Доход и выручка на тысячу показов. Число показов модуль даёт полем
   `shows`; старые сводки прятали его в имя («Сундук · 216 144 показов»). */
function блокRate(host, d, блок, шапка) {
  const items = (d.items || []).map(i => {
    const m = String(i.name).match(/^(.*) · ([\d\s ]+) показов$/);
    const shows = i.shows !== undefined ? Number(i.shows) : m ? Number(m[2].replace(/\D/g, "")) : 0;
    return { name: m ? m[1] : i.name, shows, value: Number(i.value) || 0, ecpm: shows ? (Number(i.value) || 0) / shows * 1000 : 0 };
  }).sort((a, b) => b.value - a.value);
  if (!items.length) return пусто(host, "пусто");
  const всего = items.reduce((s, b) => s + b.value, 0) || 1, vMax = Math.max(...items.map(b => b.value)) || 1, eMax = Math.max(...items.map(b => b.ecpm)) || 1;
  if (шапка) шапка.insertAdjacentHTML("beforeend", '<span class="badge">' + esc(items[0].name) + " — " + Math.round(items[0].value / всего * 100) + " %</span>");
  const дешевле = items.filter(b => b.shows).sort((a, b) => a.ecpm - b.ecpm)[0], дороже = items.filter(b => b.shows).sort((a, b) => b.ecpm - a.ecpm)[0];
  host.innerHTML = '<div class="ab"><div class="ab-h"><span>Блок</span><span>Доход</span><span>На 1000 показов</span></div>' +
    items.map((b, i) => '<div class="ab-r"><div class="act-nm"><b>' + esc(b.name) + "</b><small>" + (b.shows ? fmt(b.shows) + " показов" : "показы неизвестны") + "</small></div>" +
      '<div class="ab-bar"><i class="' + (i ? "t3" : "t1") + '" style="width:' + (b.value / vMax * 100) + '%"></i><b class="v">' + число(b.value, d.format || "money") + "</b></div>" +
      '<div class="ab-e"><i style="width:' + (b.ecpm / eMax * 100) + '%"></i><b class="v">' + (b.shows ? число(b.ecpm, "money") : "—") + "</b></div></div>").join("") +
    (дешевле && дороже && дороже !== дешевле ? '<p class="hint" style="padding:12px 0 0">Тысяча показов «' + esc(дешевле.name) + "» приносит " + число(дешевле.ecpm, "money") +
      ", «" + esc(дороже.name) + "» — " + число(дороже.ecpm, "money") + ".</p>" : "") + "</div>";
}

/* Сумма за период с переключателем «сегодня, вчера, месяц, год», полоса
   источников и гантели «прошлый месяц → этот» по каждому. Основной источник —
   месяц; остальные блок просит полем with: today, yesterday, year, sources. */
function блокPeriods(host, d, блок, шапка) {
  const с = d.with || {}, моё = память((блок && блок.src) || "periods");
  const периоды = [["today", "Сегодня"], ["yesterday", "Вчера"], ["month", "Месяц"], ["year", "Год"]].filter(([k]) => k === "month" || с[k]);
  if (!моё.per || !периоды.some(([k]) => k === моё.per)) моё.per = "month";
  const сводка = k => k === "month" ? d : с[k];
  const src = ((с.sources || {}).rows || []).slice().sort((a, b) => (b[2] || 0) - (a[2] || 0));
  const тона = ["t1", "t2", "t3", "t4", "t5"], тонИсточника = имя => тона[Math.max(0, src.findIndex(r => r[0] === имя)) % 5];
  const теперь = new Date(), m = теперь.getMonth();
  подписать(шапка, MONTH_FULL[m] + " " + теперь.getFullYear() + (src.length ? " · " + src.length + " " + plural(src.length, "источник", "источника", "источников") : ""));
  if (шапка) шапка.insertAdjacentHTML("beforeend", '<div class="segc" role="group" aria-label="Период дохода">' +
    периоды.map(([k, l]) => '<button data-per="' + k + '" aria-pressed="' + (моё.per === k) + '">' + l + "</button>").join("") + "</div>");
  const сумма = () => {
    const p = сводка(моё.per) || {}, части = (p.parts || []).filter(x => x.value > 0).sort((a, b) => b.value - a.value);
    return '<div class="ib"><div class="ib-big"><b>' + число(p.value, p.format || "money") + "</b>" +
      (p.delta !== undefined && p.delta !== null ? '<span class="badge">' + pctd(p.delta) + " к " + MONS[(m + 11) % 12] + "</span>" : "") +
      (p.sub ? "<small>" + esc(p.sub) + "</small>" : "") + "</div>" +
      (части.length ? '<div class="ib-bar">' + части.map(x => '<i class="' + тонИсточника(x.name) + '" style="flex:' + x.value + '" title="' + esc(x.name) + '"></i>').join("") + "</div>" +
          '<div class="ib-leg">' + части.map(x => '<span><i class="' + тонИсточника(x.name) + '"></i>' + esc(x.name) + "<b>" + число(x.value, p.format || "money") + "</b></span>").join("") + "</div>"
        : '<p class="ib-none">' + (моё.per === "year" ? "По источникам год не разложен: история хранит по месяцам только общий итог." : "Эту сумму сводка хранит одним числом, без разбивки по источникам.") + "</p>") + "</div>";
  };
  const dMax = Math.max(1, ...src.flatMap(r => [r[2] || 0, r[3] || 0]));
  host.innerHTML = сумма() + (src.length ? '<div class="db"><div class="db-h"><span>Источник</span><span><i class="db-ring"></i>в ' + MONTH_IN[(m + 11) % 12] +
      ' <i class="db-dot"></i>в ' + MONTH_IN[m] + "</span><span>Месяц</span></div>" +
    src.map(r => {
      const g = r[3] ? ((r[2] || 0) / r[3] - 1) * 100 : null, a = Math.min(r[2] || 0, r[3] || 0) / dMax * 100, b = Math.max(r[2] || 0, r[3] || 0) / dMax * 100;
      return '<div class="db-r"><div class="act-nm"><b>' + esc(r[0]) + "</b><small>сегодня " + число(r[1] || 0, "money") + "</small></div>" +
        '<div class="db-t"><i class="db-line' + ((r[2] || 0) < (r[3] || 0) ? " dn" : "") + '" style="left:' + a + "%;width:" + (b - a) + '%"></i><i class="db-ring" style="left:' + (r[3] || 0) / dMax * 100 + '%"></i><i class="db-dot ' + тонИсточника(r[0]) + '" style="left:' + (r[2] || 0) / dMax * 100 + '%"></i></div>' +
        '<div class="db-v"><b class="v">' + число(r[2] || 0, "money") + '</b><small class="' + (g !== null && g < 0 ? "dn" : "") + '">' + (g === null ? "—" : pctd(g)) + "</small></div></div>";
    }).join("") + "</div>" : "");
  шапка && шапка.querySelectorAll("[data-per]").forEach(btn => btn.addEventListener("click", () => {
    моё.per = btn.dataset.per;
    шапка.querySelectorAll("[data-per]").forEach(x => x.setAttribute("aria-pressed", x === btn));
    segThumbs();
    const старое = host.querySelector(".ib-big > b").textContent;
    host.querySelector(".ib").outerHTML = сумма();
    const big = host.querySelector(".ib-big > b"), текст = big.textContent;
    big.textContent = старое; tweenText(big, текст, 600);
    host.querySelectorAll(".ib-bar i").forEach((e, i) => anim(e, GROW_X, { duration: 700, delay: i * 70 }));
    host.querySelectorAll(".ib-leg > span, .ib-none").forEach((e, i) => anim(e, RISE, { duration: 420, delay: 80 + i * 40 }));
  }));
}

/* Вафля: целое на пятьдесят клеток, доли — цветом. Для «сколько оплат и
   откуда»: пятьдесят клеток считаются глазами, проценты — нет. */
function блокWaffle(host, d, блок, шапка) {
  const parts = (d.parts || []).filter(p => p.value > 0);
  if (!parts.length) return блокStat(host, d, блок, шапка);
  const всего = d.value || parts.reduce((s, p) => s + p.value, 0), клетки = share(parts.map(p => p.value), 50);
  const тон = (p, i) => ОСТАТОК.test(String(p.name).trim()) ? "td" : ["t1", "t2", "t3", "t4", "t5"][Math.min(i, 4)];
  if (d.sub) подписать(шапка, d.sub);
  host.innerHTML = '<div class="pad"><div style="display:flex;align-items:baseline;gap:10px;margin-bottom:16px;flex-wrap:wrap"><b class="num" style="font:400 26px var(--mono)">' + число(всего, d.format) + "</b>" +
      '<span class="num blue" style="font-size:13px">кусочек ≈ ' + dec(всего / 50) + "</span></div>" +
    '<div class="waffle">' + клетки.flatMap((c, i) => Array(c).fill('<i class="' + тон(parts[i], i) + '"></i>')).join("") + "</div></div>" +
    '<div class="hr" style="padding:8px 0 10px">' + parts.map((p, i) => '<div class="wl"><i class="' + тон(p, i) + '"></i>' + esc(p.name) +
      '<span class="c">' + Math.round(p.value / всего * 100) + ' %</span><span class="num">' + число(p.value, d.format) + "</span></div>").join("") + "</div>";
}

/* ── funnel: шаги с отвалом ─────────────────────────────────────────────── */
function блокFunnel(host, d) {
  const steps = (d.steps || []).filter(s => s.value !== null && s.value !== undefined);
  if (!steps.length) return пусто(host, "шаги не размечены");
  const первый = steps[0].value || 1;
  host.innerHTML = '<div class="funnel">' + steps.map((s, i) => {
    const доля = s.value / первый * 100;
    // Шаг бывает шире предыдущего: аватар ставят реже, чем заводят группу.
    // Тогда это не отвал, а прибавка, и минус тут врал бы.
    const разница = i > 0 ? s.value - steps[i - 1].value : 0;
    const процент = доля < 1 && доля > 0 ? доля.toFixed(1) : доля.toFixed(0);
    const отвал = i > 0 && steps[i - 1].value
      ? '<div class="fdrop">' + (разница < 0 ? "−" + fmt(-разница) : "+" + fmt(разница)) +
        " · от первого шага " + процент + "%</div>"
      : "";
    return отвал + '<div class="fstep"><span class="fill" style="width:' + доля.toFixed(1) + '%"></span>' +
      '<span class="ftxt">' + s.name + (s.note ? ' <span class="lbl">' + s.note + "</span>" : "") + "</span>" +
      '<span class="fval num">' + fmt(s.value) + "</span></div>";
  }).join("") + "</div>";
}

/* ── heat: матрица когорт ───────────────────────────────────────────────── */
function блокHeat(host, d) {
  const rows = d.cells || [];
  if (!rows.length) return пусто(host, "когорт нет");
  const flip = parseFloat(getComputedStyle(document.documentElement)
    .getPropertyValue("--cell-flip")) || 57;
  host.innerHTML = '<div class="table-wrap"><table class="hm"><thead><tr><th></th>' +
    (d.colLabels || []).map(c => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r, i) => '<tr><td class="k">' + (d.rowLabels[i] || "") + "</td>" +
      r.map((v, j) => {
        if (v === null || v === undefined) return '<td><span class="cell">—</span></td>';
        // Первая колонка — размер когорты, остальные красятся долей от неё.
        const база = r[0] || 1;
        const доля = j === 0 ? 100 : v / база * 100;
        const тон = Math.min(90, доля * 1.6);
        const текст = тон > flip ? "var(--cell-ink)" : "var(--ink)";
        return '<td><span class="cell" style="background:color-mix(in oklab, var(--b1) ' +
          тон.toFixed(0) + '%, var(--sunk));color:' + текст + '">' + fmt(v) + "</span></td>";
      }).join("") + "</tr>").join("") + "</tbody></table></div>";
}

/* ── note: пояснение текстом ────────────────────────────────────────────── */
/* Записка: каждая оговорка начинается с «Источник:», следующее предложение
   без двоеточия дописывается к ней. Оговорки встают клетками. */
function блокNote(host, d) {
  const пункты = [];
  String(d.text || "").split(/(?<=\.)\s+(?=[А-ЯЁA-Z])/).forEach(s => {
    const m = s.match(/^([^:.]{2,40}):\s*(.*)$/);
    if (m) пункты.push({ h: m[1], t: m[2] });
    else if (/^Рубли|курс/i.test(s)) пункты.push({ h: "Курс", t: s });
    else if (пункты.length) пункты.at(-1).t += " " + s;
    else пункты.push({ h: "", t: s });
  });
  host.innerHTML = '<div class="nt' + (пункты.length < 2 ? " one" : "") + '">' + пункты.map(x =>
    '<div class="nt-i">' + (x.h ? "<b>" + esc(x.h) + "</b>" : "") + "<p>" + esc(x.t) + "</p></div>").join("") + "</div>";
}

/* ── map: карта двух величин ────────────────────────────────────────────── */
function блокMap(host, d) {
  const points = d.points || [];
  if (!points.length) return пусто(host, "точек нет");
  screensMap(host, points.map(p => ({
    n: p.name, hits: p.x, sec: p.y, min: (p.size || 1) * 60, u: 0,
  })));
  host.insertAdjacentHTML("beforeend",
    '<div class="map-note"><span>вправо — ' + (d.xLabel || "больше") + "</span>" +
    "<span>вверх — " + (d.yLabel || "больше") + "</span></div>");
}

/* Возраст кадра словами. Модерации важно не точное время, а порядок величины:
 * жалоба на сегодняшний снимок и на прошлогодний — разные разговоры. Дальше
 * недели показываем дату: «14 авг» читается быстрее, чем «23 дня назад». */
function давность(ts) {
  const сек = Math.floor(Date.now() / 1000) - Number(ts || 0);
  // Метка из будущего — не возраст, а сбитые часы на телефоне: такую не рисуем.
  if (!ts || сек < -3600) return "";
  if (сек < 60) return "только что";
  if (сек < 3600) return Math.floor(сек / 60) + " мин назад";
  if (сек < 86400) return Math.floor(сек / 3600) + " ч назад";
  if (сек < 172800) return "вчера";
  if (сек < 604800) return Math.floor(сек / 86400) + " дн назад";
  return new Date(ts * 1000).toLocaleDateString("ru", { day: "numeric", month: "short" });
}

/* Возраст того, кто загрузил кадр: «16 лет», «21 год», «23 года». Даты
 * рождения нет у большинства людей — тогда пусто, и подпись не рисуется. */
function возрастЧеловека(лет) {
  if (лет === null || лет === undefined || лет === "") return "";
  const n = Number(лет), д = n % 10, с = n % 100;
  const слово = д === 1 && с !== 11 ? "год"
    : д >= 2 && д <= 4 && (с < 12 || с > 14) ? "года" : "лет";
  return n + " " + слово;
}

/* Метка возраста на кадре и в полосе лайтбокса. Младше восемнадцати
 * выделяется: снимок под замком «для взрослых» от подростка модератор должен
 * заметить сразу. */
function меткаВозраста(лет) {
  const текст = возрастЧеловека(лет);
  if (!текст) return "";
  return '<span class="age' + (Number(лет) < 18 ? " minor" : "") +
    '" title="Возраст того, кто загрузил">' + текст + "</span>";
}

/* ── shelf: лента чужих кадров ───────────────────────────────────────────
 *
 * Единственная заготовка, которая ходит на сервер сама: собрать двести тысяч
 * файлов заранее нельзя, страницы приходят по требованию. Источник блока
 * подставляется в /api/query, оттуда же берутся фильтры и число страниц. */

/* Что из памяти блока уходит на сервер. Плотность сетки сюда не входит: она
   меняет размер кадров в браузере, а не набор файлов. */
const ФИЛЬТРЫ_ЛЕНТЫ = ["kind", "fmt", "adult", "group"];

/* Вид файлов, пока человек не выбрал другой. Холсты, аватарки и виджеты
   смотрят реже, а ленту они забивают наравне со снимками. «Все» — явный
   выбор, он хранится звёздочкой: пустой вид значит «как по умолчанию», и
   старое запомненное место с пустым видом откроет воспоминания. */
const ВИД_ПО_УМОЛЧАНИЮ = "Воспоминания";
const ВСЕ_ВИДЫ = "*";
const видЛенты = моё => моё.kind || ВИД_ПО_УМОЛЧАНИЮ;

function ссылкаЛенты(src, страница) {
  const моё = память(src);
  let ссылка = адрес("/api/query") + "?src=" + encodeURIComponent(src) +
    "&page=" + (страница === undefined ? (моё.page || 0) : страница);
  const вид = видЛенты(моё);
  for (const имя of ФИЛЬТРЫ_ЛЕНТЫ) {
    const значение = имя === "kind" ? (вид === ВСЕ_ВИДЫ ? "" : вид) : моё[имя];
    if (значение) ссылка += "&" + имя + "=" + encodeURIComponent(значение);
  }
  // Номер страницы назван явно — это догрузка или запас вслед за показанной.
  // Им нужен срез первой страницы: она могла прийти из сводки получасовой
  // давности, и смещение от живого верха повторяло бы уже показанные кадры.
  if (страница !== undefined && моё.top) ссылка += "&top=" + моё.top;
  return ссылка;
}

/* Забрать страницу ленты и нарисовать её. Живёт отдельно от блока, потому что
   ленту просит не только её собственная листалка: поиск нашёл пару — и
   отправляет ленту к файлам этой пары. */
async function загрузитьЛенту(host, src, блок) {
  host.innerHTML = '<p class="block-empty">Загружаю ленту…</p>';
  try {
    блокShelf(host, await взять(ссылкаЛенты(src)), блок);
  } catch (e) {
    пусто(host, "лента не пришла: " + e.message);
  }
}

/* Один блок отправляет другой за новыми данными: поиск нашёл пару — лента
   показывает её файлы. Кто кого просит, решает модуль в своём ответе, поэтому
   панель только ищет нужный блок среди тех, что стоят на вкладке. */
async function открытьВБлоке(src, изменения) {
  const i = (state.блоки || []).findIndex(b => b.src === src);
  const host = i < 0 ? null : $("блок-" + i);
  if (!host) {
    // Блок могли убрать в настройке вкладки — тогда переходить некуда, и
    // молчаливое бездействие читается как сломанная кнопка.
    сказать("на этой вкладке нет блока, который это покажет");
    return;
  }
  Object.assign(память(src), изменения);
  await загрузитьЛенту(host, src, state.блоки[i]);
  const секция = host.closest("section");
  if (секция) секция.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Плитка без кадра переспрашивает его. Генератор делает низ страницы фоном, и
   через несколько секунд кадр уже на диске, а без повтора плитка стояла
   заглушкой «кадр ещё готовится», пока ленту не перерисуют. */
const ПАУЗЫ_ПОВТОРА = [3000, 8000, 20000];
function кадрНеПришёл(img) {
  const ph = img.closest(".ph");
  if (ph) ph.classList.add("нет");
  const попытка = Number(img.dataset.retry || 0);
  if (попытка >= ПАУЗЫ_ПОВТОРА.length) return;
  img.dataset.retry = String(попытка + 1);
  setTimeout(() => {
    if (!img.isConnected) return;
    // Новый хвост адреса — иначе браузер ответит прежним отказом из памяти.
    // Под заглушкой картинка скрыта, а скрытую ленивую браузер не грузит.
    const url = new URL(img.src);
    url.searchParams.set("r", String(попытка + 1));
    img.loading = "eager";
    img.onload = () => { if (ph) ph.classList.remove("нет"); };
    img.src = url.toString();
  }, ПАУЗЫ_ПОВТОРА[попытка]);
}

/* Разметка одного кадра ленты. Отдельной функцией, потому что её зовёт и
   первая отрисовка, и догрузка следующей страницы. */
function разметкаКадра(it, i, выбран) {
  return '<figure data-i="' + i + '" data-id="' + текстом(it.id) + '"' +
      (выбран ? ' class="выбран"' : "") + '><div class="ph' + (it.video ? " vid" : "") +
      (it.audio ? " snd" : "") + (it.adult ? " adult" : "") + '">' +
    // У звука кадра не бывает, и картинку ему не рисуем вовсе: пустой <img>
    // тут же свалился бы в «кадр ещё готовится», а готовиться нечему.
    // Плашку рисует css по классу, слушают такой файл в лайтбоксе.
    (it.audio ? "" :
      // Адрес обязательно через адрес(): модуль отдаёт путь от корня панели,
      // а панель живёт в подпапке (/tessera/). Без этого браузер уходил на
      // корень домена и получал пустоту — лента стояла без единого кадра.
      '<img loading="lazy" src="' + адрес(it.url) + '" alt="' + (it.caption || "кадр") + '"' +
      ' onerror="кадрНеПришёл(this)">') +
    // Галочка стоит только там, где есть что скачивать: у кадра без исходника
    // выбор ничего не даст. Отдельной кнопкой, а не щелчком по плитке, —
    // щелчок открывает кадр, и совмещать эти два действия нельзя.
    (it.download ? '<button class="pick" data-pick aria-pressed="' +
      (выбран ? "true" : "false") + '" title="Выбрать кадр" aria-label="Выбрать кадр"></button>' : "") +
    // Возраст — плашкой на самом кадре, а не в подписи: подпись на плитке в
    // десятую часть ленты режется многоточием, и возраст пропадал бы первым.
    меткаВозраста(it.age) +
    "</div><figcaption>" + (it.caption || "") +
      (it.ts ? " · " + давность(it.ts) : "") + "</figcaption>" +
    // id пары — то, с чем модератор уходит в поиск, в переписку и в поддержку.
    // Поэтому он не подпись, а кнопка: щелчок кладёт его в буфер.
    (it.group ? '<button class="pair-id" data-pair="' + it.group +
      '" title="Скопировать id пары">' + it.group + "</button>" : "") +
    "</figure>";
}

/* Адреса оригиналов копятся отдельно от кадров: пачку скачивают из выбора, а
   в нём лежат и кадры страниц, которых на экране уже нет. */
function запомнитьАдреса(items, карта) {
  (items || []).forEach(it => {
    if (it && it.id && it.download) карта[it.id] = it.download;
  });
  return карта;
}

function блокShelf(host, d, блок) {
  const src = (блок && блок.src) || "";
  const моё = память(src);
  // Настройки, пережившие перезагрузку, читаются ДО разметки: тумблер рисуется
  // прямо в строке фильтров, и прочитанное позже опоздало бы на целый кадр —
  // человек видел бы галочку в прежнем положении.
  if (моё.origDate === undefined) {
    try { моё.origDate = localStorage.getItem("tessera:orig-date") !== "0"; }
    catch { моё.origDate = true; }          // приватный режим
  }

  // Первая отрисовка после перезагрузки: возвращаем человека туда, где он
  // ленту оставил. Ядро прислало первую страницу сводки — воспоминания без
  // прочих фильтров (`kind` в ответе; у сводки старого модуля его нет, там
  // все виды), поэтому под другое место ленту приходится перезапросить —
  // один раз.
  if (моё.page === undefined) {
    моё._вернуться = применитьМесто(моё, вспомнитьМесто(src)) || "";
    моё.page = моё.page || 0;
    const видСводки = d.kind || ВСЕ_ВИДЫ;
    if (моё.page || видЛенты(моё) !== видСводки || моё.fmt || моё.adult || моё.group) {
      загрузитьЛенту(host, src, блок);
      return;
    }
  }

  const вид = видЛенты(моё);
  const стр = Number(моё.page || 0);
  // Срез этой отрисовки: от него считаются все догруженные страницы.
  моё.top = d.top || null;

  const items = d.items || [];
  const виды = d.kinds || [];

  const формат = моё.fmt || "";
  const форматы = d.formats || [];

  const замок = моё.adult || "";
  // Пару берём из ответа: фильтр мог поставить не этот блок, а поиск рядом.
  const пара = d.group || моё.group || "";
  моё.group = пара;

  const фильтры = '<div class="seg shelf-filter" role="group" aria-label="Вид файла">' +
    '<button data-kind="' + ВСЕ_ВИДЫ + '"' + (вид === ВСЕ_ВИДЫ ? ' aria-pressed="true"' : "") +
      ">Все</button>" +
    виды.map(k => '<button data-kind="' + k + '"' +
      (k === вид ? ' aria-pressed="true"' : "") + ">" + k + "</button>").join("") + "</div>" +
    // Формат отдельно от вида: mp4 лежит и в «Воспоминаниях», и в
    // «Виджетах», а «Голосовые» — это и m4a, и ogg. Роликов меньше процента,
    // и без своей кнопки до них не долистать.
    (форматы.length
      ? '<div class="seg shelf-filter" role="group" aria-label="Формат файла">' +
        '<button data-fmt=""' + (формат ? "" : ' aria-pressed="true"') + ">Любой</button>" +
        форматы.map(ф => '<button data-fmt="' + ф + '"' +
          (ф === формат ? ' aria-pressed="true"' : "") + ">" + ф + "</button>").join("") +
        "</div>"
      : "") +
    // Замок ставит сама пара в приложении, модерация его только видит. Своей
    // строкой, а не среди видов: вид и возрастная пометка — разные вопросы, и
    // спрашивают их вместе («холсты, где стоит замок»).
    '<div class="seg shelf-filter" role="group" aria-label="Возрастная пометка">' +
    '<button data-adult=""' + (замок ? "" : ' aria-pressed="true"') + ">Любые</button>" +
    '<button data-adult="only"' + (замок === "only" ? ' aria-pressed="true"' : "") +
      ">Только 18+</button>" +
    '<button data-adult="hide"' + (замок === "hide" ? ' aria-pressed="true"' : "") +
      ">Без 18+</button></div>" +
    // Плотность сетки. Мельче ширины экрана лента не станет, поэтому потолок
    // ползунка — то, что даёт CSS сам; крайнее правое положение и есть
    // «как было». Число подставляется после вставки в DOM, когда потолок
    // известен.
    '<label class="shelf-cols">в ряд<input type="range" min="1" step="1" value="1"' +
      ' aria-label="Кадров в ряд"><b></b></label>' +
    // Дату съёмки в скачанный файл ставит сервер, и нужна она не всегда:
    // иногда кадр нужен галерее свежим, по дате загрузки к себе. Выбор
    // запоминается — переключают его редко, а качают помногу.
    '<label class="shelf-date">дата съёмки<input type="checkbox"' +
      (моё.origDate === false ? "" : " checked") + '><span class="sw" aria-hidden="true"></span></label>' +
    // Пару ставит поиск, поэтому лента обязана сказать, что показывает не всё:
    // без плашки «пусто» на редкой паре читается как поломка ленты.
    (пара ? '<div class="shelf-pair">файлы пары <b>' + текстом(пара) +
      '</b><button class="ghost-btn" data-pair-off title="Показать всю ленту">' +
      "×</button></div>" : "");

  // Выбор живёт в памяти блока: он переживает и догрузку страниц, и смену
  // фильтра. Модератор собирает кадры одной жалобы из разных углов ленты, и
  // терять набор на каждом щелчке по фильтру нельзя.
  моё.выбор = моё.выбор || [];
  моё.адреса = моё.адреса || {};
  запомнитьАдреса(items, моё.адреса);

  // Кадры копятся: догруженная страница дописывается сюда, и лайтбокс листает
  // всё, что человек уже видел, а не одну первую страницу.
  const показанные = items.slice();

  const кадры = items.map((it, i) => разметкаКадра(it, i, моё.выбор.includes(it.id))).join("");

  const листалка = '<div class="shelf-nav">' +
    '<button class="ghost-btn" data-page="' + (стр - 1) + '"' + (стр <= 0 ? " disabled" : "") +
      ">Назад</button>" +
    // Номер — поле, а не подпись: страниц тут тысячи, и стрелками до конца
    // июня не дойти. Ширина считается по числу цифр, чтобы поле не висело
    // пустым полем ввода посреди строки.
    '<span class="lbl">страниц<span class="shelf-shown"></span> <input class="shelf-page"' +
      ' type="text" inputmode="numeric"' +
      ' value="' + (стр + 1) + '" size="' + String(d.pages || 1).length +
      '" aria-label="Номер страницы"> из ' + fmt(d.pages || 1) +
      " · всего " + fmt(d.total || 0) + " файлов</span>" +
    '<button class="ghost-btn" data-page="' + (стр + 1) + '"' +
      ((d.pages && стр + 1 >= d.pages) ? " disabled" : "") + ">Дальше</button></div>";

  // Маячок под сеткой: как только он показался на экране, снизу дописывается
  // следующая страница. Кнопка «Дальше» остаётся — прокруткой до конца июня
  // не добраться, туда прыгают по номеру.
  const маячок = items.length ? '<div class="shelf-more" aria-live="polite"></div>' : "";

  // Полоса выбора висит внизу и появляется, только когда что-то выбрано.
  const полоса = '<div class="shelf-pick" hidden>' +
    '<span class="lbl">Выбрано <b></b></span>' +
    '<button class="ghost-btn" data-pack>Скачать оригиналы</button>' +
    '<button class="ghost-btn" data-pick-off>Снять выбор</button></div>';

  host.innerHTML = '<div class="shelf-bar">' + фильтры + "</div>" +
    '<div class="shelf-body">' +
    (items.length ? '<div class="shelf">' + кадры + "</div>" : '<p class="block-empty">пусто</p>') +
    маячок + "</div>" + листалка + полоса +
    '<p class="block-note shelf-note">Порядок — по загрузке в хранилище, а не по дате внутри записи: ' +
    "дату загрузивший может подвинуть. Кадры чужие, поэтому наружу они не уходят.</p>";
  segThumbs();

  const перерисовать = async () => {
    // Держим блок на месте: перерисовка меняет высоту, и страница уезжала
    // к началу — человек листал ленту, а его выбрасывало наверх, к шапке.
    const былоСверху = host.getBoundingClientRect().top;
    host.style.minHeight = host.offsetHeight + "px";
    await загрузитьЛенту(host, src, блок);
    host.style.minHeight = "";
    // Возвращаем блок туда, где он был под пальцем.
    const сталоСверху = host.getBoundingClientRect().top;
    if (Math.abs(сталоСверху - былоСверху) > 4) {
      window.scrollBy({ top: сталоСверху - былоСверху, behavior: "instant" });
    }
  };

  host.querySelectorAll("[data-kind]").forEach(b => b.addEventListener("click", () => {
    моё.kind = b.dataset.kind;
    моё.page = 0;
    перерисовать();
  }));
  const снять = host.querySelector("[data-pair-off]");
  if (снять) снять.addEventListener("click", () => {
    моё.group = "";
    моё.page = 0;
    перерисовать();
  });
  host.querySelectorAll("[data-fmt]").forEach(b => b.addEventListener("click", () => {
    моё.fmt = b.dataset.fmt;
    моё.page = 0;
    перерисовать();
  }));
  host.querySelectorAll("[data-adult]").forEach(b => b.addEventListener("click", () => {
    моё.adult = b.dataset.adult;
    моё.page = 0;
    перерисовать();
  }));

  // Плотность сетки меняется на месте, без похода на сервер: те же кадры,
  // другой размер. Потолок берём у CSS — сколько колонок даёт эта ширина.
  const сетка = host.querySelector(".shelf");
  const ползунок = host.querySelector(".shelf-cols input");
  if (сетка && ползунок) {
    const потолок = Number(getComputedStyle(сетка).getPropertyValue("--cols-auto")) || 10;
    const показать = n => {
      сетка.style.setProperty("--cols", n);
      ползунок.parentElement.querySelector("b").textContent = n;
    };
    // Выбор переживает перезагрузку: плотность подбирают под свой монитор
    // один раз, и просить об этом каждое утро незачем.
    const запомненное = Number(моё.cols || localStorage.getItem("tessera:shelf-cols"));
    ползунок.max = потолок;
    ползунок.value = Math.min(запомненное || потолок, потолок) || потолок;
    показать(Number(ползунок.value));
    ползунок.addEventListener("input", () => {
      моё.cols = Number(ползунок.value);
      показать(моё.cols);
      try { localStorage.setItem("tessera:shelf-cols", String(моё.cols)); } catch { /* приватный режим */ }
    });
  } else if (ползунок) {
    // Лента пуста — сетки нет, и крутить нечего.
    ползунок.closest(".shelf-cols").remove();
  }
  // Полоса выбора. Появляется, когда отмечен хоть один кадр, и говорит,
  // сколько их: «Выбрано 14 кадров».
  const полосаВыбора = host.querySelector(".shelf-pick");
  const обновитьПолосу = () => {
    if (сетка) сетка.classList.toggle("выбираем", моё.выбор.length > 0);
    if (!полосаВыбора) return;
    const была = !полосаВыбора.hidden;
    полосаВыбора.hidden = моё.выбор.length === 0;
    // полоса выезжает снизу, а не возникает
    if (!была && !полосаВыбора.hidden)
      anim(полосаВыбора, [{ opacity: 0, transform: "translate(-50%,24px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 380 });
    полосаВыбора.querySelector("b").textContent = кадровСловом(моё.выбор.length);
    // Полоса всплыла или ушла — кнопка «наверх» встаёт над ней или опускается.
    if (typeof поставитьНаверх === "function") поставитьНаверх();
  };

  // `надо`: true — отметить, false — снять, не задано — переключить.
  const отметить = (ид, узел, надо) => {
    const место = моё.выбор.indexOf(ид);
    const стал = надо === undefined ? место < 0 : надо;
    if (стал && место < 0) моё.выбор.push(ид);
    if (!стал && место >= 0) моё.выбор.splice(место, 1);
    узел.classList.toggle("выбран", стал);
    const кнопка = узел.querySelector("[data-pick]");
    if (кнопка) кнопка.setAttribute("aria-pressed", стал ? "true" : "false");
    обновитьПолосу();
  };
  // Отмечать можно только кадр с галочкой: без исходника выбор ничего не даст.
  const можноОтметить = f => !!f.querySelector("[data-pick]");
  const кадрыСетки = () => Array.from(host.querySelectorAll(".shelf figure"));

  // Отметить всё от кадра-якоря до этого: Shift+щелчок и протягивание после
  // удержания. Отметки вне диапазона не трогаем — так собирают несколько
  // кусков ленты подряд.
  const отметитьДо = f => {
    const узлы = кадрыСетки();
    const ids = узлы.map(у => у.dataset.id);
    const якорь = моё._якорь && ids.includes(моё._якорь) ? моё._якорь : f.dataset.id;
    for (const ид of диапазонКадров(ids, якорь, f.dataset.id)) {
      const у = узлы[ids.indexOf(ид)];
      if (у && можноОтметить(у)) отметить(ид, у, true);
    }
  };

  // Удержание пальца или кнопки мыши на кадре отмечает его, как в галерее
  // телефона. Дальше, не отпуская, можно протянуть по ленте: отметится всё
  // от первого кадра до того, что под пальцем. Сдвиг больше чем на 10 пикселей
  // до срабатывания — это прокрутка, а не удержание.
  const УДЕРЖАНИЕ_МС = 450;
  const начатьУдержание = (f, e) => {
    if (e.button > 0 || e.target.closest(".pair-id") || !можноОтметить(f)) return;
    const x0 = e.clientX, y0 = e.clientY;
    const отмена = () => {
      clearTimeout(моё._удержание);
      моё._удержали = null;
      removeEventListener("pointermove", сдвиг);
      removeEventListener("pointerup", отмена);
      removeEventListener("pointercancel", отмена);
    };
    const сдвиг = м => { if (Math.hypot(м.clientX - x0, м.clientY - y0) > 10) отмена(); };
    addEventListener("pointermove", сдвиг);
    addEventListener("pointerup", отмена);
    addEventListener("pointercancel", отмена);
    моё._удержали = () => {
      отмена();
      моё._якорь = f.dataset.id;
      отметить(f.dataset.id, f, true);
      // Щелчок, который придёт при отпускании, не должен ни открыть кадр, ни
      // снять только что поставленную отметку.
      моё._глушитьЩелчок = true;
      if (navigator.vibrate) navigator.vibrate(15);
      протягивать();
    };
    моё._удержание = setTimeout(моё._удержали, УДЕРЖАНИЕ_МС);
  };
  const протягивать = () => {
    моё._тянем = true;
    const ход = м => {
      const под = document.elementFromPoint(м.clientX, м.clientY);
      const f = под && под.closest && под.closest(".shelf figure");
      if (f && host.contains(f)) отметитьДо(f);
    };
    const конец = () => {
      // Глушилку щелчка здесь не снимаем: от пальца щелчок приходит не сразу
      // за pointerup, а отдельной задачей, и снимал отметку, которую только
      // что поставило удержание. Её снимает следующее касание кадра.
      моё._тянем = false;
      removeEventListener("pointermove", ход);
      removeEventListener("pointerup", конец);
      removeEventListener("pointercancel", конец);
    };
    addEventListener("pointermove", ход);
    addEventListener("pointerup", конец);
    addEventListener("pointercancel", конец);
  };

  // Кадры оживают и при первой отрисовке, и после догрузки следующей
  // страницы, поэтому обработчики висят одной функцией, а не разбросаны по
  // блоку.
  const оживитьКадры = узлы => узлы.forEach(f => {
    f.addEventListener("pointerdown", e => {
      // Новое касание: щелчок от прошлого удержания уже пришёл или не придёт
      // вовсе (палец отпустили над полосой выбора), и честный глушить нельзя.
      моё._глушитьЩелчок = false;
      моё._палец = e.pointerType === "touch";
      начатьУдержание(f, e);
    });
    // Удержание на телефоне иначе открывает меню картинки «сохранить, поделиться»,
    // а мышью картинку начинало бы тащить в другое окно. Android считает
    // долгое нажатие своим таймером и бывает быстрее нашего: тогда его
    // contextmenu и есть удержание, иначе меню всплывёт, а отметки не будет.
    f.addEventListener("contextmenu", e => {
      if (моё._палец && моё._удержали) {
        clearTimeout(моё._удержание);
        моё._удержали();
      }
      if (моё._палец || моё._глушитьЩелчок || моё._тянем) e.preventDefault();
    });
    f.addEventListener("dragstart", e => e.preventDefault());
    f.addEventListener("click", e => {
      if (моё._глушитьЩелчок) {
        моё._глушитьЩелчок = false;
        return;
      }
      // Галочка и id пары — свои действия, кадр от них не открывается.
      if (e.target.closest("[data-pick]")) {
        моё._якорь = f.dataset.id;
        отметить(f.dataset.id, f);
        return;
      }
      if (e.target.closest(".pair-id")) return;
      // Shift+щелчок отмечает диапазон от прошлого отмеченного кадра.
      if (e.shiftKey && можноОтметить(f)) {
        отметитьДо(f);
        моё._якорь = f.dataset.id;
        return;
      }
      // Пока что-то выбрано, щелчок по кадру отмечает его, а не открывает:
      // целиться в маленькую галочку на каждом из тридцати кадров долго.
      if (щелчокОтмечает(моё.выбор) && можноОтметить(f)) {
        моё._якорь = f.dataset.id;
        отметить(f.dataset.id, f);
        return;
      }
      запомнить(f.dataset.id);
      открытьКадр(показанные, Number(f.dataset.i), моё.origDate);
    });
    const пара = f.querySelector(".pair-id");
    if (пара) пара.addEventListener("click", async e => {
      e.stopPropagation();
      const id = пара.dataset.pair || "";
      try {
        await navigator.clipboard.writeText(id);
        сказать("id пары скопирован");
      } catch {
        // Буфер закрыт (панель открыта не по https или права не даны) — тогда
        // выделяем текст, чтобы человек забрал его сам.
        const д = document.createRange();
        д.selectNodeContents(пара);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(д);
        сказать("скопируйте выделенное");
      }
    });
  });
  оживитьКадры(Array.from(host.querySelectorAll(".shelf figure")));
  обновитьПолосу();

  // Протягивание пальцем после удержания: без этого телефон прокручивал бы
  // страницу вместо того, чтобы отмечать кадры. Слушатель не пассивный —
  // иначе отменить прокрутку нельзя. Вешается один раз на блок.
  if (сетка && !сетка._тянемСлушает) {
    сетка._тянемСлушает = true;
    сетка.addEventListener("touchmove", e => { if (моё._тянем) e.preventDefault(); },
                           { passive: false });
  }
  // Esc снимает выбор, если лайтбокс не открыт.
  if (моё._esc) removeEventListener("keydown", моё._esc);
  моё._esc = e => {
    if (e.key !== "Escape" || !моё.выбор.length || document.querySelector(".light")) return;
    const снять = host.querySelector("[data-pick-off]");
    if (снять) снять.click();
  };
  addEventListener("keydown", моё._esc);

  // Место запоминается на прокрутке: человек листает ленту часами и в
  // лайтбокс заходит не на каждом кадре. Считаем по первому кадру, который
  // виден целиком, — он и есть тот, на который человек смотрит.
  const запомнить = ид => {
    if (!сетка) return;
    const узлы = сетка.children;
    for (let i = 0; i < узлы.length; i++) {
      if (ид ? узлы[i].dataset.id === ид : узлы[i].getBoundingClientRect().bottom > 80) {
        запомнитьМесто(src, {
          page: страницаКадра(стр, i, items.length || 60),
          id: узлы[i].dataset.id || "",
          kind: моё.kind || "", fmt: моё.fmt || "",
          adult: моё.adult || "", group: моё.group || "",
        });
        return;
      }
    }
  };
  if (моё._скролл) removeEventListener("scroll", моё._скролл);
  моё._скролл = () => {
    clearTimeout(моё._ждём);
    моё._ждём = setTimeout(() => запомнить(""), 400);
  };
  addEventListener("scroll", моё._скролл, { passive: true });

  // Вернуться к кадру можно только после того, как он оказался в сетке.
  if (моё._вернуться && сетка) {
    const цель = сетка.querySelector('[data-id="' + моё._вернуться + '"]');
    моё._вернуться = "";
    if (цель) {
      цель.scrollIntoView({ block: "center", behavior: "instant" });
      // Подсветка на пару секунд: без неё непонятно, почему лента открылась
      // посреди себя.
      цель.classList.add("вернулись");
      setTimeout(() => цель.classList.remove("вернулись"), 2000);
    }
  }

  const дата = host.querySelector(".shelf-date input");
  if (дата) дата.addEventListener("change", () => {
    моё.origDate = дата.checked;
    try { localStorage.setItem("tessera:orig-date", дата.checked ? "1" : "0"); }
    catch { /* приватный режим */ }
    сказать(дата.checked ? "оригиналы уходят с датой съёмки"
                         : "оригиналы уходят без даты съёмки");
  });

  const снятьВыбор = host.querySelector("[data-pick-off]");
  if (снятьВыбор) снятьВыбор.addEventListener("click", () => {
    моё.выбор.length = 0;
    host.querySelectorAll(".shelf figure.выбран").forEach(f => {
      f.classList.remove("выбран");
      const к = f.querySelector("[data-pick]");
      if (к) к.setAttribute("aria-pressed", "false");
    });
    обновитьПолосу();
  });

  const пачкой = host.querySelector("[data-pack]");
  if (пачкой) пачкой.addEventListener("click", () => скачатьПачкой(пачкой, моё));

  // Догрузка: маячок под сеткой показался — снизу дописывается следующая
  // страница. Номер первой показанной страницы остаётся в памяти блока, чтобы
  // перерисовка после фильтра вернулась туда же, а не в конец догруженного.
  const показаноТут = host.querySelector(".shelf-shown");
  let последняя = стр;
  const обновитьСчёт = () => {
    if (показаноТут) показаноТут.textContent = "ы " + показаноСтраниц(стр, последняя);
  };
  обновитьСчёт();

  const маячокУзел = host.querySelector(".shelf-more");
  if (маячокУзел && сетка) {
    let грузим = false;
    // Перерисовка под другой фильтр делает запас этой отрисовки ненужным:
    // поколение останавливает подтягивание его картинок.
    const поколение = моё._поколение = (моё._поколение || 0) + 1;
    const устарел = () => моё._поколение !== поколение;
    // Метка prefetch: модуль отвечает списком сразу, а миниатюры отдаёт
    // генератору фоном, не занимая очередь ожиданием.
    const запас = создатьЗапас(стр => взять(ссылкаЛенты(src, стр) + "&prefetch=1"));
    const запастись = () => {
      const следом = следующаяСтраница(последняя, d.pages);
      if (следом === null) return;
      запас.приготовить(следом);
      // Картинки — через три секунды после страницы: за это время генератор
      // на сервере, запущенный той же страницей фоном, успевает сделать
      // большую часть миниатюр, и запас берёт уже готовые файлы.
      const п = запас.забрать(следом);
      if (!п) return;
      const снова = п.then(ещё => {
        setTimeout(() => {
          // С конца страницы: генератор идёт с начала, и так они встречаются
          // посередине, а не делают одни и те же кадры дважды.
          if (!устарел()) подтянутьКартинки(адресаЗапаса(ещё.items).reverse(), 2, загрузитьКартинку, устарел);
        }, 3000);
        return ещё;
      });
      снова.catch(() => {});
      моё._запас = { стр: следом, п: снова };
    };
    const догрузить = async () => {
      const следом = следующаяСтраница(последняя, d.pages);
      if (грузим || следом === null) return;
      грузим = true;
      маячокУзел.textContent = "догружаю…";
      try {
        const готовый = моё._запас && моё._запас.стр === следом ? моё._запас.п : null;
        моё._запас = null;
        const ещё = await (готовый || взять(ссылкаЛенты(src, следом)));
        const новые = ещё.items || [];
        const было = показанные.length;
        показанные.push(...новые);
        запомнитьАдреса(новые, моё.адреса);
        сетка.insertAdjacentHTML("beforeend", новые.map(
          (it, i) => разметкаКадра(it, было + i, моё.выбор.includes(it.id))).join(""));
        оживитьКадры(Array.from(сетка.children).slice(было));
        последняя = следом;
        обновитьСчёт();
        маячокУзел.textContent = следующаяСтраница(последняя, d.pages) === null
          ? "лента кончилась" : "";
        запастись();
      } catch (e) {
        // Страница не пришла — говорим об этом прямо в ленте. Молчаливый
        // маячок читается как «файлы кончились», а это не так.
        маячокУзел.textContent = "не догрузилось: " + e.message;
      }
      грузим = false;
    };
    if (моё._смотрит) моё._смотрит.disconnect();
    if (typeof IntersectionObserver === "function") {
      // Запас в полторы тысячи пикселей — это экран-полтора до низа: страница
      // уже лежит в запасе, и дописать её успевает до того, как человек
      // доскроллит до пустоты.
      моё._смотрит = new IntersectionObserver(
        записи => { if (записи.some(з => з.isIntersecting)) догрузить(); },
        { rootMargin: "1500px" });
      моё._смотрит.observe(маячокУзел);
    }
    // Следующая страница — сразу после показа этой, пока человек смотрит.
    моё._запас = null;
    запастись();
  }

  host.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    моё.page = Number(b.dataset.page);
    перерисовать();
  }));

  // Поле номера. Enter переводит, уход из поля — тоже: человек набирает номер
  // и щёлкает мимо, ожидая перехода. Мусор и та же страница возвращают поле к
  // текущему номеру, чтобы оно не осталось врать.
  const номер = host.querySelector(".shelf-page");
  if (номер) {
    const перейти = () => {
      const куда = номерСтраницы(номер.value, d.pages || 1);
      if (куда === null || куда === стр) {
        номер.value = String(стр + 1);
        return;
      }
      моё.page = куда;
      перерисовать();
    };
    номер.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); перейти(); }
      // Стрелки листают ленту, а внутри поля они двигают курсор — иначе номер
      // не поправить, не улетев на соседнюю страницу.
      e.stopPropagation();
    });
    номер.addEventListener("change", перейти);
    номер.addEventListener("focus", () => номер.select());
  }

}

/* Запас ленты: следующая страница грузится, пока человек смотрит эту.
 *
 * Холодная страница отвечает три с половиной секунды, а потом браузер добирает
 * сорок недостающих миниатюр по 0,4 секунды каждую — у пустого низа ленты
 * выходило полминуты ожидания. Запас просит страницу сразу после показа
 * предыдущей, и к моменту, когда маячок показался, она уже лежит готовой.
 *
 * Одна и та же страница грузится один раз; забранный запас второй раз не
 * отдаётся — иначе две догрузки подряд дописали бы одни и те же кадры. */
function создатьЗапас(загрузить) {
  let стр = null, обещание;
  return {
    приготовить(номер) {
      if (номер === null || номер === undefined || номер === стр) return;
      стр = номер;
      обещание = загрузить(номер);
      // Отказ запаса не должен всплыть в консоль «необработанным»: его
      // увидит догрузка, когда заберёт.
      обещание.catch(() => {});
    },
    забрать(номер) {
      if (номер !== стр || !обещание) return undefined;
      const п = обещание;
      стр = null; обещание = undefined;
      return п;
    },
  };
}

/* Адреса миниатюр для запаса — те же, что у плиток, чтобы браузер взял их из
   своего кэша. У звука картинки нет, у кадра без адреса брать нечего. */
function адресаЗапаса(кадры) {
  return (кадры || []).filter(it => it && it.url && !it.audio).map(it => адрес(it.url));
}

/* Подтягивает картинки запаса понемногу. Каждая непрогретая миниатюра
 * поднимает на сервере процесс модуля, а их у ядра четыре разом: займи запас
 * все — щелчок модератора по кадру встал бы в очередь за чужими плитками.
 * `хватит` останавливает подгрузку, когда лента перерисовалась под другой
 * фильтр и запас больше не нужен. */
async function подтянутьКартинки(адреса, разом, сделать, хватит = () => false) {
  const очередь = адреса.slice();
  const рабочий = async () => {
    while (очередь.length && !хватит()) {
      const а = очередь.shift();
      try { await сделать(а); } catch { /* не догрузилась — плитка попросит сама */ }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, разом) }, рабочий));
}

/* Картинка в браузере: ждём загрузку или отказ, дольше двадцати секунд — нет. */
function загрузитьКартинку(а) {
  return new Promise(готово => {
    const img = new Image();
    const таймер = setTimeout(готово, 20000);
    img.onload = img.onerror = () => { clearTimeout(таймер); готово(); };
    img.src = а;
  });
}

/* Какую страницу догружать следующей, когда лента доскроллена до низа.
 *
 * Дальше последней грузить нечего: сервер отдаст пустоту, а наблюдатель
 * продолжит спрашивать её при каждом движении колеса. Число страниц приходит
 * от модуля и может не прийти вовсе — тогда тоже молчим. */
function следующаяСтраница(последняя, всегоСтраниц) {
  const всего = Number(всегоСтраниц) || 0;
  const эта = Number(последняя) || 0;
  return эта + 1 < всего ? эта + 1 : null;
}

/* Подпись листалки: какие страницы сейчас на экране. Долистав до третьей,
   человек видит «страницы 1–3», а не «страница 1» — иначе непонятно, где он
   находится и что вообще догрузилось. */
function показаноСтраниц(первая, последняя) {
  return последняя > первая ? (первая + 1) + "–" + (последняя + 1) : String(первая + 1);
}

/* Кадры ленты от `от` до `до` включительно, в порядке сетки и в любую
   сторону. Чего-то из двух нет на странице — только тот, что есть. */
function диапазонКадров(ids, от, до) {
  const а = ids.indexOf(от), б = ids.indexOf(до);
  if (а < 0 && б < 0) return [];
  if (а < 0 || б < 0) return [ids[Math.max(а, б)]];
  return ids.slice(Math.min(а, б), Math.max(а, б) + 1);
}

/* Щелчок по кадру отмечает его, а не открывает, пока выбран хоть один. */
function щелчокОтмечает(выбор) {
  return Array.isArray(выбор) && выбор.length > 0;
}

/* «14 кадров», «21 кадр», «2 кадра». Полоса выбора висит на виду всё время
   разбора, и «Выбрано 21 кадров» мозолит глаза. */
function кадровСловом(n) {
  const сотня = n % 100;
  const десяток = n % 10;
  const слово = сотня >= 11 && сотня <= 14 ? "кадров"
    : десяток === 1 ? "кадр"
      : десяток >= 2 && десяток <= 4 ? "кадра" : "кадров";
  return n + " " + слово;
}

/* ── место в ленте ───────────────────────────────────────────────────────
 *
 * Разбор жалобы идёт часами, а лента длиной в семнадцать тысяч страниц. Любая
 * перезагрузка сбрасывала её в начало, и место человек искал заново. Поэтому
 * лента помнит, где её оставили: страницу, фильтры и кадр под глазами.
 *
 * Фильтры входят в место обязательно — страница 700 без них показывает совсем
 * другие кадры. */

/* На какой странице лежит кадр с таким номером в накопленной сетке. */
function страницаКадра(перваяСтраница, индекс, наСтранице) {
  const шаг = Number(наСтранице) || 60;
  return Number(перваяСтраница || 0) + Math.floor(Math.max(0, Number(индекс) || 0) / шаг);
}

function запомнитьМесто(src, место) {
  try { localStorage.setItem("tessera:spot:" + src, JSON.stringify(место)); }
  catch { /* приватный режим */ }
}

function вспомнитьМесто(src) {
  try {
    const сырое = localStorage.getItem("tessera:spot:" + src);
    const место = сырое ? JSON.parse(сырое) : null;
    return место && typeof место === "object" ? место : null;
  } catch {
    // Битую запись (правили руками, оборвалась запись) считаем отсутствием
    // места: лента откроется с начала, но откроется.
    return null;
  }
}

/* Кладёт запомненное в память блока и отдаёт кадр, к которому надо вернуться.
 *
 * Применяется ровно один раз — на пустой памяти, то есть сразу после
 * перезагрузки. Человек, который уже листает, сам выбрал, где ему быть;
 * возвращать его к прошлому месту значило бы отбирать управление. */
function применитьМесто(моё, место) {
  if (!место || моё.page !== undefined) return null;
  моё.page = Number(место.page) || 0;
  if (место.kind !== undefined) моё.kind = место.kind;
  if (место.fmt !== undefined) моё.fmt = место.fmt;
  if (место.adult !== undefined) моё.adult = место.adult;
  if (место.group !== undefined) моё.group = место.group;
  return место.id || "";
}

/* Адрес оригинала с учётом тумблера «дата съёмки».
 *
 * Дату в файл вписывает сервер, поэтому выбор человека едет параметром, а не
 * решается в панели. Тумблер включён — адрес не меняется вовсе: так у ссылки
 * остаётся тот же вид, что был до появления тумблера. */
function адресОригинала(url, сДатой) {
  return адрес(сДатой === false ? url + "&date=0" : url);
}

/* Адреса выбранных кадров в том порядке, в каком их отмечали.
 *
 * Выбор переживает смену фильтра и догрузку страниц, поэтому в наборе может
 * остаться кадр, которого в ленте уже нет: адреса у него взять неоткуда, и
 * такой пропускается молча. */
function адресаВыбранных(порядок, карта, сДатой) {
  return (порядок || []).map(ид => (карта || {})[ид]).filter(Boolean)
    .map(url => адресОригинала(url, сДатой));
}

/* Пачка оригиналов уходит по одному файлу, а не архивом.
 *
 * Архив пришлось бы распаковывать перед заливкой в галерею, а так файлы сразу
 * ложатся в папку загрузок готовыми. Промежуток между ссылками нужен браузеру:
 * без него часть загрузок он отбрасывает молча, а сервер получает десяток
 * выкачек из бакета разом.
 *
 * Разрешение на несколько файлов браузер спросит один раз за сеанс. */
async function скачатьПачкой(кнопка, моё) {
  const список = адресаВыбранных(моё.выбор, моё.адреса, моё.origDate);
  if (!список.length || кнопка.disabled) return;
  const надпись = кнопка.textContent;
  кнопка.disabled = true;
  for (let i = 0; i < список.length; i++) {
    кнопка.textContent = "качаю " + (i + 1) + " из " + список.length + "…";
    const ссылка = document.createElement("a");
    ссылка.href = список[i];
    ссылка.download = "";
    ссылка.rel = "noopener";
    document.body.appendChild(ссылка);
    ссылка.click();
    ссылка.remove();
    await new Promise(готово => setTimeout(готово, 800));
  }
  кнопка.disabled = false;
  кнопка.textContent = надпись;
  сказать("ушло " + кадровСловом(список.length));
}

/* Введённый номер страницы → номер, каким его знает сервер.
 *
 * Человек видит страницы с единицы, сервер считает с нуля. Пробелы внутри
 * числа свои: подпись рядом пишет «из 2 004», и это же значение копируют в
 * поле. Промах за край прижимается к краю — за последней страницей лежит
 * пустая лента, и она читается как «файлы кончились».
 *
 * Мусор не переводит никуда (null): случайное нажатие не должно уносить с той
 * страницы, которую человек разбирает. */
function номерСтраницы(ввод, всего) {
  const чистый = String(ввод == null ? "" : ввод).replace(/[\s ]/g, "");
  if (!/^-?\d+$/.test(чистый)) return null;
  const n = Number(чистый);
  const край = Math.max(1, Number(всего) || 1);
  return Math.min(край, Math.max(1, n)) - 1;
}

/* Адрес того же кадра, но крупного.
 *
 * В ленте кадр приходит с готовым `path` к плитке 512: так ядро отдаёт файл,
 * не поднимая процесс модуля на каждую картинку. Для просмотра во весь экран
 * этот путь надо снять — увидев его, ядро отдаёт ровно названный файл и
 * запрошенный размер уже не смотрит, поэтому на весь экран растягивалась
 * миниатюра. Без пути ядро спросит модуль, а тот назовёт кадр 1600 и при
 * промахе сделает его на месте. */
function крупныйКадр(url) {
  const [путь, запрос = ""] = url.split("?");
  const параметры = new URLSearchParams(запрос);
  параметры.delete("path");
  параметры.delete("type");
  параметры.set("w", "1600");
  return адрес(путь + "?" + параметры.toString());
}

function открытьКадр(items, i, сДатой) {
  const слой = document.createElement("div");
  слой.className = "light";
  const показать = n => {
    const это = (n + items.length) % items.length;
    const it = items[это];
    // Кнопку скачивания рисуем по адресу от модуля: панель не знает ни его
    // ключей, ни того, что у кадра вообще бывает исходник. Нет адреса — нет и
    // кнопки, и лайтбокс выглядит как раньше.
    // Ролик и голосовое открываются плеером браузера: жалоба на них — про
    // звук и движение, а по одному кадру её не разобрать. Ядро отдаёт файл
    // через ServeContent, тот понимает Range, поэтому работает и перемотка.
    // У ролика кадр уже есть — он стоит заставкой, пока едут первые секунды.
    слой.innerHTML = (
      it.video && it.play
        ? '<video src="' + адрес(it.play) + '" poster="' + адрес(it.url) +
          '" controls autoplay playsinline></video>'
        : it.audio && it.play
          ? '<div class="light-snd"><b>' + (it.caption || "Звук") + "</b>" +
            '<audio src="' + адрес(it.play) + '" controls autoplay></audio></div>'
          : '<img src="' + адрес(it.url) + '" alt="">') +
      '<div class="light-bar"><span class="lbl">' + меткаВозраста(it.age) +
      (it.caption || "") + " · " + (it.group || "") + "</span>" +
      (it.download
        ? '<a class="light-dl" href="' + адресОригинала(it.download, сДатой) +
          '" download>Скачать оригинал</a>'
        : "") +
      "</div>";
    слой.dataset.i = String(это);
    // Клик по слою закрывает кадр, а кнопка лежит внутри слоя: без этой
    // строки лайтбокс закрывался бы раньше, чем начнётся скачивание.
    const кнопка = слой.querySelector(".light-dl");
    if (кнопка) кнопка.addEventListener("click", e => e.stopPropagation());
    // Плеер — та же история: нажатие на «играть» или на полосу перемотки не
    // должно закрывать окно. Ролик и голосовое уходят из-под общего клика
    // целиком, вместе с подписью рядом.
    const плеер = слой.querySelector("video, .light-snd");
    if (плеер) плеер.addEventListener("click", e => e.stopPropagation());
    // Плитка уже лежит в кэше браузера и появляется сразу; крупный кадр
    // подменяет её, когда доедет. Сверяем номер: при быстром листании поздний
    // ответ не должен подменить кадр, который человек уже пролистнул. У
    // ролика и звука подменять нечего: там играет оригинал.
    const место = слой.querySelector("img");
    if (!место) return;
    const крупный = new Image();
    крупный.onload = () => {
      if (слой.dataset.i === String(это) && место.isConnected) место.src = крупный.src;
    };
    крупный.src = крупныйКадр(it.url);
  };
  показать(i);
  document.body.appendChild(слой);
  // Кадр вырастает из своей плитки, фон проявляется, полоса подписи выезжает снизу.
  anim(слой, FADE, { duration: 260 });
  const плитка = items[i] && document.querySelector('.shelf figure[data-id="' + CSS.escape(String(items[i].id)) + '"] .ph');
  const крупно = слой.querySelector("img, video, .light-snd");
  if (плитка && крупно) {
    const a = плитка.getBoundingClientRect(), b = крупно.getBoundingClientRect();
    if (b.width && b.height) anim(крупно, [{ transformOrigin: "0 0", opacity: .5, transform: "translate(" + (a.left - b.left) + "px," + (a.top - b.top) + "px) scale(" + (a.width / b.width) + "," + (a.height / b.height) + ")" },
      { transformOrigin: "0 0", opacity: 1, transform: "none" }], { duration: 480 });
  }
  anim(слой.querySelector(".light-bar"), [{ opacity: 0, transform: "translate(-50%,12px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 400, delay: 120 });

  const клавиша = e => {
    if (e.key === "Escape") закрыть();
    if (e.key === "ArrowRight") показать(Number(слой.dataset.i) + 1);
    if (e.key === "ArrowLeft") показать(Number(слой.dataset.i) - 1);
  };
  const закрыть = () => {
    removeEventListener("keydown", клавиша);
    const уход = anim(слой, [{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: "forwards" });
    (уход ? уход.finished : Promise.resolve()).then(() => слой.remove());
  };
  addEventListener("keydown", клавиша);
  слой.addEventListener("click", закрыть);
}

/* Чужой текст в разметке. Имена и почты люди пишут себе сами, а панель
   собирает строки конкатенацией — без этого имя вида `<img onerror=…>`
   выполнялось бы прямо в админке. */
function текстом(v) {
  return String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function пусто(host, текст) {
  host.innerHTML = '<p class="block-empty">' + текст + "</p>";
}

/* ── search: найти по запросу ─────────────────────────────────────────────
 *
 * Вторая заготовка, которая ходит на сервер сама: заранее собрать ответы на
 * все возможные запросы нельзя. Поле ввода, кнопка, таблица ответов. Пустой
 * запрос ничего не ищет — иначе первый же заход вываливал бы всю базу.
 *
 * Модуль получает запрос параметром `q` и отвечает теми же полями, что
 * обычная таблица: cols и rows. */
function блокSearch(host, d, блок) {
  const src = (блок && блок.src) || "";
  const моё = память(src);
  const было = моё.q || "";
  if (d === null && моё.ответ) d = моё.ответ;   // вернулись на вкладку — показываем найденное
  const подпись = (блок && блок.placeholder) || "id, имя или почта";

  const строка = '<form class="search-row" role="search">' +
    '<input type="search" name="q" value="' + было.replace(/"/g, "&quot;") +
      '" placeholder="' + подпись + '" aria-label="' + подпись + '" autocomplete="off">' +
    '<button class="ghost-btn" type="submit">Найти</button></form>';

  // Ответ бывает двух видов: одна таблица (cols/rows) или несколько разделов
  // (sections) — так один поиск отдаёт разом и людей, и их пары.
  const разделы = d && d.sections ? d.sections
    : (d && (d.rows || []).length ? [{ title: "", cols: d.cols, rows: d.rows }] : []);

  const таблица = р => {
    const шапка = (р.cols || []).map(c => "<th>" + текстом(c) + "</th>").join("");
    // Модуль вправе пометить колонку, чьё значение является фильтром для
    // соседнего блока: id пары в результатах поиска уводит ленту к её файлам.
    const переход = р.link || null;
    const тело = (р.rows || []).map(r =>
      "<tr>" + r.map((v, к) => {
        const текст = текстом(v === null || v === undefined ? "—" : v);
        if (!переход || к !== переход.col || !v) return "<td>" + текст + "</td>";
        return '<td><button class="cell-link" data-link-src="' + текстом(переход.src) +
          '" data-link-param="' + текстом(переход.param) +
          '" data-link-val="' + текстом(v) +
          '" title="' + текстом(переход.title || "Показать") + '">' + текст + "</button></td>";
      }).join("") + "</tr>"
    ).join("");
    return (р.title ? '<p class="lbl found-title">' + р.title + " · " +
              (р.rows || []).length + "</p>" : "") +
      '<div class="table-wrap"><table class="tbl"><thead><tr>' + шапка +
      "</tr></thead><tbody>" + тело + "</tbody></table></div>";
  };

  let ответ;
  if (!было) {
    ответ = '<p class="search-hint">Найденное встанет таблицей. Щелчок по выделенной ячейке откроет соседний блок на этом значении — так ленту сужают до файлов одной пары.</p>';
  } else if (!разделы.length) {
    ответ = '<p class="search-hint">По запросу «' + текстом(было) + '» ничего не нашлось.</p>';
  } else {
    ответ = разделы.map(таблица).join("") + '<div style="height:8px"></div>';
  }

  host.innerHTML = строка + ответ;
  if (было && разделы.length) host.querySelectorAll(".tbl tbody tr").forEach((tr, i) => anim(tr, RISE, { duration: 420, delay: Math.min(i * 30, 300) }));

  // Щелчок по помеченной ячейке уводит соседний блок к этому значению.
  host.querySelectorAll(".cell-link").forEach(b => b.addEventListener("click", () => {
    открытьВБлоке(b.dataset.linkSrc, { [b.dataset.linkParam]: b.dataset.linkVal, page: 0 });
  }));

  const форма = host.querySelector("form");
  форма.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = (форма.querySelector("input").value || "").trim();
    моё.q = q;
    моё.ответ = null;
    if (!q) return блокSearch(host, null, блок);
    const кнопка = форма.querySelector("button");
    if (кнопка) { кнопка.disabled = true; кнопка.textContent = "Ищу…"; }
    const ссылка = адрес("/api/query") + "?src=" + encodeURIComponent(src) +
      "&q=" + encodeURIComponent(q);
    try {
      моё.ответ = await взять(ссылка);
      блокSearch(host, моё.ответ, блок);
    } catch (err) {
      пусто(host, "поиск не ответил: " + err.message);
    }
  });
}

/* Кто какую заготовку рисует. Незнакомый тип — не повод падать: панель может
   быть старее модуля, который просит невиданный блок. */
const ЗАГОТОВКИ = {
  stat: блокStat, columns: блокColumns, raster: блокRaster, table: блокTable,
  list: блокList, funnel: блокFunnel, heat: блокHeat, note: блокNote, map: блокMap,
  shelf: блокShelf, search: блокSearch,
  periods: блокPeriods, waffle: блокWaffle, rows: блокRows, rate: блокRate,
};

/* шапка — правый угол заголовка карточки: туда заготовка кладёт переключатель
   или плашку. Живой блок перерисовывается заново, поэтому старое из угла
   снимается, кроме крестика правки раскладки. */
function нарисовать(host, тип, данные, блок, шапка) {
  // Заготовки, рисующие в svg, дописывают узлы к тому, что уже лежит внутри,
  // поэтому заглушку «загружаю» надо снять руками.
  host.innerHTML = "";
  if (шапка) шапка.querySelectorAll(":scope > :not(.block-x)").forEach(e => e.remove());
  const рисовать = ЗАГОТОВКИ[тип];
  if (!рисовать) return пусто(host, "панель не умеет блок «" + тип + "»: обновите её");
  try {
    рисовать(host, данные, блок, шапка);
  } catch (e) {
    пусто(host, "данные не разобрались: " + e.message);
  }
}
