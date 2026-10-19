"""Таблица источников: прошлый месяц у каждого.

lava и AdMob в сводке прошлого месяца не держат, и 19.10.2026 таблица
показывала у lava «Прошлый месяц 0,00 $», хотя в сентябре она продавала
больше всех. В архиве по месяцам прошлый месяц есть у каждого источника.

    python3 источники.test.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


СВОДКА = {
    "updated": "2026-10-19T18:07:00.005Z",
    "totals": {},
    "sources": {
        "lava": {"ok": True, "title": "lava, все каналы", "today": 10.0, "month": 300.0},
        "admob": {"ok": True, "title": "AdMob, реклама", "today": 0.01, "month": 0.5},
        "play": {"ok": True, "title": "Google Play", "month": 50.0, "prev_month": 40.0},
    },
}
АРХИВ = {"months": [
    {"m": "2026-08", "total": 900.0, "lava": 500.0, "admob": 5.0, "play": 100.0},
    {"m": "2026-09", "total": 700.0, "lava": 400.0, "admob": 9.5, "play": 45.0},
    {"m": "2026-10", "total": 600.0, "lava": 310.0, "admob": 0.5, "play": 50.0},
]}


class ПрошлыйМесяц(unittest.TestCase):
    def строки(self, сводка=СВОДКА, архив=АРХИВ):
        return {r[0]: r for r in main.блоки(сводка, архив)["sources"]["rows"]}

    def test_у_lava_и_AdMob_прошлый_месяц_из_архива(self):
        строки = self.строки()
        self.assertEqual(строки["lava, все каналы"][3], 400.0)
        self.assertEqual(строки["AdMob, реклама"][3], 9.5)

    def test_свой_прошлый_месяц_источника_главнее_архива(self):
        # Google Play сам знает свой прошлый месяц по отчёту о доходах.
        self.assertEqual(self.строки()["Google Play"][3], 40.0)

    def test_без_архива_прошлый_месяц_пустой_а_не_чужой(self):
        self.assertEqual(self.строки(архив=None)["lava, все каналы"][3], 0.0)

    def test_месяц_считается_от_времени_сводки(self):
        # Первого ноября сводка уже ноябрьская, и прошлым становится октябрь.
        сводка = dict(СВОДКА, updated="2026-11-01T00:30:00Z")
        self.assertEqual(self.строки(сводка)["lava, все каналы"][3], 310.0)
        январская = dict(СВОДКА, updated="2027-01-05T10:00:00Z")
        архив = {"months": [{"m": "2026-12", "total": 1.0, "lava": 7.5}]}
        self.assertEqual(self.строки(январская, архив)["lava, все каналы"][3], 7.5)


class СегодняУМагазинов(unittest.TestCase):
    """App Store и Google Play присылают продажи дня только назавтра, и ноль
    в «Сегодня» читался как поломка (19.10.2026: «почему тут 0 гугл и эпл»)."""

    def строки(self):
        сводка = dict(СВОДКА, sources=dict(СВОДКА["sources"], appstore={
            "ok": True, "title": "App Store", "today": 0.0, "month": 391.13}))
        return {r[0]: r for r in main.блоки(сводка, АРХИВ)["sources"]["rows"]}

    def test_у_магазинов_в_сегодня_прочерк(self):
        self.assertEqual(self.строки()["App Store"][1], "—")
        self.assertEqual(self.строки()["Google Play"][1], "—")

    def test_у_рекламы_и_lava_сегодня_числом(self):
        self.assertEqual(self.строки()["lava, все каналы"][1], 10.0)
        self.assertEqual(self.строки()["AdMob, реклама"][1], 0.01)

    def test_месяц_у_магазинов_остаётся(self):
        self.assertEqual(self.строки()["App Store"][2], 391.13)


if __name__ == "__main__":
    unittest.main(verbosity=2)
