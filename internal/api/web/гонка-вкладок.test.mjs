/* Вкладка модуля открывается, даже если её нажали, пока грузилось ядро.
 *
 * Ловит поломку 18.09.2026: панель проверяла, своя ли вкладка открыта, ДО
 * загрузки данных ядра, а рисовала ПОСЛЕ. Ответ `/api/core` на проде идёт
 * секунду и дольше; нажал «Розыгрыш», пока грузился обзор, — ядро досчиталось
 * и попыталось нарисовать «club» своим экраном. Вместо блоков модуля оставалась
 * строка «Вкладка не открылась: ЯДРО[state.tab] is not a function».
 *
 * Задержку ответа ядра делает сам тест, поэтому он годится и для пустой базы.
 *
 *   node гонка-вкладок.test.mjs <адрес> <пароль>
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
// Форма входа показывается после ответа сервера, на проде это дольше полсекунды.
await page.waitForSelector("input[type=password]:visible, [data-tab]");
const поле = await page.$("input[type=password]:visible");
if (поле) {
  await поле.fill(ПАРОЛЬ);
  await page.keyboard.press("Enter");
}
await page.waitForSelector('[data-tab="club"]');
await page.waitForTimeout(1500);

// Дальше ядро отвечает медленно, как на проде с холодным кэшем.
await page.route(/\/api\/core/, async route => {
  await new Promise(r => setTimeout(r, 1500));
  await route.continue();
});

// Смена периода сбрасывает кэш ядра, и вкладка идёт за данными заново.
// Период живёт в фильтре «Экранов».
await page.click('[data-tab="screens"]');
await page.waitForSelector('[data-range-s="7d"]', { timeout: 15000 });
await page.click('[data-range-s="7d"]');
await page.waitForTimeout(200);
await page.click('[data-tab="club"]');
await page.waitForTimeout(3500);

const вид = await page.evaluate(() => ({
  текст: document.getElementById("view").innerText,
  блоков: document.querySelectorAll("#view .card").length,
  вкладка: document.querySelector('.nav a[aria-current="page"]')?.dataset.tab,
}));
проверка("нет строки «не открылась»", !вид.текст.includes("не открылась"),
  вид.текст.split("\n")[0]);
проверка("блоки модуля на месте", вид.блоков > 0, "блоков " + вид.блоков);
проверка("выбрана вкладка «Розыгрыш»", вид.вкладка === "club", вид.вкладка);

// Два экрана ядра подряд, пока ядро грузилось: открыться должен второй, и
// запоздавший первый не имеет права перерисовать его своим.
await page.click('[data-tab="overview"]');
await page.waitForTimeout(150);
await page.click('[data-tab="people"]');
await page.waitForTimeout(4500);
const люди = await page.evaluate(() => ({
  текст: document.getElementById("view").innerText,
  вкладка: document.querySelector('.nav a[aria-current="page"]')?.dataset.tab,
}));
проверка("на «Людях» нарисованы «Люди», а не запоздавший обзор",
  люди.текст.includes("Приход и возврат") && !люди.текст.includes("Куда уходит время"), люди.текст.split("\n")[0]);
проверка("экран ядра после быстрой смены открылся", !люди.текст.includes("не открылась"),
  люди.текст.split("\n")[0]);
проверка("выбрана вкладка «Люди»", люди.вкладка === "people", люди.вкладка);

await browser.close();
if (провалы.length) {
  console.log("\nПровалов: " + провалы.length);
  process.exit(1);
}
console.log("\nВсё сходится.");
