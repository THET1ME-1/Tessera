/* Вкладки ядра: перенесены из принятого макета целиком — разметка, подписи,
   порядок блоков и все помощники. Отличие ровно одно: DATA приходит с сервера.
   Каркас (вкладки, тема, вход, адрес строки) живёт в panel.js, низкоуровневая
   отрисовка — в draw.js, заготовки для модулей — в blocks.js. */

/* Живые данные: /opt/app_stats/stats.db на проде Togetherly, снято 13.08.2026 22:45 */




/* ---------------- тултип ---------------- */


/* ---------------- рисование колонок ---------------- */


/*  items: [{key, parts:[{v,color,label}], tipTitle, tipLines, muted}]  */


/* ---------------- разметка ---------------- */
const panel = (cls, inner) => '<section class="panel ' + cls + '">' + inner + "</section>";
const head = (l, r = "") => '<div class="panel-head"><span class="lbl">' + l + "</span>" + (r ? '<span class="lbl">' + r + "</span>" : "") + "</div>";

function viewOverview() {
  const dd = DATA.days || [];
  const key = state.людиСчитаются ? "nw" : "events";
  const week = dd.slice(-7).reduce((s, d) => s + d[key], 0);
  const prevWeek = dd.slice(-14, -7).reduce((s, d) => s + d[key], 0);
  const growth = prevWeek ? (week - prevWeek) / prevWeek * 100 : 0;
  const android = DATA.platforms[0], ios = DATA.platforms[1];
  // Крупная цифра — сколько всего учёток в приложении, если оно само это
  // сказало (модуль объявляет `people_total`). Ядро своими силами столько не
  // знает: события живут две недели, и человек, не заходивший дольше, из
  // счёта выпадает — на Togetherly это 36 тысяч из 72. Пока такого числа нет,
  // показываем прежнее: уникальных за период.
  const учёток = DATA.totals.accounts;
  const heroV = state.людиСчитаются
    ? (учёток || DATA.totals.people)
    : DATA.totals.events;

  const html =
    '<div class="grid">' +

    panel("c8",
      head("Всего " + (state.людиСчитаются ? "людей" : "событий"), подписьПериода()) +
      '<div class="hero" style="margin-bottom:20px">' +
        '<div class="hero-val num">' + fmt(heroV) + "</div>" +
        '<div style="display:flex;flex-direction:column;gap:8px;padding-bottom:6px">' +
          '<span class="delta' + (growth < 0 ? " down" : "") + '">' + (growth >= 0 ? "↑ " : "↓ ") +
            Math.abs(growth).toFixed(0) + "% " + (state.людиСчитаются ? "новых" : "событий") + " к прошлой неделе</span>" +
          '<span class="hero-note">' + (state.людиСчитаются
            ? (учёток
                ? "Учёток в приложении. На графике — " + fmt(DATA.totals.people) +
                  " заходивших за период; хеш считает сервер, соли приложение не знает."
                : "Уникальные люди за 15 дней. Хеш считает сервер, соли приложение не знает.")
            : "События за 15 дней. Людей не считаем: в базе одни счётчики.") + "</span>" +
        "</div>" +
      "</div>" +
      '<div class="legend" style="margin-bottom:10px">' + (state.людиСчитаются
        ? '<span class="lg"><i style="background:var(--accent)"></i>Новые</span>' +
          '<span class="lg"><i style="background:var(--serie-2)"></i>Вернувшиеся</span>'
        : '<span class="lg"><i style="background:var(--serie-1)"></i>События за день</span>') +
        '<span class="lg" style="margin-left:auto">последний день неполный</span>' +
      "</div>" +
      '<div id="chart-days"></div>'
    ) +

    panel("c4",
      head("Сутки", "среднее за 14 дней") +
      '<div style="font-size:13px;color:var(--ink-2);margin-bottom:16px">Пик в ' +
        '<b style="font-weight:500">19:00</b>, провал в ' + '<b style="font-weight:500">02:00</b>. ' +
        'Разница ' + (Math.max(...DATA.hours.map(h => h.e)) / Math.min(...DATA.hours.map(h => h.e))).toFixed(1).replace(".", ",") + " раза.</div>" +
      '<div id="chart-hours"></div>' +
      '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">' +
        '<span class="lbl" style="display:block;margin-bottom:12px">Действия за период</span>' +
        DATA.actions.map(a => '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:7px 0;font-size:12.5px;border-bottom:1px solid var(--line)">' +
          nameCell(a.n, true) +
          '<span class="num">' + fmt(a.hits) + "</span></div>").join("") +
      "</div>"
    ) +

    '<div class="c12"><div class="tiles six">' +
      tile("События", fmt(DATA.totals.events), "за 15 дней, свой сервер", dd.map(d => d.events)) +
      tile(state.людиСчитаются ? "Люди" : "Люди", state.людиСчитаются ? fmt(DATA.totals.people) : "не считаются",
           state.людиСчитаются ? "уникальных за период" : "тумблер выключен",
           state.людиСчитаются ? dd.map(d => d.people) : null) +
      tile("Открытий экранов", fmt(DATA.screens.reduce((s, x) => s + x.hits, 0)), "25 экранов размечено",
           dd.filter(d => !d.partial).map(d => d.screens)) +
      tile("Android", pctS(android.u, android.u + ios.u, 0), "iOS " + pctS(ios.u, android.u + ios.u, 0), null) +
      modTile("Доход за месяц", money((DATA.income || {}).month), "модуль «Доход», четыре источника") +
      modTile("Файлов на модерации", fmt((DATA.moderation || {}).total), "модуль «Модерация», лента файлов") +
    "</div></div>" +

    panel("c7",
      head("Экраны", "внимание за 15 дней") +
      rasterRows(DATA.screens.slice(0, 7), 10, r => r.min / 60,
                 r => fmt(r.min / 60) + NBSP + "ч · " + fmt(r.hits) + " откр.") +
      '<p style="font-size:12px;color:var(--ink-3);margin:14px 0 0">Кусочек — десять часов внимания. ' +
      'Открытия рядом числом: у date_picker их больше всех, а времени меньше.</p>'
    ) +

    panel("c5",
      head("Версии", "люди за 30 дней") +
      versionsList(DATA.versions.slice(0, 6)) +
      '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">' +
        '<span class="lbl" style="display:block;margin-bottom:12px">Платформы</span>' +
        '<div style="display:flex;gap:2px;margin-bottom:12px">' +
          DATA.platforms.map((p, i) => '<div style="flex:' + p.u + ';height:32px;border-radius:var(--r);background:' +
            (i === 0 ? "var(--serie-1)" : "var(--serie-2)") + '"></div>').join("") + "</div>" +
        DATA.platforms.map((p, i) => '<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:4px 0">' +
          '<span class="lg"><i style="background:' + (i === 0 ? "var(--serie-1)" : "var(--serie-2)") + '"></i>' + p.p + "</span>" +
          '<span class="num">' + fmt(p.u) + " · " + pctS(p.u, android.u + ios.u, 0) + "</span></div>").join("") +
      "</div>"
    ) +

    "</div>";

  document.getElementById("view").innerHTML = html;

  const dcols = dd.map((d, i) => ({
    parts: state.людиСчитаются
      ? [{ v: d.nw, color: "var(--accent)" }, { v: d.ret, color: "var(--serie-2)", hatch: true }]
      : [{ v: d.events, color: "var(--serie-1)" }],
    muted: !!d.partial,
    tick: (i % 2 === 0 || i === dd.length - 1) ? shortDate(d.d) : "",
    tipTitle: shortDate(d.d) + (d.partial ? " · неполный день" : ""),
    tipLines: state.людиСчитаются
      ? [fmt(d.people) + " человек", fmt(d.nw) + " новых · " + fmt(d.ret) + " вернувшихся"]
      : [fmt(d.events) + " событий"]
  }));
  columns(document.getElementById("chart-days"), dcols, { h: 258 });

  columns(document.getElementById("chart-hours"), DATA.hours.map(h => ({
    parts: [{ v: h.e, color: h.h === 19 ? "var(--accent)" : "var(--serie-2)" }],
    tick: h.h % 6 === 0 ? String(h.h).padStart(2, "0") : "",
    tipTitle: String(h.h).padStart(2, "0") + ":00",
    tipLines: [fmt(h.e) + " событий", fmt(h.u) + " человек"]
  })), { h: 150 });

  document.querySelectorAll("[data-spark]").forEach(node => {
    spark(node, JSON.parse(node.getAttribute("data-spark")));
  });
}

function modTile(label, value, sub) {
  return '<div class="tile from-mod"><span class="lbl">' + label + "</span>" +
    '<span class="tile-v">' + value + "</span>" +
    '<span class="tile-sub">' + sub + "</span></div>";
}

function tile(label, value, sub, sparkData) {
  return '<div class="tile"><span class="lbl">' + label + "</span>" +
    '<span class="tile-v">' + value + "</span>" +
    '<span class="tile-sub">' + sub + "</span>" +
    (sparkData ? '<span data-spark="' + JSON.stringify(sparkData) + '"></span>' : "") + "</div>";
}

function screensTable(rows) {
  const max = Math.max(...rows.map(r => r.hits));
  return '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
    "<th>Экран</th><th class=\"barcell\">Доля от лидера</th><th class=\"r\">Открытий</th>" +
    (state.людиСчитаются ? '<th class="r">Людей·дней</th>' : "") +
    '<th class="r">В среднем</th></tr></thead><tbody>' +
    rows.map(r => "<tr>" +
      "<td>" + nameCell(r.n, true) + "</td>" +
      '<td class="barcell"><span class="rowbar"><span style="width:' + pct(r.hits, max).toFixed(1) + '%"></span></span></td>' +
      '<td class="r">' + fmt(r.hits) + "</td>" +
      (state.людиСчитаются ? '<td class="r">' + fmt(r.u) + "</td>" : "") +
      '<td class="r">' + r.sec.toFixed(0) + NBSP + "с</td>" +
    "</tr>").join("") + "</tbody></table></div>";
}

function versionsList(rows) {
  const total = DATA.versions.reduce((s, v) => s + v.u, 0);
  return '<div style="display:flex;flex-direction:column;gap:11px">' +
    rows.map(r => '<div>' +
      '<div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">' +
        '<span class="mono">' + r.v + "</span>" +
        '<span class="num" style="color:var(--ink-2)">' + fmt(r.u) + " · " + pctS(r.u, total, 0) + "</span>" +
      "</div>" +
      '<span class="rowbar"><span style="width:' + pct(r.u, total).toFixed(1) + '%"></span></span>' +
    "</div>").join("") + "</div>";
}



/* ---------------- словарь имён ----------------
   Ключ приходит из кода приложения, читать его человеку незачем. Панель держит
   рядом человеческое имя; в живой установке словарь лежит на сервере, поэтому
   переименование видно всем, кто открыл панель. */

/* подпись строки: имя сверху, ключ снизу; в режиме «ключи» остаётся только ключ */

/* правка на месте: подпись превращается в поле, Enter сохраняет, Esc отменяет */

/* ---------------- карта экранов: часто ли открывают против того, сколько сидят ---------------- */

/* ---------------- растровые строки: один кусочек равен фиксированной величине ---------------- */

const SCREEN_VIEWS = [["map", "Карта"], ["raster", "Растр"], ["table", "Таблица"]];
function screensBlock(s) {
  const view = state.screenView || "map";
  const seg = '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:16px">' +
    '<div class="seg" role="group" aria-label="Вид" style="width:max-content">' +
    SCREEN_VIEWS.map(([k, t]) => '<button data-screenview="' + k + '"' +
      (k === view ? ' aria-pressed="true"' : "") + ">" + t + "</button>").join("") + "</div>" +
    '<span class="lbl" style="margin-left:auto">имя правится кнопкой в строке</span></div>';

  if (view === "map")
    return seg + '<div class="map-wrap" id="screens-map"></div>' +
      '<div class="map-note"><span>вправо — чаще открывают</span><span>вверх — дольше сидят</span>' +
      "<span>сторона квадрата — часы внимания</span></div>" +
      '<p style="font-size:12.5px;color:var(--ink-2);margin:14px 0 0;max-width:76ch">«' +
      nameOf("date_picker") + '» открывают чаще всех, а держит он семнадцать секунд: это перевалочный ' +
      'экран, и мерить его успех открытиями бессмысленно. Внимание собирают «' + nameOf("memory_lane") +
      '» и «' + nameOf("draw") + '» — на них уходит 640 и 374 часа против 99 у лидера по открытиям.</p>';

  if (view === "raster")
    return seg + rasterRows(s, 10, r => r.min / 60, r => fmt(r.min / 60) + NBSP + "ч") +
      '<p style="font-size:12.5px;color:var(--ink-3);margin:16px 0 0">Один кусочек — десять часов ' +
      'человеческого внимания. Ряд читается счётом, а не сравнением длин на глаз.</p>';

  const maxMin = Math.max(...s.map(x => x.min));
  return seg + '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
    "<th>Экран</th><th class=\"barcell\">Суммарное время</th>" +
    '<th class="r">Открытий</th>' + (state.людиСчитаются ? '<th class="r">Людей·дней</th>' : "") +
    '<th class="r">Среднее</th><th class="r">Часов всего</th></tr></thead><tbody>' +
    s.map(r => "<tr>" +
      "<td>" + nameCell(r.n, true) + "</td>" +
      '<td class="barcell"><span class="rowbar"><span style="width:' + pct(r.min, maxMin).toFixed(1) + '%"></span></span></td>' +
      '<td class="r">' + fmt(r.hits) + "</td>" +
      (state.людиСчитаются ? '<td class="r">' + fmt(r.u) + "</td>" : "") +
      '<td class="r">' + r.sec.toFixed(0) + NBSP + "с</td>" +
      '<td class="r">' + fmt(r.min / 60) + "</td>" +
    "</tr>").join("") + "</tbody></table></div>";
}

function wireScreenViews(rows) {
  document.querySelectorAll("[data-screenview]").forEach(b =>
    b.addEventListener("click", () => { state.screenView = b.dataset.screenview; render(); }));

  const host = document.getElementById("screens-map");
  if (host) screensMap(host, rows);
}

/* ---------------- вкладка «Экраны» ---------------- */
function viewScreens() {
  const s = DATA.screens, maxMin = Math.max(...s.map(x => x.min));
  document.getElementById("view").innerHTML = '<div class="grid">' +
    panel("c12",
      head("Все размеченные экраны", "15 дней") + screensBlock(s)
    ) +
    panel("c6",
      head("Действия", "своя разметка в коде") +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Событие</th><th class="r">Раз</th>' +
      (state.людиСчитаются ? '<th class="r">Людей·дней</th>' : "") + "</tr></thead><tbody>" +
      DATA.actions.map(a => "<tr><td>" + nameCell(a.n, true) + '</td><td class="r">' + fmt(a.hits) + "</td>" +
        (state.людиСчитаются ? '<td class="r">' + fmt(a.u) + "</td>" : "") + "</tr>").join("") +
      "</tbody></table></div>" +
      '<p style="font-size:12px;color:var(--ink-3);margin:14px 0 0">«Импульс «скучаю»» растёт быстрее остальных ' +
      'на два порядка: кнопка отправляет событие на каждое нажатие, а не на подтверждённую отправку. ' +
      'Это видно и есть что чинить.</p>' +
      '<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--line)">' +
        '<span class="lbl" style="display:block;margin-bottom:10px">Как имя попадает в панель</span>' +
        '<p style="font-size:12.5px;color:var(--ink-2);margin:0 0 12px;line-height:1.55">Ключ приходит из кода ' +
        'и человеку ни о чём не говорит. Имя можно задать двумя путями: кнопкой в строке (словарь ложится на ' +
        'сервер, и его видят все, кто открыл панель) или прямо в вызове SDK, если удобнее держать подпись рядом ' +
        'с кодом.</p>' +
        '<pre class="mono" style="margin:0;font-size:11.5px;line-height:1.7;color:var(--ink-2);overflow-x:auto">' +
        "Tessera.action(&#39;memory_added&#39;, title: &#39;Воспоминание добавлено&#39;);" +
        "</pre></div>"
    ) +
    panel("c6",
      head("Реклама", "показы блока " + nameOf(DATA.ads.n)) +
      '<div class="hero" style="margin-bottom:18px"><div class="hero-val num" style="font-size:42px">' + fmt(DATA.ads.hits) + "</div>" +
      '<span class="hero-note">показов за 15 дней' +
      (state.людиСчитаются ? ", их видели " + fmt(DATA.ads.u) + " человек" : "") + "</span></div>" +
      '<div id="chart-ads"></div>' +
      '<p style="font-size:12px;color:var(--ink-3);margin:12px 0 0">Сводка за 14 августа ещё считается, поэтому день короткий.</p>'
    ) +
  "</div>";

  wireScreenViews(s);

  columns(document.getElementById("chart-ads"), (DATA.days || []).map((d, i) => ({
    parts: [{ v: d.ads, color: "var(--serie-2)" }],
    muted: !!d.partial,
    tick: i % 3 === 0 ? shortDate(d.d) : "",
    tipTitle: shortDate(d.d),
    tipLines: [fmt(d.ads) + " показов", fmt(d.pairs) + " пар создано"]
  })), { h: 120 });
}

/* ---------------- вкладка «Люди» ---------------- */
function viewPeople() {
  if (!state.людиСчитаются) return lockedView("Удержание считается по людям",
    "Пока тумблер выключен, сервер хранит только счётчики событий: восстановить когорты задним числом не из чего. " +
    "Включите «Считать людей» — SDK начнёт слать хеш устройства, и матрица наполнится со следующего дня.");

  const c = DATA.cohorts;
  /* порог, за которым текст в ячейке переворачивается, зависит от темы */
  const flip = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell-flip")) || 57;
  const cells = (r, k, base) => {
    if (r[k] === null) return '<td><span style="color:var(--line-2)">·</span></td>';
    const p = pct(r[k], base), mix = Math.min(90, p * 2.2);
    return '<td><span class="cell" style="background:color-mix(in oklab, var(--accent) ' + mix.toFixed(0) +
      '%, var(--panel-2))' + (mix > flip ? ";color:var(--cell-ink)" : "") + '">' + p.toFixed(0) + "%</span></td>";
  };

  document.getElementById("view").innerHTML = '<div class="grid">' +
    panel("c7",
      head("Удержание по дням прихода", "доля вернувшихся") +
      '<div style="overflow-x:auto"><table class="mx"><thead><tr><th style="text-align:left">Когорта</th>' +
      '<th>Размер</th><th>День 1</th><th>День 3</th><th>День 7</th></tr></thead><tbody>' +
      c.map(r => '<tr><td class="k">' + shortDate(r.c) + "</td>" +
        '<td class="num" style="color:var(--ink-2)">' + fmt(r.size) + "</td>" +
        cells(r, "d1", r.size) + cells(r, "d3", r.size) + cells(r, "d7", r.size) + "</tr>").join("") +
      "</tbody></table></div>" +
      '<p style="font-size:12px;color:var(--ink-3);margin:14px 0 0">Точка вместо числа — когорта ещё не дожила до этого дня.</p>'
    ) +
    panel("c5",
      head("Новые и вернувшиеся", "люди в день") +
      '<div class="legend" style="margin-bottom:12px">' +
        '<span class="lg"><i style="background:var(--accent)"></i>Новые</span>' +
        '<span class="lg"><i style="background:var(--serie-2)"></i>Вернувшиеся</span></div>' +
      '<div id="chart-nr"></div>' +
      '<p style="font-size:12.5px;color:var(--ink-2);margin:16px 0 0">Ядро держится ровно: с 3 по 12 августа ' +
      'вернувшихся от 1150 до 1461 в день, притом что новых стало втрое меньше.</p>'
    ) +
    panel("c12",
      head("Что даёт счёт людей", "разница режимов") +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:0;border-top:1px solid var(--line)">' +
      [["Удержание", "есть", "нет"], ["Когорты", "есть", "нет"], ["Воронки по людям", "есть", "только счётчики"],
       ["DAU и MAU", "есть", "нет"], ["Что уезжает на сервер", "хеш устройства с серверной солью", "только счётчики"]]
        .map(([k, on, off], i, arr) => '<div style="padding:14px 16px 14px 0' +
          (i === arr.length - 1 ? "" : ";border-right:1px solid var(--line)") + '">' +
          '<div class="lbl" style="margin-bottom:8px">' + k + "</div>" +
          '<div style="font-size:13px">Включено: <b style="font-weight:500">' + on + "</b></div>" +
          '<div style="font-size:13px;color:var(--ink-3)">Выключено: ' + off + "</div></div>").join("") +
      "</div>"
    ) +
  "</div>";

  columns(document.getElementById("chart-nr"), (DATA.days || []).map((d, i) => ({
    parts: [{ v: d.nw, color: "var(--accent)" }, { v: d.ret, color: "var(--serie-2)", hatch: true }],
    muted: !!d.partial,
    tick: i % 3 === 0 ? shortDate(d.d) : "",
    tipTitle: shortDate(d.d),
    tipLines: [fmt(d.nw) + " новых", fmt(d.ret) + " вернувшихся"]
  })), { h: 190 });
}

function lockedView(title, text) {
  document.getElementById("view").innerHTML =
    '<div class="locked"><div style="flex:1"><h3>' + title + "</h3><p>" + text + "</p>" +
    '<div style="display:flex;gap:10px;margin-top:16px"><button class="btn" id="unlock">Включить счёт людей</button>' +
    '<button class="btn ghost">Как это работает</button></div></div></div>';
  const b = document.getElementById("unlock");
  if (b) b.addEventListener("click", () => { state.людиСчитаются = true; syncSwitch(); render(); });
}

/* ---------------- вкладка «Воронки» ---------------- */
function viewFunnels() {
  if (!state.людиСчитаются) return lockedView("Воронка складывается из людей",
    "Без счёта людей сервер знает, сколько раз показали экран, но не знает, один это человек прошёл три шага или трое по одному. " +
    "Включите тумблер, и шаги свяжутся в цепочку.");

  document.getElementById("view").innerHTML = '<div class="grid">' +
    DATA.funnels.map(f => panel("c6",
      head(f.title, "люди, 15 дней") +
      '<div class="funnel">' + f.steps.map((s, i) => {
        const base = f.steps[0].v, conv = s.v === null ? null : pct(s.v, base);
        const prev = i > 0 ? f.steps[i - 1].v : null;
        return (i > 0 ? '<div class="fdrop">' + (s.v === null ? "нет данных" :
                 "↓ " + pctS(s.v, prev, 0) + " от прошлого шага") + "</div>" : "") +
          '<div class="fstep">' + (conv !== null ? '<span class="fill" style="width:' + conv.toFixed(1) + '%"></span>' : "") +
          '<span class="ftxt">' + s.n +
            (s.note ? '<br><span style="font-size:11.5px;color:var(--ink-3)">' + s.note + "</span>" : "") + "</span>" +
          '<span class="fval">' + (s.v === null ? "—" : fmt(s.v)) + "</span></div>";
      }).join("") + "</div>"
    )).join("") +
    panel("c12",
      head("Пары по дням", "последний шаг воронки") +
      '<div id="chart-pairs"></div>' +
      '<p style="font-size:12.5px;color:var(--ink-2);margin:14px 0 0">Два всплеска, 2 и 12 августа, совпадают с выкатом ' +
      'сборок 1.24 и 1.26: обе поднимали экран приглашения выше в интерфейсе.</p>'
    ) +
    panel("c12",
      head("Как размечено", "SDK") +
      '<pre class="mono" style="margin:0;font-size:12px;line-height:1.7;color:var(--ink-2);overflow-x:auto">' +
      "Tessera.screen('invite_partner');\n" +
      "Tessera.funnel('pair_created');            // шаг воронки\n" +
      "Tessera.action('memory_added', {kind: 'photo'});\n" +
      "Tessera.people(true);                      // тумблер из кода, не из панели" +
      "</pre>"
    ) +
  "</div>";

  columns(document.getElementById("chart-pairs"), (DATA.days || []).map((d, i) => ({
    parts: [{ v: d.pairs, color: d.pairs > 900 ? "var(--accent)" : "var(--serie-2)" }],
    muted: !!d.partial,
    tick: shortDate(d.d),
    tipTitle: shortDate(d.d) + (d.partial ? " · сводка ещё считается" : ""),
    tipLines: [fmt(d.pairs) + " пар создано"]
  })), { h: 150 });
}

/* ---------------- вкладка «Версии» ---------------- */
function viewVersions() {
  const total = DATA.versions.reduce((s, v) => s + v.u, 0);
  const pTotal = DATA.platforms.reduce((s, p) => s + p.u, 0);
  document.getElementById("view").innerHTML = '<div class="grid">' +
    panel("c7",
      head("Версии в бою", "люди за 30 дней") +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Сборка</th><th class="barcell">Доля</th>' +
      '<th class="r">Людей</th><th class="r">Событий</th><th class="r">Доля</th></tr></thead><tbody>' +
      DATA.versions.map(v => '<tr><td class="name">' + v.v + "</td>" +
        '<td class="barcell"><span class="rowbar"><span style="width:' + pct(v.u, total).toFixed(1) + '%"></span></span></td>' +
        '<td class="r">' + fmt(v.u) + '</td><td class="r">' + fmt(v.e) + '</td>' +
        '<td class="r">' + pctS(v.u, total) + "</td></tr>").join("") +
      "</tbody></table></div>" +
      '<p style="font-size:12px;color:var(--ink-3);margin:14px 0 0">На свежую 1.26.0 перешли ' +
      pctS(DATA.versions.filter(v => v.v.startsWith("1.26")).reduce((s, v) => s + v.u, 0), total, 0) +
      ' людей. Сборки с номером за 2000 — внутренние прогоны CI.</p>'
    ) +
    panel("c5",
      head("Платформы", "люди за 30 дней") +
      '<div style="display:flex;gap:2px;margin-bottom:14px">' +
        DATA.platforms.map((p, i) => '<div style="flex:' + p.u + ';height:44px;border-radius:var(--r);background:' +
          (i === 0 ? "var(--serie-1)" : "var(--serie-2)") + '"></div>').join("") +
      "</div>" +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      DATA.platforms.map((p, i) => '<div style="display:flex;justify-content:space-between;font-size:13px">' +
        '<span class="lg"><i style="background:' + (i === 0 ? "var(--serie-1)" : "var(--serie-2)") + '"></i>' + p.p + "</span>" +
        '<span class="num">' + fmt(p.u) + " · " + pctS(p.u, pTotal, 1) + "</span></div>").join("") + "</div>" +
      '<p style="font-size:12.5px;color:var(--ink-2);margin:18px 0 0">На iOS приходится ' +
      pctS(DATA.platforms[1].e, DATA.platforms.reduce((s, p) => s + p.e, 0), 1) +
      ' событий при ' + pctS(DATA.platforms[1].u, pTotal, 1) + ' людей: сессии там короче.</p>'
    ) +
  "</div>";
}

/* ---------------- вкладка «Все приложения» ---------------- */
function viewApps() {
  document.getElementById("view").innerHTML = '<div class="grid">' +
    panel("c12",
      head("Приложения в этой установке", "один сервер, один пароль") +
      '<div style="overflow-x:auto"><table class="tbl"><thead><tr><th>Приложение</th><th>Платформы</th>' +
      '<th>SDK</th><th class="r">События</th>' + (state.людиСчитаются ? '<th class="r">Люди</th><th class="r">DAU</th>' : "") +
      "</tr></thead><tbody>" +
      DATA.apps.map(a => '<tr><td style="font-weight:500">' + a.name + "</td>" +
        '<td style="color:var(--ink-2)">' + a.plat + "</td>" +
        '<td class="mono" style="font-size:11.5px;color:' + (a.live ? "var(--ink-2)" : "var(--ink-3)") + '">' +
          (a.live ? a.sdk : "не подключён") + "</td>" +
        '<td class="r">' + (a.live ? fmt(a.events) : "—") + "</td>" +
        (state.людиСчитаются ? '<td class="r">' + (a.live ? fmt(a.people) : "—") + "</td>" +
                        '<td class="r">' + (a.live ? fmt(a.dau) : "—") + "</td>" : "") +
      "</tr>").join("") + "</tbody></table></div>"
    ) +
    panel("c6",
      head("Подключить приложение", "две строки") +
      '<pre class="mono" style="margin:0;font-size:12px;line-height:1.8;color:var(--ink-2);overflow-x:auto">' +
      "flutter pub add tessera\n\n" +
      "await Tessera.start(\n" +
      "  url: 'https://tessera.мойсервер',\n" +
      "  app: 'kadr',\n" +
      "  people: true,\n" +
      ");" +
      "</pre>"
    ) +
    panel("c6",
      head("Сервер", "одна команда") +
      '<pre class="mono" style="margin:0;font-size:12px;line-height:1.8;color:var(--ink-2);overflow-x:auto">' +
      "curl -sL tessera.sh | sh\n\n" +
      "# один бинарник, SQLite рядом,\n" +
      "# пароль спросит при первом запуске" +
      "</pre>" +
      '<p style="font-size:12.5px;color:var(--ink-2);margin:16px 0 0">У Aptabase на этом месте три контейнера: ' +
      'их сервис, Postgres и ClickHouse.</p>'
    ) +
    panel("c12",
      head("Сравнение приложений", "нужно хотя бы два") +
      '<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;padding:8px 0">' +
        '<div style="display:flex;gap:6px">' +
          DATA.apps.map(a => '<span style="width:34px;height:34px;border-radius:var(--r);background:' +
            (a.live ? "var(--ink)" : "var(--panel-2)") + ';border:1px solid ' +
            (a.live ? "var(--ink)" : "var(--line-2)") + '"></span>').join("") + "</div>" +
        '<p style="margin:0;font-size:13px;color:var(--ink-2);max-width:60ch">Подключено одно приложение из пяти. ' +
        'Когда появится второе, здесь встанут парные графики: люди, удержание и версии рядом, на одной шкале.</p>' +
        '<button class="btn" style="margin-left:auto">Добавить приложение</button>' +
      "</div>"
    ) +
  "</div>";
}


/* ---------------- деньги ---------------- */
function money(v, cents) {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  const s = (cents || abs < 100) ? abs.toFixed(2).replace(".", ",") : fmt(abs);
  return (v < 0 ? "−" : "") + s + NBSP + "$";
}



/* ---------------- вкладка «Модули» ---------------- */
const MODULES_ON = [
  { n: "Модерация", by: "свой", v: "1.2.0",
    p: "Лента чужих файлов с фильтрами по виду и формату, лайтбокс, удаление. Ходит в хранилище приложения, ядру о нём знать нечего.",
    gives: "вкладка · плитка на обзор · 3 роута" },
  { n: "Доход", by: "свой", v: "1.4.1",
    p: "Реклама, подписки и продажи в одной таблице. Четыре чужих API опрашивает по расписанию и кладёт сводку файлом.",
    gives: "вкладка · плитка на обзор · крон" }
];
const MODULES_OFF = [
  { n: "Крэши", p: "Падения рядом с событиями: видно, на каком экране человек был перед обрывом. Тянет их из Bugsink или Sentry." },
  { n: "Сервер", p: "Нагрузка, диск и медленные запросы того же сервера, где стоит панель. Полезно, когда приложение тормозит, а события целы." },
  { n: "Обращения", p: "Жалобы из бота или почты одним списком, с версией сборки и последним экраном человека." }
];
