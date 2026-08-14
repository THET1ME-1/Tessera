#!/usr/bin/env python3
"""Модуль «Модерация»: лента чужих файлов, которые люди загрузили в приложение.

Устройство простое до скуки, и это осознанно. Модуль умеет три вещи: сказать,
сколько чего лежит, выдать страницу ленты и назвать файл миниатюры. Всё
остальное — сетку, лайтбокс, фильтры — рисует панель своими кирпичами.

    python3 main.py collect                     сводные плитки
    python3 main.py query list '{"page":"0"}'   страница ленты
    python3 main.py query thumb '{"id":"…"}'    путь к миниатюре

Порядок ленты — по вставке в базу, а не по дате внутри записи. Дату загрузивший
может подвинуть, и снимок, помеченный двухтысячным годом, уехал бы в конец
ленты вместо начала. Технический порядок для модерации честнее.
"""

import json
import os
import sqlite3
import sys

ЗДЕСЬ = os.path.dirname(os.path.abspath(__file__))
НА_СТРАНИЦЕ = 60

# Виды файлов сведены в понятные названия: в базе рядом живут «memory» и
# «memories», это следы старых версий приложения, а человеку они одно и то же.
ВИДЫ = {
    "Воспоминания": ("memory", "memories"),
    "Холсты": ("canvas",),
    "Аватарки": ("avatar", "avatars"),
    "Виджеты": ("widget", "widget_anim"),
    "Маскоты": ("mascot", "mascots"),
    "Голосовые": ("voice",),
    "Прочее": (),
}


def настройки():
    with open(os.path.join(ЗДЕСЬ, "module.json"), encoding="utf-8") as f:
        м = json.load(f)
        return м.get("source", {}), м.get("root", "")


def база(путь):
    conn = sqlite3.connect(f"file:{путь}?mode=ro", uri=True, timeout=5)
    conn.execute("PRAGMA query_only = ON")
    return conn


def ошибка(текст):
    print(текст, file=sys.stderr)
    sys.exit(1)


# ── сводка ──────────────────────────────────────────────────────────────────

def собрать():
    ист, _ = настройки()
    db = ист.get("db", "")
    if not os.path.exists(db):
        ошибка(f"базы приложения нет по пути {db!r}")
    conn = база(db)
    try:
        всего = conn.execute("SELECT count(*) FROM media").fetchone()[0]
        по_видам = dict(conn.execute("SELECT kind, count(*) FROM media GROUP BY kind"))
    finally:
        conn.close()

    ряды = []
    учтено = set()
    for имя, виды in ВИДЫ.items():
        if not виды:
            continue
        n = sum(по_видам.get(в, 0) for в in виды)
        учтено.update(виды)
        if n:
            ряды.append({"name": имя, "value": n})
    прочее = sum(n for k, n in по_видам.items() if k not in учтено)
    if прочее:
        ряды.append({"name": "Прочее", "value": прочее})
    ряды.sort(key=lambda r: -r["value"])

    видео = sum(по_видам.get(k, 0) for k in ("video",))
    return {
        "total": {"value": всего, "sub": "файлов в хранилище приложения"},
        "kinds": {"rows": ряды, "unit": 1000, "unitLabel": "файлов"},
        "fresh": {"value": по_видам.get("memory", 0) + по_видам.get("memories", 0),
                  "sub": "воспоминаний, самый частый вид"},
        "shelf": лента({"page": "0"}),
    }


# ── лента ───────────────────────────────────────────────────────────────────

def лента(параметры):
    ист, _ = настройки()
    db = ист.get("db", "")
    if not os.path.exists(db):
        ошибка(f"базы приложения нет по пути {db!r}")

    страница = int(параметры.get("page", "0") or 0)
    вид = параметры.get("kind", "") or ""
    виды = ВИДЫ.get(вид, ())

    условие, аргументы = "", []
    if виды:
        условие = " WHERE kind IN (" + ",".join("?" * len(виды)) + ")"
        аргументы = list(виды)

    conn = база(db)
    try:
        # rowid DESC — порядок вставки: свежее сверху. Сортировать по дате
        # внутри записи нельзя, её ставит загрузивший.
        строки = conn.execute(
            f"SELECT id, file, kind, group_id FROM media{условие} "
            f"ORDER BY rowid DESC LIMIT ? OFFSET ?",
            аргументы + [НА_СТРАНИЦЕ, страница * НА_СТРАНИЦЕ]).fetchall()
        всего = conn.execute(f"SELECT count(*) FROM media{условие}", аргументы).fetchone()[0]
    finally:
        conn.close()

    элементы = []
    for id_, файл, вид_, группа in строки:
        элементы.append({
            "id": id_,
            "url": f"/api/file?src=moderation:thumb&id={id_}",
            "caption": человечный(вид_),
            "kind": вид_,
            "group": группа,
            "video": (файл or "").lower().endswith((".mp4", ".mov", ".webm")),
        })
    return {
        "items": элементы,
        "page": страница,
        "total": всего,
        "pages": (всего + НА_СТРАНИЦЕ - 1) // НА_СТРАНИЦЕ,
        "kinds": [и for и, в in ВИДЫ.items() if в],
    }


def человечный(вид):
    for имя, виды in ВИДЫ.items():
        if вид in виды:
            return имя
    return вид


# ── миниатюра ───────────────────────────────────────────────────────────────

def миниатюра(параметры):
    """Возвращает путь к готовой миниатюре.

    Миниатюры делает отдельный крон приложения и кладёт их в свой кэш. Модуль
    только называет файл: ядро проверит, что он внутри объявленного корня, и
    отдаст сам. Штатные миниатюры хранилища тут не годятся — для webp они
    перекодируются в png тяжелее оригинала.
    """
    ист, корень = настройки()
    id_ = параметры.get("id", "")
    if not id_ or "/" in id_ or ".." in id_:
        ошибка("нужен id файла")

    шаблон = ист.get("thumb", "")
    if not шаблон:
        ошибка("в module.json не задан шаблон пути к миниатюре")

    # Просят один размер, а в кэше бывает другой: лайтбокс хочет крупный кадр,
    # а крон успел сделать только плитку. Отдать меньший лучше, чем отказать.
    хотят = параметры.get("w", "512")
    for w in [хотят] + [р for р in ("1600", "512") if р != хотят]:
        путь = шаблон.replace("{id}", id_).replace("{w}", w)
        if os.path.exists(путь):
            return {"path": путь, "type": "image/webp"}

    # Кэш греется кроном и отстаёт от свежих загрузок. Это не ошибка модуля:
    # панель покажет плашку, а через десять минут кадр появится сам.
    ошибка(f"миниатюры ещё нет: {id_}")


def main():
    команда = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if команда == "collect":
        print(json.dumps(собрать(), ensure_ascii=False))
        return

    if команда != "query" or len(sys.argv) < 3:
        ошибка("бывают: collect, query <ключ> '{}'")
    ключ = sys.argv[2]
    параметры = json.loads(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] else {}

    if ключ == "shelf" or ключ == "list":
        print(json.dumps(лента(параметры), ensure_ascii=False))
    elif ключ == "thumb":
        print(json.dumps(миниатюра(параметры), ensure_ascii=False))
    else:
        ошибка(f"неизвестный ключ {ключ!r}")


if __name__ == "__main__":
    main()
