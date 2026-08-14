// Пакет store держит базу и схему. Всё остальное ходит в SQLite только отсюда.
//
// Сборка обязательно с CGO: чистый Go-порт SQLite в десятки раз медленнее на
// полных сканах, и на этом уже висела админка соседнего проекта — COUNT по
// сорока тысячам строк отвечал две секунды, когорты с JOIN сорок три.
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
func Open(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_busy_timeout=15000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("открыть базу: %w", err)
	}
	// Пишущее соединение в SQLite всё равно одно, а лишние только плодят
	// блокировки и ошибку «database is locked» под нагрузкой.
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

func (s *Store) DB() *sql.DB  { return s.db }
func (s *Store) Close() error { return s.db.Close() }
