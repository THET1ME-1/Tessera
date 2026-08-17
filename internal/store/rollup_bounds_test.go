package store

import "testing"

// Сутки режутся по UTC, и границы у них жёсткие: 00:00:00 входит в день,
// 00:00:00 следующего дня — уже нет. Тест держит эту черту, пока условие дня
// переписывается с date(ts,'unixepoch') на диапазон меток времени.
func TestПересчётБерётРовноСуткиПоUTC(t *testing.T) {
	s := открыть(t)
	// 2026-08-14 00:00:00 UTC = 1786694400.
	начало := int64(1786694400)
	if _, err := s.InsertEvents("togetherly", []Event{
		{EID: "до", TS: начало - 1, Kind: "screen", Name: "главная", Who: "ху1"},
		{EID: "первая секунда", TS: начало, Kind: "screen", Name: "главная", Who: "ху2"},
		{EID: "последняя секунда", TS: начало + 86399, Kind: "screen", Name: "главная", Who: "ху3"},
		{EID: "после", TS: начало + 86400, Kind: "screen", Name: "главная", Who: "ху4"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
		t.Fatal(err)
	}

	var hits, people int
	err := s.DB().QueryRow(
		`SELECT hits, people FROM daily WHERE app=? AND day=? AND name=?`,
		"togetherly", "2026-08-14", "главная").Scan(&hits, &people)
	if err != nil {
		t.Fatalf("сводка не найдена: %v", err)
	}
	if hits != 2 || people != 2 {
		t.Fatalf("hits=%d people=%d, ждали 2/2: только первая и последняя секунда суток",
			hits, people)
	}

	// Часы тоже режутся по той же границе: нулевой и двадцать третий.
	var часов int
	if err := s.DB().QueryRow(
		`SELECT count(*) FROM hourly WHERE app=? AND day=?`,
		"togetherly", "2026-08-14").Scan(&часов); err != nil {
		t.Fatal(err)
	}
	if часов != 2 {
		t.Fatalf("часов в сводке %d, ждали 2", часов)
	}
}
