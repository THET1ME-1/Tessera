package store

import (
	"strings"
	"testing"
)

// План пересчёта важнее его текста: пока условие дня записано функцией от
// колонки (date(ts,'unixepoch')=?), индекс сужает выборку только по
// приложению, и SQLite читает все его события за всю историю. На проде это
// двенадцать миллионов строк каждую минуту, потому что расписание зовёт
// пересчёт текущего дня раз в минуту.
//
// Признак здорового плана — сужение по ts: SQLite пишет его как
// «SEARCH events USING INDEX events_ts (app=? AND ts>?)».
func TestПересчётДняЧитаетТолькоСвоиСутки(t *testing.T) {
	s := открыть(t)
	if _, err := s.InsertEvents("togetherly", []Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "главная", Who: "ху1"},
	}); err != nil {
		t.Fatal(err)
	}

	запросы, err := запросыСводкиДня("togetherly", "2026-08-14")
	if err != nil {
		t.Fatal(err)
	}
	for _, запрос := range запросы {
		план := план(t, s, запрос.sql, запрос.аргументы...)
		if !strings.Contains(план, "ts>") {
			t.Fatalf("%s читает события за всю историю, а не за сутки:\n%s",
				запрос.имя, план)
		}
	}
}

func план(t *testing.T, s *Store, sql string, аргументы ...any) string {
	t.Helper()
	rows, err := s.DB().Query("EXPLAIN QUERY PLAN "+sql, аргументы...)
	if err != nil {
		t.Fatalf("план для %q: %v", sql, err)
	}
	defer rows.Close()

	var строки []string
	for rows.Next() {
		var id, parent, notused int
		var detail string
		if err := rows.Scan(&id, &parent, &notused, &detail); err != nil {
			t.Fatal(err)
		}
		строки = append(строки, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(строки, "\n")
}
