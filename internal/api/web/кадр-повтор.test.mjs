/* Плитка без кадра переспрашивает его, а не стоит заглушкой навсегда.
 *
 * Генератор делает низ страницы фоном, и кадр появляется на диске через
 * несколько секунд после показа ленты. 19.10.2026 плитка на первом же 404
 * ставила «кадр ещё готовится» и больше не спрашивала: кадр давно лежал на
 * диске, а модератор видел заглушку, пока не перерисует ленту.
 *
 * Проверяется без браузера: файл заготовок исполняется в песочнице, часы и
 * картинка подставляются снаружи.
 *
 *   node кадр-повтор.test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const провалы = [];
function проверка(имя, ок, добавка = "") {
  console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (добавка ? " — " + добавка : ""));
  if (!ок) провалы.push(имя);
}

const таймеры = [];
const мир = {
  console,
  URL,
  document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  state: { внутри: {} },
  память: () => ({}),
  адрес: путь => "/tessera/" + путь.replace(/^\//, ""),
  fmt: n => String(n),
  NBSP: " ",
  взять: async () => ({}),
  сказать: () => {},
  setTimeout: (дело, мс) => { таймеры.push({ дело, мс }); return таймеры.length; },
};
vm.createContext(мир);
vm.runInContext(readFileSync(new URL("./blocks.js", import.meta.url), "utf8"), мир);

function плитка() {
  const классы = new Set();
  const ph = {
    classList: {
      add: к => классы.add(к),
      remove: к => классы.delete(к),
      contains: к => классы.has(к),
    },
  };
  const img = {
    src: "https://admin.togetherly.day/tessera/api/file?src=moderation:thumb&id=abc&path=%2Fx%2Fabc_512.webp",
    loading: "lazy",
    dataset: {},
    isConnected: true,
    onload: null,
    closest: () => ph,
  };
  return { ph, img };
}

const { ph, img } = плитка();
мир.кадрНеПришёл(img);
проверка("на отказе плитка показывает заглушку", ph.classList.contains("нет"));
проверка("и через три секунды спрашивает кадр снова", таймеры.length === 1 && таймеры[0].мс === 3000,
  JSON.stringify(таймеры.map(т => т.мс)));

таймеры[0].дело();
проверка("повтор идёт новым адресом, чтобы браузер не взял отказ из памяти",
  new URL(img.src).searchParams.get("r") === "1", img.src);
проверка("и не ленивой загрузкой: под заглушкой картинка скрыта и лениво не грузится",
  img.loading === "eager");
проверка("прежние параметры адреса на месте", new URL(img.src).searchParams.get("id") === "abc");

img.onload();
проверка("пришедший кадр снимает заглушку", !ph.classList.contains("нет"));

const второй = плитка();
таймеры.length = 0;
for (let i = 0; i < 4; i++) {
  мир.кадрНеПришёл(второй.img);
  if (таймеры[i]) таймеры[i].дело();
}
проверка("попыток три, дальше заглушка остаётся", таймеры.length === 3,
  JSON.stringify(таймеры.map(т => т.мс)));
проверка("паузы растут", таймеры.map(т => т.мс).join() === "3000,8000,20000");

const отсоединённая = плитка();
таймеры.length = 0;
мир.кадрНеПришёл(отсоединённая.img);
отсоединённая.img.isConnected = false;
const прежний = отсоединённая.img.src;
таймеры[0].дело();
проверка("ушедшую со страницы плитку не дёргаем", отсоединённая.img.src === прежний);

const разметка = мир.разметкаКадра({ id: "abc", url: "/api/file?src=moderation:thumb&id=abc", caption: "кадр" }, 0, false);
проверка("плитка ленты зовёт повтор на отказе картинки", разметка.includes('onerror="кадрНеПришёл(this)"'), разметка);

if (провалы.length) {
  console.log("\nне прошло: " + провалы.length);
  process.exit(1);
}
console.log("\nвсё прошло");
