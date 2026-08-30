/* В лайтбоксе есть кнопка «Скачать оригинал».
 *
 * Лента показывает миниатюры: webp, обрезанные по длинной стороне. Для жалобы
 * нужен файл как есть, и достать его иначе неоткуда — исходники лежат в
 * бакете, а не на диске.
 *
 * Адрес приносит модуль полем `download`: панель не знает ни его ключей, ни
 * того, что у кадра вообще бывает исходник. Нет поля — нет и кнопки.
 *
 *   node скачать-оригинал.test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const провалы = [];
const п = (имя, ок, д = "") => { console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (д ? " — " + д : "")); if (!ок) провалы.push(имя); };

/* Хватает того, что трогает лайтбокс: узел помнит разметку, слушателей и
   выданные по селектору узлы. Настоящего DOM тут нет и не нужно. */
function узел() {
  return {
    className: "", innerHTML: "", dataset: {}, дети: [], слушатели: {}, выданные: {},
    addEventListener(имя, f) { (this.слушатели[имя] = this.слушатели[имя] || []).push(f); },
    appendChild(д) { this.дети.push(д); return д; },
    remove() { this.удалён = true; },
    querySelector(сел) { return (this.выданные[сел] = this.выданные[сел] || узел()); },
    querySelectorAll() { return []; },
    isConnected: true,
  };
}

const созданные = [];
const мир = {
  console,
  document: {
    getElementById: () => null,
    createElement: () => { const у = узел(); созданные.push(у); return у; },
    body: узел(),
  },
  localStorage: { getItem: () => null, setItem: () => {} },
  state: { внутри: {} },
  память: src => (мир.state.внутри[src] = мир.state.внутри[src] || {}),
  адрес: путь => "/tessera/" + путь.replace(/^\//, ""),
  fmt: n => String(n), NBSP: " ", взять: async () => ({}), сказать: () => {},
  URLSearchParams, addEventListener: () => {}, removeEventListener: () => {},
  Image: class { set src(v) { this._s = v; } get src() { return this._s; } },
};
vm.createContext(мир);
vm.runInContext(readFileSync(new URL("./blocks.js", import.meta.url), "utf8"), мир);

const кадр = {
  id: "8niveuqzc2sxs4a",
  url: "/api/file?src=moderation:thumb&id=8niveuqzc2sxs4a",
  caption: "Воспоминания",
  group: "rbede7877a819da",
  download: "/api/file?src=moderation:original&id=8niveuqzc2sxs4a&download=1",
};

мир.открытьКадр([кадр], 0);
const слой = созданные[созданные.length - 1];
п("кнопка нарисована", /Скачать оригинал/.test(слой.innerHTML), слой.innerHTML.slice(0, 220));
п("ведёт на оригинал", слой.innerHTML.includes("moderation:original"));
п("просит скачать, а не показать", /\sdownload[\s>]/.test(слой.innerHTML));
п("адрес считается от места панели",
  слой.innerHTML.includes('href="/tessera/api/file?src=moderation:original'));

// Клик по слою закрывает лайтбокс. Кнопка лежит внутри слоя, и без остановки
// всплытия кадр закрывался бы раньше, чем браузер успевал начать скачивание.
const кнопка = слой.выданные[".light-dl"];
п("на кнопке есть свой обработчик клика", !!(кнопка && (кнопка.слушатели.click || []).length));
let остановлено = false;
(кнопка.слушатели.click || []).forEach(f => f({ stopPropagation: () => { остановлено = true; } }));
п("клик по кнопке не всплывает до закрытия", остановлено);

// Кадр без исходника — например, из модуля, который такого не умеет.
созданные.length = 0;
мир.открытьКадр([{ ...кадр, download: undefined }], 0);
const пустой = созданные[созданные.length - 1];
п("без адреса кнопки нет", !/Скачать оригинал/.test(пустой.innerHTML));

console.log(провалы.length ? "\nПРОВАЛЫ: " + провалы.join(", ") : "\nвсё зелено");
process.exit(провалы.length ? 1 : 0);
