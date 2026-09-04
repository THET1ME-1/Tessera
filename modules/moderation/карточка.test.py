"""Карточка ленты несёт всё, что нужно модератору с одного взгляда.

Пару видно по `group` — её копируют, чтобы уйти в переписку или в поддержку.
Возраст говорит, свежая ли это жалоба. Пометка «для взрослых» приезжает из
самого приложения: замок на воспоминании ставит пара, а не модерация.

    python3 карточка.test.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

ИСТ = {"thumb": "/несуществующий/{id}_{w}.webp"}


class ИдИзСсылки(unittest.TestCase):
    def test_обычная_ссылка(self):
        self.assertEqual(
            main.ид_из_ссылки("pb://media/8niveuqzc2sxs4a/memory_1786976251169_9y.webp"),
            "8niveuqzc2sxs4a")

    def test_мусор(self):
        for плохо in ("", None, "pb://media/", "https://example.org/a/b/c/d",
                      "pb://media/только_id"):
            self.assertEqual(main.ид_из_ссылки(плохо), "", f"на {плохо!r}")


class Карточка(unittest.TestCase):
    def test_несёт_пару_возраст_и_вид(self):
        к = main.карточка("abc123", "memory_1786968914693_8ilq5wccee.jpg",
                          "memories", "rbede7877a819da", ИСТ, set())
        self.assertEqual(к["id"], "abc123")
        self.assertEqual(к["group"], "rbede7877a819da")
        self.assertEqual(к["caption"], "Воспоминания")
        self.assertEqual(к["ts"], 1786968914)
        self.assertFalse(к["adult"])
        self.assertFalse(к["video"])

    def test_пометка_взрослого_приезжает_из_приложения(self):
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", ИСТ, {"abc123"})
        self.assertTrue(к["adult"])

    def test_видео_узнаётся_по_расширению(self):
        к = main.карточка("v1", "memory_1786968914693_x.mp4", "memories",
                          "гру", ИСТ, set())
        self.assertTrue(к["video"])
        self.assertFalse(к["audio"])

    def test_ролик_и_голосовое_дают_адрес_для_проигрывания(self):
        # Кадр показывает, что в ролике, но жалоба разбирается по звуку и
        # движению: без этого адреса модератору осталось бы только скачать
        # файл и открыть его в чужой программе.
        for имя in ("memory_1786968914693_x.mp4", "voice_1786968914693_x.m4a"):
            к = main.карточка("v1", имя, "memories", "гру", ИСТ, set())
            self.assertIn("moderation:original", к["play"], имя)
            self.assertIn("id=v1", к["play"], имя)

    def test_у_снимка_проигрывать_нечего(self):
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", ИСТ, set())
        self.assertEqual(к["play"], "")

    def test_у_голосового_кадра_не_бывает(self):
        # Миниатюру звука не сделает никакой генератор, и адрес к ней —
        # обещание пустой плитки с надписью «кадр ещё готовится». Пусто в
        # адресе честнее: панель по флагу рисует плашку.
        к = main.карточка("g1", "voice_1786968914693_x.m4a", "voice",
                          "гру", ИСТ, set())
        self.assertTrue(к["audio"])
        self.assertEqual(к["url"], "")

    def test_готовой_миниатюры_нет_значит_адрес_без_пути(self):
        # Кадра ещё нет на диске — адрес остаётся прежним, миниатюра сделается
        # на месте, при запросе. Готовый путь подставляется только когда файл
        # уже лежит.
        к = main.карточка("abc123", "memory_1786968914693_x.jpg", "memories",
                          "гру", ИСТ, set())
        self.assertNotIn("path=", к["url"])
        self.assertIn("id=abc123", к["url"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
