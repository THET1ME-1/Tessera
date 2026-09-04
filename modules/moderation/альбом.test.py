"""Под замком 18+ лежит альбом, а не одна обложка.

Пара ставит замок на воспоминание целиком, а снимков внутри бывает под сотню:
`imageUrl` — только обложка, весь набор живёт в `imageUrls`. Пока лента читала
обложку, модератор видел одну плитку из ста, а «Без 18+» прятал ровно её и
оставлял остальные на виду.

Второе: у ленты с замком нет потолка. Прежний предел в две тысячи свежих
записей отрезал всё старше начала июня — как раз то, за чем в эту ленту и
заходят.

    python3 альбом.test.py
"""
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

# rowid растёт с порядком загрузки: «м1» лежит в хранилище дольше всех.
КАДРЫ = [
    ("м1", "memory_1786968914691_a.jpg", "memories", "пара1"),
    ("м2", "memory_1786968914692_b.jpg", "memories", "пара1"),
    ("м3", "fill_1786968914693_1_c.webp", "canvas", "пара1"),
    ("м4", "memory_1786968914694_d.jpg", "memories", "пара2"),
    ("м5", "memory_1786968914695_e.jpg", "memories", "пара1"),
]


class СсылкиЗаписи(unittest.TestCase):
    def test_обложка_идёт_первой(self):
        self.assertEqual(main.кадры_записи("pb://media/о/о.jpg",
                                           ["pb://media/а/а.jpg"]),
                         ["pb://media/о/о.jpg", "pb://media/а/а.jpg"])

    def test_обложка_из_альбома_не_двоится(self):
        альбом = ["pb://media/о/о.jpg", "pb://media/а/а.jpg"]
        self.assertEqual(main.кадры_записи("pb://media/о/о.jpg", альбом), альбом)

    def test_одиночный_снимок_без_альбома(self):
        self.assertEqual(main.кадры_записи("pb://media/о/о.jpg", None),
                         ["pb://media/о/о.jpg"])

    def test_альбом_без_обложки(self):
        self.assertEqual(main.кадры_записи("", ["pb://media/а/а.jpg"]),
                         ["pb://media/а/а.jpg"])

    def test_пустых_ссылок_не_отдаём(self):
        self.assertEqual(main.кадры_записи(None, ["", None]), [])


class ЛентаСЗамком(unittest.TestCase):
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
        self.было_кадры = main.кадры_с_замком
        main.настройки = lambda: ({"db": путь, "thumb": "", "make": []}, "")
        # Порядок из Postgres нарочно другой: лента обязана переложить кадры
        # по хранилищу, иначе альбом с датой «2000 год» всплывает поверх
        # вчерашних — дату внутри записи ставит сам загрузивший.
        main.кадры_с_замком = lambda: ["м1", "м5", "м3", "м4", "нет-такого"]

    def tearDown(self):
        main.настройки = self.было_настройки
        main.кадры_с_замком = self.было_кадры
        self.папка.cleanup()

    def test_весь_альбом_а_не_обложка(self):
        d = main.лента({"page": "0", "adult": "only"})
        self.assertEqual([э["id"] for э in d["items"]], ["м5", "м4", "м3", "м1"])
        self.assertEqual(d["total"], 4)

    def test_кадра_которого_нет_в_хранилище_лента_не_придумывает(self):
        d = main.лента({"page": "0", "adult": "only"})
        self.assertNotIn("нет-такого", [э["id"] for э in d["items"]])

    def test_фильтры_пары_и_вида_складываются(self):
        d = main.лента({"page": "0", "adult": "only", "group": "пара1",
                        "kind": "Воспоминания"})
        self.assertEqual([э["id"] for э in d["items"]], ["м5", "м1"])
        self.assertEqual(d["group"], "пара1")

    def test_замок_подписан_на_каждом_кадре(self):
        d = main.лента({"page": "0", "adult": "only"})
        self.assertTrue(all(э["adult"] for э in d["items"]))

    def test_глубина_дальше_первой_страницы(self):
        # Потолка нет: страницы считаются от всего набора, а не от окна свежих.
        main.НА_СТРАНИЦЕ, было = 2, main.НА_СТРАНИЦЕ
        try:
            d = main.лента({"page": "1", "adult": "only"})
            self.assertEqual([э["id"] for э in d["items"]], ["м3", "м1"])
            self.assertEqual(d["pages"], 2)
        finally:
            main.НА_СТРАНИЦЕ = было


class ПрогревХолоднойСтраницы(unittest.TestCase):
    """Ядро ждёт модуль пятнадцать секунд, а старая страница холодная целиком."""

    def setUp(self):
        self.папка = tempfile.TemporaryDirectory()
        корень = Path(self.папка.name)
        генератор = корень / "делатель.sh"
        генератор.write_text(
            "#!/bin/sh\n"
            'for id in $(echo "$2" | tr "," " "); do\n'
            f'  echo кадр > "{корень}/${{id}}_512.webp"\n'
            "done\n")
        генератор.chmod(0o755)
        self.ист = {"make": [str(генератор)], "thumb": str(корень) + "/{id}_{w}.webp"}
        self.корень = корень

    def tearDown(self):
        self.папка.cleanup()

    def test_верх_страницы_готов_до_возврата(self):
        main.прогреть([(f"к{i:02d}", "a.webp") for i in range(40)], self.ист, ждать=True)
        готовы = [i for i in range(40)
                  if (self.корень / f"к{i:02d}_512.webp").exists()]
        self.assertEqual(готовы[:16], list(range(16)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
