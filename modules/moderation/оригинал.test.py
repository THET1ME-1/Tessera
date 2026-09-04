"""Оригинал — файл как есть, а не миниатюра.

Лента живёт на webp-плитках: они обрезаны по длинной стороне и перекодированы.
Для разбора жалобы этого мало — нужен тот самый файл, который загрузил
человек, с его весом, размером и расширением.

Файлы приложения с 21 августа лежат в бакете, а `pb_data/storage` удалён,
поэтому оригинал почти всегда приходится выкачивать. Копия кладётся внутрь
объявленного корня: ядро отдаёт только то, что лежит там, и на путь во
временную папку ответит отказом.

    python3 оригинал.test.py
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


def база_с_файлом(папка, ид, имя):
    путь = os.path.join(папка, "data.db")
    conn = sqlite3.connect(путь)
    conn.execute("CREATE TABLE media (id TEXT, file TEXT, kind TEXT, group_id TEXT)")
    conn.execute("INSERT INTO media VALUES (?,?,?,?)", (ид, имя, "memories", "гру"))
    conn.commit()
    conn.close()
    return путь


class Карточка(unittest.TestCase):
    """Адрес скачивания приезжает вместе с кадром: панель не сочиняет его сама."""

    def test_кадр_несёт_адрес_оригинала(self):
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", {"thumb": "/нет/{id}_{w}.webp"}, set())
        self.assertIn("moderation:original", к["download"])
        self.assertIn("id=abc123", к["download"])
        self.assertIn("download=1", к["download"])


class Оригинал(unittest.TestCase):
    def setUp(self):
        self.врем = tempfile.TemporaryDirectory()
        self.addCleanup(self.врем.cleanup)
        self.корень = os.path.join(self.врем.name, "thumb_cache")
        os.makedirs(self.корень)
        self.склад = os.path.join(self.врем.name, "storage", main.КОЛЛЕКЦИЯ, "abc123")
        os.makedirs(self.склад)
        self.db = база_с_файлом(self.врем.name, "abc123",
                                "memory_1786968914693_x.jpg")

        ист = {"db": self.db, "storage": os.path.join(self.врем.name, "storage")}
        self.старые = main.настройки
        main.настройки = lambda: (ист, self.корень)
        self.addCleanup(lambda: setattr(main, "настройки", self.старые))

    def положить_на_диск(self, содержимое=b"snapshot"):
        путь = os.path.join(self.склад, "memory_1786968914693_x.jpg")
        with open(путь, "wb") as f:
            f.write(содержимое)
        return путь

    def test_файл_с_диска_копируется_в_корень_модуля(self):
        # Ядро отдаёт только то, что лежит внутри объявленного корня. Исходник
        # лежит в хранилище приложения, то есть снаружи, — значит копия.
        self.положить_на_диск()
        ответ = main.оригинал({"id": "abc123"})
        self.assertTrue(ответ["path"].startswith(self.корень + os.sep),
                        ответ["path"])
        self.assertTrue(os.path.exists(ответ["path"]))
        with open(ответ["path"], "rb") as f:
            self.assertEqual(f.read(), b"snapshot")

    def test_тип_webp_узнаётся_без_помощи_питона(self):
        # На сервере питон 3.10, и webp он не знает — а лента почти целиком
        # из webp. Без своей таблицы каждый кадр уходил бы «двоичным файлом».
        conn = sqlite3.connect(self.db)
        conn.execute("UPDATE media SET file='memory_1786968914693_x.webp' WHERE id='abc123'")
        conn.commit()
        conn.close()
        with open(os.path.join(self.склад, "memory_1786968914693_x.webp"), "wb") as f:
            f.write(b"webp")
        self.assertEqual(main.оригинал({"id": "abc123"})["type"], "image/webp")

    def test_сохраняется_под_исходным_именем(self):
        # Имя в ответе — то, под которым файл сохранится у модератора. Имя
        # файла на диске для этого не годится: копия зовётся с id в начале,
        # чтобы кадры разных записей не затирали друг друга.
        self.положить_на_диск()
        ответ = main.оригинал({"id": "abc123"})
        self.assertEqual(ответ["name"], "memory_1786968914693_x.jpg")
        self.assertEqual(ответ["type"], "image/jpeg")

    def test_второй_запрос_не_выкачивает_заново(self):
        путь = self.положить_на_диск()
        первый = main.оригинал({"id": "abc123"})["path"]
        os.remove(путь)                       # исходника больше нет нигде
        второй = main.оригинал({"id": "abc123"})["path"]
        self.assertEqual(первый, второй)
        self.assertTrue(os.path.exists(второй))

    def test_ролик_отдаётся_с_видеотипом_и_одной_копией(self):
        # Тип решает, покажет ли браузер плеер: с «двоичным файлом» вместо
        # video/mp4 в лайтбоксе остаётся чёрный прямоугольник. Копия у ролика
        # одна на оба положения тумблера даты: подписывать его нечем, а вторая
        # копия — это вторая выкачка тех же мегабайт из бакета.
        conn = sqlite3.connect(self.db)
        conn.execute("UPDATE media SET file='memory_1786968914693_x.mp4' WHERE id='abc123'")
        conn.commit()
        conn.close()
        with open(os.path.join(self.склад, "memory_1786968914693_x.mp4"), "wb") as f:
            f.write(b"clip")
        ответ = main.оригинал({"id": "abc123"})
        self.assertEqual(ответ["type"], "video/mp4")
        self.assertEqual(ответ["path"], main.оригинал({"id": "abc123", "date": "0"})["path"])

    def test_голосовое_отдаётся_звуковым_типом(self):
        conn = sqlite3.connect(self.db)
        conn.execute("UPDATE media SET file='voice_1786968914693_x.m4a' WHERE id='abc123'")
        conn.commit()
        conn.close()
        with open(os.path.join(self.склад, "voice_1786968914693_x.m4a"), "wb") as f:
            f.write(b"sound")
        self.assertEqual(main.оригинал({"id": "abc123"})["type"], "audio/mp4")

    def test_без_id_отказ(self):
        for плохо in ({}, {"id": ""}, {"id": "../../etc/passwd"}, {"id": "a/b"}):
            with self.assertRaises(SystemExit, msg=f"на {плохо!r}"):
                main.оригинал(плохо)

    def test_неизвестный_id_отказ(self):
        with self.assertRaises(SystemExit):
            main.оригинал({"id": "нетутакого"})

    def test_имя_из_базы_не_уводит_из_корня(self):
        # Имя файла приходит из чужой базы. «../../» в нём не должно вывести
        # копию за корень: там ядро её и не отдаст, но складывать чужие файлы
        # по всему диску незачем.
        conn = sqlite3.connect(self.db)
        conn.execute("UPDATE media SET file='../../беглец.jpg' WHERE id='abc123'")
        conn.commit()
        conn.close()
        путь = os.path.join(self.склад, "..", "..", "беглец.jpg")
        with open(путь, "wb") as f:
            f.write(b"alien")
        ответ = main.оригинал({"id": "abc123"})
        self.assertTrue(os.path.realpath(ответ["path"]).startswith(
            os.path.realpath(self.корень) + os.sep), ответ["path"])


class Уборка(unittest.TestCase):
    """Выкачанные копии — кэш, а не хранилище: сутки, и они уходят."""

    def test_вчерашние_копии_убираются(self):
        with tempfile.TemporaryDirectory() as врем:
            склад = os.path.join(врем, "_orig")
            os.makedirs(склад)
            старый = os.path.join(склад, "старый.jpg")
            свежий = os.path.join(склад, "свежий.jpg")
            for п in (старый, свежий):
                with open(п, "wb") as f:
                    f.write(b"x")
            вчера = os.path.getmtime(старый) - 60 * 60 * 30
            os.utime(старый, (вчера, вчера))

            main.убрать_копии(врем)

            self.assertFalse(os.path.exists(старый))
            self.assertTrue(os.path.exists(свежий))


if __name__ == "__main__":
    unittest.main(verbosity=2)
