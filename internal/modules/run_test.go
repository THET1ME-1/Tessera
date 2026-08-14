package modules

import (
	"os"
	"path/filepath"
	"testing"
)

// фиктивный собирает модуль-пустышку на shell: он печатает то, что от него ждут.
func фиктивный(t *testing.T, тело string) (string, Manifest) {
	t.Helper()
	корень := t.TempDir()
	dir := filepath.Join(корень, "demo")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.sh"), []byte(тело), 0o755); err != nil {
		t.Fatal(err)
	}
	манифест := `{
		"id":"demo","name":"Демо","version":"1.0.0",
		"run":["sh","main.sh"],"every":"20m",
		"tabs":[{"id":"demo","title":"Демо","blocks":[
			{"type":"stat","title":"Число","span":4,"src":"demo:month"}]}]}`
	if err := os.WriteFile(filepath.Join(dir, "module.json"), []byte(манифест), 0o644); err != nil {
		t.Fatal(err)
	}
	ms, err := Load(корень)
	if err != nil || len(ms) != 1 {
		t.Fatalf("манифест не прочитан: %v, штук %d", err, len(ms))
	}
	return dir, ms[0]
}

func TestСборДанныхМодуля(t *testing.T) {
	dir, m := фиктивный(t, `echo '{"month":{"value":305.73,"sub":"четыре источника"}}'`)
	got, err := Collect(m, dir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := got["month"]; !ok {
		t.Fatalf("ключа month нет: %v", got)
	}
}

func TestМанифестЧитаетсяЦеликом(t *testing.T) {
	_, m := фиктивный(t, `echo '{}'`)
	if m.ID != "demo" || m.Name != "Демо" || m.Every != "20m" {
		t.Fatalf("манифест разобран неверно: %+v", m)
	}
	if len(m.Tabs) != 1 || len(m.Tabs[0].Blocks) != 1 {
		t.Fatalf("вкладки модуля не разобраны: %+v", m.Tabs)
	}
	if m.Tabs[0].Blocks[0].Src != "demo:month" {
		t.Fatalf("адрес блока %q", m.Tabs[0].Blocks[0].Src)
	}
}

func TestМусорВВыводеНеРоняет(t *testing.T) {
	dir, m := фиктивный(t, `echo 'это не json'`)
	if _, err := Collect(m, dir); err == nil {
		t.Fatal("мусор принят за данные")
	}
}

func TestУпавшийМодульВозвращаетОшибку(t *testing.T) {
	dir, m := фиктивный(t, `echo 'беда' >&2; exit 3`)
	if _, err := Collect(m, dir); err == nil {
		t.Fatal("падение модуля прошло незамеченным")
	}
}

func TestЗависшийМодульОбрываетсяПоТаймауту(t *testing.T) {
	dir, m := фиктивный(t, `sleep 30`)
	if _, err := QueryWithTimeout(m, dir, "month", nil, 300); err == nil {
		t.Fatal("зависший модуль не оборван")
	}
}

func TestБитыйМанифестНеЛомаетОстальные(t *testing.T) {
	корень := t.TempDir()
	// один битый
	os.MkdirAll(filepath.Join(корень, "битый"), 0o755)
	os.WriteFile(filepath.Join(корень, "битый", "module.json"), []byte(`{ не json`), 0o644)
	// один целый
	os.MkdirAll(filepath.Join(корень, "целый"), 0o755)
	os.WriteFile(filepath.Join(корень, "целый", "module.json"),
		[]byte(`{"id":"целый","name":"Целый","run":["sh","main.sh"]}`), 0o644)

	ms, err := Load(корень)
	if err != nil {
		t.Fatal(err)
	}
	if len(ms) != 1 || ms[0].ID != "целый" {
		t.Fatalf("прочитано %d модулей: %+v", len(ms), ms)
	}
}

func TestПапкиМодулейМожетНеБыть(t *testing.T) {
	ms, err := Load(filepath.Join(t.TempDir(), "нет-такой"))
	if err != nil {
		t.Fatalf("отсутствие папки — это норма, а не ошибка: %v", err)
	}
	if len(ms) != 0 {
		t.Fatalf("откуда-то взялись модули: %+v", ms)
	}
}
