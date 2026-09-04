"""Лента умеет показать один формат: фото, ролики или звук.

Роликов в хранилище 0,75 % — девять тысяч на миллион с четвертью файлов, и
лежат они вперемешку со снимками внутри «Воспоминаний». Без этого фильтра до
них не долистать: страница ленты — шестьдесят кадров, а ролик попадается
раз в сто тридцать.

Формат берётся из имени файла: собственной колонки под него в `media` нет, а
`kind` говорит о другом — «voice» это и m4a, и ogg, зато mp4 живёт и в
«memory», и в «widget_anim».

    python3 формат.test.py
"""
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

КАДРЫ = [
    ("ф1", "memory_1786968914691_a.jpg", "memories", "пара1"),
    ("в1", "memory_1786968914692_b.mp4", "memories", "пара1"),
    ("з1", "voice_1786968914693_c.m4a", "voice", "пара1"),
    ("ф2", "memory_1786968914694_d.webp", "memories", "пара2"),
    ("в2", "widget_1786968914695_e.mov", "widget_anim", "пара1"),
]


def база(папка):
    путь = os.path.join(папка, "data.db")
    conn = sqlite3.connect(путь)
    conn.execute("CREATE TABLE media (id TEXT, file TEXT, kind TEXT, group_id TEXT)")
    conn.executemany("INSERT INTO media VALUES (?,?,?,?)", КАДРЫ)
    conn.commit()
    conn.close()
    return путь


class Лента(unittest.TestCase):
    def setUp(self):
        self.врем = tempfile.TemporaryDirectory()
        self.addCleanup(self.врем.cleanup)
        self.корень = os.path.join(self.врем.name, "корень")
        os.makedirs(self.корень)
        ист = {"db": база(self.врем.name), "thumb": "/нет/{id}_{w}.webp"}
        старые = main.настройки
        main.настройки = lambda: (ист, self.корень)
        self.addCleanup(lambda: setattr(main, "настройки", старые))

    def ленту(self, **параметры):
        return main.лента({"page": "0", **параметры})

    def test_без_фильтра_видно_всё(self):
        d = self.ленту()
        self.assertEqual(d["total"], 5)

    def test_только_ролики(self):
        d = self.ленту(fmt="Видео")
        self.assertEqual([э["id"] for э in d["items"]], ["в2", "в1"])
        self.assertEqual(d["total"], 2)

    def test_только_звук(self):
        d = self.ленту(fmt="Звук")
        self.assertEqual([э["id"] for э in d["items"]], ["з1"])

    def test_фото_это_всё_остальное(self):
        # «Фото» задаётся отрицанием, а не списком расширений: png, jpg, webp,
        # heic, gif, dng — перечислять их значит забыть седьмое и потерять
        # снимки из ленты молча.
        d = self.ленту(fmt="Фото")
        self.assertEqual(sorted(э["id"] for э in d["items"]), ["ф1", "ф2"])

    def test_формат_дружит_с_видом_и_парой(self):
        d = self.ленту(fmt="Видео", kind="Воспоминания")
        self.assertEqual([э["id"] for э in d["items"]], ["в1"])
        d = self.ленту(fmt="Видео", group="пара1")
        self.assertEqual([э["id"] for э in d["items"]], ["в2", "в1"])

    def test_незнакомый_формат_не_режет_ленту(self):
        # Значение приходит из адреса, и «Видио» в нём — не повод показать
        # пустую ленту: неизвестный фильтр просто не применяется.
        self.assertEqual(self.ленту(fmt="Видио")["total"], 5)

    def test_панель_узнаёт_список_форматов(self):
        self.assertEqual(self.ленту()["formats"], ["Фото", "Видео", "Звук"])


class СчётПоФормату(unittest.TestCase):
    """Общее число кадров считается сканом, поэтому живёт в кэше.

    Колонки с форматом у `media` нет, отбор идёт по имени файла — на проде это
    полный проход по 1,2 млн строк, полторы секунды. Один раз это терпимо, на
    каждой странице листания — нет.
    """

    def setUp(self):
        self.врем = tempfile.TemporaryDirectory()
        self.addCleanup(self.врем.cleanup)
        self.корень = os.path.join(self.врем.name, "корень")
        os.makedirs(self.корень)
        self.db = база(self.врем.name)
        ист = {"db": self.db, "thumb": "/нет/{id}_{w}.webp"}
        старые = main.настройки
        main.настройки = lambda: (ист, self.корень)
        self.addCleanup(lambda: setattr(main, "настройки", старые))

    def test_второй_запрос_берёт_число_из_кэша(self):
        main.лента({"page": "0", "fmt": "Видео"})
        # База изменилась, а кэш ещё свеж: число остаётся прежним. Это и есть
        # цена решения — полчаса лента может показывать вчерашний счёт.
        conn = sqlite3.connect(self.db)
        conn.execute("INSERT INTO media VALUES ('в3','x_1786968914696_f.mp4','memories','пара1')")
        conn.commit()
        conn.close()
        d = main.лента({"page": "0", "fmt": "Видео"})
        self.assertEqual(d["total"], 2)
        self.assertEqual(len(d["items"]), 3)      # сами кадры всегда свежие

    def test_кэш_пишется_рядом_с_копиями(self):
        main.лента({"page": "0", "fmt": "Звук"})
        файл = os.path.join(self.корень, main.ФАЙЛ_СЧЁТА)
        self.assertTrue(os.path.exists(файл))
        with open(файл, encoding="utf-8") as f:
            self.assertTrue(json.load(f))

    def test_битый_кэш_не_роняет_ленту(self):
        with open(os.path.join(self.корень, main.ФАЙЛ_СЧЁТА), "w", encoding="utf-8") as f:
            f.write("{это не json")
        self.assertEqual(main.лента({"page": "0", "fmt": "Видео"})["total"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
