"""Под кадром ленты виден возраст того, кто его загрузил.

Модерации это нужно постоянно: снимок под замком «для взрослых» от человека
пятнадцати лет — совсем другой разговор, чем тот же снимок от тридцатилетнего.
Дата рождения лежит в `users.birth_date` базы приложения, загрузивший — в
`media.uid`. Даты нет у большинства людей, и тогда подпись просто не рисуется.

    python3 возраст_человека.test.py
"""
import sqlite3
import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

СЕГОДНЯ = date(2026, 10, 21)
ИСТ = {"thumb": "/несуществующий/{id}_{w}.webp"}


class ПолныхЛет(unittest.TestCase):
    def test_день_рождения_уже_был(self):
        self.assertEqual(main.полных_лет("2005-04-15 22:00:00.000Z", СЕГОДНЯ), 21)

    def test_день_рождения_ещё_впереди(self):
        self.assertEqual(main.полных_лет("2009-12-25 00:00:00.000Z", СЕГОДНЯ), 16)

    def test_день_рождения_сегодня(self):
        self.assertEqual(main.полных_лет("2010-10-21 00:00:00.000Z", СЕГОДНЯ), 16)

    def test_дата_без_времени(self):
        self.assertEqual(main.полных_лет("2005-12-15", СЕГОДНЯ), 20)

    def test_пусто_и_мусор(self):
        for плохо in ("", None, "вчера", "2005-13-40"):
            self.assertIsNone(main.полных_лет(плохо, СЕГОДНЯ), f"на {плохо!r}")

    def test_невозможный_возраст_не_показываем(self):
        # Дату из будущего или столетнюю человек выставил наугад: такая
        # подпись соврёт модератору, лучше промолчать.
        self.assertIsNone(main.полных_лет("2030-01-01", СЕГОДНЯ))
        self.assertIsNone(main.полных_лет("1900-01-01", СЕГОДНЯ))


class ВозрастаЛюдей(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(":memory:")
        self.conn.execute("CREATE TABLE users (id TEXT, birth_date TEXT)")
        self.conn.executemany("INSERT INTO users VALUES (?, ?)", [
            ("u1", "2005-04-15 22:00:00.000Z"),
            ("u2", ""),
            ("u3", "2012-09-14 10:00:00.000Z"),
        ])

    def test_одним_запросом_на_страницу(self):
        возрасты = main.возрасты_людей(self.conn, ["u1", "u2", "u3", "нет"], СЕГОДНЯ)
        self.assertEqual(возрасты, {"u1": 21, "u3": 14})

    def test_пустой_список(self):
        self.assertEqual(main.возрасты_людей(self.conn, ["", None], СЕГОДНЯ), {})

    def test_база_без_колонки_не_роняет_ленту(self):
        conn = sqlite3.connect(":memory:")
        conn.execute("CREATE TABLE users (id TEXT)")
        self.assertEqual(main.возрасты_людей(conn, ["u1"], СЕГОДНЯ), {})


class КарточкаСВозрастом(unittest.TestCase):
    def test_возраст_в_карточке(self):
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", ИСТ, set(), 16)
        self.assertEqual(к["age"], 16)

    def test_без_даты_возраста_нет(self):
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", ИСТ, set())
        self.assertIsNone(к["age"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
