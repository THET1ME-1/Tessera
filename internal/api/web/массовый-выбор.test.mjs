/* Массовый выбор кадров в ленте модерации — вживую, в браузере.
 *
 * Удержание отмечает кадр, протягивание после удержания — всё до кадра под
 * курсором, Shift+щелчок — диапазон, а пока что-то выбрано, обычный щелчок
 * по кадру отмечает его вместо того, чтобы открыть. Esc снимает выбор.
 *
 *   node массовый-выбор.test.mjs <адрес> <пароль>
 */
import { chromium } from "/home/alelx/.hermes/hermes-agent/node_modules/playwright/index.mjs";

const [URL, ПАРОЛЬ] = process.argv.slice(2);
const провалы = [];
const п = (имя, ок, д = "") => { console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (д ? " — " + д : "")); if (!ок) провалы.push(имя); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL);
await page.waitForSelector("input[type=password]:visible, [data-tab]");
const поле = await page.$("input[type=password]:visible");
if (поле) {
  await поле.fill(ПАРОЛЬ);
  await поле.press("Enter");
}
await page.click('[data-tab="moderation"]');
await page.waitForSelector(".shelf figure");
// Сетку — к верху окна: внизу кадры закрывает полоса выбора, она липкая.
await page.evaluate(() => scrollBy(0, document.querySelector(".shelf").getBoundingClientRect().top - 60));
await page.waitForTimeout(200);

const выбранные = () => page.$$eval(".shelf figure.выбран", у => у.map(f => f.dataset.id));
const центр = async i => {
  const r = await page.locator(".shelf figure .ph").nth(i).boundingBox();
  return [r.x + r.width / 2, r.y + r.height / 2];
};
const открытЛайтбокс = () => page.$(".light").then(Boolean);
const ids = await page.$$eval(".shelf figure", у => у.map(f => f.dataset.id));

// Удержание: кнопка мыши полсекунды на кадре.
let [x, y] = await центр(0);
await page.mouse.move(x, y);
await page.mouse.down();
await page.waitForTimeout(650);
await page.mouse.up();
await page.waitForTimeout(100);
п("удержание отмечает кадр", (await выбранные()).join() === ids[0], (await выбранные()).join());
п("удержание не открывает кадр", !(await открытЛайтбокс()));

// Щелчок по другому кадру, пока что-то выбрано, — отметка, не лайтбокс.
[x, y] = await центр(2);
await page.mouse.click(x, y);
await page.waitForTimeout(100);
п("щелчок в режиме выбора отмечает", (await выбранные()).includes(ids[2]), (await выбранные()).join());
п("и не открывает кадр", !(await открытЛайтбокс()));

// Повторный щелчок снимает отметку.
await page.mouse.click(x, y);
await page.waitForTimeout(100);
п("повторный щелчок снимает", !(await выбранные()).includes(ids[2]), (await выбранные()).join());

// Удержание и протягивание: от пятого до десятого.
[x, y] = await центр(5);
await page.mouse.move(x, y);
await page.mouse.down();
await page.waitForTimeout(650);
const [x2, y2] = await центр(9);
await page.mouse.move(x2, y2, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(100);
const после = await выбранные();
п("протягивание отмечает диапазон", ids.slice(5, 10).every(и => после.includes(и)), после.join());
п("протягивание не задевает лишнего", !после.includes(ids[4]) && !после.includes(ids[10]), после.join());
п("после протягивания лайтбокса нет", !(await открытЛайтбокс()));

// Shift+щелчок: от последнего отмеченного (девятый) до тринадцатого.
[x, y] = await центр(13);
await page.keyboard.down("Shift");
await page.mouse.click(x, y);
await page.keyboard.up("Shift");
await page.waitForTimeout(100);
const сШифтом = await выбранные();
п("Shift+щелчок отмечает диапазон", ids.slice(9, 14).every(и => сШифтом.includes(и)), сШифтом.join());

п("полоса выбора считает кадры",
  (await page.textContent(".shelf-pick b")).includes(String(сШифтом.length)),
  await page.textContent(".shelf-pick b"));

// Esc снимает выбор, и щелчок снова открывает кадр.
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
п("Esc снимает выбор", (await выбранные()).length === 0, (await выбранные()).join());
[x, y] = await центр(3);
await page.mouse.click(x, y);
await page.waitForTimeout(300);
п("без выбора щелчок открывает кадр", await открытЛайтбокс());

await page.screenshot({ path: process.env.SHOT || "/tmp/массовый-выбор.png" });
await browser.close();
console.log(провалы.length ? "\nПРОВАЛЫ: " + провалы.join(", ") : "\nвсё зелено");
process.exit(провалы.length ? 1 : 0);
