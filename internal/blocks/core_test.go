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
	if _, err := s.CreateApp("togetherly", "Togetherly"); err != nil {
		t.Fatal(err)
	}
	// 2026-08-14, полдень UTC
	if _, err := s.InsertEvents("togetherly", []store.Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "memory_lane", MS: 5000, Who: "ху1"},
		{EID: "2", TS: 1786708801, Kind: "screen", Name: "draw", MS: 9000, Who: "ху2"},
		{EID: "3", TS: 1786708802, Kind: "action", Name: "memory_added", Who: "ху1"},
	}); err != nil {
		t.Fatal(err)
	}
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
	// Ряды идут по убыванию: draw держал девять секунд против пяти у memory_lane.
	if d.Rows[0].Name != "draw" {
		t.Fatalf("первым идёт %q, ждали draw", d.Rows[0].Name)
	}
}

func TestИсточникДействийОтдаётТаблицу(t *testing.T) {
	src := Core(стенд(t))["actions"]
	got, err := src("togetherly", "2026-08-01", "2026-08-14")
	if err != nil {
		t.Fatal(err)
	}
	d, ok := got.(TableData)
	if !ok {
		t.Fatalf("тип %T, ждали TableData", got)
	}
	if len(d.Cols) != 3 || len(d.Rows) != 1 {
		t.Fatalf("колонок %d, строк %d, ждали 3 и 1", len(d.Cols), len(d.Rows))
	}
	if d.Rows[0][0] != "memory_added" {
		t.Fatalf("первая строка %v", d.Rows[0])
	}
}

func TestИсточникВсегоСобытийОтдаётПлитку(t *testing.T) {
	src := Core(стенд(t))["events_total"]
	got, err := src("togetherly", "2026-08-01", "2026-08-14")
	if err != nil {
		t.Fatal(err)
	}
	d, ok := got.(StatData)
	if !ok {
		t.Fatalf("тип %T, ждали StatData", got)
	}
	if d.Value != 3 {
		t.Fatalf("всего событий %v, ждали 3", d.Value)
	}
}

func TestПустойДиапазонНеРоняет(t *testing.T) {
	for ключ, src := range Core(стенд(t)) {
		if _, err := src("togetherly", "2020-01-01", "2020-01-31"); err != nil {
			t.Fatalf("источник %s на пустом диапазоне: %v", ключ, err)
		}
	}
}
