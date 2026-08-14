# Tessera: сервер — план работ

> **Для исполнителя:** ОБЯЗАТЕЛЬНЫЙ ПОДСКИЛЛ — `superpowers:subagent-driven-development`
> (рекомендуется) или `superpowers:executing-plans`. Шаги помечены чекбоксами
> (`- [ ]`), отмечать по мере выполнения.

**Цель:** сервер Tessera, который принимает события, считает сводки, отдаёт
блоки панели и запускает модули-программы.

**Устройство:** один процесс на Go. HTTP принимает пачки событий и складывает
их в буфер, буфер уходит в SQLite одной транзакцией. Сводки по дням считает
расписание, а не запрос. Панель получает раскладку из блоков и данные к ним по
адресу `владелец:ключ`; ядро отдаёт свои данные тем же способом, что и модули.

**Стек:** Go 1.26, SQLite через `mattn/go-sqlite3` (CGO обязателен),
стандартная библиотека для всего остального (`crypto/pbkdf2` есть с Go 1.24).

**Спека:** `docs/superpowers/specs/2026-08-14-tessera-core-design.md`

## Общие требования

Действуют в каждой задаче, повторять в тестах не нужно, но нарушать нельзя.

- Go 1.26, модуль `github.com/THET1ME-1/Tessera`.
- Зависимость ровно одна: `github.com/mattn/go-sqlite3`. Любая другая — повод
  остановиться и спросить.
- CGO включён (`CGO_ENABLED=1`). Чистый Go-порт SQLite в десятки раз медленнее
  на полных сканах, это уже стоило админке Togetherly трёх минут на вкладку.
- Панель никогда не считает агрегаты в момент запроса, только читает
  предсчитанное.
- Все тексты, комментарии и сообщения об ошибках — по-русски.
- Время в базе хранится числом (unix-секунды), день — строкой `ГГГГ-ММ-ДД`.
- Каждая задача заканчивается коммитом, подпись `THET1ME-1 <badzoff@gmail.com>`.

---

### Задача 1: Каркас модуля и база

**Файлы:**
- Создать: `go.mod`, `internal/store/store.go`, `internal/store/schema.sql`
- Тест: `internal/store/store_test.go`

**Интерфейсы:**
- Отдаёт наружу: `store.Open(path string) (*Store, error)`, `(*Store).Close() error`,
  `(*Store).DB() *sql.DB`.

- [ ] **Шаг 1: Завести модуль и зависимость**

```bash
export PATH=$HOME/.local/go/bin:$PATH
cd /home/alelx/Projects/GitHub/Tessera
go mod init github.com/THET1ME-1/Tessera
go get github.com/mattn/go-sqlite3@latest
```

- [ ] **Шаг 2: Написать падающий тест**

`internal/store/store_test.go`:

```go
package store

import (
	"path/filepath"
	"testing"
)

func TestOpenСоздаётСхему(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("открытие: %v", err)
	}
	defer s.Close()

	var n int
	err = s.DB().QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN
		 ('apps','events','daily','seen','layout','labels','module_data','settings')`,
	).Scan(&n)
	if err != nil {
		t.Fatalf("запрос: %v", err)
	}
	if n != 8 {
		t.Fatalf("таблиц создано %d, ждали 8", n)
	}
}

func TestOpenВключаетWAL(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	var mode string
	if err := s.DB().QueryRow("PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Fatalf("режим журнала %q, ждали wal", mode)
	}
}
```

- [ ] **Шаг 3: Убедиться, что тест падает**

Запуск: `go test ./internal/store/ -run TestOpen -v`
Ожидаем: не собирается, `undefined: Open`.

- [ ] **Шаг 4: Написать схему**

`internal/store/schema.sql` — ровно то, что описано в спеке:

```sql
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, app TEXT NOT NULL, eid TEXT NOT NULL, ts INTEGER NOT NULL,
  who TEXT, platform TEXT, version TEXT, kind TEXT NOT NULL, name TEXT NOT NULL,
  ms INTEGER, params TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS events_eid ON events(app, eid);
CREATE INDEX IF NOT EXISTS events_ts ON events(app, ts);
CREATE INDEX IF NOT EXISTS events_name ON events(app, kind, name, ts);

CREATE TABLE IF NOT EXISTS daily (
  app TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0, people INTEGER NOT NULL DEFAULT 0,
  ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (app, day, kind, name));

CREATE TABLE IF NOT EXISTS seen (
  app TEXT NOT NULL, day TEXT NOT NULL, who TEXT NOT NULL, PRIMARY KEY (app, day, who));

CREATE TABLE IF NOT EXISTS layout (
  tab TEXT PRIMARY KEY, blocks TEXT NOT NULL, updated INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS labels (
  app TEXT NOT NULL, key TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY (app, key));

CREATE TABLE IF NOT EXISTS module_data (
  module TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY (module, key));

CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL);
```

- [ ] **Шаг 5: Написать `store.go`**

```go
// Пакет store держит базу и схему. Всё остальное ходит в SQLite только отсюда.
package store

import (
	"database/sql"
	_ "embed"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

//go:embed schema.sql
var schema string

type Store struct{ db *sql.DB }

// Open открывает базу и доводит схему до нужного вида.
// Схема аддитивная: старые колонки не удаляются и не переименовываются.
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=15000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("открыть базу: %w", err)
	}
	// Пишущее соединение в SQLite всё равно одно, а лишние только плодят блокировки.
	db.SetMaxOpenConns(1)
	for _, p := range []string{
		"PRAGMA journal_mode = WAL",
		"PRAGMA synchronous = NORMAL",
		"PRAGMA foreign_keys = ON",
	} {
		if _, err := db.Exec(p); err != nil {
			db.Close()
			return nil, fmt.Errorf("%s: %w", p, err)
		}
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("схема: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) DB() *sql.DB { return s.db }
func (s *Store) Close() error { return s.db.Close() }
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Запуск: `go test ./internal/store/ -v`
Ожидаем: PASS обоих тестов.

- [ ] **Шаг 7: Коммит**

```bash
git add go.mod go.sum internal/store/
git commit -m "База и схема: восемь таблиц, WAL, одно пишущее соединение"
```

---

### Задача 2: Запись событий и защита от повторов

**Файлы:**
- Создать: `internal/store/events.go`
- Тест: `internal/store/events_test.go`

**Интерфейсы:**
- Берёт из задачи 1: `*Store`, `(*Store).DB()`.
- Отдаёт наружу:

```go
type Event struct {
	EID      string
	TS       int64
	Who      string
	Platform string
	Version  string
	Kind     string
	Name     string
	MS       int64
	Params   string
}
func (s *Store) InsertEvents(app string, evs []Event) (accepted int, err error)
```

- [ ] **Шаг 1: Написать падающий тест**

`internal/store/events_test.go`:

```go
package store

import (
	"path/filepath"
	"testing"
)

func открыть(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestПовторСобытияНеЗадваивает(t *testing.T) {
	s := открыть(t)
	ev := Event{EID: "a1", TS: 1786700000, Kind: "screen", Name: "memory_lane", MS: 5888}

	n, err := s.InsertEvents("togetherly", []Event{ev})
	if err != nil || n != 1 {
		t.Fatalf("первая вставка: n=%d err=%v", n, err)
	}
	// Телефон потерял ответ и шлёт ту же пачку заново.
	n, err = s.InsertEvents("togetherly", []Event{ev})
	if err != nil {
		t.Fatalf("повтор вернул ошибку: %v", err)
	}
	if n != 0 {
		t.Fatalf("повтор принят как новое: n=%d", n)
	}

	var total int
	s.DB().QueryRow("SELECT count(*) FROM events").Scan(&total)
	if total != 1 {
		t.Fatalf("в базе %d событий, ждали 1", total)
	}
}

func TestОдинаковыйEidРазныхПриложенийНеМешает(t *testing.T) {
	s := открыть(t)
	ev := Event{EID: "a1", TS: 1786700000, Kind: "action", Name: "memory_added"}

	if _, err := s.InsertEvents("togetherly", []Event{ev}); err != nil {
		t.Fatal(err)
	}
	n, err := s.InsertEvents("kadr", []Event{ev})
	if err != nil || n != 1 {
		t.Fatalf("чужое приложение отвергнуто: n=%d err=%v", n, err)
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/store/ -run Повтор -v`
Ожидаем: не собирается, `undefined: Event`.

- [ ] **Шаг 3: Написать реализацию**

`internal/store/events.go`:

```go
package store

import (
	"database/sql"
	"fmt"
)

type Event struct {
	EID      string
	TS       int64
	Who      string
	Platform string
	Version  string
	Kind     string
	Name     string
	MS       int64
	Params   string
}

// InsertEvents кладёт пачку одной транзакцией и возвращает число НОВЫХ записей.
// Повтор с тем же eid молча отбрасывается: телефон, потерявший ответ, шлёт
// пачку заново, и это не ошибка, а подтверждение доставки.
func (s *Store) InsertEvents(app string, evs []Event) (int, error) {
	if len(evs) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, fmt.Errorf("начать запись: %w", err)
	}
	defer tx.Rollback()

	st, err := tx.Prepare(`INSERT OR IGNORE INTO events
		(app, eid, ts, who, platform, version, kind, name, ms, params)
		VALUES (?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return 0, fmt.Errorf("подготовить запись: %w", err)
	}
	defer st.Close()

	accepted := 0
	for _, e := range evs {
		res, err := st.Exec(app, e.EID, e.TS, nullIfEmpty(e.Who), e.Platform, e.Version,
			e.Kind, e.Name, e.MS, nullIfEmpty(e.Params))
		if err != nil {
			return 0, fmt.Errorf("записать событие %s: %w", e.EID, err)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			accepted++
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("закрыть запись: %w", err)
	}
	return accepted, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

var _ = sql.ErrNoRows
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/store/ -v`
Ожидаем: PASS всех четырёх тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add internal/store/events.go internal/store/events_test.go
git commit -m "Запись событий пачкой, повтор с тем же eid отбрасывается"
```

---

### Задача 3: Сводки по дням

**Файлы:**
- Создать: `internal/store/rollup.go`
- Тест: `internal/store/rollup_test.go`

**Интерфейсы:**
- Берёт: `*Store`, таблицы `events`, `daily`, `seen`.
- Отдаёт: `(*Store).RollupDay(app, day string) error`,
  `(*Store).RollupRecent(days int) error`.

- [ ] **Шаг 1: Написать падающий тест**

`internal/store/rollup_test.go`:

```go
package store

import "testing"

func TestСводкаСчитаетОткрытияИЛюдей(t *testing.T) {
	s := открыть(t)
	// 2026-08-14 12:00 UTC и рядом
	evs := []Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "memory_lane", MS: 5000, Who: "ху1"},
		{EID: "2", TS: 1786708801, Kind: "screen", Name: "memory_lane", MS: 3000, Who: "ху1"},
		{EID: "3", TS: 1786708802, Kind: "screen", Name: "memory_lane", MS: 1000, Who: "ху2"},
	}
	if _, err := s.InsertEvents("togetherly", evs); err != nil {
		t.Fatal(err)
	}
	if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
		t.Fatal(err)
	}

	var hits, people, ms int
	err := s.DB().QueryRow(
		`SELECT hits, people, ms FROM daily WHERE app=? AND day=? AND kind=? AND name=?`,
		"togetherly", "2026-08-14", "screen", "memory_lane").Scan(&hits, &people, &ms)
	if err != nil {
		t.Fatalf("сводка не найдена: %v", err)
	}
	if hits != 3 || people != 2 || ms != 9000 {
		t.Fatalf("сводка: hits=%d people=%d ms=%d, ждали 3/2/9000", hits, people, ms)
	}
}

func TestПовторныйПересчётНеУдваивает(t *testing.T) {
	s := открыть(t)
	s.InsertEvents("togetherly", []Event{
		{EID: "1", TS: 1786708800, Kind: "action", Name: "memory_added", Who: "ху1"},
	})
	for i := 0; i < 3; i++ {
		if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
			t.Fatal(err)
		}
	}
	var hits int
	s.DB().QueryRow(`SELECT hits FROM daily WHERE app=? AND day=? AND name=?`,
		"togetherly", "2026-08-14", "memory_added").Scan(&hits)
	if hits != 1 {
		t.Fatalf("после трёх пересчётов hits=%d, ждали 1", hits)
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/store/ -run Сводка -v`
Ожидаем: `undefined: RollupDay`.

- [ ] **Шаг 3: Написать реализацию**

`internal/store/rollup.go`:

```go
package store

import (
	"fmt"
	"time"
)

// RollupDay переписывает сводку дня целиком. Именно переписывает, а не
// прибавляет: только так пересчёт можно гонять сколько угодно раз, не боясь
// удвоить числа после перезапуска или доехавшей с опозданием пачки.
func (s *Store) RollupDay(app, day string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("начать пересчёт: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM daily WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить день: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT INTO daily (app, day, kind, name, hits, people, ms)
		SELECT app, date(ts,'unixepoch'), kind, name,
		       count(*), count(DISTINCT who), coalesce(sum(ms),0)
		FROM events WHERE app=? AND date(ts,'unixepoch')=?
		GROUP BY app, kind, name`, app, day); err != nil {
		return fmt.Errorf("посчитать день: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM seen WHERE app=? AND day=?`, app, day); err != nil {
		return fmt.Errorf("очистить посетителей: %w", err)
	}
	if _, err := tx.Exec(`
		INSERT OR IGNORE INTO seen (app, day, who)
		SELECT app, date(ts,'unixepoch'), who FROM events
		WHERE app=? AND date(ts,'unixepoch')=? AND who IS NOT NULL`, app, day); err != nil {
		return fmt.Errorf("записать посетителей: %w", err)
	}
	return tx.Commit()
}

// RollupRecent пересчитывает последние days суток у всех приложений.
// Раз в десять минут хватает двух суток: старое уже не меняется.
func (s *Store) RollupRecent(days int) error {
	rows, err := s.db.Query(`SELECT id FROM apps`)
	if err != nil {
		return fmt.Errorf("список приложений: %w", err)
	}
	var apps []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		apps = append(apps, id)
	}
	rows.Close()

	now := time.Now().UTC()
	for _, app := range apps {
		for i := 0; i < days; i++ {
			day := now.AddDate(0, 0, -i).Format("2006-01-02")
			if err := s.RollupDay(app, day); err != nil {
				return err
			}
		}
	}
	return nil
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/store/ -v`
Ожидаем: PASS.

- [ ] **Шаг 5: Коммит**

```bash
git add internal/store/rollup.go internal/store/rollup_test.go
git commit -m "Сводки по дням: пересчёт переписывает день целиком"
```

---

### Задача 4: Приложения и ключи

**Файлы:**
- Создать: `internal/store/apps.go`
- Тест: `internal/store/apps_test.go`

**Интерфейсы:**
- Отдаёт: `(*Store).CreateApp(id, name string) (key string, err error)`,
  `(*Store).AppByKey(key string) (id string, err error)`,
  `(*Store).Apps() ([]App, error)` где `type App struct{ ID, Name, Key string; Created int64 }`.

- [ ] **Шаг 1: Написать падающий тест**

```go
package store

import "testing"

func TestКлючОткрываетСвоёПриложение(t *testing.T) {
	s := открыть(t)
	key, err := s.CreateApp("togetherly", "Togetherly")
	if err != nil {
		t.Fatal(err)
	}
	if len(key) < 24 {
		t.Fatalf("ключ короткий: %q", key)
	}
	id, err := s.AppByKey(key)
	if err != nil || id != "togetherly" {
		t.Fatalf("по ключу нашли %q, err=%v", id, err)
	}
	if _, err := s.AppByKey("чужой"); err == nil {
		t.Fatal("чужой ключ принят")
	}
}

func TestДваПриложенияПолучаютРазныеКлючи(t *testing.T) {
	s := открыть(t)
	k1, _ := s.CreateApp("togetherly", "Togetherly")
	k2, _ := s.CreateApp("kadr", "Kadr")
	if k1 == k2 {
		t.Fatal("ключи совпали")
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/store/ -run Ключ -v`
Ожидаем: `undefined: CreateApp`.

- [ ] **Шаг 3: Написать реализацию**

`internal/store/apps.go`:

```go
package store

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"time"
)

type App struct {
	ID, Name, Key string
	Created       int64
}

func (s *Store) CreateApp(id, name string) (string, error) {
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("выдать ключ: %w", err)
	}
	key := base64.RawURLEncoding.EncodeToString(raw)
	_, err := s.db.Exec(`INSERT INTO apps (id, name, key, created) VALUES (?,?,?,?)`,
		id, name, key, time.Now().Unix())
	if err != nil {
		return "", fmt.Errorf("завести приложение %s: %w", id, err)
	}
	return key, nil
}

func (s *Store) AppByKey(key string) (string, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM apps WHERE key=?`, key).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("ключ не признан: %w", err)
	}
	return id, nil
}

func (s *Store) Apps() ([]App, error) {
	rows, err := s.db.Query(`SELECT id, name, key, created FROM apps ORDER BY created`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []App
	for rows.Next() {
		var a App
		if err := rows.Scan(&a.ID, &a.Name, &a.Key, &a.Created); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/store/ -v`

- [ ] **Шаг 5: Коммит**

```bash
git add internal/store/apps.go internal/store/apps_test.go
git commit -m "Приложения и ключи приёма"
```

---

### Задача 5: Приём событий по HTTP

**Файлы:**
- Создать: `internal/ingest/ingest.go`
- Тест: `internal/ingest/ingest_test.go`

**Интерфейсы:**
- Берёт: `*store.Store`, `store.Event`, `(*Store).AppByKey`, `(*Store).InsertEvents`.
- Отдаёт: `ingest.New(s *store.Store, salt []byte, people bool) *Ingest`,
  `(*Ingest).Handler() http.Handler`, `(*Ingest).Flush() error`.

- [ ] **Шаг 1: Написать падающий тест**

`internal/ingest/ingest_test.go`:

```go
package ingest

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func стенд(t *testing.T, people bool) (*store.Store, http.Handler, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	key, err := s.CreateApp("togetherly", "Togetherly")
	if err != nil {
		t.Fatal(err)
	}
	in := New(s, []byte("соль"), people)
	t.Cleanup(func() { in.Flush() })
	return s, in.Handler(), key
}

const тело = `{"app":"togetherly","sdk":"flutter 0.4.1","events":[
  {"eid":"a1","ts":1786708800,"kind":"screen","name":"memory_lane","ms":5000,
   "platform":"android","version":"1.28.2"}]}`

func TestПриёмОтвечает202(t *testing.T) {
	s, h, key := стенд(t, false)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(тело))
	req.Header.Set("X-Tessera-Key", key)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusAccepted {
		t.Fatalf("код %d, ждали 202: %s", rec.Code, rec.Body.String())
	}
	// Буфер уходит в базу отложенно, поэтому сбрасываем руками.
	if err := New(s, nil, false).Flush(); err != nil {
		t.Fatal(err)
	}
}

func TestЧужойКлючНеПринимается(t *testing.T) {
	_, h, _ := стенд(t, false)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(тело))
	req.Header.Set("X-Tessera-Key", "чужой")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("код %d, ждали 401", rec.Code)
	}
}

func TestБезСчётаЛюдейИдентификаторНеСохраняется(t *testing.T) {
	s, h, key := стенд(t, false)
	body := strings.Replace(тело, `"ms":5000`, `"ms":5000,"who":"install-1"`, 1)
	req := httptest.NewRequest("POST", "/i", strings.NewReader(body))
	req.Header.Set("X-Tessera-Key", key)
	h.ServeHTTP(httptest.NewRecorder(), req)

	in := New(s, []byte("соль"), false)
	in.Flush()
	var n int
	s.DB().QueryRow(`SELECT count(*) FROM events WHERE who IS NOT NULL`).Scan(&n)
	if n != 0 {
		t.Fatalf("при выключенном счёте людей сохранено %d идентификаторов", n)
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/ingest/ -v`
Ожидаем: `undefined: New`.

- [ ] **Шаг 3: Написать реализацию**

`internal/ingest/ingest.go`:

```go
// Пакет ingest принимает события по HTTP. Клиент не ждёт записи: его дело —
// отдать пачку и забыть, поэтому ответ уходит раньше, чем данные лягут в базу.
package ingest

import (
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

const (
	пределТела  = 4 << 20 // 4 МБ на пачку
	порогСброса = 1000    // событий в буфере
	пауза       = time.Second
)

type входноеСобытие struct {
	EID      string          `json:"eid"`
	TS       int64           `json:"ts"`
	Who      string          `json:"who"`
	Platform string          `json:"platform"`
	Version  string          `json:"version"`
	Kind     string          `json:"kind"`
	Name     string          `json:"name"`
	MS       int64           `json:"ms"`
	Params   json.RawMessage `json:"params"`
}

type пачка struct {
	App    string           `json:"app"`
	SDK    string           `json:"sdk"`
	Events []входноеСобытие `json:"events"`
}

type Ingest struct {
	s      *store.Store
	salt   []byte
	people bool

	mu  sync.Mutex
	buf map[string][]store.Event // приложение → события
}

func New(s *store.Store, salt []byte, people bool) *Ingest {
	in := &Ingest{s: s, salt: salt, people: people, buf: map[string][]store.Event{}}
	go in.цикл()
	return in
}

func (in *Ingest) цикл() {
	for range time.Tick(пауза) {
		in.Flush()
	}
}

// Flush уносит буфер в базу одной транзакцией на приложение.
func (in *Ingest) Flush() error {
	in.mu.Lock()
	buf := in.buf
	in.buf = map[string][]store.Event{}
	in.mu.Unlock()

	for app, evs := range buf {
		if _, err := in.s.InsertEvents(app, evs); err != nil {
			return err
		}
	}
	return nil
}

func (in *Ingest) Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "только POST", http.StatusMethodNotAllowed)
			return
		}
		app, err := in.s.AppByKey(r.Header.Get("X-Tessera-Key"))
		if err != nil {
			http.Error(w, "ключ не признан", http.StatusUnauthorized)
			return
		}

		var body io.Reader = http.MaxBytesReader(w, r.Body, пределТела)
		if r.Header.Get("Content-Encoding") == "gzip" {
			zr, err := gzip.NewReader(body)
			if err != nil {
				http.Error(w, "тело не разжимается", http.StatusBadRequest)
				return
			}
			defer zr.Close()
			body = zr
		}

		var p пачка
		if err := json.NewDecoder(body).Decode(&p); err != nil {
			http.Error(w, "тело не разбирается", http.StatusBadRequest)
			return
		}

		evs := make([]store.Event, 0, len(p.Events))
		for _, e := range p.Events {
			if e.EID == "" || e.Kind == "" || e.Name == "" {
				continue // без этих полей событие бессмысленно
			}
			ev := store.Event{
				EID: e.EID, TS: e.TS, Platform: e.Platform, Version: e.Version,
				Kind: e.Kind, Name: e.Name, MS: e.MS, Params: string(e.Params),
			}
			// Идентификатор человека хеширует сервер, и только если счёт людей
			// включён. Соль наружу не отдаётся никогда.
			if in.people && e.Who != "" {
				sum := sha256.Sum256(append(in.salt, []byte(e.Who)...))
				ev.Who = hex.EncodeToString(sum[:])[:16]
			}
			evs = append(evs, ev)
		}

		in.mu.Lock()
		in.buf[app] = append(in.buf[app], evs...)
		размер := len(in.buf[app])
		in.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "accepted": len(evs)})

		if размер >= порогСброса {
			go in.Flush()
		}
	})
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/ingest/ -v`
Ожидаем: PASS трёх тестов.

- [ ] **Шаг 5: Коммит**

```bash
git add internal/ingest/
git commit -m "Приём событий: 202 сразу, буфер, хеш человека только на сервере"
```

---

### Задача 6: Договор блоков и источники ядра

**Файлы:**
- Создать: `internal/blocks/blocks.go`, `internal/blocks/core.go`
- Тест: `internal/blocks/core_test.go`

**Интерфейсы:**
- Отдаёт:

```go
type Block struct {
	Type  string `json:"type"`
	Title string `json:"title"`
	Span  int    `json:"span"`
	Src   string `json:"src"`
	Unit  string `json:"unit,omitempty"`
}
type Source func(app string, from, to string) (any, error)
func Core(s *store.Store) map[string]Source   // ключи без приставки: events_daily, screens, ...
```

- [ ] **Шаг 1: Написать падающий тест**

`internal/blocks/core_test.go`:

```go
package blocks

import (
	"path/filepath"
	"testing"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func стенд(t *testing.T) *store.Store {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	s.CreateApp("togetherly", "Togetherly")
	s.InsertEvents("togetherly", []store.Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "memory_lane", MS: 5000, Who: "ху1"},
		{EID: "2", TS: 1786708801, Kind: "screen", Name: "draw", MS: 9000, Who: "ху2"},
		{EID: "3", TS: 1786708802, Kind: "action", Name: "memory_added", Who: "ху1"},
	})
	if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestИсточникДнейОтдаётФормуДляСтолбиков(t *testing.T) {
	src := Core(стенд(t))["events_daily"]
	got, err := src("togetherly", "2026-08-01", "2026-08-14")
	if err != nil {
		t.Fatal(err)
	}
	d, ok := got.(ColumnsData)
	if !ok {
		t.Fatalf("тип %T, ждали ColumnsData", got)
	}
	if len(d.Items) == 0 {
		t.Fatal("ни одного дня")
	}
	последний := d.Items[len(d.Items)-1]
	if последний.Label != "2026-08-14" || последний.Parts[0].V != 3 {
		t.Fatalf("последний день %+v, ждали 2026-08-14 с тремя событиями", последний)
	}
}

func TestИсточникЭкрановОтдаётФормуДляРастра(t *testing.T) {
	src := Core(стенд(t))["screens"]
	got, err := src("togetherly", "2026-08-01", "2026-08-14")
	if err != nil {
		t.Fatal(err)
	}
	d, ok := got.(RasterData)
	if !ok {
		t.Fatalf("тип %T, ждали RasterData", got)
	}
	if len(d.Rows) != 2 {
		t.Fatalf("экранов %d, ждали 2", len(d.Rows))
	}
	// Ряды идут по убыванию величины: draw держал 9 секунд против 5 у memory_lane.
	if d.Rows[0].Name != "draw" {
		t.Fatalf("первым идёт %q, ждали draw", d.Rows[0].Name)
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/blocks/ -v`
Ожидаем: `undefined: Core`.

- [ ] **Шаг 3: Написать формы данных**

`internal/blocks/blocks.go`:

```go
// Пакет blocks держит договор между панелью и теми, кто даёт ей данные.
// Панель умеет десять заготовок и не знает, кто именно их наполняет: ядро,
// модуль дохода или чужой плагин — для неё это адрес вида «владелец:ключ».
package blocks

type Block struct {
	Type  string `json:"type"`
	Title string `json:"title"`
	Span  int    `json:"span"`
	Src   string `json:"src"`
	Unit  string `json:"unit,omitempty"`
}

// Source отдаёт данные одного блока за диапазон дней включительно.
type Source func(app, from, to string) (any, error)

type Part struct {
	V     float64 `json:"v"`
	Style string  `json:"style,omitempty"` // "" сплошной, "hatch" штриховка
}
type Item struct {
	Label string `json:"label"`
	Parts []Part `json:"parts"`
}
type ColumnsData struct {
	Items []Item `json:"items"`
	Unit  string `json:"unit"`
}

type Row struct {
	Name  string  `json:"name"`
	Value float64 `json:"value"`
}
type RasterData struct {
	Rows      []Row   `json:"rows"`
	Unit      float64 `json:"unit"`      // сколько величины в одном кусочке
	UnitLabel string  `json:"unitLabel"` // как подписать кусочек
}

type StatData struct {
	Value float64   `json:"value"`
	Sub   string    `json:"sub"`
	Spark []float64 `json:"spark,omitempty"`
}

type TableData struct {
	Cols   []string `json:"cols"`
	Rows   [][]any  `json:"rows"`
	BarCol int      `json:"barCol"`
}
```

- [ ] **Шаг 4: Написать источники ядра**

`internal/blocks/core.go`:

```go
package blocks

import (
	"fmt"
	"sort"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// Core отдаёт источники, которые ядро наполняет само. Ключи здесь без
// приставки: адрес «core:events_daily» разбирает вызывающий.
func Core(s *store.Store) map[string]Source {
	return map[string]Source{
		"events_daily": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT day, sum(hits) FROM daily
				WHERE app=? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("события по дням: %w", err)
			}
			defer rows.Close()
			out := ColumnsData{Unit: "событий"}
			for rows.Next() {
				var day string
				var hits float64
				if err := rows.Scan(&day, &hits); err != nil {
					return nil, err
				}
				out.Items = append(out.Items, Item{Label: day, Parts: []Part{{V: hits}}})
			}
			return out, rows.Err()
		},

		"screens": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT name, sum(ms)/1000.0/3600.0 AS часы FROM daily
				WHERE app=? AND day BETWEEN ? AND ? AND kind='screen'
				GROUP BY name`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("экраны: %w", err)
			}
			defer rows.Close()
			out := RasterData{Unit: 10, UnitLabel: "часов внимания"}
			for rows.Next() {
				var r Row
				if err := rows.Scan(&r.Name, &r.Value); err != nil {
					return nil, err
				}
				out.Rows = append(out.Rows, r)
			}
			sort.Slice(out.Rows, func(i, j int) bool { return out.Rows[i].Value > out.Rows[j].Value })
			return out, rows.Err()
		},

		"actions": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT name, sum(hits), sum(people) FROM daily
				WHERE app=? AND day BETWEEN ? AND ? AND kind='action'
				GROUP BY name ORDER BY sum(hits) DESC`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("действия: %w", err)
			}
			defer rows.Close()
			out := TableData{Cols: []string{"Событие", "Раз", "Людей·дней"}, BarCol: 1}
			for rows.Next() {
				var name string
				var hits, people float64
				if err := rows.Scan(&name, &hits, &people); err != nil {
					return nil, err
				}
				out.Rows = append(out.Rows, []any{name, hits, people})
			}
			return out, rows.Err()
		},

		"people_daily": func(app, from, to string) (any, error) {
			rows, err := s.DB().Query(`
				SELECT day, count(*) FROM seen
				WHERE app=? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`, app, from, to)
			if err != nil {
				return nil, fmt.Errorf("люди по дням: %w", err)
			}
			defer rows.Close()
			out := ColumnsData{Unit: "человек"}
			for rows.Next() {
				var day string
				var n float64
				if err := rows.Scan(&day, &n); err != nil {
					return nil, err
				}
				out.Items = append(out.Items, Item{Label: day, Parts: []Part{{V: n}}})
			}
			return out, rows.Err()
		},
	}
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Запуск: `go test ./internal/blocks/ -v`
Ожидаем: PASS обоих тестов.

- [ ] **Шаг 6: Коммит**

```bash
git add internal/blocks/
git commit -m "Договор блоков и четыре источника ядра"
```

---

### Задача 7: Модули как программы

**Файлы:**
- Создать: `internal/modules/manifest.go`, `internal/modules/run.go`
- Тест: `internal/modules/run_test.go`

**Интерфейсы:**
- Отдаёт:

```go
type Manifest struct {
	ID, Name, Version string
	Run   []string
	Every string
	Tabs  []Tab
	Tiles []blocks.Block
}
func Load(dir string) ([]Manifest, error)
func Collect(m Manifest, dir string) (map[string]json.RawMessage, error)  // таймаут 60 с
func Query(m Manifest, dir, key string, args any) (json.RawMessage, error) // таймаут 5 с
```

- [ ] **Шаг 1: Написать падающий тест**

`internal/modules/run_test.go`:

```go
package modules

import (
	"os"
	"path/filepath"
	"testing"
)

// модуль-пустышка на shell: печатает то, что от него ждут
func фиктивный(t *testing.T, тело string) (string, Manifest) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "demo")
	os.MkdirAll(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "main.sh"), []byte(тело), 0o755)
	os.WriteFile(filepath.Join(dir, "module.json"), []byte(`{
		"id":"demo","name":"Демо","version":"1.0.0",
		"run":["sh","main.sh"],"every":"20m",
		"tabs":[{"id":"demo","title":"Демо","blocks":[
			{"type":"stat","title":"Число","span":4,"src":"demo:month"}]}]}`), 0o644)
	ms, err := Load(filepath.Dir(dir))
	if err != nil || len(ms) != 1 {
		t.Fatalf("манифест не прочитан: %v, штук %d", err, len(ms))
	}
	return dir, ms[0]
}

func TestСборДанныхМодуля(t *testing.T) {
	dir, m := фиктивный(t, `echo '{"month":{"value":305.73,"sub":"четыре источника"}}'`)
	got, err := Collect(m, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got["month"]; !ok {
		t.Fatalf("ключа month нет: %v", got)
	}
}

func TestМусорВВыводеНеРоняет(t *testing.T) {
	dir, m := фиктивный(t, `echo 'это не json'`)
	if _, err := Collect(m, dir); err == nil {
		t.Fatal("мусор принят за данные")
	}
}

func TestЗависшийМодульОбрываетсяПоТаймауту(t *testing.T) {
	dir, m := фиктивный(t, `sleep 30`)
	if _, err := QueryWithTimeout(m, dir, "month", nil, 300); err == nil {
		t.Fatal("зависший модуль не оборван")
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/modules/ -v`
Ожидаем: `undefined: Load`.

- [ ] **Шаг 3: Написать разбор манифеста**

`internal/modules/manifest.go`:

```go
// Пакет modules запускает сторонние программы и читает то, что они напечатали.
// Встроенного движка нет намеренно: модуль — обычная программа, его можно
// запустить руками в терминале и увидеть тот же json, что видит панель.
package modules

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/THET1ME-1/Tessera/internal/blocks"
)

type Tab struct {
	ID     string         `json:"id"`
	Title  string         `json:"title"`
	Blocks []blocks.Block `json:"blocks"`
}

type Manifest struct {
	ID      string         `json:"id"`
	Name    string         `json:"name"`
	Version string         `json:"version"`
	Run     []string       `json:"run"`
	Every   string         `json:"every"`
	Tabs    []Tab          `json:"tabs"`
	Tiles   []blocks.Block `json:"tiles"`
}

// Load читает все папки внутри dir. Битый манифест не роняет остальные:
// панель обязана подняться даже с одним испорченным модулем.
func Load(dir string) ([]Manifest, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil // папки modules может не быть вовсе, это норма
		}
		return nil, fmt.Errorf("читать %s: %w", dir, err)
	}
	var out []Manifest
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name(), "module.json"))
		if err != nil {
			continue
		}
		var m Manifest
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		if m.ID == "" || len(m.Run) == 0 {
			continue
		}
		out = append(out, m)
	}
	return out, nil
}
```

- [ ] **Шаг 4: Написать запуск**

`internal/modules/run.go`:

```go
package modules

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"time"
)

const (
	таймаутСбора  = 60 * time.Second
	таймаутЗапроса = 5 * time.Second
)

// Collect запускает модуль с командой collect и разбирает его вывод как
// словарь «ключ → данные блока».
func Collect(m Manifest, dir string) (map[string]json.RawMessage, error) {
	out, err := запустить(m, dir, таймаутСбора, "collect")
	if err != nil {
		return nil, err
	}
	var data map[string]json.RawMessage
	if err := json.Unmarshal(out, &data); err != nil {
		return nil, fmt.Errorf("модуль %s напечатал не json: %w", m.ID, err)
	}
	return data, nil
}

func Query(m Manifest, dir, key string, args any) (json.RawMessage, error) {
	return QueryWithTimeout(m, dir, key, args, int(таймаутЗапроса/time.Millisecond))
}

// QueryWithTimeout вынесен отдельно ради тестов: ждать пять секунд в прогоне
// незачем.
func QueryWithTimeout(m Manifest, dir, key string, args any, мс int) (json.RawMessage, error) {
	раw, _ := json.Marshal(args)
	out, err := запустить(m, dir, time.Duration(мс)*time.Millisecond, "query", key, string(раw))
	if err != nil {
		return nil, err
	}
	if !json.Valid(out) {
		return nil, fmt.Errorf("модуль %s напечатал не json", m.ID)
	}
	return out, nil
}

func запустить(m Manifest, dir string, срок time.Duration, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(context.Background(), срок)
	defer cancel()

	cmd := exec.CommandContext(ctx, m.Run[0], append(m.Run[1:], args...)...)
	cmd.Dir = dir
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr

	if err := cmd.Run(); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return nil, fmt.Errorf("модуль %s не ответил за %s", m.ID, срок)
		}
		return nil, fmt.Errorf("модуль %s упал: %w (%s)", m.ID, err, stderr.String())
	}
	return stdout.Bytes(), nil
}
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Запуск: `go test ./internal/modules/ -v`
Ожидаем: PASS трёх тестов.

- [ ] **Шаг 6: Коммит**

```bash
git add internal/modules/
git commit -m "Модули: разбор манифеста, запуск программы, таймаут и мусор в выводе"
```

---

### Задача 8: Вход по паролю

**Файлы:**
- Создать: `internal/api/auth.go`
- Тест: `internal/api/auth_test.go`

**Интерфейсы:**
- Отдаёт: `auth.SetPassword(s *store.Store, pass string) error`,
  `auth.Check(s *store.Store, pass string) bool`,
  `auth.Cookie(secret []byte, until time.Time) string`,
  `auth.Valid(secret []byte, cookie string) bool`,
  `auth.Middleware(secret []byte, next http.Handler) http.Handler`.

- [ ] **Шаг 1: Написать падающий тест**

```go
package api

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func TestПарольПроверяется(t *testing.T) {
	s, _ := store.Open(filepath.Join(t.TempDir(), "t.db"))
	defer s.Close()
	if err := SetPassword(s, "секрет"); err != nil {
		t.Fatal(err)
	}
	if !Check(s, "секрет") {
		t.Fatal("верный пароль отвергнут")
	}
	if Check(s, "не секрет") {
		t.Fatal("неверный пароль принят")
	}
}

func TestКукаПодписанаИПротухает(t *testing.T) {
	secret := []byte("ключ подписи")
	good := Cookie(secret, time.Now().Add(time.Hour))
	if !Valid(secret, good) {
		t.Fatal("свежая кука отвергнута")
	}
	old := Cookie(secret, time.Now().Add(-time.Minute))
	if Valid(secret, old) {
		t.Fatal("протухшая кука принята")
	}
	if Valid([]byte("чужой ключ"), good) {
		t.Fatal("кука принята с чужой подписью")
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/api/ -v`
Ожидаем: `undefined: SetPassword`.

- [ ] **Шаг 3: Написать реализацию**

`internal/api/auth.go`:

```go
package api

import (
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

const итераций = 210_000 // рекомендация OWASP для PBKDF2-HMAC-SHA256

func SetPassword(s *store.Store, pass string) error {
	соль := make([]byte, 16)
	if _, err := rand.Read(соль); err != nil {
		return err
	}
	ключ, err := pbkdf2.Key(sha256.New, pass, соль, итераций, 32)
	if err != nil {
		return err
	}
	v := base64.RawStdEncoding.EncodeToString(соль) + ":" +
		base64.RawStdEncoding.EncodeToString(ключ)
	_, err = s.DB().Exec(`INSERT INTO settings (k,v) VALUES ('password',?)
		ON CONFLICT(k) DO UPDATE SET v=excluded.v`, v)
	return err
}

func Check(s *store.Store, pass string) bool {
	var v string
	if err := s.DB().QueryRow(`SELECT v FROM settings WHERE k='password'`).Scan(&v); err != nil {
		return false
	}
	части := strings.SplitN(v, ":", 2)
	if len(части) != 2 {
		return false
	}
	соль, err := base64.RawStdEncoding.DecodeString(части[0])
	if err != nil {
		return false
	}
	эталон, err := base64.RawStdEncoding.DecodeString(части[1])
	if err != nil {
		return false
	}
	ключ, err := pbkdf2.Key(sha256.New, pass, соль, итераций, 32)
	if err != nil {
		return false
	}
	return subtle.ConstantTimeCompare(ключ, эталон) == 1
}

// Cookie: «до-когда.подпись». Хранить в куке нечего, кроме срока: сессий одна.
func Cookie(secret []byte, until time.Time) string {
	тело := strconv.FormatInt(until.Unix(), 10)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(тело))
	return тело + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func Valid(secret []byte, cookie string) bool {
	части := strings.SplitN(cookie, ".", 2)
	if len(части) != 2 {
		return false
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(части[0]))
	ждём := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(ждём), []byte(части[1])) != 1 {
		return false
	}
	до, err := strconv.ParseInt(части[0], 10, 64)
	if err != nil {
		return false
	}
	return time.Now().Unix() < до
}

func Middleware(secret []byte, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("tessera")
		if err != nil || !Valid(secret, c.Value) {
			http.Error(w, "нужен вход", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

var _ = fmt.Sprintf
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/api/ -v`

- [ ] **Шаг 5: Коммит**

```bash
git add internal/api/auth.go internal/api/auth_test.go
git commit -m "Вход: пароль через PBKDF2, кука со сроком и подписью"
```

---

### Задача 9: Api панели

**Файлы:**
- Создать: `internal/api/api.go`, `internal/api/layout.go`
- Тест: `internal/api/api_test.go`

**Интерфейсы:**
- Берёт: `blocks.Core`, `modules.Load/Collect/Query`, `auth.Middleware`.
- Отдаёт: `api.New(s *store.Store, modulesDir string, secret []byte) *API`,
  `(*API).Routes() *http.ServeMux`.
- Раскладка по умолчанию для вкладок ядра ставится при первом запуске:
  `layout.Default()` возвращает `map[string][]blocks.Block`.

- [ ] **Шаг 1: Написать падающий тест**

```go
package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func стенд(t *testing.T) (*API, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	s.CreateApp("togetherly", "Togetherly")
	s.InsertEvents("togetherly", []store.Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "memory_lane", MS: 5000},
	})
	s.RollupDay("togetherly", "2026-08-14")
	SetPassword(s, "пароль")

	секрет := []byte("подпись")
	a := New(s, t.TempDir(), секрет)
	return a, Cookie(секрет, время())
}

func TestРаскладкаОбзораПриходитСБлоками(t *testing.T) {
	a, кука := стенд(t)
	req := httptest.NewRequest("GET", "/api/layout?tab=overview", nil)
	req.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	var got struct{ Blocks []struct{ Type, Src string } }
	json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Blocks) == 0 {
		t.Fatal("раскладка пуста")
	}
}

func TestБезКукиДанныеНеОтдаются(t *testing.T) {
	a, _ := стенд(t)
	req := httptest.NewRequest("GET", "/api/block?src=core:events_daily&range=15d", nil)
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("код %d, ждали 401", rec.Code)
	}
}

func TestНеизвестныйИсточникОтвечает404(t *testing.T) {
	a, кука := стенд(t)
	req := httptest.NewRequest("GET", "/api/block?src=нет:такого&range=15d", nil)
	req.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, req)
	if rec.Code != 404 {
		t.Fatalf("код %d, ждали 404", rec.Code)
	}
}
```

Вспомогательная `время()` в том же файле:

```go
func время() time.Time { return time.Now().Add(time.Hour) }
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/api/ -run Раскладка -v`
Ожидаем: `undefined: New`.

- [ ] **Шаг 3: Написать раскладку по умолчанию**

`internal/api/layout.go`:

```go
package api

import "github.com/THET1ME-1/Tessera/internal/blocks"

// Default — вкладки ядра. Ровно такие же раскладки приносят модули, поэтому
// ядро проверяет договор на себе с первого дня.
func Default() map[string][]blocks.Block {
	return map[string][]blocks.Block{
		"overview": {
			{Type: "columns", Title: "События по дням", Span: 8, Src: "core:events_daily"},
			{Type: "stat", Title: "Событий за период", Span: 4, Src: "core:events_total"},
			{Type: "raster", Title: "Экраны", Span: 7, Src: "core:screens"},
			{Type: "table", Title: "Действия", Span: 5, Src: "core:actions"},
		},
		"screens": {
			{Type: "raster", Title: "Все размеченные экраны", Span: 12, Src: "core:screens"},
			{Type: "table", Title: "Действия", Span: 6, Src: "core:actions"},
		},
		"people": {
			{Type: "columns", Title: "Люди по дням", Span: 12, Src: "core:people_daily"},
		},
	}
}
```

- [ ] **Шаг 4: Написать роуты**

`internal/api/api.go`:

```go
package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/THET1ME-1/Tessera/internal/blocks"
	"github.com/THET1ME-1/Tessera/internal/modules"
	"github.com/THET1ME-1/Tessera/internal/store"
)

type API struct {
	s          *store.Store
	modulesDir string
	secret     []byte
	core       map[string]blocks.Source
}

func New(s *store.Store, modulesDir string, secret []byte) *API {
	return &API{s: s, modulesDir: modulesDir, secret: secret, core: blocks.Core(s)}
}

func (a *API) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/api/layout", Middleware(a.secret, http.HandlerFunc(a.layout)))
	mux.Handle("/api/block", Middleware(a.secret, http.HandlerFunc(a.block)))
	mux.Handle("/api/tabs", Middleware(a.secret, http.HandlerFunc(a.tabs)))
	return mux
}

func (a *API) layout(w http.ResponseWriter, r *http.Request) {
	tab := r.URL.Query().Get("tab")
	if tab == "" {
		tab = "overview"
	}
	var raw string
	err := a.s.DB().QueryRow(`SELECT blocks FROM layout WHERE tab=?`, tab).Scan(&raw)
	if err != nil {
		bs, ok := Default()[tab]
		if !ok {
			http.Error(w, "нет такой вкладки", http.StatusNotFound)
			return
		}
		отдать(w, map[string]any{"tab": tab, "blocks": bs})
		return
	}
	var bs []blocks.Block
	json.Unmarshal([]byte(raw), &bs)
	отдать(w, map[string]any{"tab": tab, "blocks": bs})
}

func (a *API) block(w http.ResponseWriter, r *http.Request) {
	src := r.URL.Query().Get("src")
	владелец, ключ, ok := strings.Cut(src, ":")
	if !ok {
		http.Error(w, "адрес источника вида владелец:ключ", http.StatusBadRequest)
		return
	}
	from, to := диапазон(r.URL.Query().Get("range"))
	app := r.URL.Query().Get("app")
	if app == "" {
		app = "togetherly"
	}

	if владелец == "core" {
		src, ok := a.core[ключ]
		if !ok {
			http.Error(w, "неизвестный источник ядра", http.StatusNotFound)
			return
		}
		data, err := src(app, from, to)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		отдать(w, data)
		return
	}

	var raw string
	err := a.s.DB().QueryRow(`SELECT json FROM module_data WHERE module=? AND key=?`,
		владелец, ключ).Scan(&raw)
	if err != nil {
		http.Error(w, "модуль не отвечал", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(raw))
}

func (a *API) tabs(w http.ResponseWriter, r *http.Request) {
	вкладки := []map[string]any{
		{"id": "overview", "title": "Обзор", "mod": false},
		{"id": "screens", "title": "Экраны", "mod": false},
		{"id": "people", "title": "Люди", "mod": false},
	}
	ms, _ := modules.Load(a.modulesDir)
	for _, m := range ms {
		for _, t := range m.Tabs {
			вкладки = append(вкладки, map[string]any{"id": t.ID, "title": t.Title, "mod": true})
		}
	}
	отдать(w, вкладки)
}

// диапазон понимает 7d, 15d, 30d, all и пару дат через две точки.
func диапазон(s string) (string, string) {
	конец := time.Now().UTC()
	if s == "all" {
		return "0000-01-01", конец.Format("2006-01-02")
	}
	if from, to, ok := strings.Cut(s, ".."); ok {
		return from, to
	}
	дней := 15
	if strings.HasSuffix(s, "d") {
		if n, err := strconv.Atoi(strings.TrimSuffix(s, "d")); err == nil && n > 0 {
			дней = n
		}
	}
	return конец.AddDate(0, 0, -дней+1).Format("2006-01-02"), конец.Format("2006-01-02")
}

func отдать(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
```

- [ ] **Шаг 5: Добавить источник `core:events_total`**

В `internal/blocks/core.go`, в словарь `Core`:

```go
		"events_total": func(app, from, to string) (any, error) {
			var всего float64
			err := s.DB().QueryRow(`SELECT coalesce(sum(hits),0) FROM daily
				WHERE app=? AND day BETWEEN ? AND ?`, app, from, to).Scan(&всего)
			if err != nil {
				return nil, fmt.Errorf("всего событий: %w", err)
			}
			return StatData{Value: всего, Sub: "за выбранный период"}, nil
		},
```

- [ ] **Шаг 6: Убедиться, что тесты проходят**

Запуск: `go test ./... -v`
Ожидаем: PASS во всех пакетах.

- [ ] **Шаг 7: Коммит**

```bash
git add internal/api/ internal/blocks/core.go
git commit -m "Api панели: вкладки, раскладка и данные блока по адресу"
```

---

### Задача 10: Точка входа и первый запуск

**Файлы:**
- Создать: `cmd/tessera/main.go`
- Тест: `cmd/tessera/main_test.go`

**Интерфейсы:**
- Берёт всё предыдущее. Флаги: `--data ./data`, `--port 8090`.
- Первый запуск заводит соль, ключ подписи куки, приложение `app` и печатает
  его ключ приёма.

- [ ] **Шаг 1: Написать падающий тест**

```go
package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestПервыйЗапускЗаводитСольИКлюч(t *testing.T) {
	dir := t.TempDir()
	s, key, err := подготовить(dir, "пароль")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if key == "" {
		t.Fatal("ключ приёма не выдан")
	}
	if _, err := os.Stat(filepath.Join(dir, ".salt")); err != nil {
		t.Fatalf("соль не создана: %v", err)
	}
	// Второй запуск не должен менять ни соль, ни ключ.
	s2, key2, err := подготовить(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if key2 != key {
		t.Fatalf("ключ сменился: было %q, стало %q", key, key2)
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./cmd/tessera/ -v`
Ожидаем: `undefined: подготовить`.

- [ ] **Шаг 3: Написать точку входа**

`cmd/tessera/main.go`:

```go
// Tessera — аналитика, которая живёт на сервере владельца приложения.
package main

import (
	"crypto/rand"
	"encoding/base64"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/THET1ME-1/Tessera/internal/api"
	"github.com/THET1ME-1/Tessera/internal/ingest"
	"github.com/THET1ME-1/Tessera/internal/store"
)

func main() {
	data := flag.String("data", "./data", "папка с базой и ключами")
	port := flag.Int("port", 8090, "порт")
	pass := flag.String("password", "", "задать пароль входа (только при первом запуске)")
	people := flag.Bool("people", false, "считать людей")
	flag.Parse()

	s, key, err := подготовить(*data, *pass)
	if err != nil {
		log.Fatal(err)
	}
	defer s.Close()

	соль, err := файлСоли(*data)
	if err != nil {
		log.Fatal(err)
	}
	секрет, err := ключПодписи(*data)
	if err != nil {
		log.Fatal(err)
	}

	in := ingest.New(s, соль, *people)
	mux := api.New(s, filepath.Join(filepath.Dir(*data), "modules"), секрет).Routes()
	mux.Handle("/i", in.Handler())

	// Сводки считает расписание, а не запрос: панель обязана только читать.
	go func() {
		for range time.Tick(10 * time.Minute) {
			if err := s.RollupRecent(2); err != nil {
				log.Printf("пересчёт сводок: %v", err)
			}
		}
	}()

	fmt.Printf("Tessera слушает :%d\nКлюч приёма: %s\n", *port, key)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%d", *port), mux))
}

// подготовить открывает базу, при первом запуске заводит приложение и пароль.
func подготовить(dir, pass string) (*store.Store, string, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, "", err
	}
	s, err := store.Open(filepath.Join(dir, "tessera.db"))
	if err != nil {
		return nil, "", err
	}
	if _, err := файлСоли(dir); err != nil {
		s.Close()
		return nil, "", err
	}
	if _, err := ключПодписи(dir); err != nil {
		s.Close()
		return nil, "", err
	}
	apps, err := s.Apps()
	if err != nil {
		s.Close()
		return nil, "", err
	}
	if len(apps) == 0 {
		key, err := s.CreateApp("app", "Приложение")
		if err != nil {
			s.Close()
			return nil, "", err
		}
		if pass != "" {
			if err := api.SetPassword(s, pass); err != nil {
				s.Close()
				return nil, "", err
			}
		}
		return s, key, nil
	}
	return s, apps[0].Key, nil
}

func файлСоли(dir string) ([]byte, error) { return секретФайл(filepath.Join(dir, ".salt")) }
func ключПодписи(dir string) ([]byte, error) { return секретФайл(filepath.Join(dir, ".cookie_key")) }

// секретФайл читает файл, а если его нет — заводит 32 случайных байта.
func секретФайл(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err == nil {
		return base64.RawStdEncoding.DecodeString(string(raw))
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(b)), 0o600); err != nil {
		return nil, err
	}
	return b, nil
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./... -v`

- [ ] **Шаг 5: Живой прогон**

```bash
go build -o tessera ./cmd/tessera
./tessera --data /tmp/тесс --port 8099 --password проверка &
KEY=$(grep -o 'Ключ приёма: .*' /dev/stdout || true)
curl -sS -X POST localhost:8099/i -H "X-Tessera-Key: $KEY" \
  -d '{"app":"app","events":[{"eid":"1","ts":'"$(date +%s)"',"kind":"screen","name":"главная","ms":1200}]}'
```
Ожидаем: `{"ok":true,"accepted":1}`.

- [ ] **Шаг 6: Коммит**

```bash
git add cmd/tessera/
git commit -m "Точка входа: флаги, первый запуск, расписание сводок"
```

---

### Задача 11: Уборщик старых событий

**Файлы:**
- Создать: `internal/store/cleanup.go`
- Тест: `internal/store/cleanup_test.go`

**Интерфейсы:**
- Отдаёт: `(*Store).Cleanup(rawDays, seenDays int) error`.

- [ ] **Шаг 1: Написать падающий тест**

```go
package store

import (
	"testing"
	"time"
)

func TestУборщикСноситСтароеСырьёНоНеСводки(t *testing.T) {
	s := открыть(t)
	давно := time.Now().AddDate(0, 0, -30).Unix()
	s.InsertEvents("togetherly", []Event{
		{EID: "старое", TS: давно, Kind: "screen", Name: "главная"},
		{EID: "свежее", TS: time.Now().Unix(), Kind: "screen", Name: "главная"},
	})
	день := time.Unix(давно, 0).UTC().Format("2006-01-02")
	s.RollupDay("togetherly", день)

	if err := s.Cleanup(14, 90); err != nil {
		t.Fatal(err)
	}

	var сырых int
	s.DB().QueryRow(`SELECT count(*) FROM events`).Scan(&сырых)
	if сырых != 1 {
		t.Fatalf("сырых событий %d, ждали 1", сырых)
	}
	var сводок int
	s.DB().QueryRow(`SELECT count(*) FROM daily WHERE day=?`, день).Scan(&сводок)
	if сводок == 0 {
		t.Fatal("уборщик снёс сводку, а она живёт вечно")
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/store/ -run Уборщик -v`

- [ ] **Шаг 3: Написать реализацию**

`internal/store/cleanup.go`:

```go
package store

import (
	"fmt"
	"time"
)

// Cleanup сносит сырые события старше rawDays и хеши посетителей старше
// seenDays. Сводки не трогает никогда: они и есть память панели.
func (s *Store) Cleanup(rawDays, seenDays int) error {
	порогСырья := time.Now().AddDate(0, 0, -rawDays).Unix()
	if _, err := s.db.Exec(`DELETE FROM events WHERE ts < ?`, порогСырья); err != nil {
		return fmt.Errorf("убрать старые события: %w", err)
	}
	порогХешей := time.Now().AddDate(0, 0, -seenDays).UTC().Format("2006-01-02")
	if _, err := s.db.Exec(`DELETE FROM seen WHERE day < ?`, порогХешей); err != nil {
		return fmt.Errorf("убрать старые хеши: %w", err)
	}
	return nil
}
```

- [ ] **Шаг 4: Убедиться, что тесты проходят**

Запуск: `go test ./internal/store/ -v`

- [ ] **Шаг 5: Подключить к расписанию**

В `cmd/tessera/main.go`, рядом с пересчётом сводок:

```go
	go func() {
		for range time.Tick(6 * time.Hour) {
			if err := s.Cleanup(14, 90); err != nil {
				log.Printf("уборка: %v", err)
			}
		}
	}()
```

- [ ] **Шаг 6: Коммит**

```bash
git add internal/store/cleanup.go internal/store/cleanup_test.go cmd/tessera/main.go
git commit -m "Уборщик: сырьё живёт две недели, хеши три месяца, сводки вечно"
```

---

### Задача 12: Нагрузочная проба

**Файлы:**
- Создать: `tools/load.go` (сборка по тегу, чтобы не попадать в бинарник)
- Тест: не нужен, это измерительный инструмент.

- [ ] **Шаг 1: Написать пробу**

`tools/load.go`:

```go
//go:build tools

// Проба меряет, сколько сервер принимает событий в секунду и сколько
// занимает пересчёт сводок. Запускать против живого сервера:
//   go run -tags tools ./tools -url http://localhost:8099 -key КЛЮЧ -n 100000
package main

import (
	"bytes"
	"flag"
	"fmt"
	"net/http"
	"time"
)

func main() {
	url := flag.String("url", "http://localhost:8090", "адрес сервера")
	key := flag.String("key", "", "ключ приёма")
	n := flag.Int("n", 100000, "сколько событий отправить")
	пачка := flag.Int("batch", 500, "по сколько в пачке")
	flag.Parse()

	начало := time.Now()
	ушло := 0
	for ушло < *n {
		var b bytes.Buffer
		b.WriteString(`{"app":"app","events":[`)
		for i := 0; i < *пачка && ушло < *n; i++ {
			if i > 0 {
				b.WriteByte(',')
			}
			fmt.Fprintf(&b, `{"eid":"проба-%d","ts":%d,"kind":"screen","name":"экран-%d","ms":%d}`,
				ушло, time.Now().Unix(), ушло%25, 1000+ушло%9000)
			ушло++
		}
		b.WriteString(`]}`)

		req, _ := http.NewRequest("POST", *url+"/i", &b)
		req.Header.Set("X-Tessera-Key", *key)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Println("ошибка отправки:", err)
			return
		}
		resp.Body.Close()
	}
	прошло := time.Since(начало)
	fmt.Printf("отправлено %d событий за %s — %.0f в секунду\n",
		*n, прошло.Round(time.Millisecond), float64(*n)/прошло.Seconds())
}
```

- [ ] **Шаг 2: Прогнать пробу**

```bash
go build -o tessera ./cmd/tessera
./tessera --data /tmp/тесс-проба --port 8099 --password проверка &
go run -tags tools ./tools -url http://localhost:8099 -key <ключ> -n 100000
```

**Замеры 14 августа 2026** (ноутбук, i5-13500H, живые события Togetherly):

| Что | Сколько |
|---|---|
| Приём событий | 3 438 592 за 32,8 с — **105 тысяч в секунду** |
| База после заливки | 561 МБ на 3,4 млн событий, 163 байта на событие |
| Разовый пересчёт сводок за 16 дней | 16,5 с |
| Ответ панели на блок | 9 мс |

Приём оказался втрое быстрее ожидания из спеки: ответ уходит раньше записи, и
узкое место — не запись, а разбор json. Пересчёт истории идёт разовой командой
`--rollup N`: расписание догоняет только свежие дни, а после заливки старых
событий сводок за них нет вовсе.

- [ ] **Шаг 3: Коммит**

```bash
git add tools/
git commit -m "Нагрузочная проба приёма"
```

---

### Задача 13: Словарь имён, сохранение раскладки, список модулей

**Файлы:**
- Изменить: `internal/api/api.go` (добавить роуты), `cmd/tessera/main.go`
  (расписание сбора модулей)
- Тест: `internal/api/names_test.go`

**Интерфейсы:**
- Берёт: `modules.Load`, `modules.Collect`, таблицы `labels`, `layout`,
  `module_data`.
- Добавляет роуты: `GET/POST /api/labels`, `POST /api/layout`,
  `GET /api/modules`.

- [ ] **Шаг 1: Написать падающий тест**

`internal/api/names_test.go`:

```go
package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestИмяСохраняетсяИВозвращается(t *testing.T) {
	a, кука := стенд(t)

	post := httptest.NewRequest("POST", "/api/labels",
		strings.NewReader(`{"app":"togetherly","key":"memory_lane","title":"Лента воспоминаний"}`))
	post.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, post)
	if rec.Code != 200 {
		t.Fatalf("сохранение имени: код %d, %s", rec.Code, rec.Body.String())
	}

	get := httptest.NewRequest("GET", "/api/labels?app=togetherly", nil)
	get.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec = httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, get)
	if !strings.Contains(rec.Body.String(), "Лента воспоминаний") {
		t.Fatalf("имя не вернулось: %s", rec.Body.String())
	}
}

func TestПустоеИмяСтираетЗапись(t *testing.T) {
	a, кука := стенд(t)
	для := func(title string) {
		req := httptest.NewRequest("POST", "/api/labels",
			strings.NewReader(`{"app":"togetherly","key":"draw","title":"`+title+`"}`))
		req.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
		a.Routes().ServeHTTP(httptest.NewRecorder(), req)
	}
	для("Общий холст")
	для("") // стереть

	get := httptest.NewRequest("GET", "/api/labels?app=togetherly", nil)
	get.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, get)
	if strings.Contains(rec.Body.String(), "Общий холст") {
		t.Fatal("пустое имя не стёрло запись")
	}
}

func TestРаскладкаСохраняется(t *testing.T) {
	a, кука := стенд(t)
	тело := `{"tab":"overview","blocks":[{"type":"stat","title":"Своё","span":4,"src":"core:events_total"}]}`
	post := httptest.NewRequest("POST", "/api/layout", strings.NewReader(тело))
	post.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, post)
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}

	get := httptest.NewRequest("GET", "/api/layout?tab=overview", nil)
	get.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	rec = httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, get)
	if !strings.Contains(rec.Body.String(), "Своё") {
		t.Fatalf("раскладка не сохранилась: %s", rec.Body.String())
	}
}
```

- [ ] **Шаг 2: Убедиться, что тест падает**

Запуск: `go test ./internal/api/ -run Имя -v`
Ожидаем: 404 на `/api/labels` — роута ещё нет.

- [ ] **Шаг 3: Дописать роуты**

В `internal/api/api.go`, в `Routes()`:

```go
	mux.Handle("/api/labels", Middleware(a.secret, http.HandlerFunc(a.labels)))
	mux.Handle("/api/modules", Middleware(a.secret, http.HandlerFunc(a.modulesList)))
```

И сами обработчики там же:

```go
func (a *API) labels(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var в struct{ App, Key, Title string }
		if err := json.NewDecoder(r.Body).Decode(&в); err != nil || в.Key == "" {
			http.Error(w, "нужны app, key и title", http.StatusBadRequest)
			return
		}
		// Пустое имя означает «вернуть ключ из кода», а не «назвать пустотой».
		if в.Title == "" {
			a.s.DB().Exec(`DELETE FROM labels WHERE app=? AND key=?`, в.App, в.Key)
		} else {
			a.s.DB().Exec(`INSERT INTO labels (app,key,title) VALUES (?,?,?)
				ON CONFLICT(app,key) DO UPDATE SET title=excluded.title`, в.App, в.Key, в.Title)
		}
		отдать(w, map[string]any{"ok": true})
		return
	}

	app := r.URL.Query().Get("app")
	rows, err := a.s.DB().Query(`SELECT key, title FROM labels WHERE app=?`, app)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	словарь := map[string]string{}
	for rows.Next() {
		var k, t string
		if err := rows.Scan(&k, &t); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		словарь[k] = t
	}
	отдать(w, словарь)
}

func (a *API) modulesList(w http.ResponseWriter, r *http.Request) {
	ms, err := modules.Load(a.modulesDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]map[string]any, 0, len(ms))
	for _, m := range ms {
		var свежесть int64
		a.s.DB().QueryRow(`SELECT max(updated) FROM module_data WHERE module=?`, m.ID).
			Scan(&свежесть)
		out = append(out, map[string]any{
			"id": m.ID, "name": m.Name, "version": m.Version,
			"tabs": len(m.Tabs), "tiles": len(m.Tiles), "updated": свежесть,
		})
	}
	отдать(w, out)
}
```

Метод `layout` дополняется веткой сохранения — в начале функции:

```go
	if r.Method == http.MethodPost {
		var в struct {
			Tab    string         `json:"tab"`
			Blocks []blocks.Block `json:"blocks"`
		}
		if err := json.NewDecoder(r.Body).Decode(&в); err != nil || в.Tab == "" {
			http.Error(w, "нужны tab и blocks", http.StatusBadRequest)
			return
		}
		raw, _ := json.Marshal(в.Blocks)
		_, err := a.s.DB().Exec(`INSERT INTO layout (tab, blocks, updated) VALUES (?,?,?)
			ON CONFLICT(tab) DO UPDATE SET blocks=excluded.blocks, updated=excluded.updated`,
			в.Tab, string(raw), time.Now().Unix())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		отдать(w, map[string]any{"ok": true})
		return
	}
```

- [ ] **Шаг 4: Подключить сбор модулей к расписанию**

В `cmd/tessera/main.go`, рядом с пересчётом сводок:

```go
	модулиДир := filepath.Join(filepath.Dir(*data), "modules")
	go func() {
		собрать := func() {
			ms, _ := modules.Load(модулиДир)
			for _, m := range ms {
				данные, err := modules.Collect(m, filepath.Join(модулиДир, m.ID))
				if err != nil {
					log.Printf("модуль %s: %v", m.ID, err)
					continue
				}
				for ключ, значение := range данные {
					s.DB().Exec(`INSERT INTO module_data (module,key,json,updated)
						VALUES (?,?,?,?) ON CONFLICT(module,key)
						DO UPDATE SET json=excluded.json, updated=excluded.updated`,
						m.ID, ключ, string(значение), time.Now().Unix())
				}
			}
		}
		собрать() // первый раз сразу, чтобы панель не ждала двадцать минут
		for range time.Tick(20 * time.Minute) {
			собрать()
		}
	}()
```

- [ ] **Шаг 5: Убедиться, что тесты проходят**

Запуск: `go test ./... -v`
Ожидаем: PASS во всех пакетах.

- [ ] **Шаг 6: Коммит**

```bash
git add internal/api/ cmd/tessera/main.go
git commit -m "Словарь имён, сохранение раскладки, список модулей и сбор по расписанию"
```

---

## Что дальше

Следующие планы, каждый отдельным документом:

- **Панель.** Перенос макета на живые данные, настраиваемый дашборд с
  перетаскиванием блоков, словарь имён, вход, вшивание в бинарник через
  `embed`.
- **Flutter SDK.** Буфер на диске, отправка пачками, повтор при обрыве,
  ни одного модального шага до первого кадра.
- **Первые модули.** «Доход» и «Модерация» — переезд с админки Togetherly.
