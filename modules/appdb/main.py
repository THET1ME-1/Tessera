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

**Баз может быть две.** Приложение переезжает по частям: горячие таблицы уже
живут в Postgres, а учётки и файлы остались в SQLite. Поэтому запрос с
префиксом `pg:` уходит в Postgres, остальные — в SQLite, и один блок панели
свободно собирается из обеих баз. Postgres подключается лениво: нет таких
запросов — нет и соединения.

Три правила, ради которых модуль написан именно так:

* базы открываются ТОЛЬКО на чтение (`mode=ro` и `PRAGMA query_only` у SQLite,
  транзакция только для чтения у Postgres);
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
ПРЕФИКС_PG = "pg:"


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


class Postgres:
    """Второе хранилище. Драйвер берём тот, что найдётся в системе.

    Соединение открывается при первом `pg:`-запросе: установки, где всё ещё
    живёт в SQLite, ничего лишнего не поднимают.
    """

    def __init__(self, dsn: str):
        self.dsn = dsn
        self._conn = None
        self._вид = ""

    def _подключиться(self):
        if self._conn is not None:
            return
        if not self.dsn:
            raise RuntimeError(
                'запрос с префиксом "pg:" есть, а строки подключения нет: '
                'добавьте "pg" в секцию "sql" файла module.json')
        try:
            import psycopg2                        # noqa: PLC0415
            self._conn = psycopg2.connect(self.dsn)
            self._conn.set_session(readonly=True)
            self._вид = "psycopg2"
            return
        except ImportError:
            pass
        try:
            import asyncio                          # noqa: PLC0415
            import asyncpg                          # noqa: PLC0415
        except ImportError as e:
            raise RuntimeError(
                "для Postgres нужен psycopg2 или asyncpg — не нашёлся ни один "
                f"({e})") from e
        self._asyncio, self._asyncpg = asyncio, asyncpg
        self._вид = "asyncpg"
        self._conn = "ленивое"                      # соединение на каждый запрос

    def строки(self, запрос: str, срок: float):
        self._подключиться()
        if self._вид == "psycopg2":
            with self._conn.cursor() as cur:
                cur.execute(f"SET LOCAL statement_timeout = {int(срок * 1000)}")
                cur.execute(запрос)
                return cur.fetchall()

        async def _прогон():
            conn = await self._asyncpg.connect(self.dsn, timeout=срок)
            try:
                # Только чтение и жёсткий предел по времени: тяжёлый скан не
                # должен занимать живую базу приложения дольше своего срока.
                await conn.execute(
                    f"SET statement_timeout = {int(срок * 1000)}")
                строки = await conn.fetch(запрос)
                return [tuple(r) for r in строки]
            finally:
                await conn.close()

        return self._asyncio.run(_прогон())

    def закрыть(self):
        if self._вид == "psycopg2" and self._conn not in (None, "ленивое"):
            self._conn.close()


class Базы:
    """Две базы под одной крышей: `pg:`-запрос уходит в Postgres, прочий — в SQLite."""

    def __init__(self, путь_sqlite: str, dsn: str):
        self.lite = открыть(путь_sqlite)
        self.pg = Postgres(dsn)

    def строки(self, запрос: str, срок: float = ПРЕДЕЛ_СЕКУНД):
        if запрос.startswith(ПРЕФИКС_PG):
            return self.pg.строки(запрос[len(ПРЕФИКС_PG):].strip(), срок)
        сторож(self.lite, срок)
        try:
            return self.lite.execute(запрос).fetchall()
        finally:
            self.lite.set_progress_handler(None, 0)

    def одно(self, запрос: str, срок: float = ПРЕДЕЛ_СЕКУНД):
        r = self.строки(запрос, срок)
        return r[0][0] if r and r[0] else 0

    def закрыть(self):
        self.lite.close()
        self.pg.закрыть()


# ── сборка блоков ───────────────────────────────────────────────────────────

def плитка(б, оп):
    d = {"value": б.одно(оп["query"]), "sub": оп.get("sub", "")}
    if "parts" in оп:
        d["parts"] = [{"name": str(n), "value": v} for n, v in б.строки(оп["parts"])]
    if "delta" in оп:
        было = б.одно(оп["delta"])
        if было:
            d["delta"] = (d["value"] - было) / было * 100
    return d


def таблица(б, оп):
    return {
        "cols": оп["cols"],
        "rows": [list(r) for r in б.строки(оп["query"])],
        "barCol": оп.get("barCol", 1),
    }


def растр(б, оп):
    return {
        "rows": [{"name": str(n), "value": v} for n, v in б.строки(оп["query"])],
        "unit": оп.get("unit", 1),
        "unitLabel": оп.get("unitLabel", ""),
    }


def список(б, оп):
    return {"items": [{"name": str(n), "value": v} for n, v in б.строки(оп["query"])]}


def воронка(б, оп):
    шаги = []
    for ш in оп["steps"]:
        шаги.append({"name": ш["name"], "value": б.одно(ш["query"]),
                     "note": ш.get("note", "")})
    return {"steps": шаги}


def столбики(б, оп):
    items = [{"label": str(l), "parts": [{"v": v}]} for l, v in б.строки(оп["query"])]
    return {"items": items, "unit": оп.get("unit", "")}


def матрица(б, оп):
    """Когорты: первая колонка — подпись ряда, остальные — значения."""
    данные = б.строки(оп["query"])
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
    # Пустое значение в манифесте не должно перекрывать окружение:
    # строку с паролем держат как раз в переменной, а не в файле.
    базы = Базы(путь, оп.get("pg") or os.environ.get("APPDB_PG_DSN", ""))
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
                итог[ключ] = сборщик(базы, описание)
            except Exception as e:      # noqa: BLE001 — блок не роняет остальные
                # Прерванный сторожем запрос приходит сюда же, как и отказ
                # Postgres: один тяжёлый блок не должен уносить с собой прочие.
                print(f"{ключ}: {e}", file=sys.stderr)
    finally:
        базы.закрыть()
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
