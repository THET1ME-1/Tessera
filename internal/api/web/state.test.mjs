/* Состояние внутри блоков переживает то, что делает браузер телефона.
 *
 * Ловит две поломки, найденные 15.08.2026:
 *   • панель перерисовывалась на любое `resize`, а телефон шлёт его при каждом
 *     листании — прячется адресная строка. Лента прыгала на первую страницу,
 *     набранный запрос стирался, и со стороны это выглядело как «страница сама
 *     обновляется каждую минуту»;
 *   • кадры ленты грузились по адресу от корня домена, хотя панель живёт в
 *     подпапке, — миниатюр не было вовсе.
 *
 *   node state.test.mjs <адрес> <пароль>
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto(URL);
await page.waitForTimeout(600);
const поле = await page.$("input[type=password]");
if (поле) {
  await поле.fill(ПАРОЛЬ);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2500);
}

await page.goto(URL + "/#moderation");
await page.waitForTimeout(2600);

// ── миниатюры ──
const кадры = await page.evaluate(async () => {
  const img = document.querySelector(".shelf img");
  if (!img) return { есть: false };
  await new Promise(r => (img.complete ? r() : (img.onload = img.onerror = r)));
  return { есть: true, src: img.getAttribute("src"), ширина: img.naturalWidth };
});
проверка("кадры в ленте есть", кадры.есть);
// Панель живёт и в корне (свой порт), и в подпапке (/tessera/ за Caddy).
// Правильный адрес — от того места, откуда пришла страница; проверяем это,
// а не наличие ведущего слэша.
const база = await page.evaluate(() => location.pathname.replace(/[^/]*$/, ""));
проверка("адрес кадра построен от места панели",
  !!кадры.src && кадры.src.startsWith(база), "база «" + база + "», адрес " + кадры.src);
проверка("картинка действительно загрузилась", (кадры.ширина || 0) > 0,
  "ширина " + кадры.ширина);

// ── листаем ленту и дёргаем высоту, как браузер телефона ──
const дальше = await page.$(".shelf-nav [data-page]:not([disabled])");
if (дальше) {
  await дальше.click();
  await page.waitForTimeout(1800);
}
const страницаДо = await page.evaluate(() =>
  (document.querySelector(".shelf-nav .lbl") || {}).textContent || "");

await page.setViewportSize({ width: 390, height: 720 });   // спряталась адресная строка
await page.waitForTimeout(900);
const страницаПосле = await page.evaluate(() =>
  (document.querySelector(".shelf-nav .lbl") || {}).textContent || "");
проверка("листание не сбрасывается при смене высоты окна",
  страницаДо === страницаПосле && /2/.test(страницаДо),
  "было «" + страницаДо.trim() + "», стало «" + страницаПосле.trim() + "»");

// ── поиск переживает то же самое ──
const поиск = await page.$(".search-row input");
if (поиск) {
  await поиск.fill("ksyu");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2200);
  const нашлось = await page.evaluate(() =>
    document.querySelectorAll(".search-row").length &&
    document.querySelectorAll("table tbody tr").length);
  проверка("поиск отвечает", нашлось > 0, "строк " + нашлось);

  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(900);
  const после = await page.evaluate(() => ({
    запрос: (document.querySelector(".search-row input") || {}).value || "",
    строк: document.querySelectorAll("table tbody tr").length,
  }));
  проверка("запрос и найденное не стёрлись", после.запрос === "ksyu" && после.строк > 0,
    "в поле «" + после.запрос + "», строк " + после.строк);
}

// ── поворот экрана: ширина меняется, перерисовка нужна ──
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(1200);
const живо = await page.evaluate(() => !!document.querySelector(".panel"));
проверка("после поворота панель на месте", живо);

await browser.close();
console.log("\nитог: провалов " + провалы.length + (провалы.length ? " — " + провалы.join(", ") : ""));
process.exit(провалы.length ? 1 : 0);
