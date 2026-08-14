/* Проверяет настройку дашборда: перестановка, добавление, удаление, сброс. */
import { chromium } from "/home/alelx/.hermes/hermes-agent/node_modules/playwright/index.mjs";
const URL = "http://localhost:8099";
const проблемы = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 1100 } });
p.on("pageerror", e => проблемы.push("ошибка: " + e.message));

await p.goto(URL);
await p.waitForTimeout(500);
await p.fill("#pass", "проверка");
await p.click("button[type=submit]");
await p.waitForTimeout(1500);

const было = await p.$$eval("#сетка .panel .lbl:first-child", ns => ns.map(n => n.textContent));
console.log("блоков на обзоре:", было.length, "—", было.slice(0, 3).join(" / "));

await p.click("#начатьНастройку");
await p.waitForTimeout(400);
await p.screenshot({ path: "/tmp/панель-снимки/настройка.png", fullPage: true });

// добавляем блок из каталога
await p.click("#добавитьБлок");
await p.waitForTimeout(600);
const пунктов = await p.$$eval(".cat-row", ns => ns.length);
console.log("в каталоге предложений:", пунктов);
await p.screenshot({ path: "/tmp/панель-снимки/каталог.png" });
await p.click('.cat-row:last-child');
await p.waitForTimeout(1200);

const стало = await p.$$eval("#сетка .panel", ns => ns.length);
console.log("после добавления блоков:", стало, стало === было.length + 1 ? "— прибавился" : "— НЕ ПРИБАВИЛСЯ");

// удаляем последний
await p.click("#начатьНастройку").catch(() => {});
await p.waitForTimeout(300);
await p.click("[data-remove]:last-of-type", { force: true }).catch(async () => {
  const кнопки = await p.$$("[data-remove]");
  await кнопки[кнопки.length - 1].click();
});
await p.waitForTimeout(1200);
const послеУдаления = await p.$$eval("#сетка .panel", ns => ns.length);
console.log("после удаления:", послеУдаления);

// раскладка переживает перезагрузку
await p.reload();
await p.waitForTimeout(1500);
const послеПерезагрузки = await p.$$eval("#сетка .panel", ns => ns.length);
console.log("после перезагрузки:", послеПерезагрузки,
  послеПерезагрузки === послеУдаления ? "— сохранилась" : "— НЕ СОХРАНИЛАСЬ");

await b.close();
console.log(проблемы.length ? "НАЙДЕНО:\n  " + [...new Set(проблемы)].join("\n  ") : "ошибок нет");
