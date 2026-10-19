"""Плитка «Продано доступа»: только оплаты.

С 27.09.2026 Togetherly+ выпадает призом из сундука, и такие владельцы лежат в
той же колонке `users.plus`, что и купившие. Плитка складывала всех вместе, и
к 19.10.2026 почти каждая третья «оплата» в ней была призом сундука.

    python3 продано.test.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


СВОДКА = {"sources": {}, "totals": {}, "sold": {"ok": True, "plus_total": 300, "plus": {
    "appstore": 40, "chest": 90, "code": 10, "gift": 30, "grant": 5,
    "lava": 100, "play": 20, "неизвестно": 5}}}


class Продано(unittest.TestCase):
    def плитка(self):
        return main.блоки(СВОДКА, None)["sold"]

    def test_призы_и_ручная_выдача_не_продажи(self):
        self.assertEqual(self.плитка()["value"], 205)

    def test_каналы_названы_по_человечески(self):
        имена = {часть["name"] for часть in self.плитка()["parts"]}
        self.assertEqual(имена, {"lava", "Google Play", "App Store", "в подарок", "по коду",
                                 "неизвестно"})

    def test_больший_канал_первым(self):
        значения = [часть["value"] for часть in self.плитка()["parts"]]
        self.assertEqual(значения, sorted(значения, reverse=True))

    def test_части_складываются_в_число(self):
        плитка = self.плитка()
        self.assertEqual(sum(часть["value"] for часть in плитка["parts"]), плитка["value"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
