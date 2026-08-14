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
};

const $ = id => document.getElementById(id);

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
  const s = await взять("/api/state").catch(() => ({ signedIn: false, passwordSet: false }));
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
    await послать("/api/login", { password: $("pass").value });
    $("pass").value = "";
    $("gateNote").textContent = "";
    await запустить();
  } catch {
    $("gateNote").textContent = "Пароль не подошёл.";
  }
});

$("signout").addEventListener("click", async () => {
  await fetch("/api/logout", { credentials: "same-origin" });
  location.reload();
});

/* ── вкладки и раскладка ────────────────────────────────────────────────── */

async function загрузитьВкладки() {
  state.вкладки = await взять("/api/tabs");
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
    раскладка = await взять("/api/layout?tab=" + encodeURIComponent(state.tab));
  } catch (e) {
    view.innerHTML = '<p class="block-empty">Вкладка не открылась: ' + e.message + "</p>";
    return;
  }

  const блоки = раскладка.blocks || [];
  if (!блоки.length) {
    view.innerHTML = '<p class="block-empty">На этой вкладке пока нет блоков.</p>';
    return;
  }

  view.innerHTML = '<div class="grid">' + блоки.map((b, i) =>
    '<section class="panel c' + (b.span || 12) + '">' +
      '<div class="panel-head"><span class="lbl">' + b.title + "</span>" +
      // Владельца подписываем, только когда он не ядро: «core» у каждого
      // второго блока — шум, а имя модуля объясняет, откуда взялись числа.
      (b.src.startsWith("core:") ? "" :
        '<span class="lbl">' + (модули[b.src.split(":")[0]] || b.src.split(":")[0]) + "</span>") +
      "</div>" +
      '<div id="блок-' + i + '"><p class="block-empty">…</p></div>' +
    "</section>").join("") + "</div>";

  // Запросы идут разом: один медленный источник не держит остальные.
  блоки.forEach((b, i) => {
    const host = $("блок-" + i);
    const адрес = "/api/block?src=" + encodeURIComponent(b.src) +
      "&range=" + encodeURIComponent(state.range) +
      (state.app ? "&app=" + encodeURIComponent(state.app) : "");
    взять(адрес)
      .then(d => нарисовать(host, b.type, d))
      .catch(e => {
        host.innerHTML = '<p class="block-empty">' +
          (e.message.includes("не отвечал") ? "Модуль ещё не присылал данные."
                                            : "Источник не ответил: " + e.message) + "</p>";
      });
  });
}

async function загрузитьМодули() {
  const список = await взять("/api/modules").catch(() => []);
  список.forEach(m => { модули[m.id] = m.name; });
}

/* Строка контекста: сколько событий в базе и за какой срок они живут. */
async function подписатьШапку() {
  try {
    const d = await взять("/api/block?src=core:events_total&range=" + state.range);
    $("ctx-events").textContent = fmt(d.value);
  } catch { $("ctx-events").textContent = "—"; }
}

/* ── словарь имён ───────────────────────────────────────────────────────── */

async function загрузитьИмена() {
  const d = await взять("/api/labels?app=" + encodeURIComponent(state.app)).catch(() => ({}));
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
      await послать("/api/labels", { app: state.app, key: ключ, title: имя === ключ ? "" : имя });
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
