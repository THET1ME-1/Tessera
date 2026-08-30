"""Описание внутри скачанного оригинала.

Оригиналы приложения приходят пустыми: снимок перекодируется в webp, и вместе
с весом уходит всё, что камера записала о кадре, — дата, координаты, модель.
Модератор скачивает такой файл и заливает в Google Photos или Immich, где
кадр ложится без даты, без места и без единого признака, чьей паре он
принадлежит.

Поэтому перед выдачей копия подписывается: описание — номер пары, дата съёмки
и координаты — из записи воспоминания, если они там есть.

    python3 описание.test.py
"""
import base64
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import main  # noqa: E402

# Картинка 8×8 в webp: приложение отдаёт именно этот формат у четырёх файлов из
# пяти, и метаданные в нём живут единственным способом — XMP-чанком.
ВЕБП = base64.b64decode(
    "UklGRjIAAABXRUJQVlA4ICYAAACQAQCdASoIAAgAAUAmJQBOl0AAcwAA/u9RL9CjZRMU/bsXbwwAAA==")


def файл(папка, имя="кадр.webp", данные=ВЕБП):
    путь = os.path.join(папка, имя)
    with open(путь, "wb") as f:
        f.write(данные)
    return путь


def прочитать(путь, *теги):
    """Что лежит в файле по мнению exiftool — тем же способом, каким читают
    Immich и Google Photos."""
    вывод = subprocess.run(["exiftool", "-j", "-n", *[f"-{т}" for т in теги], путь],
                           capture_output=True, text=True, check=False).stdout
    return json.loads(вывод)[0] if вывод.strip() else {}


есть_exiftool = subprocess.run(["which", "exiftool"], capture_output=True).returncode == 0


@unittest.skipUnless(есть_exiftool, "exiftool не установлен")
class Подпись(unittest.TestCase):
    def test_описание_это_номер_пары_и_ничего_больше(self):
        # Номер пары — то, с чем модератор уходит в поиск и в переписку. Слова
        # вокруг него («пара», «группа») пришлось бы вычищать руками в каждой
        # галерее, поэтому в описании лежит голый id.
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "r61edc1c99483f6", {})
            self.assertEqual(прочитать(путь, "Description")["Description"],
                             "r61edc1c99483f6")

    def test_описание_видно_всем_трём_способам_чтения(self):
        # Immich читает XMP, Google Photos — IPTC, старые программы — EXIF.
        # Пишем во все три, иначе описание видит одна галерея из трёх.
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка, "кадр.jpg", ЖПЕГ)
            main.подписать(путь, "гру12345", {})
            в_файле = прочитать(путь, "XMP:Description", "IPTC:Caption-Abstract",
                                "EXIF:ImageDescription")
            self.assertEqual(в_файле.get("Description"), "гру12345")
            self.assertEqual(в_файле.get("Caption-Abstract"), "гру12345")
            self.assertEqual(в_файле.get("ImageDescription"), "гру12345")

    def test_дата_съёмки_попадает_в_файл(self):
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {"снято": "2026:08:14 19:05:00"})
            self.assertEqual(прочитать(путь, "DateTimeOriginal")["DateTimeOriginal"],
                             "2026:08:14 19:05:00")

    def test_координаты_попадают_в_файл(self):
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {"широта": 43.203354, "долгота": 76.889737,
                                         "место": "Алматы, Казахстан"})
            в_файле = прочитать(путь, "GPSLatitude", "GPSLongitude")
            self.assertAlmostEqual(в_файле["GPSLatitude"], 43.203354, places=4)
            self.assertAlmostEqual(в_файле["GPSLongitude"], 76.889737, places=4)

    def test_южное_полушарие_не_теряет_знак(self):
        # Широта и долгота уходят числами со знаком, а exiftool хранит их
        # модулем и стороной света. Без явной стороны Рио оказывается в
        # Северном полушарии, и карта в Immich врёт на семь тысяч километров.
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {"широта": -22.9068, "долгота": -43.1729})
            в_файле = прочитать(путь, "GPSLatitude", "GPSLongitude")
            self.assertAlmostEqual(в_файле["GPSLatitude"], -22.9068, places=4)
            self.assertAlmostEqual(в_файле["GPSLongitude"], -43.1729, places=4)

    def test_без_даты_и_координат_описание_всё_равно_на_месте(self):
        # Координаты есть у каждого пятого воспоминания, а холсты и аватарки
        # вообще не имеют записи. Такой кадр обязан скачаться с описанием, а не
        # уйти без подписи вовсе.
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {})
            self.assertEqual(прочитать(путь, "Description")["Description"], "гру")

    def test_картинка_остаётся_картинкой(self):
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {"снято": "2026:08:14 19:05:00"})
            в_файле = прочитать(путь, "FileType", "ImageWidth")
            # «Extended WEBP» — тот же webp: XMP живёт в расширенном чанке, и
            # файл, получивший описание, всегда становится расширенным.
            self.assertIn("WEBP", в_файле["FileType"])
            self.assertEqual(в_файле["ImageWidth"], 8)


@unittest.skipUnless(есть_exiftool, "exiftool не установлен")
class ПриСкачивании(unittest.TestCase):
    """Подпись ставится по дороге: отдельной кнопки «подписать» нет.

    Модератор жмёт «Скачать оригинал» и получает готовый файл. Данные берутся
    из базы в этот самый момент, поэтому кадр, загруженный минуту назад,
    подписывается так же, как годовалый, — проходить по хранилищу не нужно.
    """

    def setUp(self):
        self.врем = tempfile.TemporaryDirectory()
        self.addCleanup(self.врем.cleanup)
        self.корень = os.path.join(self.врем.name, "thumb_cache")
        os.makedirs(self.корень)
        self.склад = os.path.join(self.врем.name, "storage", main.КОЛЛЕКЦИЯ, "abc123")
        os.makedirs(self.склад)

        путь_базы = os.path.join(self.врем.name, "data.db")
        conn = sqlite3.connect(путь_базы)
        conn.execute("CREATE TABLE media (id TEXT, file TEXT, kind TEXT, group_id TEXT)")
        conn.execute("INSERT INTO media VALUES (?,?,?,?)",
                     ("abc123", "memory_1786968914693_x.webp", "memories", "r61edc1c99483f6"))
        conn.commit()
        conn.close()

        with open(os.path.join(self.склад, "memory_1786968914693_x.webp"), "wb") as f:
            f.write(ВЕБП)

        ист = {"db": путь_базы, "storage": os.path.join(self.врем.name, "storage")}
        было = main.настройки
        main.настройки = lambda: (ист, self.корень)
        self.addCleanup(lambda: setattr(main, "настройки", было))
        self.дсн = os.environ.pop("MODERATION_PG_DSN", None)
        self.addCleanup(lambda: self.дсн and os.environ.update(MODERATION_PG_DSN=self.дсн))

    def test_скачанная_копия_подписана_номером_пары(self):
        ответ = main.оригинал({"id": "abc123"})
        self.assertEqual(прочитать(ответ["path"], "Description")["Description"],
                         "r61edc1c99483f6")

    def test_имя_и_тип_не_меняются_от_подписи(self):
        ответ = main.оригинал({"id": "abc123"})
        self.assertEqual(ответ["name"], "memory_1786968914693_x.webp")
        self.assertEqual(ответ["type"], "image/webp")


class БезExiftool(unittest.TestCase):
    """Подписывать нечем — оригинал всё равно скачивается.

    exiftool ставится на сервер отдельным пакетом, и его может не оказаться:
    новая машина, откат, чужая установка Tessera. Скачивание оригинала от
    этого страдать не должно — модератор получит файл без описания, но
    получит.
    """

    def setUp(self):
        self.было = os.environ.get("PATH", "")
        os.environ["PATH"] = "/несуществующий/путь"

    def tearDown(self):
        os.environ["PATH"] = self.было

    def test_файл_на_месте_и_никто_не_упал(self):
        with tempfile.TemporaryDirectory() as папка:
            путь = файл(папка)
            main.подписать(путь, "гру", {})
            self.assertEqual(open(путь, "rb").read(), ВЕБП)


class ДатаБезЗаписи(unittest.TestCase):
    """Виджеты, аватарки и маскоты в воспоминаниях не лежат.

    Их полмиллиона на ленту, записи у них нет, и дату брать неоткуда — кроме
    имени файла: приложение кладёт в него метку загрузки. Без этого такой
    кадр ложится в галерею сегодняшним числом и теряется среди свежих.
    """

    def setUp(self):
        self.было = os.environ.pop("MODERATION_PG_DSN", None)

    def tearDown(self):
        if self.было is not None:
            os.environ["MODERATION_PG_DSN"] = self.было

    def test_дата_берётся_из_имени_файла(self):
        # Метка в имени — момент по всемирному времени. Пояс пары берётся из
        # её записей, а без базы его нет: тогда время остаётся всемирным.
        сведения = main.сведения_для_подписи(
            "кадр1", "гру1", "uof3f4djilmq0at_1788114656646_7mfe2qq4p7.webp")
        self.assertEqual(сведения.get("снято"), "2026:08:30 18:30:56")

    def test_без_базы_пояса_нет(self):
        self.assertEqual(main.пояс_пары("гру1"), "")

    def test_имя_без_метки_не_выдумывает_дату(self):
        # Холсты и старые файлы зовутся без метки. Врать датой хуже, чем
        # оставить кадр без неё: в галерее он встанет не на своё место.
        self.assertEqual(main.сведения_для_подписи("кадр1", "гру1", "avatar.jpg"), {})


class СведенияБезPostgres(unittest.TestCase):
    """Записи воспоминаний живут в Postgres, и лента не должна от него зависеть.

    Нет строки подключения или база не отвечает — кадр скачивается с одним
    описанием, без даты и координат.
    """

    def setUp(self):
        self.было = os.environ.pop("MODERATION_PG_DSN", None)

    def tearDown(self):
        if self.было is not None:
            os.environ["MODERATION_PG_DSN"] = self.было

    def test_нет_строки_подключения_нет_и_сведений(self):
        self.assertEqual(main.сведения_кадра("кадр1", "гру1"), {})

    def test_база_молчит_а_модуль_жив(self):
        os.environ["MODERATION_PG_DSN"] = "postgresql://никого@127.0.0.1:1/нет"
        self.assertEqual(main.сведения_кадра("кадр1", "гру1"), {})


ЖПЕГ = base64.b64decode(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAAIAAgBAREA/8QAHwAAAQUBAQEB"
    "AQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1Fh"
    "ByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZ"
    "WmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG"
    "x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oACAEBAAA/APn+iiiv/9k=")


if __name__ == "__main__":
    unittest.main(verbosity=2)
