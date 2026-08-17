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
function блокShelf(host, d, блок) {
  const src = (блок && блок.src) || "";
  const моё = память(src);
  const вид = моё.kind || "";
  const стр = Number(моё.page || 0);

  const items = d.items || [];
  const виды = d.kinds || [];

  const замок = моё.adult || "";

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
      ">Без 18+</button></div>";

  const кадры = items.map((it, i) =>
    '<figure data-i="' + i + '"><div class="ph' + (it.video ? " vid" : "") +
      (it.adult ? " adult" : "") + '">' +
      // Адрес обязательно через адрес(): модуль отдаёт путь от корня панели,
      // а панель живёт в подпапке (/tessera/). Без этого браузер уходил на
      // корень домена и получал пустоту — лента стояла без единого кадра.
      '<img loading="lazy" src="' + адрес(it.url) + '" alt="' + (it.caption || "кадр") + '"' +
      ' onerror="this.closest(&quot;.ph&quot;).classList.add(&quot;нет&quot;)">' +
    "</div><figcaption>" + (it.caption || "") +
      (it.ts ? " · " + давность(it.ts) : "") + "</figcaption>" +
    // id пары — то, с чем модератор уходит в поиск, в переписку и в поддержку.
    // Поэтому он не подпись, а кнопка: щелчок кладёт его в буфер.
    (it.group ? '<button class="pair-id" data-pair="' + it.group +
      '" title="Скопировать id пары">' + it.group + "</button>" : "") +
    "</figure>").join("");

  const листалка = '<div class="shelf-nav">' +
    '<button class="ghost-btn" data-page="' + (стр - 1) + '"' + (стр <= 0 ? " disabled" : "") +
      ">Назад</button>" +
    '<span class="lbl">страница ' + (стр + 1) + " из " + fmt(d.pages || 1) +
      " · всего " + fmt(d.total || 0) + " файлов</span>" +
    '<button class="ghost-btn" data-page="' + (стр + 1) + '"' +
      ((d.pages && стр + 1 >= d.pages) ? " disabled" : "") + ">Дальше</button></div>";

  host.innerHTML = фильтры +
    (items.length ? '<div class="shelf">' + кадры + "</div>" : '<p class="block-empty">пусто</p>') +
    листалка +
    '<p class="block-note">Порядок — по загрузке в хранилище, а не по дате внутри записи: ' +
    "дату загрузивший может подвинуть. Кадры чужие, поэтому наружу они не уходят.</p>";

  const перерисовать = async () => {
    // Держим блок на месте: перерисовка меняет высоту, и страница уезжала
    // к началу — человек листал ленту, а его выбрасывало наверх, к шапке.
    const былоСверху = host.getBoundingClientRect().top;
    host.style.minHeight = host.offsetHeight + "px";
    host.innerHTML = '<p class="block-empty">Загружаю ленту…</p>';
    const ссылка = адрес("/api/query") + "?src=" + encodeURIComponent(src) +
      "&page=" + (моё.page || 0) +
      (моё.kind ? "&kind=" + encodeURIComponent(моё.kind) : "") +
      (моё.adult ? "&adult=" + encodeURIComponent(моё.adult) : "");
    try {
      блокShelf(host, await взять(ссылка), блок);
    } catch (e) {
      пусто(host, "лента не пришла: " + e.message);
    }
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
  host.querySelectorAll("[data-adult]").forEach(b => b.addEventListener("click", () => {
    моё.adult = b.dataset.adult;
    моё.page = 0;
    перерисовать();
  }));
  // Копирование id пары не должно открывать кадр: щелчок сюда — про пару, а
  // не про картинку.
  host.querySelectorAll(".pair-id").forEach(b => b.addEventListener("click", async e => {
    e.stopPropagation();
    const id = b.dataset.pair || "";
    try {
      await navigator.clipboard.writeText(id);
      сказать("id пары скопирован");
    } catch {
      // Буфер закрыт (панель открыта не по https или права не даны) — тогда
      // выделяем текст, чтобы человек забрал его сам.
      const д = document.createRange();
      д.selectNodeContents(b);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(д);
      сказать("скопируйте выделенное");
    }
  }));
  host.querySelectorAll("[data-page]").forEach(b => b.addEventListener("click", () => {
    if (b.disabled) return;
    моё.page = Number(b.dataset.page);
    перерисовать();
  }));

  // Лайтбокс: кадр крупно, стрелки листают, Esc закрывает.
  host.querySelectorAll(".shelf figure").forEach(f => f.addEventListener("click", () => {
    открытьКадр(items, Number(f.dataset.i));
  }));
}

function открытьКадр(items, i) {
  const слой = document.createElement("div");
  слой.className = "light";
  const показать = n => {
    const it = items[(n + items.length) % items.length];
    слой.innerHTML = '<img src="' + адрес(it.url) + '&w=1600" alt="">' +
      '<div class="light-bar"><span class="lbl">' + (it.caption || "") + " · " +
      (it.group || "") + "</span></div>";
    слой.dataset.i = String((n + items.length) % items.length);
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
    const шапка = (р.cols || []).map(c => "<th>" + c + "</th>").join("");
    const тело = (р.rows || []).map(r =>
      "<tr>" + r.map(v => "<td>" + (v === null || v === undefined ? "—" : v) + "</td>").join("") + "</tr>"
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
