package api

import (
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
