package blocks

import "testing"

// Крупная цифра обзора берётся у модуля, когда он знает число учёток лучше
// ядра. Но модуль принадлежит ПРИЛОЖЕНИЮ: 150 649 учёток Togetherly в панели
// Wallet, где нет ни одного человека, — не «неточность», а чужая цифра
// (поймано человеком 18.09.2026).
func TestЧужоеЧислоНеПодставляется(t *testing.T) {
	s := стенд(t)
	if _, err := s.DB().Exec(
		`INSERT INTO settings (k, v) VALUES ('provides.people_total','appdb:users_total')`,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().Exec(
		`INSERT INTO module_data (module, key, json, updated)
		 VALUES ('appdb','users_total','{"value":150649}',0)`,
	); err != nil {
		t.Fatal(err)
	}

	своё := Фильтр(func(app, модуль string) bool { return app == "togetherly" })

	if всего, есть := ИзМодуля(s, "people_total", своё.Для("togetherly")); !есть || всего != 150649 {
		t.Fatalf("своему приложению число обязано достаться: %v %v", всего, есть)
	}
	if _, есть := ИзМодуля(s, "people_total", своё.Для("wallet")); есть {
		t.Fatal("чужое число подставилось в панель другого приложения")
	}
	if _, есть := ИзМодуля(s, "people_total", nil); !есть {
		t.Fatal("без фильтра поведение обязано остаться прежним")
	}
}
