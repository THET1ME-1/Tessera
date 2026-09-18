/* Таблица модуля показывает текст текстом, а числа числами.
 *
 * Ловит поломку 18.09.2026: блок `table` прогонял через формат чисел каждую
 * колонку после первой. У розыгрыша в «Последних участниках» откуда, почта,
 * приложение и пара стояли сплошным NaN, а «Покупки по магазинам» в доходе
 * падали целиком: «данные не разобрались: v.toFixed is not a function» —
 * колонка «Где» текстовая, а формат у таблицы денежный.
 *
 * Рендерер зовётся напрямую, поэтому тест годится и для пустой базы.
 *
 *   node таблица-с-текстом.test.mjs <адрес> <пароль>
 */
import { chromium } from "/home/alelx/.hermes/hermes-agent/node_modules/playwright/index.mjs";

const URL = process.argv[2] || "http://127.0.0.1:8101";
const ПАРОЛЬ = process.argv[3];
const провалы = [];

function проверка(имя, ок, добавка = "") {
  console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (добавка ? " — " + добавка : ""));
  if (!ок) провалы.push(имя);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL);
await page.waitForSelector("input[type=password]:visible, [data-tab]");
const поле = await page.$("input[type=password]:visible");
if (поле) {
  await поле.fill(ПАРОЛЬ);
  await page.keyboard.press("Enter");
}
await page.waitForSelector("[data-tab]");

const нарисовать = данные => page.evaluate(d => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  try {
    блокTable(host, d);
  } catch (e) {
    return { ошибка: e.message };
  }
  const ячейки = [...host.querySelectorAll("tbody tr")].map(tr =>
    [...tr.querySelectorAll("td")].map(td => td.textContent.trim()));
  const шапка = [...host.querySelectorAll("thead th")].map(th => th.textContent.trim());
  host.remove();
  return { ячейки, шапка };
}, данные);

// ── розыгрыш: строки из текста, полоса выключена ──
const розыгрыш = await нарисовать({
  cols: ["Когда", "Откуда", "Почта", "Приложение", "Пара", "Последний заход"],
  barCol: -1,
  rows: [["2026-09-18 13:55", "playboysparty", "a@b.ru", "ios", "—", "2026-09-18"]],
});
проверка("розыгрыш рисуется без ошибки", !розыгрыш.ошибка, розыгрыш.ошибка);
const строка = (розыгрыш.ячейки || [[]])[0];
проверка("в строке нет NaN", !строка.some(v => v.includes("NaN")), строка.join(" | "));
проверка("почта и откуда видны как есть",
  строка.includes("a@b.ru") && строка.includes("playboysparty"), строка.join(" | "));
проверка("без полосы нет колонки «Доля»", !(розыгрыш.шапка || []).includes("Доля"),
  (розыгрыш.шапка || []).join(" | "));

// ── доход: деньги в долларах, штуки без доллара, магазин текстом ──
const покупки = await нарисовать({
  cols: ["Покупка", "Где", "Штук", "Денег", "Средний чек"],
  rows: [["Togetherly+", "Google Play", 3, 12.5, 4.17]],
  barCol: 3, format: "money", formats: ["", "", "", "money", "money"],
});
проверка("покупки рисуются без ошибки", !покупки.ошибка, покупки.ошибка);
const п = (покупки.ячейки || [[]])[0];
проверка("магазин текстом", п[1] === "Google Play", п[1]);
проверка("штуки без доллара", п[2] === "3", п[2]);
проверка("деньги с долларом", /12,50\s\$/.test(п[3] || ""), п[3]);

// ── прежний договор: одна форма на всю таблицу, полоса по второй колонке ──
const источники = await нарисовать({
  cols: ["Источник", "Сегодня", "Месяц"],
  rows: [["lava", 9.8, 448.2], ["Play", 0, 12]],
  barCol: 2, format: "money",
});
const и = (источники.ячейки || [[]])[0];
проверка("старый формат таблицы не сломан", /9,80\s\$/.test(и[1] || "") && /448,20\s\$/.test(и[2] || ""),
  и.join(" | "));
проверка("полоса на месте", (источники.шапка || []).includes("Доля"));

await browser.close();
if (провалы.length) {
  console.log("\nПровалов: " + провалы.length);
  process.exit(1);
}
console.log("\nВсё сходится.");
