package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/THET1ME-1/Tessera/internal/store"
)

func стенд(t *testing.T) (*API, string) {
	t.Helper()
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	if _, err := s.CreateApp("togetherly", "Togetherly"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.InsertEvents("togetherly", []store.Event{
		{EID: "1", TS: 1786708800, Kind: "screen", Name: "memory_lane", MS: 5000},
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.RollupDay("togetherly", "2026-08-14"); err != nil {
		t.Fatal(err)
	}
	секрет := []byte("подпись")
	return New(s, t.TempDir(), секрет), Cookie(секрет, time.Now().Add(time.Hour))
}

func запрос(t *testing.T, a *API, метод, адрес, кука, тело string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if тело == "" {
		r = httptest.NewRequest(метод, адрес, nil)
	} else {
		r = httptest.NewRequest(метод, адрес, strings.NewReader(тело))
	}
	if кука != "" {
		r.AddCookie(&http.Cookie{Name: "tessera", Value: кука})
	}
	rec := httptest.NewRecorder()
	a.Routes().ServeHTTP(rec, r)
	return rec
}

func TestРаскладкаОбзораПриходитСБлоками(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "GET", "/api/layout?tab=overview", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Blocks []struct{ Type, Src string }
	}
	json.Unmarshal(rec.Body.Bytes(), &got)
	if len(got.Blocks) == 0 {
		t.Fatal("раскладка пуста")
	}
}

func TestБезКукиДанныеНеОтдаются(t *testing.T) {
	a, _ := стенд(t)
	rec := запрос(t, a, "GET", "/api/block?src=core:events_daily&range=15d", "", "")
	if rec.Code != 401 {
		t.Fatalf("код %d, ждали 401", rec.Code)
	}
}

func TestНеизвестныйИсточникОтвечает404(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "GET", "/api/block?src=core:нетТакого&range=15d", кука, "")
	if rec.Code != 404 {
		t.Fatalf("код %d, ждали 404", rec.Code)
	}
}

func TestДанныеБлокаПриходятСДиапазоном(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "GET",
		"/api/block?src=core:events_daily&range=2026-08-01..2026-08-14&app=togetherly", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "2026-08-14") {
		t.Fatalf("в ответе нет дня с событиями: %s", rec.Body.String())
	}
}

func TestИмяСохраняетсяИВозвращается(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "POST", "/api/labels", кука,
		`{"app":"togetherly","key":"memory_lane","title":"Лента воспоминаний"}`)
	if rec.Code != 200 {
		t.Fatalf("сохранение имени: код %d, %s", rec.Code, rec.Body.String())
	}
	rec = запрос(t, a, "GET", "/api/labels?app=togetherly", кука, "")
	if !strings.Contains(rec.Body.String(), "Лента воспоминаний") {
		t.Fatalf("имя не вернулось: %s", rec.Body.String())
	}
}

func TestПустоеИмяСтираетЗапись(t *testing.T) {
	a, кука := стенд(t)
	запрос(t, a, "POST", "/api/labels", кука, `{"app":"togetherly","key":"draw","title":"Общий холст"}`)
	запрос(t, a, "POST", "/api/labels", кука, `{"app":"togetherly","key":"draw","title":""}`)

	rec := запрос(t, a, "GET", "/api/labels?app=togetherly", кука, "")
	if strings.Contains(rec.Body.String(), "Общий холст") {
		t.Fatalf("пустое имя не стёрло запись: %s", rec.Body.String())
	}
}

func TestРаскладкаСохраняется(t *testing.T) {
	a, кука := стенд(t)
	тело := `{"tab":"overview","blocks":[{"type":"stat","title":"Своё","span":4,"src":"core:events_total"}]}`
	if rec := запрос(t, a, "POST", "/api/layout", кука, тело); rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	rec := запрос(t, a, "GET", "/api/layout?tab=overview", кука, "")
	if !strings.Contains(rec.Body.String(), "Своё") {
		t.Fatalf("раскладка не сохранилась: %s", rec.Body.String())
	}
}

func TestВкладкиМодуляВстаютРядомСЯдром(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	модули := t.TempDir()
	os.MkdirAll(filepath.Join(модули, "income"), 0o755)
	os.WriteFile(filepath.Join(модули, "income", "module.json"), []byte(`{
		"id":"income","name":"Доход","run":["sh","main.sh"],
		"tabs":[{"id":"income","title":"Доход","blocks":[]}]}`), 0o644)

	секрет := []byte("подпись")
	a := New(s, модули, секрет)
	rec := запрос(t, a, "GET", "/api/tabs", Cookie(секрет, time.Now().Add(time.Hour)), "")

	var вкладки []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
		Mod   bool   `json:"mod"`
	}
	json.Unmarshal(rec.Body.Bytes(), &вкладки)
	// Вкладок ядра шесть, как в макете: обзор, экраны, люди, воронки, версии,
	// приложения. Модуль добавляет свою в конец.
	if len(вкладки) != 7 {
		t.Fatalf("вкладок %d, ждали шесть ядра плюс одну модуля: %+v", len(вкладки), вкладки)
	}
	последняя := вкладки[len(вкладки)-1]
	if последняя.ID != "income" || !последняя.Mod {
		t.Fatalf("вкладка модуля не помечена: %+v", последняя)
	}
}

func TestДанныеМодуляОтдаютсяИзБазы(t *testing.T) {
	a, кука := стенд(t)
	a.s.DB().Exec(`INSERT INTO module_data (module,key,json,updated) VALUES (?,?,?,?)`,
		"income", "month", `{"value":305.73,"sub":"четыре источника"}`, time.Now().Unix())

	rec := запрос(t, a, "GET", "/api/block?src=income:month&range=15d", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "305.73") {
		t.Fatalf("данные модуля не вернулись: %s", rec.Body.String())
	}
}

func TestМолчавшийМодульОтвечает404АНеПадением(t *testing.T) {
	a, кука := стенд(t)
	rec := запрос(t, a, "GET", "/api/block?src=income:month&range=15d", кука, "")
	if rec.Code != 404 {
		t.Fatalf("код %d, ждали 404", rec.Code)
	}
}

func TestВходВыдаётКукуТолькоПоПаролю(t *testing.T) {
	a, _ := стенд(t)
	if err := SetPassword(a.s, "секрет"); err != nil {
		t.Fatal(err)
	}

	rec := запрос(t, a, "POST", "/api/login", "", `{"password":"не тот"}`)
	if rec.Code != 401 {
		t.Fatalf("неверный пароль: код %d, ждали 401", rec.Code)
	}

	rec = запрос(t, a, "POST", "/api/login", "", `{"password":"секрет"}`)
	if rec.Code != 200 {
		t.Fatalf("верный пароль: код %d, %s", rec.Code, rec.Body.String())
	}
	куки := rec.Result().Cookies()
	if len(куки) == 0 || куки[0].Name != "tessera" || куки[0].Value == "" {
		t.Fatalf("кука не выдана: %+v", куки)
	}
	if !куки[0].HttpOnly {
		t.Fatal("кука доступна скриптам страницы")
	}

	// Выданной кукой панель сразу открывает данные.
	rec2 := запрос(t, a, "GET", "/api/tabs", куки[0].Value, "")
	if rec2.Code != 200 {
		t.Fatalf("с выданной кукой код %d", rec2.Code)
	}
}

func TestСостояниеОтвечаетБезКуки(t *testing.T) {
	a, _ := стенд(t)
	rec := запрос(t, a, "GET", "/api/state", "", "")
	if rec.Code != 200 {
		t.Fatalf("код %d, ждали 200: состояние нужно до входа", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"signedIn":false`) {
		t.Fatalf("ответ без куки: %s", rec.Body.String())
	}
}

// Блок, зависящий от периода, обязан спрашивать модуль заново — с датами.
//
// Пока такие блоки читались из предсказанной таблицы, переключатель «7 дней /
// 30 дней / всё время» на вкладке дохода не менял ни одного числа: модуль
// собирает данные командой `collect`, где периода нет вовсе. Со стороны это
// выглядит как сломанные кнопки, а на деле — как неверная сумма.
func TestБлокСПериодомСпрашиваетМодульСДатами(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	модули := t.TempDir()
	папка := filepath.Join(модули, "income")
	os.MkdirAll(папка, 0o755)
	// Модуль печатает то, что ему передали: так видно, доехал ли период.
	os.WriteFile(filepath.Join(папка, "main.sh"),
		[]byte(`printf '{"value":1,"sub":%s}' "$3"`), 0o755)
	os.WriteFile(filepath.Join(папка, "module.json"), []byte(`{
		"id":"income","name":"Доход","run":["sh","main.sh"],
		"tabs":[{"id":"income","title":"Доход","blocks":[
			{"type":"stat","title":"За период","src":"income:month","ranged":true}]}]}`), 0o644)

	секрет := []byte("подпись")
	a := New(s, модули, секрет)
	кука := Cookie(секрет, time.Now().Add(time.Hour))
	// Предсчитанное лежит в базе и НЕ должно попасть в ответ: оно без периода.
	a.s.DB().Exec(`INSERT INTO module_data (module,key,json,updated) VALUES (?,?,?,?)`,
		"income", "month", `{"value":377.86,"sub":"с начала месяца"}`, time.Now().Unix())

	rec := запрос(t, a, "GET", "/api/block?src=income:month&range=7d", кука, "")
	if rec.Code != 200 {
		t.Fatalf("код %d: %s", rec.Code, rec.Body.String())
	}
	тело := rec.Body.String()
	if strings.Contains(тело, "377.86") {
		t.Fatalf("отдано предсчитанное вместо счёта за период: %s", тело)
	}
	if !strings.Contains(тело, `"from"`) || !strings.Contains(тело, `"to"`) {
		t.Fatalf("модулю не передали границы периода: %s", тело)
	}
}


// Новая плитка модуля появляется на обзоре и в уже настроенной раскладке —
// но ровно один раз.
//
// Раскладку человек правит и она ложится в базу; после этого блоки нового
// модуля в неё не попадали вовсе, и плитка оставалась невидимой навсегда.
// Возвращать её каждый раз тоже нельзя: убранное должно оставаться убранным.
func TestНоваяПлиткаМодуляДоезжаетДоНастроенногоОбзора(t *testing.T) {
	s, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	модули := t.TempDir()
	папка := filepath.Join(модули, "moderation")
	os.MkdirAll(папка, 0o755)
	os.WriteFile(filepath.Join(папка, "module.json"), []byte(`{
		"id":"moderation","name":"Модерация","run":["sh","main.sh"],
		"tiles":[{"type":"stat","title":"Сейчас на связи","src":"moderation:online","live":"20s","span":3}]}`), 0o644)

	// Человек уже настроил обзор, и плитки модерации там нет.
	s.DB().Exec(`INSERT INTO layout (tab, blocks, updated) VALUES (?,?,?)`,
		"overview", `[{"type":"stat","title":"Онлайн сейчас","span":3,"src":"core:online"}]`,
		time.Now().Unix())

	секрет := []byte("подпись")
	a := New(s, модули, секрет)
	кука := Cookie(секрет, time.Now().Add(time.Hour))

	есть := func() bool {
		rec := запрос(t, a, "GET", "/api/layout?tab=overview", кука, "")
		return strings.Contains(rec.Body.String(), "moderation:online")
	}

	if !есть() {
		t.Fatal("новая плитка модуля не доехала до настроенного обзора")
	}

	// Человек убрал её и сохранил раскладку без неё — значит она не нужна.
	rec := запрос(t, a, "POST", "/api/layout", кука,
		`{"tab":"overview","blocks":[{"type":"stat","title":"Онлайн сейчас","span":3,"src":"core:online"}]}`)
	if rec.Code != 200 {
		t.Fatalf("раскладка не сохранилась: %d %s", rec.Code, rec.Body.String())
	}
	if есть() {
		t.Fatal("убранная плитка вернулась сама")
	}
}
