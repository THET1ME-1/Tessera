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
