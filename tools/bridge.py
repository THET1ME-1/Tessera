#!/usr/bin/env python3
"""Мост: перекладывает события из чужой базы в Tessera.

Нужен на время переезда. Приложение уже шлёт события куда-то ещё — в свой
коллектор, в старую аналитику, — и переучивать его значит выпускать новую
сборку и ждать, пока люди обновятся. Мост читает готовую базу и досылает
события по тому же протоколу, которым пользуется SDK.

Приложение при этом не трогается вовсе, а старая аналитика продолжает
работать: мост только читает.

    python3 bridge.py --db /opt/app_stats/stats.db \
                      --url http://127.0.0.1:8101 --key КЛЮЧ

Докуда дошли, помнится в файле рядом с базой состояния. Повторный запуск
досылает только новое; если файла нет, мост начинает с последних суток, а не
с начала времён — иначе первый же запуск по крону утащит миллионы строк.
"""

import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.error
import urllib.request

ПАЧКА = 1000


def отправить(url, key, события):
    тело = json.dumps({"app": "app", "sdk": "мост", "events": события},
                      ensure_ascii=False).encode("utf-8")
    запрос = urllib.request.Request(url.rstrip("/") + "/i", data=тело, method="POST")
    запрос.add_header("Content-Type", "application/json")
    запрос.add_header("X-Tessera-Key", key)
    with urllib.request.urlopen(запрос, timeout=30) as ответ:
        if ответ.status != 202:
            raise RuntimeError(f"сервер ответил {ответ.status}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", required=True, help="база, откуда читать события")
    p.add_argument("--url", default="http://127.0.0.1:8101")
    p.add_argument("--key", required=True, help="ключ приёма Tessera")
    p.add_argument("--state", default="", help="файл с отметкой, докуда дошли")
    p.add_argument("--table", default="events")
    p.add_argument("--from-start", action="store_true",
                   help="начать с самого начала, а не с последних суток")
    арг = p.parse_args()

    состояние = арг.state or os.path.join(os.path.dirname(os.path.abspath(арг.db)),
                                          ".tessera_bridge")
    conn = sqlite3.connect(f"file:{арг.db}?mode=ro", uri=True, timeout=10)
    conn.execute("PRAGMA query_only = ON")

    последний = 0
    if os.path.exists(состояние):
        try:
            последний = int(open(состояние).read().strip() or 0)
        except ValueError:
            последний = 0
    elif not арг.from_start:
        # Первый запуск: берём сутки назад. Иначе крон утащит всю историю
        # разом, а её лучше заливать руками и осознанно.
        сутки = int(time.time()) - 86400
        строка = conn.execute(
            f"SELECT coalesce(max(id),0) FROM {арг.table} WHERE ts < ?", (сутки,)).fetchone()
        последний = строка[0] if строка else 0

    ушло = 0
    начало = time.monotonic()
    while True:
        строки = conn.execute(
            f"SELECT id, ts, uid_hash, platform, version, kind, name, ms "
            f"FROM {арг.table} WHERE id > ? ORDER BY id LIMIT ?",
            (последний, ПАЧКА)).fetchall()
        if not строки:
            break

        события = [{
            "eid": f"мост-{id_}", "ts": ts, "who": who or "", "platform": plat or "",
            "version": ver or "", "kind": kind, "name": name, "ms": ms or 0,
        } for id_, ts, who, plat, ver, kind, name, ms in строки]

        try:
            отправить(арг.url, арг.key, события)
        except (urllib.error.URLError, RuntimeError) as e:
            # Панель могла перезапускаться. Отметку не двигаем: в следующий раз
            # эта же пачка уйдёт заново, а повтор Tessera отбросит сама.
            print(f"не отправилось: {e}", file=sys.stderr)
            sys.exit(1)

        последний = строки[-1][0]
        ушло += len(строки)
        with open(состояние, "w") as f:
            f.write(str(последний))

    if ушло:
        print(f"переложено {ушло} событий за {time.monotonic() - начало:.1f} с, "
              f"отметка на {последний}")


if __name__ == "__main__":
    main()
