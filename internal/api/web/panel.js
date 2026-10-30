/* Панель: спрашивает сервер, что показать, и показывает.
 *
 * Ни одного знания о том, что такое «событие», «доход» или «пара», здесь нет.
 * Панель знает три вещи: какие есть вкладки, из каких блоков состоит вкладка и
 * где взять данные блока. Всё остальное решает сервер и модули. Оформление —
 * макет v2: боковое меню, карточки, движение из motion.js. */

const модули = {};   // id модуля → его имя, для подписи блоков

/* Набор данных для вкладок ядра. Приходит одним запросом и живёт до смены
   периода или приложения. */
let DATA = {};

/* Вкладки ядра нарисованы в макете, вкладки модулей — из заготовок. */
const ЯДРО = {
  overview: () => viewOverview(),
  screens: () => viewScreens(),
  people: () => viewPeople(),
  funnels: () => viewFunnels(),
  versions: () => viewVersions(),
  apps: () => viewApps(),
};
const ЗНАЧКИ_ЯДРА = { overview: 'overview', screens: 'screens', people: 'people', funnels: 'funnels', versions: 'versions', apps: 'apps' };
const ТОНА_МОДУЛЕЙ = ['t4', 't3', 't1', 't2', 't5'];

function подписьПериода() {
  const t = DATA.totals || {};
  if (!(t.first && t.last)) return '';
  const с = t.first.startsWith('0000') ? ((DATA.history || [])[0] || {}).d : t.first;
  return с ? day(с) + ' – ' + day(t.last) : '';
}

const state = {
  tab: "overview",
  range: "15d",
  app: "",
  theme: "auto",
  rawNames: false,
  людиСчитаются: true,
  вкладки: [],
  настройка: false,   // режим правки раскладки
  блоки: [],          // раскладка открытой вкладки
  // Что человек делал внутри блоков: какая страница ленты открыта, какой
  // фильтр выбран, что набрано в поиске. Живёт здесь, а не в DOM: перерисовка
  // вкладки пересоздаёт узлы, и всё, что лежало в них, пропадало — лента
  // прыгала на первую страницу, запрос стирался.
  внутри: {},
};

/* Память блока: состояние переживает перерисовку вкладки. */
function память(src) {
  if (!state.внутри[src]) state.внутри[src] = {};
  return state.внутри[src];
}

const $ = id => document.getElementById(id);

/* Панель может стоять не в корне, а за префиксом вроде /tessera.
   Адреса считаются от места, откуда пришла страница. */
const КОРЕНЬ = location.pathname.replace(/\/[^/]*$/, "/");
const адрес = путь => КОРЕНЬ + путь.replace(/^\//, "");


/* ── разговор с сервером ────────────────────────────────────────────────── */

async function взять(путь) {
  const r = await fetch(путь, { credentials: "same-origin" });
  if (r.status === 401) {
    показатьВход();
    throw new Error("нужен вход");
  }
  if (!r.ok) throw new Error(await r.text() || ("сервер ответил " + r.status));
  return r.json();
}

async function послать(путь, тело) {
  const r = await fetch(путь, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(тело),
  });
  if (!r.ok) throw new Error(await r.text() || ("сервер ответил " + r.status));
  return r.json();
}

/* ── вход ───────────────────────────────────────────────────────────────── */

function показатьВход(подсказка) {
  $("gate").hidden = false;
  $("root").hidden = true;
  if (подсказка) $("gateNote").textContent = подсказка;
}

async function проверитьВход() {
  const s = await взять(адрес("/api/state")).catch(() => ({ signedIn: false, passwordSet: false }));
  if (!s.passwordSet) {
    показатьВход("Пароль ещё не задан. Запустите сервер с флагом --password один раз.");
    return false;
  }
  if (!s.signedIn) {
    показатьВход("");
    return false;
  }
  $("gate").hidden = true;
  $("root").hidden = false;
  return true;
}

$("gateForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await послать(адрес("/api/login"), { password: $("pass").value });
    $("pass").value = "";
    $("gateNote").textContent = "";
    await запустить();
  } catch {
    $("gateNote").textContent = "Пароль не подошёл.";
    anim($("gateForm"), [{ transform: "translateX(0)" }, { transform: "translateX(-6px)" }, { transform: "translateX(5px)" }, { transform: "translateX(0)" }], { duration: 320, easing: EASE_IO });
  }
});

$("signout").addEventListener("click", async () => {
  await fetch(адрес("/api/logout"), { credentials: "same-origin" });
  location.reload();
});

/* ── боковое меню ───────────────────────────────────────────────────────── */

async function загрузитьВкладки() {
  // Приложение обязано ехать в запросе: вкладки у них разные, и без него
  // сервер отвечает про первое.
  state.вкладки = await взять(адрес("/api/tabs") +
    (state.app ? "?app=" + encodeURIComponent(state.app) : ""));
  нарисоватьМеню();
}

function нарисоватьМеню() {
  const ядро = state.вкладки.filter(t => !t.mod), мод = state.вкладки.filter(t => t.mod);
  const счёт = { screens: (DATA.screens || []).length, apps: (DATA.apps || []).length };
  const ссылка = (t, i) => '<a href="#' + t.id + '" data-tab="' + t.id + '"' +
    (t.id === state.tab ? ' aria-current="page"' : "") + ">" +
    (t.mod ? '<i class="sq ' + ТОНА_МОДУЛЕЙ[i % ТОНА_МОДУЛЕЙ.length] + '"></i>' : svg(ЗНАЧКИ_ЯДРА[t.id] || "grid")) +
    "<span>" + esc(t.title) + "</span>" +
    (!t.mod && счёт[t.id] ? '<span class="cnt">' + счёт[t.id] + "</span>" : "") + "</a>";
  $("nav-core").innerHTML = ядро.map(ссылка).join("");
  $("nav-mods").innerHTML = мод.map(ссылка).join("");
  $("sect-mods").hidden = !мод.length;
}

/* Подсветка открытой вкладки меняется на месте: фон пункта перетекает. */
function отметитьВкладку() {
  document.querySelectorAll(".nav a").forEach(a =>
    a.dataset.tab === state.tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
}

document.addEventListener("click", e => {
  const a = e.target.closest(".nav a[data-tab]");
  if (!a) return;
  e.preventDefault();
  if (a.dataset.tab === state.tab) return;
  location.hash = a.dataset.tab;
});

/* Выбор приложения — меню под его именем. С одним приложением меню нет. */
function заполнитьВыборПриложений() {
  const apps = DATA.apps || [];
  const своё = apps.find(a => a.id === state.app);
  $("org-name").textContent = своё ? своё.name : "Tessera";
  $("org").querySelector(".chev").style.display = apps.length > 1 ? "" : "none";
  $("org-menu").innerHTML = apps.map(a => '<button type="button" role="menuitem" data-app="' + esc(a.id) + '"' +
    (a.id === state.app ? ' aria-current="true"' : "") + (a.live ? "" : " disabled") + "><span>" + esc(a.name) + "</span>" +
    "<small>" + (a.live ? n(a.dau || 0) + " сегодня" : "нет событий") + "</small></button>").join("");
}
$("org").addEventListener("click", () => {
  const меню = $("org-menu");
  if ((DATA.apps || []).length < 2) return;
  const открыть = меню.hidden;
  меню.hidden = !открыть;
  $("org").setAttribute("aria-expanded", String(открыть));
  if (открыть) anim(меню, [{ opacity: 0, transform: "translateY(-4px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 260 });
});
document.addEventListener("pointerdown", e => {
  if (!e.target.closest("#org, #org-menu")) { $("org-menu").hidden = true; $("org").setAttribute("aria-expanded", "false"); }
});
$("org-menu").addEventListener("click", async e => {
  const b = e.target.closest("[data-app]");
  if (!b || b.disabled) return;
  $("org-menu").hidden = true;
  if (b.dataset.app === state.app) return;
  state.app = b.dataset.app;
  try { localStorage.setItem("tessera-app", state.app); } catch {}
  ядроКогда = 0;
  онлайнЧисло = null;
  // Вкладки у приложений РАЗНЫЕ: модуль модерации разбирает фото
  // Togetherly, и в панели Wallet его вкладки нет. Без перезапроса там
  // оставались чужие вкладки, а открытая чужая отвечала пустотой.
  await загрузитьЯдро();
  await загрузитьВкладки();
  if (!state.вкладки.some(t => t.id === state.tab)) {
    state.tab = "overview";
    history.replaceState(null, "", "#overview");
  }
  await загрузитьИмена();
  заполнитьВыборПриложений();
  сменитьВид();
});

/* ── вкладки ────────────────────────────────────────────────────────────── */

// Номер последней отрисовки. Пока вызов ждёт сервер, человек успевает нажать
// другую вкладку или период, и тогда вид принадлежит новому вызову. Без этой
// проверки ядро, досчитав обзор, рисовало «club» своим экраном, и вместо
// розыгрыша оставалось «ЯДРО[state.tab] is not a function» (18.09.2026), а
// запоздавшая раскладка модуля затирала уже открытую вкладку.
let отрисовка = 0;

/* how: 'enter' — новая вкладка собирается карточками, 'soft' — та же вкладка с
   новыми данными (числа перетекают), 'boot' — первая загрузка с каркасом,
   'quiet' — без движения (ширина окна, правка раскладки). */
async function нарисоватьВкладку(how = "enter") {
  const мой = ++отрисовка;
  const устарел = () => мой !== отрисовка;
  const вкладка = state.tab;
  отметитьВкладку();
  const view = $("view");
  const было = how === "soft" ? snapshot(view) : null;

  // Вкладки ядра нарисованы в макете и получают весь набор данных разом.
  if (ЯДРО[вкладка]) {
    try {
      await загрузитьЯдро();
      if (устарел()) return;
      снятьЖивые();
      ЯДРО[вкладка]();
      segThumbs();
      нарисоватьМеню();
      показатьДвижение(how, было);
      живойОнлайн();
    } catch (e) {
      if (устарел()) return;
      view.innerHTML = '<p class="block-empty">Вкладка не открылась: ' + esc(e.message) + "</p>";
    }
    return;
  }

  let раскладка;
  try {
    раскладка = await взять(адрес("/api/layout?tab=") + encodeURIComponent(вкладка) +
      (state.app ? "&app=" + encodeURIComponent(state.app) : ""));
  } catch (e) {
    if (устарел()) return;
    view.innerHTML = '<p class="block-empty">Вкладка не открылась: ' + esc(e.message) + "</p>";
    return;
  }
  if (устарел()) return;

  const блоки = раскладка.blocks || [];
  state.блоки = блоки;
  const чьи = src => { const id = String(src || "").split(":")[0]; return id === "core" ? "" : (модули[id] || id); };

  view.innerHTML = (блоки.length
      ? '<div class="grid g12" id="сетка">' + блоки.map((b, i) =>
          // Класс типа нужен раскладке телефона: там ширина решается не
          // числом колонок, а тем, ЧТО внутри. Одно число живёт в половине
          // строки, а график или растр в половине превращаются в кашу.
          '<section class="card c' + (b.span || 12) + " b-" + (b.type || "stat") + (state.настройка ? "" : " ждёт") +
            '" data-idx="' + i + '"' + (state.настройка ? ' draggable="true"' : "") + ">" +
            '<header class="ch"><span class="it">' + svg(b.icon || ЗНАЧОК_ЗАГОТОВКИ[b.type] || "grid") + "</span>" +
            "<div><h2>" + esc(b.title) + "</h2>" +
            // Владельца подписываем, только когда он не ядро: «core» у каждого
            // второго блока — шум, а имя модуля объясняет, откуда числа.
            ((b.sub || чьи(b.src)) ? "<p>" + esc(b.sub || чьи(b.src)) + "</p>" : "") + "</div>" +
            '<div class="cr" id="шапка-' + i + '">' +
            (state.настройка ? '<button class="block-x" data-remove="' + i + '" title="Убрать блок">×</button>' : "") +
            "</div></header>" +
            '<div class="in" id="блок-' + i + '">' +
              (state.настройка
                // В настройке числа не грузим: важна раскладка. Но пустое тело
                // читается как поломка, поэтому блок называет себя сам.
                ? '<p class="block-empty">' + esc(b.type) + " · " + esc(b.src) + "</p>"
                : "") +
            "</div></section>").join("") + "</div>"
      : '<p class="block-empty">На этой вкладке пока нет блоков. Нажмите «Настроить вкладку» и добавьте.</p>') +
    панельНастройки() + подвал();

  segThumbs();
  if (state.настройка) {
    подключитьПеретаскивание();
    return; // в настройке числа не грузим: важна раскладка, а не данные
  }
  // Карточки встают каркасом, данные проступают в каждой, как только придут.
  const вошли = how === "quiet" || how === "soft" ? [] : enterView(view, true);

  // Запросы идут разом: один медленный источник не держит остальные.
  снятьЖивые();
  блоки.forEach((b, i) => {
    const host = $("блок-" + i), шапка = $("шапка-" + i), карточка = host.closest(".card");
    const готово = () => {
      if (устарел()) return;
      const первый = карточка.classList.contains("ждёт");
      карточка.classList.remove("ждёт");
      segThumbs();
      if (!первый) return;
      if (how === "quiet") return;
      if (было) anim(host, [{ opacity: .35, filter: "blur(4px)" }, { opacity: 1, filter: "blur(0)" }], { duration: 500 });
      else if (!карточка.classList.contains("wait")) revealInside(карточка, вошли.includes(карточка) ? 120 : 0);
    };
    // Поиск заранее ничего не считает: ответы зависят от запроса, и собирать
    // их расписанием бессмысленно. Рисуем поле ввода сразу, а за данными блок
    // сходит сам, когда человек нажмёт «Найти».
    if (b.type === "search") { нарисовать(host, b.type, null, b, шапка); return готово(); }
    const живой = секунды(b.live);
    const тянуть = () => данныеБлока(b, живой)
      .then(d => { if (устарел()) return; нарисовать(host, b.type, d, b, шапка); готово(); })
      .catch(e => {
        if (устарел()) return;
        // У живого блока обрыв — это мигание раз в двадцать секунд, поэтому
        // прежнее число остаётся на месте: лучше слегка устаревшее, чем дыра.
        if (живой && host.querySelector(".stat-val")) return;
        host.innerHTML = '<p class="block-empty">' +
          (e.message.includes("не отвечал") ? "Модуль ещё не присылал данные."
                                            : "Источник не ответил: " + esc(e.message)) + "</p>";
        готово();
      });
    тянуть();
    if (живой) живые.push(setInterval(() => { if (!document.hidden) тянуть(); }, живой * 1000));
  });
}
const ЗНАЧОК_ЗАГОТОВКИ = { stat: "grid", columns: "chart", raster: "grid", table: "list", list: "list", funnel: "funnels",
  heat: "calendar", note: "note", map: "chart", shelf: "screens", search: "search", periods: "coin", waffle: "grid",
  rows: "bag", rate: "ad" };

/* Данные блока. Блок может попросить ещё несколько источников полем `with`
   ({имя: "модуль:ключ"}): «Доход» рисует сумму, источники и прошлый месяц
   одной карточкой, а модуль отдаёт их отдельными ключами. */
async function данныеБлока(b, живой) {
  const d = await взять(ссылкаБлока(b, живой));
  if (!b.with) return d;
  const ещё = await Promise.all(Object.entries(b.with).map(([имя, src]) =>
    взять(ссылкаБлока({ src, ranged: b.ranged }, false)).then(v => [имя, v]).catch(() => [имя, null])));
  return { ...d, with: Object.fromEntries(ещё) };
}

/* Как вкладка появляется: каркас при первой загрузке, карточками при смене
   вкладки, перетеканием чисел при новых данных той же вкладки. */
function показатьДвижение(how, было) {
  const view = $("view");
  if (how === "soft") return settle(view, было);
  if (how === "quiet" || CALM.matches) return;
  if (how === "boot") {
    view.classList.add("loading");
    const вошли = enterView(view, true);
    setTimeout(() => { view.classList.remove("loading"); вошли.forEach((c, i) => revealInside(c, i * 90)); }, 900);
    return;
  }
  enterView(view);
}

/* Та же вкладка ядра с новыми данными или в другом поясе: блоки, которые
   изменились, проступают, числа доезжают от старых значений. */
function перерисоватьЯдро(how = "soft") {
  if (!ЯДРО[state.tab]) return нарисоватьВкладку(how);
  const view = $("view"), было = how === "soft" ? snapshot(view) : null;
  ЯДРО[state.tab]();
  segThumbs();
  if (было) settle(view, было);
  живойОнлайн();
}

/* Смена вкладки: старая уходит вверх и тает, новая собирается карточками. */
function сменитьВид() {
  const view = $("view");
  const дальше = () => { scrollTo(0, 0); нарисоватьВкладку("enter"); };
  document.querySelector(".lb, .light")?.remove();
  if (CALM.matches || !view.animate || !view.children.length) return дальше();
  const уход = view.animate([{ opacity: 1, transform: "none", filter: "blur(0)" }, { opacity: 0, transform: "translateY(-8px)", filter: "blur(3px)" }],
    { duration: 220, easing: "cubic-bezier(.5,0,.75,0)", fill: "forwards" });
  уход.finished.then(() => { дальше(); уход.cancel(); });
}

// «Сейчас в приложении» на обзоре — живое число модуля Togetherly. Ходит само
// раз в двадцать секунд и меняет только свою ячейку: перерисуй мы вкладку
// целиком, человек терял бы прокрутку каждые двадцать секунд.
let онлайнТаймер = 0;
function живойОнлайн() {
  if (!DATA.moderation) return;
  const тянуть = () => взять(адрес("/api/query") + "?src=moderation:online")
    .then(d => {
      const было = онлайнЧисло;
      онлайнЧисло = d;
      const ячейка = $("online-cell");
      if (!ячейка) return;
      const старое = ячейка.querySelector(".v").textContent;
      ячейка.outerHTML = онлайнЯчейка();
      const новая = $("online-cell");
      if (было) { const v = новая.querySelector(".v"), текст = v.textContent; v.textContent = старое; tweenText(v, текст, 600); }
    })
    // Молчание источника не стирает последнее известное число: мигающая раз в
    // двадцать секунд цифра хуже слегка устаревшей.
    .catch(() => {});
  if (!онлайнТаймер) {
    онлайнТаймер = setInterval(() => { if (!document.hidden && $("online-cell")) тянуть(); }, 20000);
  }
  if ($("online-cell")) тянуть();
}

// ── живые блоки ──────────────────────────────────────────────────────────────
// Онлайн стареет за минуту, поэтому такой блок ходит за числом сам. Ходит он
// мимо собранного расписанием — через тот же путь, которым лента берёт свои
// страницы, — и перерисовывает ТОЛЬКО себя.
const живые = [];
function снятьЖивые() { while (живые.length) clearInterval(живые.pop()); }
function секунды(строка) {
  const m = /^(\d+)(s|m)?$/.exec(String(строка || ""));
  if (!m) return 0;
  return Math.max(5, +m[1] * (m[2] === "m" ? 60 : 1));
}
function ссылкаБлока(b, живой) {
  if (живой) return адрес("/api/query") + "?src=" + encodeURIComponent(b.src);
  return адрес("/api/block") + "?src=" + encodeURIComponent(b.src) +
    "&range=" + encodeURIComponent(state.range) +
    (state.app ? "&app=" + encodeURIComponent(state.app) : "");
}

/* ── настройка раскладки ────────────────────────────────────────────────── */

function панельНастройки() {
  if (!state.настройка) {
    return '<div class="edit-bar"><button class="ghost-btn" id="начатьНастройку">' +
      svg("pencil") + "Настроить вкладку</button></div>";
  }
  return '<div class="edit-bar edit-on">' +
    '<span class="lbl">Блок берётся за себя и переставляется мышью</span>' +
    '<button class="ghost-btn" id="добавитьБлок">Добавить блок</button>' +
    '<button class="ghost-btn" id="сброситьРаскладку">Вернуть заводскую</button>' +
    '<button class="btn dark" id="закончитьНастройку">Готово</button></div>';
}

/* Перетаскивание: блок берётся за себя целиком, порядок меняется на месте и
   сразу уходит на сервер — «сохранить» тут лишняя кнопка. */
function подключитьПеретаскивание() {
  const сетка = $("сетка");
  if (!сетка) return;
  let взятый = null;

  сетка.querySelectorAll(".card").forEach(node => {
    node.addEventListener("dragstart", e => {
      взятый = node;
      node.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    node.addEventListener("dragend", async () => {
      node.classList.remove("dragging");
      взятый = null;
      const порядок = [...сетка.querySelectorAll(".card")].map(n => Number(n.dataset.idx));
      state.блоки = порядок.map(i => state.блоки[i]);
      await сохранитьРаскладку();
    });
    node.addEventListener("dragover", e => {
      e.preventDefault();
      if (!взятый || взятый === node) return;
      const r = node.getBoundingClientRect();
      const после = (e.clientY - r.top) / r.height > 0.5;
      node.parentNode.insertBefore(взятый, после ? node.nextSibling : node);
    });
  });
}

async function сохранитьРаскладку() {
  await послать(адрес("/api/layout"), { tab: state.tab, blocks: state.блоки });
  нарисоватьВкладку("quiet");
}

/* Что можно добавить: блоки ядра и то, что предлагают модули. */
async function показатьКаталог() {
  const каталог = await взять(адрес("/api/catalog"));
  const лист = document.createElement("div");
  лист.className = "sheet";
  лист.innerHTML = '<div class="sheet-card"><div class="panel-head">' +
    '<span class="lbl">Добавить блок</span>' +
    '<button class="block-x" id="закрытьЛист" title="Закрыть">×</button></div>' +
    каталог.map((c, i) =>
      '<button class="cat-row" data-cat="' + i + '">' +
      "<span>" + esc(c.block.title) + "</span>" +
      '<span class="lbl">' + esc(c.owner) + " · " + esc(c.block.type) + "</span></button>").join("") +
    "</div>";
  document.body.appendChild(лист);
  anim(лист.firstChild, [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 320 });

  лист.addEventListener("click", async e => {
    if (e.target === лист || e.target.closest("#закрытьЛист")) { лист.remove(); return; }
    const кнопка = e.target.closest("[data-cat]");
    if (!кнопка) return;
    state.блоки = [...state.блоки, каталог[Number(кнопка.dataset.cat)].block];
    лист.remove();
    await сохранитьРаскладку();
  });
}

document.addEventListener("click", async e => {
  if (e.target.closest("#начатьНастройку")) {
    state.настройка = true;
    нарисоватьВкладку("quiet");
  } else if (e.target.closest("#закончитьНастройку")) {
    state.настройка = false;
    нарисоватьВкладку("enter");
  } else if (e.target.closest("#добавитьБлок")) {
    показатьКаталог();
  } else if (e.target.closest("#сброситьРаскладку")) {
    // Пустая раскладка означает «отдавай заводскую»: сервер сам подставит её.
    await послать(адрес("/api/layout"), { tab: state.tab, blocks: [] });
    state.настройка = false;
    нарисоватьВкладку("enter");
  } else if (e.target.closest("[data-remove]")) {
    const i = Number(e.target.closest("[data-remove]").dataset.remove);
    state.блоки = state.блоки.filter((_, j) => j !== i);
    await сохранитьРаскладку();
  }
});

/* Блоки модуля превращаются в плоские числа: {month:{value:305}} → {month:305}.
   Что не число — остаётся как есть. */
function развернуть(набор) {
  const out = {};
  for (const [ключ, знач] of Object.entries(набор || {})) {
    out[ключ] = (знач && typeof знач === "object" && "value" in знач && !("items" in знач))
      ? знач.value : знач;
  }
  return out;
}

let ядроКогда = 0;
async function загрузитьЯдро() {
  const свежо = Date.now() - ядроКогда < 20000 && DATA.totals;
  if (свежо) return;
  DATA = await взять(адрес("/api/core") + "?range=" + encodeURIComponent(state.range) +
    (state.app ? "&app=" + encodeURIComponent(state.app) : ""));
  // Чужой модуль не приезжает вовсе — сервер отдаёт данные только своим
  // приложениям. Пустой объект вместо `undefined` здесь означал бы «модуль
  // есть, но молчит», и обзор Wallet спрашивал бы онлайн Togetherly.
  const м = DATA.modules || {};
  DATA.income = м.income ? развернуть(м.income) : null;
  DATA.moderation = м.moderation ? развернуть(м.moderation) : null;
  DATA.appdb = м.appdb ? развернуть(м.appdb) : null;
  if (!state.app && (DATA.apps || []).length) {
    let прежнее = "";
    try { прежнее = localStorage.getItem("tessera-app") || ""; } catch {}
    const есть = DATA.apps.some(a => a.id === прежнее);
    state.app = есть ? прежнее : DATA.apps[0].id;
    // Ядро отдавало первое приложение; если выбрано другое — спрашиваем его.
    if (есть && прежнее !== DATA.apps[0].id) { ядроКогда = 0; return загрузитьЯдро(); }
  }
  заполнитьВыборПриложений();
  ядроКогда = Date.now();
}

async function загрузитьМодули() {
  const список = await взять(адрес("/api/modules")).catch(() => []);
  список.forEach(m => { модули[m.id] = m.name; });
}

/* ── словарь имён ───────────────────────────────────────────────────────── */

async function загрузитьИмена() {
  const d = await взять(адрес("/api/labels?app=") + encodeURIComponent(state.app)).catch(() => ({}));
  Object.keys(labels).forEach(k => delete labels[k]);
  Object.assign(labels, d);
}

document.addEventListener("click", e => {
  const btn = e.target.closest("[data-rename]");
  if (!btn) return;
  e.stopPropagation();

  const ключ = btn.dataset.rename;
  const обёртка = btn.closest(".nm-edit");
  const b = обёртка.querySelector("b");
  const поле = document.createElement("input");
  поле.value = nameOf(ключ);
  поле.setAttribute("aria-label", "Имя для " + ключ);
  b.replaceWith(поле);
  btn.style.display = "none";
  поле.focus();
  поле.select();

  let закрыто = false;
  const готово = async сохранить => {
    if (закрыто) return;
    закрыто = true;
    if (сохранить) {
      const имя = поле.value.trim();
      await послать(адрес("/api/labels"), { app: state.app, key: ключ, title: имя === ключ ? "" : имя });
      await загрузитьИмена();
    }
    перерисоватьЯдро();
  };
  поле.addEventListener("keydown", ev => {
    if (ev.key === "Enter") готово(true);
    if (ev.key === "Escape") готово(false);
  });
  поле.addEventListener("blur", () => готово(true));
});

/* ── обновление и свежесть ──────────────────────────────────────────────── */

// Пересбор по кнопке. Сводки считает расписание, и это правильно, но между
// прогонами лежит двадцать минут: свежая покупка в панели ещё не видна, а со
// стороны это читается как неверный расчёт. Собираем модуль открытой вкладки,
// а на вкладках ядра — все: там числа приходят из своей базы, и пересбор
// нужен ради онлайна и модульных чисел.
const кнопкаОбновить = $("refresh");
кнопкаОбновить.addEventListener("click", async () => {
  if (кнопкаОбновить.disabled) return;
  кнопкаОбновить.disabled = true;
  кнопкаОбновить.classList.add("крутится");
  const чей = ЯДРО[state.tab] ? "" : (state.блоки || []).map(b => (b.src || "").split(":")[0])
    .find(в => в && в !== "core") || "";
  try {
    const r = await fetch(адрес("/api/refresh") + (чей ? "?module=" + encodeURIComponent(чей) : ""),
      { method: "POST", credentials: "same-origin" });
    const о = await r.json().catch(() => ({}));
    if (о && о.ok === false) сказать("Собралось не всё: " + (о.error || "источник не ответил"));
    ядроКогда = 0;
    await нарисоватьВкладку("soft");
    await свежесть();
  } catch (e) {
    сказать("Не обновилось: " + e.message);
  } finally {
    кнопкаОбновить.disabled = false;
    кнопкаОбновить.classList.remove("крутится");
  }
});

// Когда данные собраны последний раз. Без этой строки человек не отличает
// «числа не сошлись» от «числа получасовой давности».
async function свежесть() {
  const ячейка = $("ctx-fresh");
  try {
    const ms = await взять(адрес("/api/modules"));
    const t = Math.max(0, ...ms.map(m => m.updated || 0));
    if (!t) { ячейка.textContent = "модули молчат"; return; }
    const мин = Math.round((Date.now() / 1000 - t) / 60);
    ячейка.textContent = "собрано " + (мин < 1 ? "только что"
      : мин < 60 ? мин + " мин назад"
      : new Date(t * 1000).toLocaleString("ru", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }));
  } catch { ячейка.textContent = "свой сервер"; }
}

function сказать(текст) {
  const п = document.createElement("div");
  п.className = "тост";
  п.textContent = текст;
  document.body.appendChild(п);
  anim(п, [{ opacity: 0, transform: "translate(-50%,12px)" }, { opacity: 1, transform: "translate(-50%,0)" }], { duration: 320 });
  setTimeout(() => {
    const a = anim(п, [{ opacity: 1 }, { opacity: 0 }], { duration: 240, fill: "forwards" });
    (a ? a.finished : Promise.resolve()).then(() => п.remove());
  }, 5000);
}

/* ── тема ───────────────────────────────────────────────────────────────── */

function поставитьТему(t, плавно) {
  state.theme = t;
  if (плавно) themeFlow();
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll("[data-theme-set]").forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.themeSet === t)));
  segThumbs();
  try { localStorage.setItem("tessera-theme", t); } catch {}
}
document.querySelectorAll("[data-theme-set]").forEach(b =>
  b.addEventListener("click", () => поставитьТему(b.dataset.themeSet, true)));

/* ── запуск ─────────────────────────────────────────────────────────────── */

async function запустить() {
  if (!await проверитьВход()) return;

  try { поставитьТему(localStorage.getItem("tessera-theme") || "auto"); } catch {}

  await загрузитьМодули();
  await загрузитьЯдро();       // отсюда узнаём приложение
  await загрузитьВкладки();
  const изАдреса = location.hash.replace("#", "");
  if (state.вкладки.some(t => t.id === изАдреса)) state.tab = изАдреса;
  else if (!state.вкладки.some(t => t.id === state.tab)) state.tab = "overview";
  await загрузитьИмена();
  // Боковое меню выезжает по пунктам, вкладка встаёт каркасом.
  if (!CALM.matches) document.querySelectorAll(".org, .sect:not([hidden]), .nav a, .side-foot > *").forEach((e, i) =>
    anim(e, [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: 80 + i * 35 }));
  await нарисоватьВкладку("boot");
  свежесть();
  setInterval(() => { if (!document.hidden) свежесть(); }, 60000);
}

addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "");
  if (t && t !== state.tab && state.вкладки.some(x => x.id === t)) {
    state.tab = t;
    отметитьВкладку();
    сменитьВид();
  }
});

/* Перерисовываем ТОЛЬКО когда изменилась ширина, и заметно.
 *
 * На телефоне `resize` прилетает постоянно: браузер прячет адресную строку при
 * листании, всплывает клавиатура, меняется высота. Полная перерисовка на
 * каждое такое событие сбрасывала ленту на первую страницу и стирала набранный
 * запрос — со стороны это выглядело так, будто панель сама себя обновляет.
 * Графики зависят от ширины, поэтому её изменение по-прежнему важно, а порог
 * в сорок пикселей отсекает дрожание полосы прокрутки. */
let таймерРазмера = null;
let последняяШирина = innerWidth;
addEventListener("resize", () => {
  segThumbs();
  if (Math.abs(innerWidth - последняяШирина) < 40) return;
  последняяШирина = innerWidth;
  clearTimeout(таймерРазмера);
  таймерРазмера = setTimeout(() => ЯДРО[state.tab] ? перерисоватьЯдро("quiet") : нарисоватьВкладку("quiet"), 200);
});

/* Кнопка «наверх» в правом нижнем углу. Видна, когда страница ушла вниз
 * дальше экрана: на телефоне до шапки модерации — три экрана ленты.
 *
 * Полоса выбора кадров висит у низа экрана и правым краем закрыла бы кнопку,
 * поэтому, пока полоса видна, кнопка поднимается над ней. */
function поставитьНаверх() {
  const кнопка = $("наверх");
  if (!кнопка) return;
  кнопка.classList.toggle("видна", scrollY > innerHeight * 0.8);
  const полоса = document.querySelector(".shelf-pick:not([hidden])");
  const место = полоса && полоса.getBoundingClientRect();
  const прилипла = место && место.top < innerHeight && место.bottom > innerHeight - 24;
  кнопка.style.setProperty("--над", прилипла ? полоса.offsetHeight + 8 + "px" : "0px");
}
addEventListener("scroll", поставитьНаверх, { passive: true });
$("наверх").addEventListener("click", () => {
  scrollTo({ top: 0, behavior: CALM.matches ? "auto" : "smooth" });
});

запустить();
