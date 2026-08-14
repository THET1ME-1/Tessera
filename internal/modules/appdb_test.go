package modules

import (
	"path/filepath"
	"runtime"
	"testing"
)

// Модуль «База приложения» лежит в репозитории готовым, поэтому ядро обязано
// читать его манифест без правок — включая незнакомую секцию sql.
func TestМанифестМодуляБазыЧитается(t *testing.T) {
	_, файл, _, _ := runtime.Caller(0)
	корень := filepath.Join(filepath.Dir(файл), "..", "..", "modules")

	ms, err := Load(корень)
	if err != nil {
		t.Fatal(err)
	}
	var найден *Manifest
	for i := range ms {
		if ms[i].ID == "appdb" {
			найден = &ms[i]
		}
	}
	if найден == nil {
		t.Fatalf("модуль appdb не прочитан, найдено: %+v", ms)
	}
	if len(найден.Tabs) != 1 || найден.Tabs[0].ID != "product" {
		t.Fatalf("вкладка модуля разобрана неверно: %+v", найден.Tabs)
	}
	if len(найден.Tabs[0].Blocks) < 10 {
		t.Fatalf("блоков во вкладке %d, ждали хотя бы десять", len(найден.Tabs[0].Blocks))
	}
	if len(найден.Tiles) != 4 {
		t.Fatalf("плиток для обзора %d, ждали четыре", len(найден.Tiles))
	}
	// Незнакомое ядру поле sql не должно мешать разбору.
	if найден.Name != "База приложения" {
		t.Fatalf("имя модуля %q", найден.Name)
	}
}
