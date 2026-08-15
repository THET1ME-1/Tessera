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
import subprocess
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
    # Прогрев пачкой. Страница просит шестьдесят кадров, и если каждый промах
    # будет запускать свой генератор, на сервере случится лавина процессов.
    # Один вызов на всю страницу дешевле в разы, а ответ его не ждёт.
    прогреть([э["id"] for э in элементы], ист)

    return {
        "items": элементы,
        "page": страница,
        "total": всего,
        "pages": (всего + НА_СТРАНИЦЕ - 1) // НА_СТРАНИЦЕ,
        "kinds": [и for и, в in ВИДЫ.items() if в],
    }


def прогреть(ids, ист):
    """Просит генератор сделать миниатюры для тех кадров, которых ещё нет."""
    команда = ист.get("make")
    шаблон = ист.get("thumb", "")
    if not команда or not шаблон or not ids:
        return
    нет = [i for i in ids
           if not os.path.exists(шаблон.replace("{id}", i).replace("{w}", "512"))]
    if not нет:
        return
    try:
        # Не ждём: ответ уходит сразу, кадры доедут к моменту, когда браузер
        # запросит картинки. Опоздавшие закроет промах поштучно.
        subprocess.Popen([*команда, "--ids", ",".join(нет[:60])],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    except OSError as e:
        print(f"генератор миниатюр не запустился: {e}", file=sys.stderr)


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

    # Кэш греет крон приложения, но он берёт последние шестьсот записей раз в
    # десять минут, а загружают быстрее — свежий кадр не успевает попасть в
    # прогрев никогда. Поэтому промах не ждём, а просим генератор сделать
    # именно этот файл: у него для такого есть отдельный режим.
    команда = ист.get("make")
    if команда:
        try:
            subprocess.run([*команда, "--ids", id_], timeout=8, check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"генератор миниатюр не отозвался: {e}", file=sys.stderr)
        for w in [хотят, "512", "1600"]:
            путь = шаблон.replace("{id}", id_).replace("{w}", w)
            if os.path.exists(путь):
                return {"path": путь, "type": "image/webp"}

    ошибка(f"миниатюры нет и сделать не вышло: {id_}")


# ── поиск пары ──────────────────────────────────────────────────────────────

def postgres():
    """Соединение с Postgres, где живут пары. Строка подключения — в
    module.json (ключ "pg") или в переменной окружения MODERATION_PG_DSN,
    чтобы пароль не лежал в файле."""
    ист, _ = настройки()
    dsn = ист.get("pg") or os.environ.get("MODERATION_PG_DSN", "")
    if not dsn:
        ошибка('нет строки подключения к Postgres: добавьте "pg" в module.json')
    import psycopg2                                  # noqa: PLC0415
    conn = psycopg2.connect(dsn)
    conn.set_session(readonly=True)
    return conn


def поиск_пары(параметры):
    """Найти пару по огрызку id, имени участника или почте.

    Полный id никто не помнит: у мигрированных пар он двадцать символов, у
    новых пятнадцать. Поэтому ищем по подстроке id, по именам участников
    (карта лежит в самой записи пары) и по людям — почта и имя, — а от них
    переходим к их парам.

    Пары читаются из Postgres, люди — из SQLite PocketBase: там они и живут.
    """
    ист, _ = настройки()
    запрос = str(параметры.get("q", "")).strip()
    if len(запрос) < 3:
        return {"cols": ["пара", "участники", "статус", "воспоминаний",
                         "сообщений", "заведена"], "rows": []}

    # 1) кандидаты среди людей — по почте и имени
    свои = []
    conn = база(ист.get("db", ""))
    try:
        строки = conn.execute(
            "SELECT id, coalesce(display_name,''), coalesce(email,'') FROM users "
            "WHERE lower(email) LIKE ? OR lower(coalesce(display_name,'')) LIKE ? "
            "LIMIT 40", (f"%{запрос.lower()}%", f"%{запрос.lower()}%")).fetchall()
        свои = [(r[0], r[1] or r[2]) for r in строки]
    finally:
        conn.close()
    имена = {uid: подпись for uid, подпись in свои}

    pg = postgres()
    try:
        with pg.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 8000")
            условия = ["id ILIKE %s", "member_names::text ILIKE %s"]
            значения = [f"%{запрос}%", f"%{запрос}%"]
            if имена:
                условия.append("members ?| %s")
                значения.append(list(имена))
            cur.execute(
                "SELECT id, members::text, member_names::text, disbanded, "
                "coalesce(memories_count,0), coalesce(messages_count,0), "
                "coalesce(created_at,''), coalesce(disbanded_at,'') "
                "FROM groups WHERE " + " OR ".join(условия) +
                " ORDER BY disbanded ASC, updated DESC LIMIT 25", значения)
            найдено = cur.fetchall()
    finally:
        pg.close()

    ряды = []
    for gid, состав, подписи, распалась, воспоминаний, сообщений, когда, распалась_когда in найдено:
        try:
            участники = json.loads(состав or "[]") or []
        except ValueError:
            участники = []
        try:
            карта = json.loads(подписи or "{}") or {}
        except ValueError:
            карта = {}
        кто = ", ".join(
            str(карта.get(u) or имена.get(u) or u)[:24] for u in участники) or "—"
        ряды.append([
            gid, кто,
            "распалась " + (распалась_когда[:10] if распалась_когда else "") if распалась else "живая",
            int(воспоминаний), int(сообщений), (когда or "")[:10],
        ])
    return {"cols": ["пара", "участники", "статус", "воспоминаний",
                     "сообщений", "заведена"], "rows": ряды}


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
    elif ключ == "pairs":
        print(json.dumps(поиск_пары(параметры), ensure_ascii=False))
    elif ключ == "thumb":
        print(json.dumps(миниатюра(параметры), ensure_ascii=False))
    else:
        ошибка(f"неизвестный ключ {ключ!r}")


if __name__ == "__main__":
    main()
