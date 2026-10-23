"""Лента листается от одного среза хранилища, и новые файлы её не сдвигают.

Первую страницу панель берёт из сводки, а сводку модуль собирает раз в
полчаса. Следующие страницы шли живым запросом со смещением от самого
свежего файла, и за полчаса сверху набегали сотни новых: 23.10.2026 на
третьей странице снова стояли кадры с первой, 43 из 60. Теперь первая
страница отдаёт `top` — самый свежий rowid хранилища в момент ответа, — и
панель просит следующие страницы «не новее него».

    python3 срез.test.py
"""
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

КАДРЫ = [(f"к{н}", f"memory_{н}.jpg", "memories", "пара1") for н in range(1, 7)]


def вставить(путь, кадры):
    conn = sqlite3.connect(путь)
    conn.executemany("INSERT INTO media (id, file, kind, group_id) VALUES (?,?,?,?)", кадры)
    conn.commit()
    conn.close()


class Срез(unittest.TestCase):
    def setUp(self):
        self.папка = tempfile.TemporaryDirectory()
        self.addCleanup(self.папка.cleanup)
        self.путь = os.path.join(self.папка.name, "data.db")
        conn = sqlite3.connect(self.путь)
        conn.execute("CREATE TABLE media (id TEXT, file TEXT, kind TEXT, group_id TEXT, "
                     "uid TEXT DEFAULT '')")
        conn.close()
        вставить(self.путь, КАДРЫ)
        было_настройки, было_замки, было_страница = (
            main.настройки, main.кадры_с_замком, main.НА_СТРАНИЦЕ)
        # Корень — своя папка: счёт по формату пишется туда файлом.
        main.настройки = lambda: ({"db": self.путь, "thumb": "", "make": []}, self.папка.name)
        main.кадры_с_замком = lambda: ["к1", "к3", "к5", "н2"]
        main.НА_СТРАНИЦЕ = 2

        def вернуть():
            main.настройки = было_настройки
            main.кадры_с_замком = было_замки
            main.НА_СТРАНИЦЕ = было_страница
        self.addCleanup(вернуть)

    def ids(self, d):
        return [э["id"] for э in d["items"]]

    def test_первая_страница_называет_срез(self):
        d = main.лента({"page": "0"})
        self.assertEqual(self.ids(d), ["к6", "к5"])
        self.assertEqual(d["top"], 6)

    def test_новые_файлы_не_сдвигают_следующую_страницу(self):
        первая = main.лента({"page": "0"})
        вставить(self.путь, [("н1", "memory_н1.jpg", "memories", "пара1"),
                             ("н2", "memory_н2.jpg", "memories", "пара1")])
        вторая = main.лента({"page": "1", "top": str(первая["top"])})
        self.assertEqual(self.ids(вторая), ["к4", "к3"])
        self.assertEqual(вторая["top"], первая["top"])

    def test_без_среза_страница_живая(self):
        вставить(self.путь, [("н1", "memory_н1.jpg", "memories", "пара1")])
        d = main.лента({"page": "0"})
        self.assertEqual(self.ids(d), ["н1", "к6"])
        self.assertEqual(d["top"], 7)

    def test_срез_держит_и_фильтр_формата(self):
        первая = main.лента({"page": "0", "fmt": "Фото"})
        вставить(self.путь, [("н1", "memory_н1.jpg", "memories", "пара1")])
        вторая = main.лента({"page": "1", "fmt": "Фото", "top": str(первая["top"])})
        self.assertEqual(self.ids(вторая), ["к4", "к3"])

    def test_срез_держит_ленту_с_замком(self):
        первая = main.лента({"page": "0", "adult": "only"})
        self.assertEqual(self.ids(первая), ["к5", "к3"])
        вставить(self.путь, [("н1", "memory_н1.jpg", "memories", "пара1"),
                             ("н2", "memory_н2.jpg", "memories", "пара1")])
        вторая = main.лента({"page": "1", "adult": "only", "top": str(первая["top"])})
        self.assertEqual(self.ids(вторая), ["к1"])

    def test_лента_называет_свой_вид(self):
        # Панель сверяет вид сводки со своим и перезапрашивает ленту, только
        # если они разошлись.
        self.assertEqual(main.лента({"page": "0", "kind": "Воспоминания"})["kind"],
                         "Воспоминания")
        self.assertEqual(main.лента({"page": "0"})["kind"], "")

    def test_сводка_показывает_воспоминания(self):
        вставить(self.путь, [("х1", "canvas_1.jpg", "canvas", "пара1")])
        старое = main.убрать_копии
        main.убрать_копии = lambda корень: None
        self.addCleanup(lambda: setattr(main, "убрать_копии", старое))
        лента = main.собрать()["shelf"]
        self.assertEqual(лента["kind"], "Воспоминания")
        self.assertNotIn("х1", self.ids(лента))

    def test_мусор_вместо_среза_не_роняет_ленту(self):
        d = main.лента({"page": "0", "top": "абв"})
        self.assertEqual(self.ids(d), ["к6", "к5"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
