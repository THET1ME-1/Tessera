/* Отрисовка марок: перенесено из принятого макета без правок смысла.
   Здесь нет ни одного знания о том, что за данные рисуются, — только форма:
   столбики во весь слот с зазором в два пикселя, кусочки растра, штриховка. */

const NBSP = " ";

const fmt = n => (n === null || n === undefined) ? "—" : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

const pct = (a, b) => b ? (a / b * 100) : 0;

const pctS = (a, b, d = 1) => pct(a, b).toFixed(d).replace(".", ",") + "%";

const MONTHS = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];

const shortDate = s => { const [y, m, d] = s.split("-").map(Number); return d + NBSP + MONTHS[m - 1]; };

const tip = document.getElementById("tip");
function showTip(e, title, lines) {
  tip.innerHTML = '<span class="t2">' + title + "</span>" + lines.map(l => "<b>" + l + "</b>").join("<br>");
  tip.style.opacity = "1";
  const r = tip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY - r.height - 12;
  if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
  if (y < 8) y = e.clientY + 18;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
const hideTip = () => { tip.style.opacity = "0"; };

const SVGNS = "http://www.w3.org/2000/svg";

const el = (n, a = {}) => { const x = document.createElementNS(SVGNS, n); for (const k in a) x.setAttribute(k, a[k]); return x; };

function hatchDefs(svg, id) {
  const step = 4.6, bar = 1.7;   /* шаг растровой штриховки и толщина штриха */
  const defs = el("defs");
  const p = el("pattern", { id, width: step, height: step, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
  p.appendChild(el("rect", { width: step, height: step, fill: "var(--panel-2)" }));
  p.appendChild(el("rect", { width: bar, height: step, fill: "var(--serie-2)", opacity: .6 }));
  defs.appendChild(p); svg.appendChild(defs);
}

function columns(host, items, opt) {
  const W = Math.max(320, host.clientWidth || 900), H = opt.h || 190, bottom = opt.axis === false ? 6 : 22;
  const svg = el("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, width: "100%", height: H });
  hatchDefs(svg, "hatch");
  const plotH = H - bottom - 4;
  const max = opt.max || Math.max(...items.map(i => i.parts.reduce((s, p) => s + p.v, 0))) || 1;
  const slot = W / items.length;
  /* Ширина бруска = слот минус зазор: чем больше дней в периоде, тем уже брусок,
     до предела в 2px. Зазор и скругление задаёт направление. */
  const gap = 2;                 /* зазор между столбиками — ровно 2px */
  const style = "hatch";
  const bw = Math.max(2, slot - gap);
  const radius = 4;

  items.forEach((it, i) => {
    const cx = slot * i + slot / 2;
    let y = 4 + plotH;
    it.parts.forEach(p => {
      const hgt = (p.v / max) * plotH;
      if (hgt <= 0) return;
      y -= hgt;
      const fill = (style === "hatch" && p.hatch) ? "url(#hatch)" : p.color;
      const hh = Math.max(1, hgt - 2);
      svg.appendChild(el("rect", { x: cx - bw / 2, y: y + 1, width: bw, height: hh,
                                   rx: Math.min(radius, hh / 2), fill, opacity: it.muted ? .4 : 1 }));
      y -= 2;
    });
    if (opt.axis !== false && it.tick) {
      const t = el("text", { x: cx, y: H - 6, "text-anchor": "middle" });
      t.textContent = it.tick; svg.appendChild(t);
    }
    const hit = el("rect", { x: slot * i, y: 0, width: slot, height: H - bottom + 4, fill: "transparent" });
    hit.addEventListener("mousemove", e => showTip(e, it.tipTitle, it.tipLines));
    hit.addEventListener("mouseleave", hideTip);
    svg.appendChild(hit);
  });
  if (opt.axis !== false) svg.appendChild(el("line", { class: "axis", x1: 0, y1: H - bottom + 2, x2: W, y2: H - bottom + 2 }));
  host.appendChild(svg);
}

function spark(host, values) {
  const W = Math.max(80, host.clientWidth || 180), H = 26, max = Math.max(...values) || 1, slot = W / values.length;
  const svg = el("svg", { class: "spark", viewBox: "0 0 " + W + " " + H, width: "100%", height: H });
  const bw = Math.max(1.6, slot - 2);
  values.forEach((v, i) => {
    const h = Math.max(1, v / max * (H - 2));
    svg.appendChild(el("rect", { x: slot * i + (slot - bw) / 2, y: H - h, width: bw, height: h,
                                 rx: 2,
                                 fill: i === values.length - 1 ? "var(--accent)" : "var(--serie-2)" }));
  });
  host.appendChild(svg);
}

function screensMap(host, rows) {
  const W = Math.max(340, host.clientWidth || 900), H = 400;
  const padL = 52, padR = 18, padT = 20, padB = 40;
  const maxX = Math.max(...rows.map(r => r.hits)) * 1.1;
  const maxY = Math.max(...rows.map(r => r.sec)) * 1.15;
  const maxA = Math.max(...rows.map(r => r.min));
  const X = v => padL + (v / maxX) * (W - padL - padR);
  const Y = v => H - padB - (v / maxY) * (H - padB - padT);
  const svg = el("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, width: "100%", height: H });
  hatchDefs(svg, "hatch");

  /* сетка и оси: подписи по осям в тысячах открытий и в секундах */
  for (let i = 1; i <= 3; i++) {
    const v = maxY * i / 3.4, yy = Y(v);
    svg.appendChild(el("line", { class: "grid-l", x1: padL, x2: W - padR, y1: yy, y2: yy }));
    const t = el("text", { x: padL - 8, y: yy + 3, "text-anchor": "end" });
    t.textContent = Math.round(v) + " с"; svg.appendChild(t);
  }
  for (let i = 1; i <= 3; i++) {
    const v = maxX * i / 3.4, xx = X(v);
    const t = el("text", { x: xx, y: H - padB + 16, "text-anchor": "middle" });
    t.textContent = (v / 1000).toFixed(0) + "k"; svg.appendChild(t);
  }
  svg.appendChild(el("line", { class: "axis", x1: padL, x2: W - padR, y1: H - padB, y2: H - padB }));

  /* медианы делят поле на четыре угла — это и есть чтение карты */
  const med = a => { const b = [...a].sort((p, q) => p - q); return b[Math.floor(b.length / 2)]; };
  const mx = X(med(rows.map(r => r.hits))), my = Y(med(rows.map(r => r.sec)));
  svg.appendChild(el("line", { class: "med", x1: mx, x2: mx, y1: padT, y2: H - padB }));
  svg.appendChild(el("line", { class: "med", x1: padL, x2: W - padR, y1: my, y2: my }));
  const quad = (x, y, anchor, txt) => {
    const t = el("text", { class: "quad", x: x, y: y, "text-anchor": anchor });
    t.textContent = txt; svg.appendChild(t);
  };
  quad(padL + 6, padT + 10, "start", "редко, но надолго");
  quad(W - padR - 6, padT + 10, "end", "сердце приложения");

  /* квадрат — экран; сторона считается от суммарного времени, поэтому крупные держат внимание */
  const sorted = [...rows].sort((a, b) => b.min - a.min);
  /* подписываем пять самых «долгих» и обязательно самый частый: о нём речь в пояснении */
  const busiest = rows.reduce((a, b) => (b.hits > a.hits ? b : a));
  const named = new Set(sorted.slice(0, 5).map(r => r.n));
  named.add(busiest.n);
  const taken = [];   /* занятые высоты подписей, чтобы имена не наезжали друг на друга */
  sorted.forEach((r, i) => {
    const side = 9 + Math.sqrt(r.min / maxA) * 26;
    const cx = X(r.hits), cy = Y(r.sec);
    const g = el("g");
    g.appendChild(el("rect", { x: cx - side / 2, y: cy - side / 2, width: side, height: side, rx: 3,
      fill: i < 4 ? "var(--serie-1)" : "url(#hatch)", stroke: "var(--panel)", "stroke-width": 2 }));
    if (named.has(r.n)) {
      const right = cx < W * 0.66;
      let ty = cy + 4;
      while (taken.some(v => Math.abs(v - ty) < 13)) ty += 13;
      taken.push(ty);
      const lx = cx + (right ? side / 2 + 7 : -(side / 2 + 7));
      if (Math.abs(ty - (cy + 4)) > 6)
        g.appendChild(el("line", { x1: cx + (right ? side / 2 : -side / 2), y1: cy,
          x2: lx - (right ? 3 : -3), y2: ty - 4, stroke: "var(--line-2)", "stroke-width": 1 }));
      const t = el("text", { class: "dotlbl", x: lx, y: ty, "text-anchor": right ? "start" : "end" });
      t.textContent = nameOf(r.n); g.appendChild(t);
    }
    g.addEventListener("pointerenter", e => showTip(e, nameOf(r.n) + (named(r.n) ? " · " + r.n : ""),
      [fmt(r.hits) + " открытий" + (state.people ? " · " + fmt(r.u) + " людей·дней" : ""),
       r.sec.toFixed(0) + " с в среднем · " + fmt(r.min / 60) + " часов всего"]));
    g.addEventListener("pointerleave", hideTip);
    svg.appendChild(g);
  });
  host.appendChild(svg);
}

function rasterRows(rows, unit, val, label) {
  const maxN = Math.ceil(Math.max(...rows.map(val)) / unit);
  return [...rows].sort((a, b) => val(b) - val(a)).map(r => {
    const n = Math.max(1, Math.round(val(r) / unit));
    const cells = Array.from({ length: n }, (_, i) =>
      '<rect x="' + (i * 8) + '" y="0" width="6" height="6" rx="1.6" fill="' +
      (i < n - 1 || n === 1 ? "var(--serie-1)" : "var(--serie-2)") + '"/>').join("");
    return '<div class="rrow">' + nameCell(r.n, true) +
      '<svg viewBox="0 0 ' + (maxN * 8) + ' 6" preserveAspectRatio="xMinYMid meet">' + cells + "</svg>" +
      '<span class="rv">' + label(r) + "</span></div>";
  }).join("");
}
