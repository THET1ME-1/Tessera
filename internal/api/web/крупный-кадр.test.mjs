/* Лайтбокс показывает крупный кадр, а не ту же плитку.
 *
 * Ловит поломку 19.08.2026: в ленте адрес кадра несёт готовый `path` к файлу
 * 512 — так ядро отдаёт плитку, не поднимая процесс модуля. Лайтбокс брал тот
 * же адрес и дописывал `&w=1600`, но ядро, увидев path, размер игнорирует, и
 * на весь экран растягивалась миниатюра.
 *
 *   node крупный-кадр.test.mjs
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";

const провалы = [];
const п = (имя, ок, д = "") => { console.log((ок ? "ОК   " : "ПЛОХО") + " " + имя + (д ? " — " + д : "")); if (!ок) провалы.push(имя); };

const мир = {
  console, document: { getElementById: () => null },
  localStorage: { getItem: () => null, setItem: () => {} },
  state: { внутри: {} },
  память: src => (мир.state.внутри[src] = мир.state.внутри[src] || {}),
  адрес: путь => "/tessera/" + путь.replace(/^\//, ""),
  fmt: n => String(n), NBSP: " ", взять: async () => ({}), сказать: () => {},
  URLSearchParams, Image: class { set src(v) { this._s = v; } get src() { return this._s; } },
};
vm.createContext(мир);
vm.runInContext(readFileSync(new URL("./blocks.js", import.meta.url), "utf8"), мир);

const сПутём = "/api/file?src=moderation:thumb&id=8niveuqzc2sxs4a&type=image/webp" +
  "&path=%2Fopt%2Fpocketbase%2Fpb_data%2Fthumb_cache%2F8niveuqzc2sxs4a_512.webp";
const крупный = мир.крупныйКадр(сПутём);
п("готовый путь к плитке убран", !крупный.includes("path="), крупный);
п("размер просят крупный", крупный.includes("w=1600"), крупный);
п("кадр остался тот же", крупный.includes("id=8niveuqzc2sxs4a"));
п("адрес считается от места панели", крупный.startsWith("/tessera/api/file"));

// Кадр без готовой миниатюры приходит коротким адресом — он тоже обязан
// открываться крупным.
const безПути = "/api/file?src=moderation:thumb&id=abc123";
const крупный2 = мир.крупныйКадр(безПути);
п("короткий адрес получает размер", крупный2.includes("w=1600"), крупный2);
// Прежний размер в адресе заменяется, а не приписывается вторым.
const сРазмером = "/api/file?src=moderation:thumb&id=abc123&w=512";
п("размер не дублируется",
  (мир.крупныйКадр(сРазмером).match(/w=/g) || []).length === 1 &&
    мир.крупныйКадр(сРазмером).includes("w=1600"),
  мир.крупныйКадр(сРазмером));

console.log(провалы.length ? "\nПРОВАЛЫ: " + провалы.join(", ") : "\nвсё зелено");
process.exit(провалы.length ? 1 : 0);
