/* Щелчок по паре из поиска доводит ленту до её файлов.
 *
 * Блоки друг о друге не знают: цель названа в ответе модуля, а панель ищет её
 * среди блоков вкладки. Если ленты на вкладке нет (её убрали в настройке),
 * человек должен услышать почему, а не смотреть в ничего не изменившуюся
 * таблицу.
 *
 *   node переход-в-ленту.test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const провалы = [];
function проверка(имя, ок, добавка = "") {
  console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (добавка ? " — " + добавка : ""));
  if (!ок) провалы.push(имя);
}

const сказанное = [];
const прокручено = [];
const секция = { scrollIntoView: () => прокручено.push(true) };
const host = { innerHTML: "", closest: () => секция };
const мир = {
  console,
  document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  state: {
    внутри: {},
    блоки: [{ src: "core:events", type: "stat" },
            { src: "moderation:shelf", type: "shelf", title: "Лента" }],
  },
  память: src => (мир.state.внутри[src] = мир.state.внутри[src] || {}),
  адрес: путь => "/tessera/" + путь.replace(/^\//, ""),
  $: id => (id === "блок-1" ? host : null),
  fmt: n => String(n),
  NBSP: " ",
  взять: async () => ({}),
  сказать: т => сказанное.push(т),
};
vm.createContext(мир);
vm.runInContext(readFileSync(new URL("./blocks.js", import.meta.url), "utf8"), мир);

const загружено = [];
мир.загрузитьЛенту = (h, src) => { загружено.push([h, src]); };

await мир.открытьВБлоке("moderation:shelf", { group: "rd656e16ea471f3", page: 0 });
проверка("фильтр лёг в память ленты",
  мир.state.внутри["moderation:shelf"].group === "rd656e16ea471f3");
проверка("ленту попросили перечитать",
  загружено.length === 1 && загружено[0][0] === host && загружено[0][1] === "moderation:shelf");
проверка("страница ленты сброшена на первую",
  мир.state.внутри["moderation:shelf"].page === 0);
проверка("лента подвинута под глаза", прокручено.length === 1);

await мир.открытьВБлоке("income:table", { period: "август" });
проверка("нет такого блока — говорим человеку", сказанное.length === 1, сказанное.join(" / "));
проверка("и ничего не грузим", загружено.length === 1);

console.log(провалы.length ? "\nПРОВАЛЫ: " + провалы.join(", ") : "\nвсё зелено");
process.exit(провалы.length ? 1 : 0);
