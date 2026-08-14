package store

import "testing"

func TestСводкаСчитаетОткрытияИЛюдей(t *testing.T) {
	s := открыть(t)
	// 2026-08-14, полдень UTC и рядом
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
	for range 3 {
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

func TestАнонимныеСобытияНеСчитаютсяЛюдьми(t *testing.T) {
	s := открыть(t)
	s.InsertEvents("togetherly", []Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "главная"},
		{EID: "2", TS: 1786708801, Kind: "screen", Name: "главная"},
	})
	if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
		t.Fatal(err)
	}
	var hits, people int
	s.DB().QueryRow(`SELECT hits, people FROM daily WHERE app=? AND day=?`,
		"togetherly", "2026-08-14").Scan(&hits, &people)
	if hits != 2 || people != 0 {
		t.Fatalf("hits=%d people=%d, ждали 2/0: без счёта людей человек ноль", hits, people)
	}
}
