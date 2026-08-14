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

function подписьДня(l) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(l)) return l;
  const [, m, d] = l.split("-");
  return Number(d) + NBSP + MONTHS[Number(m) - 1];
}

/* ── raster: ряды кусочков ──────────────────────────────────────────────── */
function блокRaster(host, d) {
  const rows = (d.rows || []).slice().sort((a, b) => b.value - a.value);
  if (!rows.length) return пусто(host, "нечего показывать");
  const unit = d.unit || 1;
  const maxN = Math.max(1, Math.ceil(Math.max(...rows.map(r => r.value)) / unit));
  host.innerHTML = rows.map(r => {
    const n = Math.max(1, Math.round(r.value / unit));
    const cells = Array.from({ length: n }, (_, i) =>
      '<rect x="' + (i * 8) + '" y="0" width="6" height="6" rx="1.6" fill="' +
      (i < n - 1 || n === 1 ? "var(--serie-1)" : "var(--serie-2)") + '"/>').join("");
    return '<div class="rrow">' + nameCell(r.name, true) +
      '<svg viewBox="0 0 ' + (maxN * 8) + ' 6" preserveAspectRatio="xMinYMid meet">' + cells + "</svg>" +
      '<span class="rv">' + число(r.value, d.format) + "</span></div>";
  }).join("") +
    (d.unitLabel ? '<p class="block-note">Один кусочек — ' + fmt(unit) + " " + d.unitLabel + "</p>" : "");
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

function пусто(host, текст) {
  host.innerHTML = '<p class="block-empty">' + текст + "</p>";
}

/* Кто какую заготовку рисует. Незнакомый тип — не повод падать: панель может
   быть старее модуля, который просит невиданный блок. */
const ЗАГОТОВКИ = {
  stat: блокStat, columns: блокColumns, raster: блокRaster, table: блокTable,
  list: блокList, funnel: блокFunnel, heat: блокHeat, note: блокNote, map: блокMap,
};

function нарисовать(host, тип, данные) {
  // Заготовки, рисующие в svg, дописывают узлы к тому, что уже лежит внутри,
  // поэтому заглушку «загружаю» надо снять руками.
  host.innerHTML = "";
  const рисовать = ЗАГОТОВКИ[тип];
  if (!рисовать) return пусто(host, "панель не умеет блок «" + тип + "»: обновите её");
  try {
    рисовать(host, данные);
  } catch (e) {
    пусто(host, "данные не разобрались: " + e.message);
  }
}
