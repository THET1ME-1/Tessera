#!/usr/bin/env python3
"""Модуль «Розыгрыш»: что вышло из акции — сколько людей дошло до приложения.

Заходы на страницу считает Umami. Здесь другое, чего в браузерной аналитике
нет вовсе: сколько участников поставило приложение, сколько открыло его уже
ПОСЛЕ участия, сколько собрало пару и сколько продолжает заходить.

**Две базы, и соединяются они здесь, а не в SQL.** Участники живут в SQLite
PocketBase (`club_entries`), а присутствие — в Postgres: у свежих аккаунтов
зеркало присутствия в SQLite пусто (проверено 15.09.2026 — 47 из 50 новейших
есть в Postgres и ноль в зеркале), поэтому активность, посчитанная по SQLite,
показывала бы ноль при живых людях. Один SQL-запрос две базы не видит, так что
список участников берётся из SQLite, их присутствие — одним запросом в
Postgres, а сводится всё питоном.

Подключение к базам берём у соседнего модуля `appdb`: там оно написано
правильно — только чтение, сторож по времени на каждый запрос, ленивый
Postgres. Копировать это ради других метрик незачем.

    python3 main.py collect            собрать всё и напечатать json
    python3 main.py query <ключ> '{}'  посчитать один блок
"""
import importlib.util
import json
import os
import sys
import time
from collections import Counter

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
ДВИЖОК = os.path.join(ЗДЕСЬ, "..", "appdb", "main.py")
НЕДЕЛЯ = 7 * 86400


def движок():
    if not os.path.exists(ДВИЖОК):
        print(f"рядом нет модуля appdb ({ДВИЖОК}) — он даёт подключение к базам",
              file=sys.stderr)
        sys.exit(1)
    spec = importlib.util.spec_from_file_location("appdb_engine", ДВИЖОК)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def настройки():
    with open(os.path.join(ЗДЕСЬ, "module.json"), encoding="utf-8") as f:
        return json.load(f).get("sql", {})


def участники(б):
    """Строка на участника: кто, когда вошёл, откуда и что у него в аккаунте."""
    запрос = """
        SELECT c.user, c.created, c.src, c.source, c.winner,
               u.email, u.platform, u.apns_token, u.fcm_token,
               u.group_ids, u.plus, u.created
        FROM club_entries c JOIN users u ON u.id = c.user
        ORDER BY c.created DESC
    """
    поля = ("uid", "вошёл", "метка", "кампания", "победитель", "почта",
            "платформа", "apns", "fcm", "группы", "плюс", "аккаунт_с")
    return [dict(zip(поля, строка)) for строка in б.строки(запрос)]


def присутствие(б, люди):
    """Последний визит каждого — из Postgres: зеркало в SQLite отстаёт."""
    if not люди:
        return {}
    ids = ",".join("'" + str(ч["uid"]).replace("'", "") + "'" for ч in люди)
    строки = б.строки(f"pg:SELECT user_uid, seen_at FROM user_presence WHERE user_uid IN ({ids})")
    return {uid: int(seen or 0) for uid, seen in строки}


def мс(iso):
    """Время PocketBase (`2026-09-15 20:31:06.969Z`) в миллисекунды."""
    if not iso:
        return 0
    s = str(iso).replace("Z", "").replace("T", " ").split(".")[0]
    try:
        return int(time.mktime(time.strptime(s, "%Y-%m-%d %H:%M:%S"))) * 1000
    except ValueError:
        return 0


def ставил_приложение(ч, seen):
    """Приложение было на устройстве: оно и только оно пишет платформу,
    пуш-токен и присутствие. Сайт не пишет ничего из этого."""
    return bool(ч["платформа"] or ч["apns"] or ч["fcm"] or seen.get(ч["uid"]))


def в_паре(ч):
    return str(ч["группы"] or "") not in ("", "[]", "null")


def имя_метки(м):
    return {
        "": "без метки", "direct": "прямой заход", "qr": "QR в клубе",
        "ig": "Instagram", "tg": "Telegram", "story": "Сторис",
    }.get(str(м or ""), str(м))


def собрать(ключи=None):
    оп = настройки()
    путь = оп.get("db", "")
    if not путь or not os.path.exists(путь):
        print(f"базы приложения нет по пути {путь!r}: поправьте \"db\" в module.json",
              file=sys.stderr)
        sys.exit(1)

    m = движок()
    базы = m.Базы(путь, оп.get("pg") or os.environ.get("APPDB_PG_DSN", ""))
    try:
        люди = участники(базы)
        try:
            seen = присутствие(базы, люди)
        except Exception as e:                      # noqa: BLE001
            # Postgres может быть недоступен — тогда честно показываем участие
            # и пары, а метрики активности останутся пустыми.
            print(f"присутствие не прочитано: {e}", file=sys.stderr)
            seen = {}

        сейчас = int(time.time() * 1000)
        поставили = [ч for ч in люди if ставил_приложение(ч, seen)]
        после = [ч for ч in люди if seen.get(ч["uid"], 0) > мс(ч["вошёл"])]
        пары = [ч for ч in люди if в_паре(ч)]

        def свежие(дней):
            край = сейчас - дней * 86400 * 1000
            return [ч for ч in люди if seen.get(ч["uid"], 0) > край]

        по_меткам = Counter(имя_метки(ч["метка"]) for ч in люди)
        по_дням = Counter(str(ч["вошёл"])[:10] for ч in люди)
        по_кампаниям = Counter(ч["кампания"] or "без кампании" for ч in люди)
        платформы = Counter(
            (ч["платформа"] or ("ios" if ч["apns"] else "android" if ч["fcm"] else "неизвестно"))
            for ч in поставили)

        блоки = {
            "total": {
                "value": len(люди),
                "sub": "вошли на странице розыгрыша",
                "parts": [{"name": "победители", "value": sum(1 for ч in люди if ч["победитель"])},
                          {"name": "участвуют", "value": sum(1 for ч in люди if not ч["победитель"])}],
            },
            "installed": {
                "value": len(поставили),
                "sub": "приложение было на устройстве",
                "parts": [{"name": k, "value": v} for k, v in платформы.most_common()],
            },
            "paired": {"value": len(пары), "sub": "нашли себе второго"},
            "alive7": {"value": len(свежие(7)), "sub": "заходили за последние 7 дней"},
            "funnel": {"steps": [
                {"name": "Участвуют", "value": len(люди), "note": "вошли на странице"},
                {"name": "Поставили приложение", "value": len(поставили), "note": ""},
                {"name": "Открыли после участия", "value": len(после), "note": "не просто были раньше"},
                {"name": "Собрали пару", "value": len(пары), "note": ""},
                {"name": "Живы через неделю", "value": len(свежие(7)), "note": ""},
            ]},
            "sources": {
                "items": [{"label": k, "parts": [{"v": v}]} for k, v in по_меткам.most_common()],
                "unit": "чел.",
            },
            "by_day": {
                "items": [{"label": k, "parts": [{"v": v}]} for k, v in sorted(по_дням.items())],
                "unit": "чел.",
            },
            "campaigns": {
                "items": [{"label": k, "parts": [{"v": v}]} for k, v in по_кампаниям.most_common()],
                "unit": "чел.",
            },
            "retention": {"items": [
                {"name": "заходили за сутки", "value": len(свежие(1))},
                {"name": "за 3 дня", "value": len(свежие(3))},
                {"name": "за 7 дней", "value": len(свежие(7))},
                {"name": "за 30 дней", "value": len(свежие(30))},
            ]},
            "newcomers": {"items": [
                {"name": "Завели аккаунт ради розыгрыша",
                 "value": sum(1 for ч in люди if str(ч["аккаунт_с"])[:10] == str(ч["вошёл"])[:10])},
                {"name": "Были в Togetherly раньше",
                 "value": sum(1 for ч in люди if str(ч["аккаунт_с"])[:10] < str(ч["вошёл"])[:10])},
                {"name": "Уже с Togetherly+", "value": sum(1 for ч in люди if ч["плюс"])},
            ]},
            "recent": {
                "cols": ["Когда", "Откуда", "Почта", "Приложение", "Пара", "Последний заход"],
                "barCol": -1,
                "rows": [[
                    str(ч["вошёл"])[:16],
                    имя_метки(ч["метка"]),
                    ч["почта"],
                    (ч["платформа"] or ("ios" if ч["apns"] else "android" if ч["fcm"] else
                                        ("есть" if seen.get(ч["uid"]) else "—"))),
                    "есть" if в_паре(ч) else "—",
                    (time.strftime("%Y-%m-%d", time.localtime(seen[ч["uid"]] / 1000))
                     if seen.get(ч["uid"]) else "—"),
                ] for ч in люди[:25]],
            },
        }
    finally:
        базы.закрыть()

    return {k: v for k, v in блоки.items() if not ключи or k in ключи}


def main():
    команда = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if команда == "collect":
        print(json.dumps(собрать(), ensure_ascii=False))
        return 0
    if команда == "query":
        if len(sys.argv) < 3:
            print("нужен ключ: main.py query <ключ> '{}'", file=sys.stderr)
            return 1
        ключ = sys.argv[2]
        данные = собрать([ключ])
        if ключ not in данные:
            print(f"блок {ключ!r} не посчитан", file=sys.stderr)
            return 1
        print(json.dumps(данные[ключ], ensure_ascii=False))
        return 0
    print(f"неизвестная команда {команда!r}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
