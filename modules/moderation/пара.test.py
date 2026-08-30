"""Лента модерации умеет показать файлы одной пары.

Разбор жалобы всегда начинается с поиска: нашли пару по имени или почте — и
дальше нужны её файлы, а не общий поток на полмиллиона кадров. Пара живёт в
`media.group_id`, поэтому фильтр стоит ровно там же, где вид файла, и
складывается с ним и с возрастной пометкой.

    python3 пара.test.py
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

КАДРЫ = [
    ("м1", "memory_1786968914693_a.jpg", "memories", "пара1"),
    ("м2", "memory_1786968914694_b.jpg", "memories", "пара2"),
    ("м3", "fill_1786968914695_1_c.webp", "canvas", "пара1"),
    ("м4", "memory_1786968914696_d.jpg", "memories", "пара1"),
    ("м5", "avatar_1786968914697_e.jpg", "avatar", "пара2"),
]


class ЛентаПары(unittest.TestCase):
    def setUp(self):
        self.папка = tempfile.TemporaryDirectory()
        путь = str(Path(self.папка.name) / "data.db")
        conn = sqlite3.connect(путь)
        conn.execute("CREATE TABLE media (id TEXT PRIMARY KEY, file TEXT, "
                     "kind TEXT, group_id TEXT)")
        conn.executemany("INSERT INTO media VALUES (?,?,?,?)", КАДРЫ)
        conn.commit()
        conn.close()
        # Ни миниатюр, ни Postgres: проверяем отбор, а не окружение.
        self.было = main.настройки
        main.настройки = lambda: ({"db": путь, "thumb": "", "make": []}, "")

    def tearDown(self):
        main.настройки = self.было
        self.папка.cleanup()

    def test_видны_только_кадры_этой_пары(self):
        d = main.лента({"page": "0", "group": "пара1"})
        self.assertEqual({э["id"] for э in d["items"]}, {"м1", "м3", "м4"})

    def test_счётчик_считает_только_её_кадры(self):
        d = main.лента({"page": "0", "group": "пара1"})
        self.assertEqual(d["total"], 3)
        self.assertEqual(d["pages"], 1)

    def test_панель_узнаёт_фильтр_из_ответа(self):
        # Плашку «показаны файлы пары такой-то» рисует панель, и знать о
        # фильтре она может только из ответа: страницу могли открыть ссылкой.
        self.assertEqual(main.лента({"page": "0", "group": "пара1"})["group"], "пара1")
        self.assertEqual(main.лента({"page": "0"})["group"], "")

    def test_пробелы_вокруг_id_не_мешают(self):
        d = main.лента({"page": "0", "group": "  пара2 "})
        self.assertEqual({э["id"] for э in d["items"]}, {"м2", "м5"})

    def test_вид_и_пара_складываются(self):
        d = main.лента({"page": "0", "group": "пара1", "kind": "Холсты"})
        self.assertEqual([э["id"] for э in d["items"]], ["м3"])
        self.assertEqual(d["total"], 1)

    def test_незнакомая_пара_даёт_пустую_ленту(self):
        d = main.лента({"page": "0", "group": "такой-пары-нет"})
        self.assertEqual(d["items"], [])
        self.assertEqual(d["total"], 0)

    def test_без_фильтра_лента_прежняя(self):
        d = main.лента({"page": "0"})
        self.assertEqual(d["total"], len(КАДРЫ))


class ЛентаПарыСЗамком(unittest.TestCase):
    """«Только 18+» уходит в свою ветку — пара не должна там теряться."""

    def setUp(self):
        self.папка = tempfile.TemporaryDirectory()
        путь = str(Path(self.папка.name) / "data.db")
        conn = sqlite3.connect(путь)
        conn.execute("CREATE TABLE media (id TEXT PRIMARY KEY, file TEXT, "
                     "kind TEXT, group_id TEXT)")
        conn.executemany("INSERT INTO media VALUES (?,?,?,?)", КАДРЫ)
        conn.commit()
        conn.close()
        self.было_настройки = main.настройки
        self.было_замки = main.кадры_с_замком
        main.настройки = lambda: ({"db": путь, "thumb": "", "make": []}, "")
        main.кадры_с_замком = lambda предел=2000: ["м4", "м2", "м1"]

    def tearDown(self):
        main.настройки = self.было_настройки
        main.кадры_с_замком = self.было_замки
        self.папка.cleanup()

    def test_помеченные_кадры_только_этой_пары(self):
        d = main.лента({"page": "0", "adult": "only", "group": "пара1"})
        self.assertEqual([э["id"] for э in d["items"]], ["м4", "м1"])
        self.assertEqual(d["total"], 2)
        self.assertEqual(d["group"], "пара1")


class ПоискЗовётЛенту(unittest.TestCase):
    """Найденную пару должно быть чем открыть: связку описывает сам модуль."""

    def test_таблица_пар_помечает_колонку_с_ид(self):
        ответ = main.поиск_пары({"q": "аб"})     # короткий запрос, база не нужна
        связь = ответ.get("link") or {}
        self.assertEqual(связь.get("col"), 0)
        self.assertEqual(ответ["cols"][связь["col"]], "пара")
        self.assertEqual(связь.get("src"), "moderation:shelf")
        self.assertEqual(связь.get("param"), "group")

    def test_общий_поиск_несёт_связку_в_разделе_пар(self):
        было = main.поиск_человека, main.поиск_пары
        main.поиск_человека = lambda п: {"cols": ["человек"], "rows": []}
        try:
            main.поиск_пары = lambda п: {"cols": ["пара"], "rows": [["п1"]],
                                         "link": {"col": 0, "src": "moderation:shelf",
                                                  "param": "group"}}
            разделы = main.найти({"q": "пара"})["sections"]
            пары = [р for р in разделы if р["title"] == "Пары"]
            self.assertTrue(пары, "раздел «Пары» пропал")
            self.assertEqual(пары[0]["link"]["param"], "group")
        finally:
            main.поиск_человека, main.поиск_пары = было


if __name__ == "__main__":
    unittest.main(verbosity=2)
