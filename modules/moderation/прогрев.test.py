"""Страница ленты не уходит раньше, чем сделаны её кадры.

Лента смотрит на самые свежие записи, а их около полусотни в минуту. Любое
расписание опаздывает по определению: к моменту открытия страницы верхние
кадры моложе минуты, и прогрев до них ещё не дошёл. Проверено на проде
17.08.2026 — из последних шестидесяти записей миниатюра была у нуля.

Поэтому прогрев страницы ждут: пара секунд на открытие честнее, чем сетка
серых заглушек.

    python3 прогрев.test.py
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


class ПрогревСтраницы(unittest.TestCase):
    def setUp(self):
        self.папка = tempfile.TemporaryDirectory()
        корень = Path(self.папка.name)
        # Заглушка вместо генератора: делает файлы для перечисленных кадров.
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

    def test_ждём_и_кадры_готовы(self):
        main.прогреть([("раз", "a.webp"), ("два", "b.webp")], self.ист, ждать=True)
        self.assertTrue((self.корень / "раз_512.webp").exists())
        self.assertTrue((self.корень / "два_512.webp").exists())

    def test_готовые_второй_раз_не_делаем(self):
        (self.корень / "раз_512.webp").write_text("уже есть")
        main.прогреть([("раз", "a.webp")], self.ист, ждать=True)
        self.assertEqual((self.корень / "раз_512.webp").read_text(), "уже есть")

    def test_без_генератора_молчим(self):
        main.прогреть([("раз", "a.webp")], {"thumb": self.ист["thumb"]}, ждать=True)
        self.assertFalse((self.корень / "раз_512.webp").exists())

    def test_за_звуком_генератор_не_ходит(self):
        # Миниатюры у голосового не будет никогда, а на странице ленты таких
        # файлов бывает под полсотни: без проверки имени каждый показ
        # запускал бы генератор впустую полсотни раз.
        main.прогреть([("раз", "voice_1786968914693_x.m4a")], self.ист, ждать=True)
        self.assertFalse((self.корень / "раз_512.webp").exists())

    def test_упавший_генератор_не_роняет_ленту(self):
        main.прогреть([("раз", "a.webp")],
                      {"make": ["/нет/такого/файла"], "thumb": self.ист["thumb"]},
                      ждать=True)
        self.assertFalse((self.корень / "раз_512.webp").exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
