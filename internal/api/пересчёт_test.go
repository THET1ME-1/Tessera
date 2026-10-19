package api

import (
	"testing"
	"time"
)

// Пересчёт текущего дня держит пишущее соединение каждую минуту: на проде
// 19.10.2026 — по 26–28 секунд из шестидесяти. Пока панель читала через него
// же, запрос при открытии вставал в очередь за пересчётом, и вкладка висела на
// «Загружаю…», пока человек не нажмёт её ещё раз.
func TestПанельНеЖдётПересчётаСводок(t *testing.T) {
	a, кука := стенд(t)

	// Пишущее соединение занято, как во время пересчёта.
	tx, err := a.s.DB().Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO settings (k,v) VALUES ('пересчёт','идёт')`); err != nil {
		t.Fatal(err)
	}

	for _, адрес := range []string{"/api/state", "/api/tabs", "/api/layout?tab=overview",
		"/api/core?range=15d", "/api/labels?app=togetherly", "/api/modules"} {
		готово := make(chan int, 1)
		go func() { готово <- запрос(t, a, "GET", адрес, кука, "").Code }()
		select {
		case код := <-готово:
			if код != 200 {
				t.Fatalf("%s: код %d", адрес, код)
			}
		case <-time.After(3 * time.Second):
			tx.Rollback()
			<-готово
			t.Fatalf("%s ждёт, пока освободится пишущее соединение", адрес)
		}
	}
}
