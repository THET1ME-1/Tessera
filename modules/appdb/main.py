#!/usr/bin/env python3
"""Модуль «База приложения»: превращает запросы к базе приложения в блоки панели.

Ядро про устройство чужого приложения не знает ничего — что такое «пара»,
«воспоминание» или «монета», знает только оно само. Этот модуль читает его
базу и отдаёт готовые числа.

Запускается двумя способами, как и любой модуль Tessera:

    python3 main.py collect            собрать всё и напечатать json
    python3 main.py query <ключ> '{}'  посчитать один блок

Что именно считать, описано в module.json, в секции "sql". Ядро эту секцию не
читает и не понимает — для него это лишнее поле манифеста.

Три правила, ради которых модуль написан именно так:

* база открывается ТОЛЬКО на чтение (`mode=ro` и `PRAGMA query_only`);
* у каждого запроса свой предел по времени, иначе один тяжёлый JOIN подвесит
  живую базу приложения, а вместе с ней и само приложение;
* упавший запрос не роняет остальные: блок останется без данных, панель
  покажет это честной надписью.
"""

import json
import os
import sqlite3
import sys
import time

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
ПРЕДЕЛ_СЕКУНД = 8.0          # на один запрос
ПРЕДЕЛ_СБОРА = 50.0          # на весь сбор: у ядра таймаут шестьдесят


def настройки():
    with open(os.path.join(ЗДЕСЬ, "module.json"), encoding="utf-8") as f:
        return json.load(f).get("sql", {})


def открыть(путь):
    """База приложения открывается только на чтение: модуль аналитики не имеет
    права писать в чужие данные даже по ошибке."""
    conn = sqlite3.connect(f"file:{путь}?mode=ro", uri=True, timeout=5)
    conn.execute("PRAGMA query_only = ON")
    conn.execute("PRAGMA busy_timeout = 4000")
    return conn


def сторож(conn, срок):
    """Прерывает запрос, если он идёт дольше срока.

    Обработчик вызывается каждые несколько тысяч операций движка, поэтому
    зависший скан прерывается, а не висит до конца таймаута ядра.
    """
    до = time.monotonic() + срок

    def проверка():
        return 1 if time.monotonic() > до else 0

    conn.set_progress_handler(проверка, 10_000)


def строки(conn, запрос, срок=ПРЕДЕЛ_СЕКУНД):
    сторож(conn, срок)
    try:
        return conn.execute(запрос).fetchall()
    finally:
        conn.set_progress_handler(None, 0)


def одно(conn, запрос, срок=ПРЕДЕЛ_СЕКУНД):
    r = строки(conn, запрос, срок)
    return r[0][0] if r and r[0] else 0


# ── сборка блоков ───────────────────────────────────────────────────────────

def плитка(conn, оп):
    d = {"value": одно(conn, оп["query"]), "sub": оп.get("sub", "")}
    if "parts" in оп:
        d["parts"] = [{"name": str(n), "value": v} for n, v in строки(conn, оп["parts"])]
    if "delta" in оп:
        было = одно(conn, оп["delta"])
        if было:
            d["delta"] = (d["value"] - было) / было * 100
    return d


def таблица(conn, оп):
    return {
        "cols": оп["cols"],
        "rows": [list(r) for r in строки(conn, оп["query"])],
        "barCol": оп.get("barCol", 1),
    }


def растр(conn, оп):
    return {
        "rows": [{"name": str(n), "value": v} for n, v in строки(conn, оп["query"])],
        "unit": оп.get("unit", 1),
        "unitLabel": оп.get("unitLabel", ""),
    }


def список(conn, оп):
    return {"items": [{"name": str(n), "value": v} for n, v in строки(conn, оп["query"])]}


def воронка(conn, оп):
    шаги = []
    for ш in оп["steps"]:
        шаги.append({"name": ш["name"], "value": одно(conn, ш["query"]), "note": ш.get("note", "")})
    return {"steps": шаги}


def столбики(conn, оп):
    items = [{"label": str(l), "parts": [{"v": v}]} for l, v in строки(conn, оп["query"])]
    return {"items": items, "unit": оп.get("unit", "")}


def матрица(conn, оп):
    """Когорты: первая колонка — подпись ряда, остальные — значения."""
    данные = строки(conn, оп["query"])
    return {
        "rowLabels": [str(r[0]) for r in данные],
        "colLabels": оп["cols"],
        "cells": [[None if v is None else v for v in r[1:]] for r in данные],
    }


СБОРЩИКИ = {
    "stat": плитка, "table": таблица, "raster": растр, "list": список,
    "funnel": воронка, "columns": столбики, "heat": матрица,
}


def собрать(ключи=None):
    оп = настройки()
    путь = оп.get("db", "")
    if not путь or not os.path.exists(путь):
        печатать_ошибку(f"базы приложения нет по пути {путь!r}: поправьте \"db\" в module.json")

    блоки = оп.get("blocks", {})
    if ключи:
        блоки = {k: v for k, v in блоки.items() if k in ключи}

    итог = {}
    начало = time.monotonic()
    conn = открыть(путь)
    try:
        for ключ, описание in блоки.items():
            if time.monotonic() - начало > ПРЕДЕЛ_СБОРА:
                # Лучше отдать половину блоков, чем не отдать ничего: ядро
                # оборвёт нас на шестидесятой секунде и не получит вообще
                # ничего.
                print(f"сбор прерван по времени, посчитано {len(итог)} из {len(блоки)}",
                      file=sys.stderr)
                break
            сборщик = СБОРЩИКИ.get(описание.get("type"))
            if сборщик is None:
                print(f"{ключ}: неизвестный тип блока {описание.get('type')!r}", file=sys.stderr)
                continue
            try:
                итог[ключ] = сборщик(conn, описание)
            except sqlite3.OperationalError as e:
                # Прерванный сторожем запрос приходит сюда же. Один тяжёлый
                # блок не должен уносить с собой остальные.
                print(f"{ключ}: {e}", file=sys.stderr)
    finally:
        conn.close()
    return итог


def печатать_ошибку(текст):
    print(текст, file=sys.stderr)
    sys.exit(1)


def main():
    команда = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if команда == "collect":
        print(json.dumps(собрать(), ensure_ascii=False))
    elif команда == "query":
        if len(sys.argv) < 3:
            печатать_ошибку("нужен ключ: main.py query <ключ> '{}'")
        ключ = sys.argv[2]
        данные = собрать([ключ])
        if ключ not in данные:
            печатать_ошибку(f"блок {ключ!r} не посчитан")
        print(json.dumps(данные[ключ], ensure_ascii=False))
    else:
        печатать_ошибку(f"неизвестная команда {команда!r}: бывают collect и query")


if __name__ == "__main__":
    main()
