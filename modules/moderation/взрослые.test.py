"""Пометка «для взрослых» приезжает из другой базы, и лента не должна от неё зависеть.

Кадры лежат в SQLite приложения, а замок на воспоминании — в Postgres. Связь
между ними живёт только в json-поле, и любая беда на той стороне (нет строки
подключения, база не отвечает, запрос упёрся в таймаут) обязана стоить
модерации ровно одну подпись под кадром, а не всю ленту.

    python3 взрослые.test.py
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402


class БезPostgres(unittest.TestCase):
    def setUp(self):
        self.было = os.environ.pop("MODERATION_PG_DSN", None)

    def tearDown(self):
        if self.было is not None:
            os.environ["MODERATION_PG_DSN"] = self.было

    def test_пометок_нет_а_лента_жива(self):
        self.assertEqual(main.взрослые_для(["группа1", "группа2"]), set())

    def test_пустой_список_групп_никуда_не_ходит(self):
        self.assertEqual(main.взрослые_для([]), set())


class ПриПоломкеБазы(unittest.TestCase):
    def setUp(self):
        os.environ["MODERATION_PG_DSN"] = "postgresql://никого@127.0.0.1:1/нет"

    def tearDown(self):
        os.environ.pop("MODERATION_PG_DSN", None)

    def test_молчаливый_пустой_ответ(self):
        # База недоступна: ждём пустое множество и живой процесс, а не падение
        # с трассировкой в stdout, которую ядро прочитает как ответ модуля.
        self.assertEqual(main.взрослые_для(["группа1"]), set())


if __name__ == "__main__":
    unittest.main(verbosity=2)
