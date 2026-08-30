/* Из найденной пары можно уйти в её файлы одним щелчком.
 *
 * Поиск и лента — соседние блоки, которые ничего друг о друге не знают.
 * Связывает их сам модуль: он помечает в ответе колонку, чей текст является
 * фильтром для другого блока. Панель делает такую ячейку кнопкой.
 *
 *   node поиск-переход.test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const провалы = [];
function проверка(имя, ок, добавка = "") {
  console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (добавка ? " — " + добавка : ""));
  if (!ок) провалы.push(имя);
}

const пусто_ = { addEventListener() {}, querySelector: () => ({ value: "" }) };
const мир = {
  console,
  document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  state: { внутри: {} },
  память: src => (мир.state.внутри[src] = мир.state.внутри[src] || {}),
  адрес: путь => "/tessera/" + путь.replace(/^\//, ""),
  fmt: n => String(n),
  NBSP: " ",
  взять: async () => ({}),
  сказать: () => {},
  открытьВБлоке: () => {},
};
vm.createContext(мир);
vm.runInContext(readFileSync(new URL("./blocks.js", import.meta.url), "utf8"), мир);

function нарисовать(данные) {
  const host = {
    html: "",
    set innerHTML(v) { this.html = v; },
    get innerHTML() { return this.html; },
    querySelector: () => пусто_,
    querySelectorAll: () => [],
  };
  мир.память("moderation:find").q = "rd656";
  мир.блокSearch(host, данные, { src: "moderation:find" });
  return host.html;
}

const ПАРЫ = {
  sections: [{
    title: "Пары",
    cols: ["пара", "участники", "статус"],
    rows: [["rd656e16ea471f3", "Sergey, Alina", "живая"]],
    link: { col: 0, src: "moderation:shelf", param: "group", title: "Файлы пары" },
  }],
};

const html = нарисовать(ПАРЫ);
проверка("id пары стал кнопкой", html.includes('class="cell-link"'), html.slice(0, 400));
проверка("кнопка знает, кого просить",
  html.includes('data-link-src="moderation:shelf"') && html.includes('data-link-param="group"'));
проверка("кнопка несёт сам id", html.includes('data-link-val="rd656e16ea471f3"'));
проверка("соседние ячейки остались текстом", html.includes("<td>Sergey, Alina</td>"));
проверка("подсказка модуля дошла до кнопки", html.includes("Файлы пары"));

const ЛЮДИ = {
  sections: [{ title: "Люди", cols: ["человек", "почта"], rows: [["u1", "a@b.c"]] }],
};
проверка("раздел без пометки кнопок не заводит", !нарисовать(ЛЮДИ).includes("cell-link"));

const ГРЯЗЬ = {
  sections: [{
    title: "Пары",
    cols: ["пара"],
    rows: [['ид"onmouseover="alert(1)']],
    link: { col: 0, src: "moderation:shelf", param: "group" },
  }],
};
// Разорванным атрибут был бы, попади в разметку настоящая кавычка перед
// чужим словом: `data-link-val="ид"onmouseover="…`.
const грязь = нарисовать(ГРЯЗЬ);
проверка("кавычка в значении не разрывает атрибут",
  !грязь.includes('"onmouseover'),
  грязь.slice(грязь.indexOf("<tbody>"), грязь.indexOf("</tbody>")));

// Имя человек пишет себе сам, а таблица поиска показывает его как есть.
const ИМЯ = {
  sections: [{ title: "Люди", cols: ["человек", "имя"],
               rows: [["u1", '<img src=x onerror="alert(1)">']] }],
};
const имя = нарисовать(ИМЯ);
проверка("чужое имя не втягивает разметку в панель",
  !имя.includes("<img src=x"), имя.slice(имя.indexOf("<tbody>"), имя.indexOf("</tbody>")));

console.log(провалы.length ? "\nПРОВАЛЫ: " + провалы.join(", ") : "\nвсё зелено");
process.exit(провалы.length ? 1 : 0);
