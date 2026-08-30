"""Покупки по магазинам: сколько штук и сколько денег.

Плитка «Продано доступа» считает людей: сто пятьдесят три оплаты за всё время.
Денег в ней нет, и по ней не сказать, сколько принёс App Store, а сколько
Google Play — при том, что чек в них разный: доллар в Штатах и восемьсот
рублей в России дают разные строки в отчёте.

Блок показывает текущий месяц: покупки, деньги за вычетом комиссии магазина и
средний чек. Считает не он — комиссии, курсы и возвраты остаются в сборе, сюда
приезжают готовые доллары.

    python3 покупки.test.py
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


СВОДКА = {
    "sources": {
        "play": {"ok": True, "title": "Google Play", "purchases": [
            {"name": "togetherly_plus", "count": 32, "usd": 276.08},
            {"name": "mood_pack.moti", "count": 2, "usd": 8.55},
        ]},
        "appstore": {"ok": True, "title": "App Store", "purchases": [
            {"name": "togetherly_plus", "count": 4, "usd": 11.9},
        ]},
        "lava": {"ok": True, "title": "lava, все каналы", "purchases": [
            {"name": "Togetherly+ — полный доступ", "count": 100, "usd": 831.6},
            {"name": "донат", "count": 2, "usd": 0.98},
        ]},
        "rsya": {"ok": True, "title": "Яндекс, реклама", "month": 318.25},
    },
}


class Строки(unittest.TestCase):
    def таблица(self, сводка=None):
        return main.покупки(сводка if сводка is not None else СВОДКА)

    def test_магазины_каждый_своей_строкой(self):
        где = [r[1] for r in self.таблица()["rows"]]
        self.assertIn("App Store", где)
        self.assertIn("Google Play", где)
        self.assertIn("lava, все каналы", где)

    def test_реклама_в_покупки_не_лезет(self):
        # У рекламы нет ни покупок, ни чека: строка «Яндекс — 318 $» в таблице
        # покупок читалась бы как триста долларов проданного доступа.
        self.assertNotIn("Яндекс, реклама", [r[1] for r in self.таблица()["rows"]])

    def test_имена_товаров_человеческие(self):
        # `togetherly_plus` и «Togetherly+ — полный доступ» — один и тот же
        # Плюс, названный по-разному в двух магазинах. В таблице он должен
        # читаться одинаково, иначе строки не сравнить глазами.
        имена = {r[0] for r in self.таблица()["rows"]}
        self.assertIn("Плюс", имена)
        self.assertNotIn("togetherly_plus", имена)
        self.assertIn("Набор настроений", имена)

    def test_средний_чек_считается(self):
        строка = next(r for r in self.таблица()["rows"] if r[1] == "App Store")
        self.assertEqual(строка[2], 4)             # покупок
        self.assertEqual(строка[3], 11.9)          # денег
        self.assertEqual(строка[4], 2.98)          # средний чек

    def test_дорогое_сверху(self):
        деньги = [r[3] for r in self.таблица()["rows"]]
        self.assertEqual(деньги, sorted(деньги, reverse=True))

    def test_один_товар_в_магазине_одной_строкой(self):
        # lava ведёт счёт по валютам: сто покупок Плюса в рублях и семь в
        # долларах — это два ряда с одним именем. В таблице они читались бы
        # как два разных товара, поэтому складываются.
        сводка = {"sources": {"lava": {"ok": True, "title": "lava", "purchases": [
            {"name": "Togetherly+ — полный доступ", "count": 98, "usd": 887.09},
            {"name": "Togetherly+ — полный доступ", "count": 7, "usd": 64.4},
            {"name": "донат", "count": 2, "usd": 0.98},
        ]}}}
        строки = self.таблица(сводка)["rows"]
        плюс = [r for r in строки if r[0] == "Плюс"]
        self.assertEqual(len(плюс), 1, строки)
        self.assertEqual(плюс[0][2], 105)
        self.assertEqual(плюс[0][3], 951.49)

    def test_пустая_сводка_не_роняет_блок(self):
        self.assertEqual(self.таблица({})["rows"], [])
        self.assertEqual(main.покупки(None)["rows"], [])

    def test_магазин_без_покупок_строки_не_даёт(self):
        # Пустой месяц у App Store — это ноль строк, а не строка с нулями:
        # нулевая строка читается как «продали на ноль долларов», хотя продаж
        # просто не было.
        сводка = {"sources": {"appstore": {"ok": True, "title": "App Store", "purchases": []}}}
        self.assertEqual(self.таблица(сводка)["rows"], [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
