/* Панель: спрашивает сервер, что показать, и показывает.
 *
 * Ни одного знания о том, что такое «событие», «доход» или «пара», здесь нет.
 * Панель знает три вещи: какие есть вкладки, из каких блоков состоит вкладка и
 * где взять данные блока. Всё остальное решает сервер и модули. */

const модули = {};   // id модуля → его имя, для подписи блоков

const state = {
  tab: "overview",
  range: "15d",
  app: "",
  theme: "auto",
  rawNames: false,
  вкладки: [],
  настройка: false,   // режим правки раскладки
  блоки: [],          // раскладка открытой вкладки
};

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
  }
});

$("signout").addEventListener("click", async () => {
  await fetch(адрес("/api/logout"), { credentials: "same-origin" });
  location.reload();
});

/* ── вкладки и раскладка ────────────────────────────────────────────────── */

async function загрузитьВкладки() {
  state.вкладки = await взять(адрес("/api/tabs"));
  $("tabs").innerHTML = state.вкладки.map(t =>
    '<button role="tab" data-tab="' + t.id + '" aria-selected="' + (t.id === state.tab) + '">' +
    (t.mod ? '<span class="frag" title="вкладку принёс модуль"></span>' : "") +
    t.title + "</button>").join("");
  document.querySelectorAll("[data-tab]").forEach(b =>
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      location.hash = state.tab;
      нарисоватьВкладку();
    }));
}

async function нарисоватьВкладку() {
  document.querySelectorAll("[data-tab]").forEach(b =>
    b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));

  const view = $("view");
  view.innerHTML = '<p class="block-empty">Загружаю…</p>';

  let раскладка;
  try {
    раскладка = await взять(адрес("/api/layout?tab=") + encodeURIComponent(state.tab));
  } catch (e) {
    view.innerHTML = '<p class="block-empty">Вкладка не открылась: ' + e.message + "</p>";
    return;
  }

  const блоки = раскладка.blocks || [];
  state.блоки = блоки;

  view.innerHTML = панельНастройки() +
    (блоки.length
      ? '<div class="grid" id="сетка">' + блоки.map((b, i) =>
          '<section class="panel c' + (b.span || 12) + '" data-idx="' + i + '"' +
            (state.настройка ? ' draggable="true"' : "") + ">" +
            '<div class="panel-head"><span class="lbl">' + b.title + "</span>" +
            // Владельца подписываем, только когда он не ядро: «core» у каждого
            // второго блока — шум, а имя модуля объясняет, откуда числа.
            (b.src.startsWith("core:") ? "" :
              '<span class="lbl">' + (модули[b.src.split(":")[0]] || b.src.split(":")[0]) + "</span>") +
            (state.настройка
              ? '<button class="block-x" data-remove="' + i + '" title="Убрать блок">×</button>'
              : "") +
            "</div>" +
            '<div id="блок-' + i + '">' +
              (state.настройка
                // В настройке числа не грузим: важна раскладка. Но пустое тело
                // читается как поломка, поэтому блок называет себя сам.
                ? '<p class="block-empty">' + b.type + " · " + b.src + "</p>"
                : '<p class="block-empty">…</p>') +
            "</div>" +
          "</section>").join("") + "</div>"
      : '<p class="block-empty">На этой вкладке пока нет блоков. Нажмите «Настроить» и добавьте.</p>');

  if (state.настройка) {
    подключитьПеретаскивание();
    return; // в настройке числа не грузим: важна раскладка, а не данные
  }

  // Запросы идут разом: один медленный источник не держит остальные.
  блоки.forEach((b, i) => {
    const host = $("блок-" + i);
    const ссылка = адрес("/api/block") + "?src=" + encodeURIComponent(b.src) +
      "&range=" + encodeURIComponent(state.range) +
      (state.app ? "&app=" + encodeURIComponent(state.app) : "");
    взять(ссылка)
      .then(d => нарисовать(host, b.type, d, b))
      .catch(e => {
        host.innerHTML = '<p class="block-empty">' +
          (e.message.includes("не отвечал") ? "Модуль ещё не присылал данные."
                                            : "Источник не ответил: " + e.message) + "</p>";
      });
  });
}

function панельНастройки() {
  if (!state.настройка) {
    return '<div class="edit-bar"><button class="ghost-btn" id="начатьНастройку">' +
      "Настроить вкладку</button></div>";
  }
  return '<div class="edit-bar edit-on">' +
    "<span class=\"lbl\">Блок берётся за заголовок и переставляется мышью</span>" +
    '<button class="ghost-btn" id="добавитьБлок">Добавить блок</button>' +
    '<button class="ghost-btn" id="сброситьРаскладку">Вернуть заводскую</button>' +
    '<button class="btn" id="закончитьНастройку">Готово</button></div>';
}

/* Перетаскивание: блок берётся за себя целиком, порядок меняется на месте и
   сразу уходит на сервер — «сохранить» тут лишняя кнопка. */
function подключитьПеретаскивание() {
  const сетка = $("сетка");
  if (!сетка) return;
  let взятый = null;

  сетка.querySelectorAll(".panel").forEach(node => {
    node.addEventListener("dragstart", e => {
      взятый = node;
      node.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    node.addEventListener("dragend", async () => {
      node.classList.remove("dragging");
      взятый = null;
      const порядок = [...сетка.querySelectorAll(".panel")].map(n => Number(n.dataset.idx));
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
  нарисоватьВкладку();
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
      "<span>" + c.block.title + "</span>" +
      '<span class="lbl">' + c.owner + " · " + c.block.type + "</span></button>").join("") +
    "</div>";
  document.body.appendChild(лист);

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
    нарисоватьВкладку();
  } else if (e.target.closest("#закончитьНастройку")) {
    state.настройка = false;
    нарисоватьВкладку();
  } else if (e.target.closest("#добавитьБлок")) {
    показатьКаталог();
  } else if (e.target.closest("#сброситьРаскладку")) {
    // Пустая раскладка означает «отдавай заводскую»: сервер сам подставит её.
    await послать(адрес("/api/layout"), { tab: state.tab, blocks: [] });
    await fetch(адрес("/api/layout") + "?tab=" + encodeURIComponent(state.tab), { credentials: "same-origin" });
    state.настройка = false;
    нарисоватьВкладку();
  } else if (e.target.closest("[data-remove]")) {
    const i = Number(e.target.closest("[data-remove]").dataset.remove);
    state.блоки = state.блоки.filter((_, j) => j !== i);
    await сохранитьРаскладку();
  }
});

async function загрузитьМодули() {
  const список = await взять(адрес("/api/modules")).catch(() => []);
  список.forEach(m => { модули[m.id] = m.name; });
}

/* Строка контекста: сколько событий в базе и за какой срок они живут. */
async function подписатьШапку() {
  try {
    const d = await взять(адрес("/api/block?src=core:events_total&range=") + state.range);
    $("ctx-events").textContent = fmt(d.value);
  } catch { $("ctx-events").textContent = "—"; }
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
    нарисоватьВкладку();
  };
  поле.addEventListener("keydown", ev => {
    if (ev.key === "Enter") готово(true);
    if (ev.key === "Escape") готово(false);
  });
  поле.addEventListener("blur", () => готово(true));
});

/* ── период, приложения, тема ───────────────────────────────────────────── */

document.querySelectorAll("[data-range]").forEach(b =>
  b.addEventListener("click", () => {
    state.range = b.dataset.range;
    document.querySelectorAll("[data-range]").forEach(x => x.removeAttribute("aria-pressed"));
    b.setAttribute("aria-pressed", "true");
    подписатьПериод();
    нарисоватьВкладку();
  }));

function подписатьПериод() {
  const подписи = { "7d": "последние 7 суток", "15d": "последние 15 суток",
                    "30d": "последние 30 суток", all: "всё время" };
  $("ctx-range").textContent = подписи[state.range] || state.range;
}

const rs = $("rawSwitch");
const переключитьКлючи = () => {
  state.rawNames = !state.rawNames;
  rs.setAttribute("aria-checked", String(state.rawNames));
  нарисоватьВкладку();
};
rs.addEventListener("click", переключитьКлючи);
rs.addEventListener("keydown", e => {
  if (e.key === " " || e.key === "Enter") { e.preventDefault(); переключитьКлючи(); }
});

function поставитьТему(t) {
  state.theme = t;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  document.querySelectorAll("[data-theme-set]").forEach(x =>
    x.setAttribute("aria-pressed", String(x.dataset.themeSet === t)));
  try { localStorage.setItem("tessera-theme", t); } catch {}
}
document.querySelectorAll("[data-theme-set]").forEach(b =>
  b.addEventListener("click", () => поставитьТему(b.dataset.themeSet)));

/* ── запуск ─────────────────────────────────────────────────────────────── */

async function запустить() {
  if (!await проверитьВход()) return;

  document.documentElement.setAttribute("data-dir", "b"); // растровое оформление
  try { поставитьТему(localStorage.getItem("tessera-theme") || "auto"); } catch {}
  подписатьПериод();

  await загрузитьВкладки();
  const изАдреса = location.hash.replace("#", "");
  if (state.вкладки.some(t => t.id === изАдреса)) state.tab = изАдреса;

  await загрузитьМодули();
  await загрузитьИмена();
  await нарисоватьВкладку();
  подписатьШапку();
}

addEventListener("hashchange", () => {
  const t = location.hash.replace("#", "");
  if (t && t !== state.tab && state.вкладки.some(x => x.id === t)) {
    state.tab = t;
    нарисоватьВкладку();
  }
});

let таймерРазмера = null;
addEventListener("resize", () => {
  clearTimeout(таймерРазмера);
  таймерРазмера = setTimeout(нарисоватьВкладку, 200);
});

запустить();
