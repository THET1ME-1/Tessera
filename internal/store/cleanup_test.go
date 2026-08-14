package store

import (
	"testing"
	"time"
)

func TestУборщикСноситСтароеСырьёНоНеСводки(t *testing.T) {
	s := открыть(t)
	давно := time.Now().AddDate(0, 0, -30).Unix()
	if _, err := s.InsertEvents("togetherly", []Event{
		{EID: "старое", TS: давно, Kind: "screen", Name: "главная"},
		{EID: "свежее", TS: time.Now().Unix(), Kind: "screen", Name: "главная"},
	}); err != nil {
		t.Fatal(err)
	}
	день := time.Unix(давно, 0).UTC().Format("2006-01-02")
	if err := s.RollupDay("togetherly", день); err != nil {
		t.Fatal(err)
	}

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

func TestУборщикЧиститСтарыеХешиЛюдей(t *testing.T) {
	s := открыть(t)
	давно := time.Now().AddDate(0, 0, -100).UTC().Format("2006-01-02")
	s.DB().Exec(`INSERT INTO seen (app, day, who) VALUES (?,?,?)`, "togetherly", давно, "ху1")
	s.DB().Exec(`INSERT INTO seen (app, day, who) VALUES (?,?,?)`,
		"togetherly", time.Now().UTC().Format("2006-01-02"), "ху2")

	if err := s.Cleanup(14, 90); err != nil {
		t.Fatal(err)
	}
	var n int
	s.DB().QueryRow(`SELECT count(*) FROM seen`).Scan(&n)
	if n != 1 {
		t.Fatalf("хешей осталось %d, ждали 1", n)
	}
}
