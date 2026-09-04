package api

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

// Блок «Версии» отвечает на вопрос «на чём люди сидят сейчас», а не «какой
// пик за день сборка когда-то набрала». Пока срез считался как max(people)
// по окну, старая сборка застревала наверху до тех пор, пока её лучший день
// не выпадет из тридцати: на проде 04.09.2026 первой строкой стояла 1.29.6
// с 11 669 людьми, набранными 21 августа, а живая 1.31.3 с 8 650 стояла
// пятой.
func TestВерсииПоказываютЖивойСрезАНеПикПрошлогоМесяца(t *testing.T) {
	a, _ := стенд(t)
	s := a.s

	давно := time.Now().UTC().AddDate(0, 0, -20)
	вчера := time.Now().UTC().AddDate(0, 0, -1)

	var события []store.Event
	// Десять человек двадцать дней назад — на старой сборке.
	for i := 1; i <= 10; i++ {
		события = append(события, store.Event{
			EID: fmt.Sprintf("old-%d", i), TS: давно.Unix(),
			Who: fmt.Sprintf("w%d", i), Platform: "android", Version: "1.28.0+120",
			Kind: "screen", Name: "home",
		})
	}
	// Вчера шестеро из них уже на новой, а седьмой не обновился.
	for i := 1; i <= 6; i++ {
		события = append(события, store.Event{
			EID: fmt.Sprintf("new-%d", i), TS: вчера.Unix(),
			Who: fmt.Sprintf("w%d", i), Platform: "android", Version: "1.31.3+222",
			Kind: "screen", Name: "home",
		})
	}
	события = append(события, store.Event{
		EID: "stale-7", TS: вчера.Unix(),
		Who: "w7", Platform: "android", Version: "1.28.0+120",
		Kind: "screen", Name: "home",
	})
	if _, err := s.InsertEvents("togetherly", события); err != nil {
		t.Fatal(err)
	}
	for _, д := range []time.Time{давно, вчера} {
		if err := s.RollupDay("togetherly", д.Format(time.DateOnly)); err != nil {
			t.Fatal(err)
		}
	}

	from := time.Now().UTC().AddDate(0, 0, -29).Format(time.DateOnly)
	to := time.Now().UTC().Format(time.DateOnly)
	срез, err := a.версии("togetherly", from, to)
	if err != nil {
		t.Fatal(err)
	}
	строки, ок := срез.([]map[string]any)
	if !ок || len(строки) == 0 {
		t.Fatalf("срез версий пуст: %#v", срез)
	}

	if строки[0]["v"] != "1.31.3+222" {
		t.Fatalf("наверху %v, а живая сборка — 1.31.3+222: %#v", строки[0]["v"], строки)
	}
	if строки[0]["u"].(float64) != 6 {
		t.Fatalf("на живой сборке %v людей вместо шести: %#v", строки[0]["u"], строки)
	}
	// На старой сборке остаются четверо: один не обновился и трое, кого с тех
	// пор не видели — их последняя известная сборка та же. Десяти там быть не
	// может: шестеро уже посчитаны на новой.
	for _, r := range строки {
		if r["v"] == "1.28.0+120" && r["u"].(float64) != 4 {
			t.Fatalf("на старой сборке %v людей вместо четырёх: %#v", r["u"], строки)
		}
	}
}

// Установка без счёта людей: у событий нет who, связки «человек — сборка» не
// существует, и остаётся срез последних посчитанных суток. Взять max по окну
// нельзя по той же причине, что и с людьми, а сумму — тем более: она сложит
// один и тот же телефон за каждый день.
func TestБезСчётаЛюдейВерсииБерутсяЗаПоследниеСутки(t *testing.T) {
	a, _ := стенд(t)
	s := a.s

	давно := time.Now().UTC().AddDate(0, 0, -20)
	вчера := time.Now().UTC().AddDate(0, 0, -1)

	var события []store.Event
	for i := 1; i <= 30; i++ {
		события = append(события, store.Event{
			EID: fmt.Sprintf("old-%d", i), TS: давно.Unix(),
			Platform: "android", Version: "1.28.0+120", Kind: "screen", Name: "home",
		})
	}
	for i := 1; i <= 5; i++ {
		события = append(события, store.Event{
			EID: fmt.Sprintf("new-%d", i), TS: вчера.Unix(),
			Platform: "android", Version: "1.31.3+222", Kind: "screen", Name: "home",
		})
	}
	if _, err := s.InsertEvents("togetherly", события); err != nil {
		t.Fatal(err)
	}
	for _, д := range []time.Time{давно, вчера} {
		if err := s.RollupDay("togetherly", д.Format(time.DateOnly)); err != nil {
			t.Fatal(err)
		}
	}

	срез, err := a.версии("togetherly",
		time.Now().UTC().AddDate(0, 0, -29).Format(time.DateOnly),
		time.Now().UTC().Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	строки := срез.([]map[string]any)
	if len(строки) != 1 || строки[0]["v"] != "1.31.3+222" {
		t.Fatalf("ждали срез последних суток с 1.31.3+222, пришло: %#v", строки)
	}
	// События за окно считаются по всей его длине, а не по одним суткам.
	if строки[0]["e"].(float64) != 5 {
		t.Fatalf("событий на сборке %v вместо пяти: %#v", строки[0]["e"], строки)
	}
}

// Числа рядом со сборками панель берёт из сводок и не заглядывает в сырые
// события: их на проде 28 миллионов, а срез считается на каждое открытие
// «Обзора».
func TestСрезВерсийНеЧитаетСырыеСобытия(t *testing.T) {
	a, _ := стенд(t)
	сегодня := time.Now().UTC().Format(time.DateOnly)
	месяцНазад := time.Now().UTC().AddDate(0, 0, -29).Format(time.DateOnly)

	планы := map[string]string{
		"срез по людям": планЗапроса(t, a, sqlСрезВерсий, "togetherly", месяцНазад, сегодня),
		"срез без людей": планЗапроса(t, a, sqlСрезВерсийБезЛюдей, "togetherly", "togetherly",
			месяцНазад, сегодня, сегодня, "togetherly", месяцНазад, сегодня, сегодня),
	}
	for имя, план := range планы {
		if strings.Contains(план, "events") {
			t.Fatalf("%s читает сырые события:\n%s", имя, план)
		}
	}
}
