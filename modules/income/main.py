#!/usr/bin/env python3
"""Модуль «Доход»: показывает деньги из рекламных кабинетов и магазинов.

Модуль НЕ ходит в чужие API сам. Он читает готовые сводки, которые кладёт
отдельный сбор по расписанию, и превращает их в блоки панели.

Так сделано намеренно. Поход в четыре чужих кабинета — дело долгое, с ключами,
лимитами и отказами; складывать его в путь запроса от панели значит получить
экран, который грузится минуту и падает, когда у Google плохой день. Сбор
отвечает за «сходить и записать», модуль — за «показать записанное».

    python3 main.py collect            все блоки разом
    python3 main.py query month '{}'   один блок

Откуда читать, задаётся в module.json:

    "files": { "summary": "/opt/.../.income.json",
               "history": "/opt/.../.income_history.json" }
"""

import json
import os
import sys

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))


def настройки():
    with open(os.path.join(ЗДЕСЬ, "module.json"), encoding="utf-8") as f:
        return json.load(f).get("files", {})


def прочитать(путь):
    """Сводки пишутся ASCII-экранированными, поэтому кодировку не угадываем."""
    if not путь or not os.path.exists(путь):
        return None
    try:
        with open(путь, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print(f"{путь}: {e}", file=sys.stderr)
        return None


def деньги(v):
    return 0.0 if v is None else round(float(v), 2)


# ── блоки ───────────────────────────────────────────────────────────────────

def блоки(сводка, история):
    итог = {}
    if not сводка:
        return итог

    totals = сводка.get("totals", {})
    источники = сводка.get("sources", {})
    месяцы = (история or {}).get("months", [])

    # Плитки за периоды. Разбивка под числом — сколько дал каждый источник.
    части = [{"name": д.get("title", ключ), "value": деньги(д.get("month"))}
             for ключ, д in источники.items() if д.get("ok")]
    части.sort(key=lambda p: -p["value"])

    прирост = None
    if len(месяцы) >= 2 and месяцы[-2].get("total"):
        было, стало = месяцы[-2]["total"], месяцы[-1]["total"]
        прирост = (стало - было) / было * 100

    итог["month"] = {"value": деньги(totals.get("month")), "sub": "с начала месяца",
                     "format": "money", "parts": части}
    if прирост is not None:
        итог["month"]["delta"] = прирост

    заСегодня = [{"name": д.get("title", к), "value": деньги(д.get("today"))}
                 for к, д in источники.items() if д.get("ok") and д.get("today")]
    заСегодня.sort(key=lambda p: -p["value"])
    итог["today"] = {"value": деньги(totals.get("today")), "sub": "с полуночи",
                     "format": "money", "parts": заСегодня}
    итог["yesterday"] = {"value": деньги(totals.get("yesterday")), "sub": "полные сутки",
                         "format": "money"}

    # История собирается ночью, а сводка обновляется каждые двадцать минут.
    # Без поправки год оказывается меньше собственного последнего месяца.
    годы = (история or {}).get("years", [])
    за_год = деньги(годы[0].get("total")) if годы else 0
    if месяцы and totals.get("month") is not None:
        за_год = деньги(за_год - деньги(месяцы[-1].get("total")) + деньги(totals.get("month")))
    итог["year"] = {"value": за_год, "format": "money",
                    "sub": f"за {годы[0].get('y')} год, с поправкой на сегодня" if годы else "за год"}

    # Таблица источников: сегодня, месяц и прошлый месяц рядом.
    строки = []
    for ключ, д in источники.items():
        if not д.get("ok"):
            # Источник без ключа не ломает сводку: он честно говорит, что не
            # подключён, иначе непонятно, почему в сумме нет рекламы Google.
            строки.append([д.get("title", ключ), None, None, None])
            continue
        строки.append([д.get("title", ключ), деньги(д.get("today")),
                       деньги(д.get("month")), деньги(д.get("prev_month"))])
    строки.sort(key=lambda r: -(r[2] or 0))
    итог["sources"] = {"cols": ["Источник", "Сегодня", "Месяц", "Прошлый месяц"],
                       "rows": строки, "barCol": 2, "format": "money"}

    # Месяцы столбиками.
    if месяцы:
        итог["history"] = {
            "items": [{"label": м["m"], "parts": [{"v": деньги(м.get("total"))}]} for м in месяцы],
            "unit": "долларов", "format": "money",
        }

    # Продажи: сколько людей купили и каким путём.
    продано = сводка.get("sold", {})
    if продано:
        каналы = продано.get("plus", {})
        итог["sold"] = {
            "value": продано.get("plus_total", 0),
            "sub": "оплат полного доступа",
            "parts": [{"name": имя, "value": число} for имя, число in каналы.items()],
        }

    # География рекламы: у кого её показывают.
    рся = источники.get("rsya", {})
    if рся.get("geo"):
        итог["geo"] = {"rows": [{"name": g["name"], "value": деньги(g["v"])} for g in рся["geo"][:8]],
                       "unit": 1, "unitLabel": "долларов на кусочек", "format": "money"}
    if рся.get("os"):
        итог["os"] = {"items": [{"name": o["name"], "value": деньги(o["v"])} for o in рся["os"]],
                      "format": "money"}

    # Оговорки источников — на видном месте, а не в чужой голове.
    оговорки = [f"{д.get('title', к)}: {д['note'].rstrip('.')}." for к, д in источники.items()
                if д.get("note")]
    курс = сводка.get("rates", {}).get("rub_per_usd")
    if курс:
        оговорки.append(f"Рубли и евро приведены к доллару по курсу дня сборки: {round(курс, 2)} ₽.")
    if оговорки:
        итог["notes"] = {"text": " ".join(оговорки)}

    return итог


def собрать(ключи=None):
    f = настройки()
    сводка = прочитать(f.get("summary"))
    if сводка is None:
        print(f"сводки нет по пути {f.get('summary')!r}: поправьте \"files\" в module.json",
              file=sys.stderr)
        sys.exit(1)
    все = блоки(сводка, прочитать(f.get("history")))
    return {k: v for k, v in все.items() if not ключи or k in ключи}


def main():
    команда = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if команда == "collect":
        print(json.dumps(собрать(), ensure_ascii=False))
    elif команда == "query":
        if len(sys.argv) < 3:
            print("нужен ключ: main.py query <ключ> '{}'", file=sys.stderr)
            sys.exit(1)
        ключ = sys.argv[2]
        д = собрать([ключ])
        if ключ not in д:
            print(f"блок {ключ!r} не посчитан", file=sys.stderr)
            sys.exit(1)
        print(json.dumps(д[ключ], ensure_ascii=False))
    else:
        print(f"неизвестная команда {команда!r}: бывают collect и query", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
