-- Схема Tessera. Только аддитивные правки: колонки не удаляем и не
-- переименовываем, иначе обновление сервера ломает чужие установки.

CREATE TABLE IF NOT EXISTS apps (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  key     TEXT NOT NULL UNIQUE,
  created INTEGER NOT NULL
);

-- Сырые события живут две недели, дальше их сносит уборщик.
CREATE TABLE IF NOT EXISTS events (
  id       INTEGER PRIMARY KEY,
  app      TEXT NOT NULL,
  eid      TEXT NOT NULL,
  ts       INTEGER NOT NULL,
  who      TEXT,
  platform TEXT,
  version  TEXT,
  kind     TEXT NOT NULL,
  name     TEXT NOT NULL,
  ms       INTEGER,
  params   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS events_eid  ON events(app, eid);
CREATE INDEX        IF NOT EXISTS events_ts   ON events(app, ts);
CREATE INDEX        IF NOT EXISTS events_name ON events(app, kind, name, ts);

-- Сводки по дням живут вечно и стоят копейки: строка на «день, вид, имя».
CREATE TABLE IF NOT EXISTS daily (
  app    TEXT NOT NULL,
  day    TEXT NOT NULL,
  kind   TEXT NOT NULL,
  name   TEXT NOT NULL,
  hits   INTEGER NOT NULL DEFAULT 0,
  people INTEGER NOT NULL DEFAULT 0,
  ms     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (app, day, kind, name)
);

-- Хеши посетителей по дням: нужны для уникальных, живут три месяца.
CREATE TABLE IF NOT EXISTS seen (
  app TEXT NOT NULL,
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  PRIMARY KEY (app, day, who)
);

CREATE TABLE IF NOT EXISTS layout (
  tab     TEXT PRIMARY KEY,
  blocks  TEXT NOT NULL,
  updated INTEGER NOT NULL
);

-- Словарь имён: ключ из кода → то, что читает человек.
CREATE TABLE IF NOT EXISTS labels (
  app   TEXT NOT NULL,
  key   TEXT NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (app, key)
);

-- То, что напечатали модули: панель читает отсюда и не ждёт их запуска.
CREATE TABLE IF NOT EXISTS module_data (
  module  TEXT NOT NULL,
  key     TEXT NOT NULL,
  json    TEXT NOT NULL,
  updated INTEGER NOT NULL,
  PRIMARY KEY (module, key)
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
