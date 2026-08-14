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
