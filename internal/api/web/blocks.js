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
function блокStat(host, d) {
  const части = (d.parts || []).map(p =>
    '<span class="stat-part"><i></i>' + p.name + " " + число(p.value, d.format) + "</span>").join("");
  const дельта = d.delta === undefined || d.delta === null ? "" :
    '<span class="delta' + (d.delta < 0 ? " down" : "") + '">' +
    (d.delta >= 0 ? "↑ " : "↓ ") + Math.abs(d.delta).toFixed(0) + "%</span>";
  host.innerHTML =
    '<div class="stat-val num">' + число(d.value, d.format) + "</div>" +
    (дельта ? '<div style="margin:8px 0 0">' + дельта + "</div>" : "") +
    (d.sub ? '<div class="stat-sub">' + d.sub + "</div>" : "") +
    (части ? '<div class="stat-parts">' + части + "</div>" : "");
  if (d.spark && d.spark.length) {
    const s = document.createElement("span");
    host.appendChild(s);
    spark(s, d.spark);
  }
}

/* ── columns: столбики по дням ──────────────────────────────────────────── */
function блокColumns(host, d) {
  const items = (d.items || []).map((it, i) => ({
    parts: (it.parts || []).map(p => ({
      v: p.v,
      color: p.style === "hatch" ? "var(--serie-2)" : "var(--serie-1)",
      hatch: p.style === "hatch",
    })),
    tick: (i % 2 === 0 || i === d.items.length - 1) ? подписьДня(it.label) : "",
    tipTitle: подписьДня(it.label),
    tipLines: [(it.parts || []).reduce((s, p) => s + p.v, 0).toLocaleString("ru") +
               " " + (d.unit || "")],
  }));
  if (!items.length) return пусто(host, "за этот период ничего не пришло");

  // Один день-всплеск делает остальные пятнадцать неразличимыми, поэтому
  // шкала режется по медиане, а срезанные столбики помечаются.
  const суммы = items.map(i => i.parts.reduce((s, p) => s + p.v, 0)).sort((a, b) => a - b);
  const медиана = суммы[Math.floor(суммы.length / 2)] || 0;
  const максимум = суммы[суммы.length - 1] || 0;
  const порог = медиана * 5;
  // Обрезаем, только когда точек много и всплеск одиночный. Пять месяцев,
  // где каждый следующий больше предыдущего, — это рост, а не выброс.
  const последнийСамый = items.length &&
    items[items.length - 1].parts.reduce((s, p) => s + p.v, 0) === максимум;
  const режем = медиана > 0 && максимум > порог && items.length >= 10 && !последнийСамый;

  columns(host, items, { h: 240, max: режем ? порог : undefined });
  if (режем) {
    host.insertAdjacentHTML("beforeend",
      '<p class="block-note">Шкала обрезана по медиане: иначе всплеск в ' +
      fmt(максимум) + " кладёт остальные дни в плинтус.</p>");
  }
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l)) return l;
  const [, m, d] = l.split("-");
  return Number(d) + NBSP + MONTHS[Number(m) - 1];
}

/* ── raster: ряды кусочков ──────────────────────────────────────────────── */
function блокRaster(host, d) {
  const rows = (d.rows || []).slice().sort((a, b) => b.value - a.value);
  if (!rows.length) return пусто(host, "нечего показывать");
  const наибольшее = Math.max(...rows.map(r => r.value));
  // Шаг, присланный модулем, может не подойти данным: тысяча файлов на
  // кусочек при значениях в десятки даёт один кусочек, растянутый во всю
  // ширину. В таком случае шаг подбирается сам — по 1, 2 или 5 на порядок.
  let unit = d.unit || 1;
  if (наибольшее / unit < 5 || наибольшее / unit > 400) unit = подобратьШаг(наибольшее);
  const maxN = Math.max(1, Math.ceil(наибольшее / unit));
  host.innerHTML = rows.map(r => {
    const n = Math.max(1, Math.round(r.value / unit));
    const cells = Array.from({ length: n }, (_, i) =>
      '<rect x="' + (i * 8) + '" y="0" width="6" height="6" rx="1.6" fill="' +
      (i < n - 1 || n === 1 ? "var(--serie-1)" : "var(--serie-2)") + '"/>').join("");
    return '<div class="rrow">' + nameCell(r.name, true) +
      '<svg viewBox="0 0 ' + (maxN * 8) + ' 6" preserveAspectRatio="xMinYMid meet">' + cells + "</svg>" +
      '<span class="rv">' + число(r.value, d.format) + "</span></div>";
  }).join("") +
    '<p class="block-note">Один кусочек — ' + fmt(unit) + " " +
      (d.unitLabel || "единиц").replace(/ на кусочек$/, "") + "</p>";
}

/* ── table: таблица с полосой ───────────────────────────────────────────── */
function блокTable(host, d) {
  const rows = d.rows || [];
  if (!rows.length) return пусто(host, "строк нет");
  const bar = d.barCol === undefined ? 1 : d.barCol;
  const max = Math.max(...rows.map(r => Number(r[bar]) || 0)) || 1;
  host.innerHTML = '<div style="overflow-x:auto"><table class="tbl"><thead><tr>' +
    (d.cols || []).map((c, i) => '<th' + (i ? ' class="r"' : "") + ">" + c + "</th>").join("") +
    '<th class="barcell">Доля</th></tr></thead><tbody>' +
    rows.map(r => "<tr>" +
      r.map((v, i) => i === 0 ? "<td>" + nameCell(String(v), true) + "</td>"
                              : '<td class="r">' + число(v, d.format) + "</td>").join("") +
      '<td class="barcell"><span class="rowbar"><span style="width:' +
        ((Number(r[bar]) || 0) / max * 100).toFixed(1) + '%"></span></span></td>' +
    "</tr>").join("") + "</tbody></table></div>";
}

/* ── list: строки «имя — число» ─────────────────────────────────────────── */
function блокList(host, d) {
  const items = d.items || [];
  if (!items.length) return пусто(host, "пусто");
  host.innerHTML = items.map(i =>
    '<div class="lrow"><span>' + i.name + '</span><span class="num">' +
    число(i.value, d.format) + "</span></div>"
  ).join("");
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
  host.innerHTML = '<div style="overflow-x:auto"><table class="mx"><thead><tr><th></th>' +
    (d.colLabels || []).map(c => "<th>" + c + "</th>").join("") + "</tr></thead><tbody>" +
    rows.map((r, i) => '<tr><td class="k">' + (d.rowLabels[i] || "") + "</td>" +
      r.map((v, j) => {
        if (v === null || v === undefined) return '<td><span class="cell">—</span></td>';
        // Первая колонка — размер когорты, остальные красятся долей от неё.
        const база = r[0] || 1;
        const доля = j === 0 ? 100 : v / база * 100;
        const тон = Math.min(90, доля * 1.6);
        const текст = тон > flip ? "var(--cell-ink)" : "var(--ink)";
        return '<td><span class="cell" style="background:color-mix(in oklab, var(--accent) ' +
          тон.toFixed(0) + '%, var(--panel-2));color:' + текст + '">' + fmt(v) + "</span></td>";
      }).join("") + "</tr>").join("") + "</tbody></table></div>";
}

/* ── note: пояснение текстом ────────────────────────────────────────────── */
function блокNote(host, d) {
  host.innerHTML = '<p class="block-note" style="font-size:13px;color:var(--ink-2)">' +
    (d.text || "") + "</p>";
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

/* ── shelf: лента чужих кадров ───────────────────────────────────────────
 *
 * Единственная заготовка, которая ходит на сервер сама: собрать двести тысяч
 * файлов заранее нельзя, страницы приходят по требованию. Источник блока
 * подставляется в /api/query, оттуда же берутся фильтры и число страниц. */

/* Что из памяти блока уходит на сервер. Плотность сетки сюда не входит: она
   меняет размер кадров в браузере, а не набор файлов. */
const ФИЛЬТРЫ_ЛЕНТЫ = ["kind", "adult", "group"];

function ссылкаЛенты(src, страница) {
  const моё = память(src);
  let ссылка = адрес("/api/query") + "?src=" + encodeURIComponent(src) +
    "&page=" + (страница === undefined ? (моё.page || 0) : страница);
  for (const имя of ФИЛЬТРЫ_ЛЕНТЫ) {
    if (моё[имя]) ссылка += "&" + имя + "=" + encodeURIComponent(моё[имя]);
  }
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

/* Разметка одного кадра ленты. Отдельной функцией, потому что её зовёт и
   первая отрисовка, и догрузка следующей страницы. */
function разметкаКадра(it, i, выбран) {
  return '<figure data-i="' + i + '" data-id="' + текстом(it.id) + '"' +
      (выбран ? ' class="выбран"' : "") + '><div class="ph' + (it.video ? " vid" : "") +
      (it.adult ? " adult" : "") + '">' +
    // Адрес обязательно через адрес(): модуль отдаёт путь от корня панели,
    // а панель живёт в подпапке (/tessera/). Без этого браузер уходил на
    // корень домена и получал пустоту — лента стояла без единого кадра.
    '<img loading="lazy" src="' + адрес(it.url) + '" alt="' + (it.caption || "кадр") + '"' +
    ' onerror="this.closest(&quot;.ph&quot;).classList.add(&quot;нет&quot;)">' +
    // Галочка стоит только там, где есть что скачивать: у кадра без исходника
    // выбор ничего не даст. Отдельной кнопкой, а не щелчком по плитке, —
    // щелчок открывает кадр, и совмещать эти два действия нельзя.
    (it.download ? '<button class="pick" data-pick aria-pressed="' +
      (выбран ? "true" : "false") + '" title="Выбрать кадр" aria-label="Выбрать кадр"></button>' : "") +
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
  const вид = моё.kind || "";
  const стр = Number(моё.page || 0);

  const items = d.items || [];
  const виды = d.kinds || [];

  const замок = моё.adult || "";
  // Пару берём из ответа: фильтр мог поставить не этот блок, а поиск рядом.
  const пара = d.group || моё.group || "";
  моё.group = пара;

  const фильтры = '<div class="seg shelf-filter" role="group" aria-label="Вид файла">' +
    '<button data-kind=""' + (вид ? "" : ' aria-pressed="true"') + ">Все</button>" +
    виды.map(k => '<button data-kind="' + k + '"' +
      (k === вид ? ' aria-pressed="true"' : "") + ">" + k + "</button>").join("") + "</div>" +
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

  host.innerHTML = фильтры +
    (items.length ? '<div class="shelf">' + кадры + "</div>" : '<p class="block-empty">пусто</p>') +
    маячок + листалка + полоса +
    '<p class="block-note">Порядок — по загрузке в хранилище, а не по дате внутри записи: ' +
    "дату загрузивший может подвинуть. Кадры чужие, поэтому наружу они не уходят.</p>";

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
    if (!полосаВыбора) return;
    полосаВыбора.hidden = моё.выбор.length === 0;
    полосаВыбора.querySelector("b").textContent = кадровСловом(моё.выбор.length);
  };

  const отметить = (ид, узел) => {
    const место = моё.выбор.indexOf(ид);
    const стал = место < 0;
    if (стал) моё.выбор.push(ид); else моё.выбор.splice(место, 1);
    узел.classList.toggle("выбран", стал);
    const кнопка = узел.querySelector("[data-pick]");
    if (кнопка) кнопка.setAttribute("aria-pressed", стал ? "true" : "false");
    обновитьПолосу();
  };

  // Кадры оживают и при первой отрисовке, и после догрузки следующей
  // страницы, поэтому обработчики висят одной функцией, а не разбросаны по
  // блоку.
  const оживитьКадры = узлы => узлы.forEach(f => {
    f.addEventListener("click", e => {
      // Галочка и id пары — свои действия, кадр от них не открывается.
      if (e.target.closest("[data-pick]")) {
        отметить(f.dataset.id, f);
        return;
      }
      if (e.target.closest(".pair-id")) return;
      открытьКадр(показанные, Number(f.dataset.i));
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
    const догрузить = async () => {
      const следом = следующаяСтраница(последняя, d.pages);
      if (грузим || следом === null) return;
      грузим = true;
      маячокУзел.textContent = "догружаю…";
      try {
        const ещё = await взять(ссылкаЛенты(src, следом));
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
      } catch (e) {
        // Страница не пришла — говорим об этом прямо в ленте. Молчаливый
        // маячок читается как «файлы кончились», а это не так.
        маячокУзел.textContent = "не догрузилось: " + e.message;
      }
      грузим = false;
    };
    if (моё._смотрит) моё._смотрит.disconnect();
    if (typeof IntersectionObserver === "function") {
      // Запас в шестьсот пикселей: страница успевает приехать до того, как
      // человек доскроллит до пустоты.
      моё._смотрит = new IntersectionObserver(
        записи => { if (записи.some(з => з.isIntersecting)) догрузить(); },
        { rootMargin: "600px" });
      моё._смотрит.observe(маячокУзел);
    }
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

/* Адреса выбранных кадров в том порядке, в каком их отмечали.
 *
 * Выбор переживает смену фильтра и догрузку страниц, поэтому в наборе может
 * остаться кадр, которого в ленте уже нет: адреса у него взять неоткуда, и
 * такой пропускается молча. */
function адресаВыбранных(порядок, карта) {
  return (порядок || []).map(ид => (карта || {})[ид]).filter(Boolean).map(адрес);
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
  const список = адресаВыбранных(моё.выбор, моё.адреса);
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

function открытьКадр(items, i) {
  const слой = document.createElement("div");
  слой.className = "light";
  const показать = n => {
    const это = (n + items.length) % items.length;
    const it = items[это];
    // Кнопку скачивания рисуем по адресу от модуля: панель не знает ни его
    // ключей, ни того, что у кадра вообще бывает исходник. Нет адреса — нет и
    // кнопки, и лайтбокс выглядит как раньше.
    слой.innerHTML = '<img src="' + адрес(it.url) + '" alt="">' +
      '<div class="light-bar"><span class="lbl">' + (it.caption || "") + " · " +
      (it.group || "") + "</span>" +
      (it.download
        ? '<a class="light-dl" href="' + адрес(it.download) + '" download>Скачать оригинал</a>'
        : "") +
      "</div>";
    слой.dataset.i = String(это);
    // Клик по слою закрывает кадр, а кнопка лежит внутри слоя: без этой
    // строки лайтбокс закрывался бы раньше, чем начнётся скачивание.
    const кнопка = слой.querySelector(".light-dl");
    if (кнопка) кнопка.addEventListener("click", e => e.stopPropagation());
    // Плитка уже лежит в кэше браузера и появляется сразу; крупный кадр
    // подменяет её, когда доедет. Сверяем номер: при быстром листании поздний
    // ответ не должен подменить кадр, который человек уже пролистнул.
    const место = слой.querySelector("img");
    const крупный = new Image();
    крупный.onload = () => {
      if (слой.dataset.i === String(это) && место.isConnected) место.src = крупный.src;
    };
    крупный.src = крупныйКадр(it.url);
  };
  показать(i);
  document.body.appendChild(слой);

  const клавиша = e => {
    if (e.key === "Escape") закрыть();
    if (e.key === "ArrowRight") показать(Number(слой.dataset.i) + 1);
    if (e.key === "ArrowLeft") показать(Number(слой.dataset.i) - 1);
  };
  const закрыть = () => {
    слой.remove();
    removeEventListener("keydown", клавиша);
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
    ответ = '<p class="block-empty">введите запрос</p>';
  } else if (!разделы.length) {
    ответ = '<p class="block-empty">ничего не нашлось</p>';
  } else {
    ответ = разделы.map(таблица).join("");
  }

  host.innerHTML = строка + ответ;

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
    host.innerHTML = '<p class="block-empty">Ищу…</p>';
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
};

function нарисовать(host, тип, данные, блок) {
  // Заготовки, рисующие в svg, дописывают узлы к тому, что уже лежит внутри,
  // поэтому заглушку «загружаю» надо снять руками.
  host.innerHTML = "";
  const рисовать = ЗАГОТОВКИ[тип];
  if (!рисовать) return пусто(host, "панель не умеет блок «" + тип + "»: обновите её");
  try {
    рисовать(host, данные, блок);
  } catch (e) {
    пусто(host, "данные не разобрались: " + e.message);
  }
}
