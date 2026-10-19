"""«Сегодня» у App Store и Google Play — по нашим чекам.

Магазины присылают продажи дня только назавтра, и колонка «Сегодня» у них
каждый день стояла прочерком. Владелец, 19.10.2026: «какой смысл?» Каждая
оплата в Play и App Store сразу приходит на наш сервер проверять чек, поэтому
сегодняшние покупки известны: их число умножаем на среднюю выручку за штуку в
этом месяце, а назавтра точную цифру даёт отчёт магазина.

    python3 сегодня.test.py
"""
import os
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


def метка(момент):
    return момент.strftime("%Y-%m-%d %H:%M:%S.000Z")


class ПокупкиСПолуночи(unittest.TestCase):
    def setUp(self):
        self.папка = tempfile.mkdtemp()
        self.путь = os.path.join(self.папка, "data.db")
        база = sqlite3.connect(self.путь)
        база.execute("CREATE TABLE iap_purchases (id TEXT, user_uid TEXT, product_id TEXT,"
                     " amount REAL, at TEXT, token TEXT, transaction_id TEXT)")
        сейчас = datetime.now(timezone.utc)
        полночь = (сейчас + timedelta(hours=3)).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=3)
        сегодня = метка(полночь + timedelta(minutes=1))
        вчера = метка(полночь - timedelta(hours=1))
        строки = [
            # App Store: одна покупка, чек пришёл дважды
            ("a1", "togetherly_plus", сегодня, "1001"),
            ("a2", "togetherly_plus", сегодня, "1001"),
            # App Store: купили вчера, сегодня чек пришёл снова при восстановлении
            ("a3", "togetherly_plus", вчера, "1002"),
            ("a4", "togetherly_plus", сегодня, "1002"),
            # Google Play: номер транзакции пустой, сделка — сама запись
            ("p1", "togetherly_plus_gift", сегодня, ""),
            ("p2", "togetherly_plus", вчера, ""),
        ]
        база.executemany("INSERT INTO iap_purchases (id, product_id, at, transaction_id) VALUES (?, ?, ?, ?)",
                         строки)
        база.commit()
        база.close()

    def test_сделка_App_Store_считается_один_раз(self):
        self.assertEqual(main.покупки_с_полуночи(self.путь)["appstore"], 1)

    def test_восстановленная_вчерашняя_покупка_не_считается(self):
        self.assertEqual(main.покупки_с_полуночи(self.путь)["appstore"], 1)

    def test_Google_Play_считается_по_записи(self):
        self.assertEqual(main.покупки_с_полуночи(self.путь)["play"], 1)

    def test_нет_базы_нули(self):
        self.assertEqual(main.покупки_с_полуночи(os.path.join(self.папка, "нет.db")),
                         {"appstore": 0, "play": 0})


def сводка():
    return {
        "totals": {"today": 100.0},
        "sources": {
            "rsya": {"ok": True, "title": "Яндекс, реклама", "today": 100.0, "month": 800.0},
            "appstore": {"ok": True, "title": "App Store", "today": 0, "month": 391.13, "month_sales": 47},
            "play": {"ok": True, "title": "Google Play", "month": 0.0, "month_sales": 0},
        },
    }


class СегодняПоЧекам(unittest.TestCase):
    def test_покупки_умножаются_на_среднюю_выручку_за_штуку(self):
        с = main.сегодня_по_чекам(сводка(), {"appstore": 2, "play": 0})
        self.assertEqual(с["sources"]["appstore"]["today"], 16.64)

    def test_оценка_входит_в_итог_за_сегодня(self):
        с = main.сегодня_по_чекам(сводка(), {"appstore": 2, "play": 0})
        self.assertAlmostEqual(с["totals"]["today"], 116.64, places=2)

    def test_оценка_входит_в_месяц(self):
        # Иначе период внутри месяца выходил бы больше самого месяца
        исходная = сводка()
        исходная["totals"]["month"] = 1191.13
        с = main.сегодня_по_чекам(исходная, {"appstore": 2, "play": 0})
        self.assertEqual(с["sources"]["appstore"]["month"], 407.77)
        self.assertAlmostEqual(с["totals"]["month"], 1207.77, places=2)

    def test_без_продаж_в_месяце_оценки_нет(self):
        с = main.сегодня_по_чекам(сводка(), {"appstore": 0, "play": 3})
        self.assertNotIn("today_by_receipts", с["sources"]["play"])

    def test_оценка_ложится_сегодняшним_днём_в_период(self):
        сегодня = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%d")
        вчера = (datetime.now(timezone.utc) + timedelta(hours=3) - timedelta(days=1)).strftime("%Y-%m-%d")
        исходная = сводка()
        исходная["sources"]["appstore"]["days"] = [{"d": вчера, "v": 5.0}, {"d": сегодня, "v": 1.0}]
        с = main.сегодня_по_чекам(исходная, {"appstore": 2, "play": 0})
        self.assertEqual(main.за_период(с, None, сегодня, сегодня)["value"], 16.64)
        self.assertEqual(main.за_период(с, None, вчера, вчера)["value"], 5.0)

    def test_в_таблице_число_у_оценённого_и_прочерк_у_прочих(self):
        с = main.сегодня_по_чекам(сводка(), {"appstore": 2, "play": 3})
        строки = {r[0]: r for r in main.блоки(с, None)["sources"]["rows"]}
        self.assertEqual(строки["App Store"][1], 16.64)
        self.assertEqual(строки["Google Play"][1], "—")
        self.assertEqual(строки["Яндекс, реклама"][1], 100.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
