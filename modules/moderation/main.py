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
import re
import sqlite3
import subprocess
import sys
import time
import urllib.request
from urllib.parse import quote

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


# ── кто сейчас на связи ─────────────────────────────────────────────────────

def онлайн(_параметры=None):
    """Сколько человек держит соединение прямо сейчас и с чего они зашли.

    Считает не база, а Centrifugo: он и есть тот, кто держит соединения.
    Отметка `user_presence` для этого не годится — её пишут раз в пять минут,
    и по ней «сейчас» означает «за последние пять минут»: 875 против 1170.

    Платформу узнаём обходом присутствия в парных каналах — там лежит uid
    каждого подключённого, а платформа человека уже есть в базе приложения.
    Обход тысячи каналов стоит 0,8 с, поэтому разбивка живёт в кэше полторы
    минуты: общее число обновляется каждый тик, разбивка реже. Считать её по
    каналам `user:*` нельзя — там висят и каналы партнёров, которые сейчас
    оффлайн (2015 каналов против 1170 подключённых).
    """
    ист, _ = настройки()
    путь = ист.get("centrifugo", "/opt/centrifugo/config.json")
    адрес = ист.get("centrifugo_api", "http://127.0.0.1:9000")
    try:
        with open(путь, encoding="utf-8") as f:
            c = json.load(f)
        ключ = (c.get("http_api") or {}).get("key") or c.get("api_key") or ""
    except OSError as e:
        ошибка(f"конфиг Centrifugo не прочитался: {e}")
    if not ключ:
        ошибка("в конфиге Centrifugo нет ключа API")

    def спросить(путь_, тело, таймаут=4):
        req = urllib.request.Request(
            адрес.rstrip("/") + путь_, data=json.dumps(тело).encode(),
            headers={"X-API-Key": ключ, "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=таймаут) as r:
            return json.loads(r.read().decode())

    try:
        инфо = спросить("/api/info", {}).get("result") or {}
    except Exception as e:
        ошибка(f"Centrifugo не ответил: {e}")
    людей = sum(u.get("num_users", 0) for u in инфо.get("nodes", []))
    соединений = sum(u.get("num_clients", 0) for u in инфо.get("nodes", []))

    пар, платформы = 0, {}
    свежий = _кэш_платформ()
    if свежий:
        пар, платформы = свежий["пар"], свежий["платформы"]
    else:
        try:
            каналы = list(((спросить("/api/channels", {"pattern": "pair:*"}).get("result") or {})
                           .get("channels") or {}).keys())
            пар = len(каналы)
            люди = set()
            for имя in каналы:
                try:
                    p = (спросить("/api/presence", {"channel": имя}, 3).get("result") or {}).get("presence") or {}
                    for кл in p.values():
                        if кл.get("user"):
                            люди.add(кл["user"])
                except Exception:
                    continue
            платформы = _платформы(люди, ист)
            _кэш_платформ(записать={"пар": пар, "платформы": платформы})
        except Exception:
            платформы = {}

    части = []
    if платформы:
        известно = платформы.get("android", 0) + платформы.get("ios", 0)
        части = [{"name": "Android", "value": платформы.get("android", 0)},
                 {"name": "iPhone", "value": платформы.get("ios", 0)}]
        # Остаток — те, кого не видно в парных каналах: одиночки, только что
        # подключившиеся, аккаунты без платформы. Без этой строки сумма частей
        # не сходится с числом наверху, и блок читается как ошибка.
        прочие = max(0, людей - известно)
        if прочие:
            части.append({"name": "не видно платформы", "value": прочие})
    if пар:
        части.append({"name": "пар на связи", "value": пар})

    хвост = f"{соединений} соединений" if соединений != людей else "человек на связи"
    return {"value": людей, "sub": хвост, "parts": части[:4]}


def _платформы(uids, ист):
    """Раскладка людей по системам. Поле `platform` пишут свежие сборки, а
    пуш-токен говорит об устройстве точно, поэтому смотрим оба признака."""
    db = ист.get("db", "")
    if not uids or not os.path.exists(db):
        return {}
    из_ = {"android": 0, "ios": 0, "нет": 0}
    conn = база(db)
    try:
        uids = list(uids)
        for i in range(0, len(uids), 900):
            часть = uids[i:i + 900]
            q = ",".join("?" * len(часть))
            for platform, apns, fcm in conn.execute(
                    f"SELECT platform, apns_token, fcm_token FROM users WHERE id IN ({q})", часть):
                p = (platform or "").lower()
                if p == "ios" or apns:
                    из_["ios"] += 1
                elif p == "android" or fcm:
                    из_["android"] += 1
                else:
                    из_["нет"] += 1
    finally:
        conn.close()
    return из_


_КЭШ_ПЛАТФОРМ = "/tmp/tessera_online_platforms.json"
_ЖИЗНЬ_КЭША = 90


def _кэш_платформ(записать=None):
    """Обход присутствия дорогой, а панель спрашивает блок раз в двадцать
    секунд и у каждого открытого окна. Полторы минуты — разумная давность для
    разбивки: общее число всё равно живое."""
    if записать is not None:
        try:
            with open(_КЭШ_ПЛАТФОРМ, "w", encoding="utf-8") as f:
                json.dump({"когда": time.time(), **записать}, f)
        except OSError:
            pass
        return None
    try:
        with open(_КЭШ_ПЛАТФОРМ, encoding="utf-8") as f:
            d = json.load(f)
        if time.time() - d.get("когда", 0) < _ЖИЗНЬ_КЭША:
            return d
    except (OSError, ValueError):
        pass
    return None


# ── лента ───────────────────────────────────────────────────────────────────

def лента(параметры):
    ист, _ = настройки()
    db = ист.get("db", "")
    if not os.path.exists(db):
        ошибка(f"базы приложения нет по пути {db!r}")

    страница = int(параметры.get("page", "0") or 0)
    вид = параметры.get("kind", "") or ""
    виды = ВИДЫ.get(вид, ())
    взрослый_фильтр = (параметры.get("adult", "") or "").strip()
    if взрослый_фильтр not in ("", "only", "hide"):
        взрослый_фильтр = ""
    if взрослый_фильтр == "only":
        return лента_с_замком(страница, вид, ист, db)

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

    взрослые = взрослые_для([г for _, _, _, г in строки])
    элементы = [карточка(ид, файл, вид_, группа, ист, взрослые)
                for ид, файл, вид_, группа in строки]

    # «Без 18+» режет уже собранную страницу: помеченных кадров на общем потоке
    # единицы, и страница от их пропажи почти не худеет. Обратный фильтр так не
    # сделаешь — помеченное лежит глубже первой страницы, поэтому «только 18+»
    # ушёл выше, в свою ветку.
    if взрослый_фильтр == "hide":
        элементы = [э for э in элементы if not э["adult"]]

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
        "adult": взрослый_фильтр,
        "adultCount": sum(1 for э in элементы if э["adult"]),
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


def кадры_с_замком(предел=2000):
    """Идентификаторы кадров с замком, свежие сверху.

    Отдельным списком, а не признаком в общей выборке: замок живёт в чужой
    базе, и отфильтровать им страницу `media` одним запросом нельзя. Предел
    держит запрос в разумных секундах — на глубину дальше двух тысяч кадров
    модерация не ходит, для точечного разбора есть поиск по паре.
    """
    ист, _ = настройки()
    if not (ист.get("pg") or os.environ.get("MODERATION_PG_DSN", "")):
        return []
    try:
        pg = postgres()
    except Exception:
        return []
    try:
        with pg.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 8000")
            cur.execute(
                "SELECT data::jsonb ->> 'imageUrl' FROM memories "
                "WHERE (data::jsonb ->> 'isAdult') = 'true' "
                "  AND coalesce(deleted, false) = false "
                "  AND (data::jsonb ->> 'imageUrl') LIKE 'pb://media/%%' "
                "ORDER BY created_at DESC LIMIT %s", (предел,))
            ряд = [ид for (ссылка,) in cur.fetchall() if (ид := ид_из_ссылки(ссылка))]
            return list(dict.fromkeys(ряд))
    except Exception:
        return []
    finally:
        try:
            pg.close()
        except Exception:
            pass


def лента_с_замком(страница, вид, ист, db):
    """Страница ленты из кадров, помеченных парами как «для взрослых»."""
    все = кадры_с_замком()
    виды = ВИДЫ.get(вид, ())
    conn = база(db)
    try:
        отобрано = []
        # Идём пачками: список приходит из чужой базы, а по нашей ходим
        # обычным IN, сохраняя порядок «свежие сверху».
        for i in range(0, len(все), 900):
            часть = все[i:i + 900]
            места = ",".join("?" * len(часть))
            найдено = {ид: (файл, вид_, группа) for ид, файл, вид_, группа in conn.execute(
                f"SELECT id, file, kind, group_id FROM media WHERE id IN ({места})", часть)}
            for ид in часть:
                if ид in найдено and (not виды or найдено[ид][1] in виды):
                    отобрано.append((ид, *найдено[ид]))
    finally:
        conn.close()

    всего = len(отобрано)
    окно = отобрано[страница * НА_СТРАНИЦЕ:(страница + 1) * НА_СТРАНИЦЕ]
    метки = {ид for ид, *_ in окно}
    элементы = [карточка(ид, файл, вид_, группа, ист, метки)
                for ид, файл, вид_, группа in окно]
    прогреть([э["id"] for э in элементы], ист)
    return {
        "items": элементы,
        "page": страница,
        "total": всего,
        "pages": max(1, (всего + НА_СТРАНИЦЕ - 1) // НА_СТРАНИЦЕ),
        "kinds": [и for и, в in ВИДЫ.items() if в],
        "adult": "only",
        "adultCount": len(элементы),
    }


def взрослые_для(группы):
    """Кадры этих пар, помеченные в приложении как «для взрослых».

    Замок ставит сама пара в форме воспоминания, признак лежит в json-поле
    записи, а сами записи с 14 августа живут в Postgres. Спрашиваем только про
    пары текущей страницы: полный проход по воспоминаниям стоит секунды, а
    шестьдесят пар закрываются индексом по `group_id`.

    Любая беда на той стороне стоит ровно одной подписи под кадром: лента
    важнее пометки, поэтому здесь молчаливое пустое множество вместо ошибки.
    """
    группы = [г for г in dict.fromkeys(группы) if г]
    if not группы:
        return set()
    ист, _ = настройки()
    if not (ист.get("pg") or os.environ.get("MODERATION_PG_DSN", "")):
        return set()
    try:
        pg = postgres()
    except Exception:
        return set()
    try:
        with pg.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 4000")
            cur.execute(
                "SELECT data::jsonb ->> 'imageUrl' FROM memories "
                "WHERE group_id = ANY(%s) "
                "  AND (data::jsonb ->> 'isAdult') = 'true' "
                "  AND coalesce(deleted, false) = false", (группы,))
            return {ид for (ссылка,) in cur.fetchall() if (ид := ид_из_ссылки(ссылка))}
    except Exception:
        return set()
    finally:
        try:
            pg.close()
        except Exception:
            pass


def ид_из_ссылки(ссылка):
    """Идентификатор файла из ссылки вида `pb://media/<id>/<имя>`.

    Так воспоминание в Postgres указывает на строку в `media`: собственного
    поля с файлом у него нет. Всё, что на этот вид не похоже, отдаёт пустоту.
    """
    куски = (ссылка or "").split("/")
    if len(куски) < 5 or not куски[0].startswith("pb:"):
        return ""
    return куски[3]


def карточка(ид, файл, вид, группа, ист, взрослые):
    """Один кадр ленты со всем, что нужно модератору с одного взгляда."""
    готовый = ""
    шаблон = ист.get("thumb", "")
    if шаблон:
        для_512 = шаблон.replace("{id}", ид).replace("{w}", "512")
        if os.path.exists(для_512):
            готовый = для_512
    return {
        "id": ид,
        # Готовый путь называем сразу: ядро отдаст файл, не поднимая ради
        # каждого кадра отдельный процесс модуля. Кадра ещё нет — оставляем
        # прежний адрес, там миниатюра сделается на месте.
        "url": (f"/api/file?src=moderation:thumb&id={ид}&type=image/webp"
                f"&path={quote(готовый)}" if готовый else
                f"/api/file?src=moderation:thumb&id={ид}"),
        "caption": человечный(вид),
        "kind": вид,
        "group": группа,
        "ts": метка_времени(файл),
        "adult": ид in взрослые,
        "video": (файл or "").lower().endswith((".mp4", ".mov", ".webm")),
    }


def метка_времени(имя):
    """Секунды загрузки, вытащенные из имени файла.

    В таблице `media` даты нет ни одной колонкой, зато приложение кладёт метку
    прямо в имя: `memory_1786968914693_…`, `fill_1786993617496_140_…`. Берём
    первое тринадцатизначное число, похожее на миллисекунды нашего века:
    короткие числа рядом — счётчик кадра холста, а не время. Нет метки — ноль,
    и подпись под кадром просто не рисуется.
    """
    for кусок in re.findall(r"\d{13}", имя or ""):
        мс = int(кусок)
        if 1_577_836_800_000 <= мс <= 4_102_444_800_000:  # 2020…2100
            return мс // 1000
    return 0


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


def поиск_человека(параметры):
    """Найти человека по почте, имени или огрызку id.

    Показывает то, что нужно поддержке в первую минуту разговора: с чего он
    заходит, есть ли Togetherly+ и откуда он взялся, сколько монет, когда
    завёл учётку и в скольких парах состоит. Переписку и содержимое не
    показываем: для разбора жалобы этого не нужно.
    """
    ист, _ = настройки()
    запрос = str(параметры.get("q", "")).strip()
    колонки = ["человек", "имя", "почта", "устройство", "Togetherly+",
               "монет", "пар", "завёл"]
    if len(запрос) < 3:
        return {"cols": колонки, "rows": []}

    к = f"%{запрос.lower()}%"
    conn = база(ист.get("db", ""))
    try:
        строки = conn.execute(
            "SELECT id, coalesce(display_name,''), coalesce(email,''), "
            "coalesce(platform,''), coalesce(plus,0), coalesce(plus_platform,''), "
            "coalesce(coins,0), coalesce(group_ids,''), coalesce(created,''), "
            "coalesce(apns_token,''), coalesce(fcm_token,'') "
            "FROM users WHERE lower(email) LIKE ? "
            "OR lower(coalesce(display_name,'')) LIKE ? OR id LIKE ? "
            "ORDER BY created DESC LIMIT 25", (к, к, f"%{запрос}%")).fetchall()
    finally:
        conn.close()

    ряды = []
    for (uid, имя, почта, плат, плюс, канал, монеты, пары, когда,
         apns, fcm) in строки:
        # Платформу знает не только поле профиля: оно пишется свежими
        # сборками, а пуш-токен говорит об устройстве точно.
        устройство = ({"android": "Android", "ios": "iPhone"}.get(плат)
                      or ("iPhone" if apns else "Android" if fcm else "—"))
        try:
            сколько_пар = len(json.loads(пары or "[]") or [])
        except ValueError:
            сколько_пар = 0
        ряды.append([
            uid, имя or "—", почта or "—", устройство,
            ("да · " + канал if канал else "да") if плюс else "нет",
            int(монеты), сколько_пар, (когда or "")[:10],
        ])
    return {"cols": колонки, "rows": ряды}


def найти(параметры):
    """Один поиск на всё: и люди, и пары.

    Двух отдельных полей быть не должно. В поддержку приходят с почтой или
    именем, и человек нужен вместе со своей парой: «есть ли Плюс» и «в какой
    он паре» — один вопрос, а не два. Поэтому спрашиваем оба источника и
    отдаём двумя разделами; пустой раздел панель не рисует.
    """
    запрос = str(параметры.get("q", "")).strip()
    люди = поиск_человека(параметры)
    пары = поиск_пары(параметры)
    разделы = []
    if люди["rows"]:
        разделы.append({"title": "Люди", **люди})
    if пары["rows"]:
        разделы.append({"title": "Пары", **пары})
    if not разделы and len(запрос) >= 3:
        # Ни там, ни там: покажем пустую таблицу людей, чтобы человек видел,
        # по каким полям вообще идёт поиск.
        разделы.append({"title": "Люди", **люди})
    return {"sections": разделы}


def помечено_18(параметры):
    """Кадры, которые пара сама пометила как «для взрослых».

    Пометку ставит форма воспоминания (замок рядом с фото), и живёт она НЕ в
    таблице файлов: `media` знает только имя файла и владельца, а флаг лежит
    внутри json-поля `data` записи воспоминания — так его завели, чтобы не
    менять схему ради одного признака. С 14 августа воспоминания переехали в
    Postgres, поэтому связь собирается здесь: из `data.imageUrl` достаётся
    `pb://media/<id>/<файл>`, а `<id>` — это и есть строка в `media`.

    Отдаём сразу карточки, а не одни идентификаторы: админке нужны имя файла и
    пара, чтобы открыть кадр и уйти в переписку, а второй запрос за этим стоил
    бы ещё одного прохода по таблице на четыреста тысяч строк.
    """
    предел = min(max(int(параметры.get("limit", 400) or 400), 1), 2000)
    pg = postgres()
    строки = []
    try:
        with pg.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout = 8000")
            cur.execute(
                "SELECT group_id, data::jsonb ->> \'imageUrl\', "
                "       data::jsonb ->> \'authorName\', created_at "
                "FROM memories "
                "WHERE (data::jsonb ->> \'isAdult\') = \'true\' "
                "  AND coalesce(deleted, false) = false "
                "  AND (data::jsonb ->> \'imageUrl\') LIKE \'pb://media/%%\' "
                "ORDER BY created_at DESC LIMIT %s", (предел,))
            строки = cur.fetchall()
    finally:
        pg.close()

    ист, _ = настройки()
    элементы = []
    for группа, ссылка, автор, когда in строки:
        куски = (ссылка or "").split("/")
        if len(куски) < 5:
            continue
        ид, файл = куски[3], куски[4]
        готовый = ""
        шаблон = ист.get("thumb", "")
        if шаблон:
            путь = шаблон.replace("{id}", ид).replace("{w}", "512")
            if os.path.exists(путь):
                готовый = путь
        элементы.append({
            "id": ид,
            "url": (f"/api/file?src=moderation:thumb&id={ид}&type=image/webp"
                    f"&path={quote(готовый)}" if готовый else
                    f"/api/file?src=moderation:thumb&id={ид}"),
            "caption": (автор or "")[:24],
            "kind": "image",
            "group": группа,
            "file": файл,
            "at": (когда or "")[:10],
            "video": False,
        })
    прогреть([э["id"] for э in элементы[:60]], ист)
    return {"items": элементы, "page": 0, "total": len(элементы),
            "pages": 1, "kinds": []}


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
    elif ключ == "find":
        print(json.dumps(найти(параметры), ensure_ascii=False))
    elif ключ == "people":
        print(json.dumps(поиск_человека(параметры), ensure_ascii=False))
    elif ключ == "online":
        print(json.dumps(онлайн(параметры), ensure_ascii=False))
    elif ключ == "adult":
        print(json.dumps(помечено_18(параметры), ensure_ascii=False))
    elif ключ == "thumb":
        print(json.dumps(миниатюра(параметры), ensure_ascii=False))
    else:
        ошибка(f"неизвестный ключ {ключ!r}")


if __name__ == "__main__":
    main()
