"""Возраст кадра берётся из имени файла, а таблица `media` его не знает вовсе.

В `media` шесть колонок — файл, пара, id, вид, человек, источник — и ни одной
даты. Зато приложение кладёт метку времени прямо в имя: `memory_1786968914693_…`,
`fill_1786993617496_140_…`. Модерации возраст нужен постоянно: свежая жалоба и
кадр полугодовой давности — разные разговоры.

    python3 возраст.test.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


class ВозрастИзИмени(unittest.TestCase):
    def test_воспоминание(self):
        self.assertEqual(
            main.метка_времени("memory_1786968914693_8ilq5wccee.jpg"), 1786968914)

    def test_холст(self):
        self.assertEqual(
            main.метка_времени("fill_1786993617496_2698_f7qbicyweh.webp"), 1786993617)

    def test_аватарка_без_метки(self):
        # `profile_dfak41h6kg.jpg` метки не несёт: такие кадры остаются без
        # возраста, и подпись под ними просто не рисуется.
        self.assertEqual(main.метка_времени("profile_dfak41h6kg.jpg"), 0)

    def test_пустое_имя(self):
        self.assertEqual(main.метка_времени(""), 0)
        self.assertEqual(main.метка_времени(None), 0)

    def test_чужие_числа_не_путаются_с_меткой(self):
        # Первое длинное число в имени — не всегда метка: у холстов за ним
        # идёт короткий счётчик кадра. Секунды из будущего или из прошлого
        # века берём за мусор и отдаём ноль.
        self.assertEqual(main.метка_времени("fill_140_kmtkz4tmtq.png"), 0)
        self.assertEqual(main.метка_времени("memory_99_x.jpg"), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
