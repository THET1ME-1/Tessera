package blocks

import (
	"path/filepath"
	"testing"
	"time"

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

func TestПлиткиЛюдейДелятсяПоПлатформам(t *testing.T) {
	s := стенд(t)
	// свежие события: у «онлайн» окно в пять минут
	сейчас := time.Now().Unix()
	if _, err := s.InsertEvents("togetherly", []store.Event{
		{EID: "n1", TS: сейчас, Kind: "screen", Name: "главная", Who: "ху1", Platform: "android"},
		{EID: "n2", TS: сейчас, Kind: "screen", Name: "главная", Who: "ху2", Platform: "ios"},
		{EID: "n3", TS: сейчас, Kind: "screen", Name: "главная", Who: "ху3", Platform: "android"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.RollupDay("togetherly", time.Now().UTC().Format("2006-01-02")); err != nil {
		t.Fatal(err)
	}

	got, err := Core(s)["online"]("togetherly", "", "")
	if err != nil {
		t.Fatal(err)
	}
	d := got.(StatData)
	if d.Value != 3 {
		t.Fatalf("онлайн %v, ждали 3", d.Value)
	}
	if len(d.Parts) != 2 {
		t.Fatalf("платформ %d, ждали две: %+v", len(d.Parts), d.Parts)
	}
	if d.Parts[0].Name != "android" || d.Parts[0].Value != 2 {
		t.Fatalf("первая платформа %+v, ждали android с двумя", d.Parts[0])
	}
}

func TestАктивныеЗаСуткиСчитаютсяПоЛюдямАНеСобытиям(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "чисто.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if _, err := s.CreateApp("togetherly", "Togetherly"); err != nil {
		t.Fatal(err)
	}
	сегодня := time.Now().UTC().Format("2006-01-02")
	сейчас := time.Now().Unix()
	// один человек, десять событий
	var evs []store.Event
	for i := range 10 {
		evs = append(evs, store.Event{
			EID: "m" + string(rune('a'+i)), TS: сейчас, Kind: "screen",
			Name: "главная", Who: "ху1", Platform: "ios"})
	}
	if _, err := s.InsertEvents("togetherly", evs); err != nil {
		t.Fatal(err)
	}
	if err := s.RollupDay("togetherly", сегодня); err != nil {
		t.Fatal(err)
	}

	got, errИсточника := Core(s)["active_24h"]("togetherly", "", "")
	if errИсточника != nil {
		t.Fatal(errИсточника)
	}
	if v := got.(StatData).Value; v != 1 {
		t.Fatalf("активных %v, ждали одного человека на десять событий", v)
	}
}

func TestПриростНовыхПустБезПрошлогоОтрезка(t *testing.T) {
	s := стенд(t)
	got, err := Core(s)["new_24h"]("togetherly", "", "")
	if err != nil {
		t.Fatal(err)
	}
	if d := got.(StatData); d.Delta != nil {
		t.Fatalf("прирост показан на пустоте: %v", *d.Delta)
	}
}
