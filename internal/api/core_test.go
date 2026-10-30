package api

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

// Список приложений собирается на каждый запрос ядра, то есть при открытии
// любой вкладки. Поэтому ни одному его запросу нельзя заглядывать в сырые
// события: там миллионы строк, и по индексу events_ts SQLite читает их все.
// На проде 24.08.2026 это стоило 13,6 секунды из 16 на весь ответ:
// «SELECT DISTINCT platform ... LIMIT 4» проходил 27,9 млн строк, потому что
// платформ всего две и лимит не набирается никогда, а «version ... ORDER BY
// id DESC LIMIT 1» сортировал всю таблицу ради одной строки.
//
// Признак здорового плана — ни одного упоминания events: платформы берутся из
// seen, версия — из сводки versions.
func TestСписокПриложенийНеЧитаетСырыеСобытия(t *testing.T) {
	a, _ := стенд(t)
	сегодня := time.Now().UTC().Format("2006-01-02")

	запросы := []struct {
		имя       string
		sql       string
		аргументы []any
	}{
		{"события", sqlСобытийПриложения, []any{"togetherly"}},
		{"люди", sqlЛюдейПриложения, []any{"togetherly"}},
		{"за сутки", sqlЗаСуткиПриложения, []any{"togetherly", сегодня}},
		{"версия", sqlВерсииПриложения, []any{"togetherly"}},
		{"платформы", sqlПлатформПриложения, []any{"togetherly"}},
	}

	for _, з := range запросы {
		план := планЗапроса(t, a, з.sql, з.аргументы...)
		if strings.Contains(план, "events") {
			t.Fatalf("%s читает сырые события:\n%s", з.имя, план)
		}
	}
}

func планЗапроса(t *testing.T, a *API, sql string, аргументы ...any) string {
	t.Helper()
	rows, err := a.s.DB().Query("EXPLAIN QUERY PLAN "+sql, аргументы...)
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
	return strings.Join(строки, "\n")
}

// Обзор и «Люди» рисуют всю историю, а не выбранный период: ползунок окна
// ходит по ней сам, волны прихода сравниваются за месяцы. Сетка суток ещё и
// перекладывается в пояс смотрящего, поэтому часы приходят по дням как есть,
// в UTC, а не сложенными в одни сутки.
func TestЯдроОтдаётИсториюИЧасы(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "GET", "/api/core?range=7d", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	var д struct {
		History []map[string]any `json:"history"`
		Hourly  struct {
			Start string       `json:"start"`
			Rows  [][]*float64 `json:"rows"`
		} `json:"hourly"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &д); err != nil {
		t.Fatal(err)
	}
	// Событие стенда — 14 августа, за пределами семи суток: история его видит.
	if len(д.History) != 1 || д.History[0]["d"] != "2026-08-14" {
		t.Fatalf("история: %v", д.History)
	}
	if д.Hourly.Start != "2026-08-14" || len(д.Hourly.Rows) != 1 || len(д.Hourly.Rows[0]) != 24 {
		t.Fatalf("часы: %+v", д.Hourly)
	}
	if д.Hourly.Rows[0][12] == nil || д.Hourly.Rows[0][3] != nil {
		t.Fatalf("12 часов посчитаны, 3 часа пусты: %v", д.Hourly.Rows[0])
	}
}

// «Платформы» на обзоре считают людей за окно, и за две недели число
// сдвигается медленно — на глаз оно стоит. Рядом с окном нужен сегодняшний
// день: это число живое и отвечает на вопрос «кто сейчас на Android».
func TestПлатформыНесутСегодня(t *testing.T) {
	a, кука := стенд(t)
	сегодня := time.Now().UTC().Format("2006-01-02")
	вчера := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")
	for _, с := range [][3]string{{сегодня, "а", "android"}, {вчера, "б", "android"}, {вчера, "в", "ios"}} {
		if _, err := a.s.DB().Exec(`INSERT INTO seen (app, day, who, platform) VALUES ('togetherly',?,?,?)`, с[0], с[1], с[2]); err != nil {
			t.Fatal(err)
		}
	}
	var д struct {
		Platforms []struct {
			P string  `json:"p"`
			U float64 `json:"u"`
			D float64 `json:"d"`
		} `json:"platforms"`
	}
	// Окно своё: ответ ядра кэшируется на полминуты по приложению и окну, и
	// семь суток уже спрашивал соседний тест.
	json.Unmarshal(запрос(t, a, "GET", "/api/core?range=6d", кука, "").Body.Bytes(), &д)
	итог := map[string][2]float64{}
	for _, п := range д.Platforms {
		итог[п.P] = [2]float64{п.U, п.D}
	}
	if итог["android"] != [2]float64{2, 1} || итог["ios"] != [2]float64{1, 0} {
		t.Fatalf("за окно и сегодня: %v", итог)
	}
}

// Окно обзора двигают ручкой, и на каждый отпуск панель спрашивает ядро. Всё
// подряд — история, часы, когорты, список приложений — от окна не зависит и
// пересчитывалось зря: три секунды на проде под потолком процессора, и со
// стороны казалось, что окно ничего не меняет. Поле only отдаёт только
// названные срезы.
func TestЯдроОтдаётТолькоНазванное(t *testing.T) {
	a, кука := стенд(t)
	var д map[string]any
	json.Unmarshal(запрос(t, a, "GET", "/api/core?range=5d&only=platforms,screens", кука, "").Body.Bytes(), &д)
	if _, есть := д["screens"]; !есть {
		t.Fatalf("нет названного среза: %v", д)
	}
	for _, лишнее := range []string{"history", "hourly", "cohorts", "apps", "modules"} {
		if _, есть := д[лишнее]; есть {
			t.Fatalf("пришёл ненужный срез %s", лишнее)
		}
	}
}
