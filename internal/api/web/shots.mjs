/* Проверяет живую панель: вход, вкладки, блоки, темы, телефон. */
import { chromium } from "/home/alelx/.hermes/hermes-agent/node_modules/playwright/index.mjs";
import { mkdirSync } from "fs";
const OUT = "/tmp/панель-снимки";
mkdirSync(OUT, { recursive: true });
const URL = "http://localhost:8099";

const проблемы = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.on("console", m => { if (m.type() === "error") проблемы.push("консоль: " + m.text()); });
page.on("pageerror", e => проблемы.push("ошибка страницы: " + e.message));

await page.goto(URL);
await page.waitForTimeout(600);
await page.screenshot({ path: OUT + "/вход.png" });

await page.fill("#pass", "проверка");
await page.click("button[type=submit]");
await page.waitForTimeout(1500);

const вкладки = await page.$$eval("[data-tab]", ns => ns.map(n => n.textContent.trim()));
console.log("вкладки:", вкладки.join(" · "));

for (const t of ["overview", "screens", "people", "product"]) {
  await page.goto(URL + "#" + t);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/${t}.png`, fullPage: true });
  const пусто = await page.$$eval(".block-empty", ns => ns.map(n => n.textContent.trim()));
  if (пусто.length) console.log(`  ${t}: пустых блоков ${пусто.length} — ${пусто.slice(0,2).join(" / ")}`);
  const wide = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (wide) проблемы.push(`вкладка ${t}: страница едет вбок`);
}

await page.goto(URL + "#overview");
await page.waitForTimeout(1200);
await page.click('[data-theme-set="dark"]');
await page.waitForTimeout(400);
await page.screenshot({ path: OUT + "/тёмная.png", fullPage: true });

const phone = await browser.newPage({ viewport: { width: 393, height: 852 } });
await phone.goto(URL);
await phone.waitForTimeout(500);
await phone.fill("#pass", "проверка");
await phone.click("button[type=submit]");
await phone.waitForTimeout(1500);
await phone.screenshot({ path: OUT + "/телефон.png", fullPage: true });

await browser.close();
console.log(проблемы.length ? "НАЙДЕНО:\n  " + [...new Set(проблемы)].join("\n  ") : "ошибок нет");
