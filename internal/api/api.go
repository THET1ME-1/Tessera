// Пакет api отдаёт панели вкладки, раскладку и данные блоков.
//
// Панель не знает, кто наполняет блок: адрес «core:events_daily» ведёт в ядро,
// «income:month» — в таблицу, куда сложил данные модуль. Разницы для неё нет,
// и в этом весь смысл договора.
package api

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/THET1ME-1/Tessera/internal/blocks"
	"github.com/THET1ME-1/Tessera/internal/modules"
	"github.com/THET1ME-1/Tessera/internal/store"
)

type API struct {
	s          *store.Store
	modulesDir string
	secret     []byte
	core       map[string]blocks.Source
}

func New(s *store.Store, modulesDir string, secret []byte) *API {
	return &API{s: s, modulesDir: modulesDir, secret: secret, core: blocks.Core(s)}
}

func (a *API) Routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/api/layout", Middleware(a.secret, http.HandlerFunc(a.layout)))
	mux.Handle("/api/block", Middleware(a.secret, http.HandlerFunc(a.block)))
	mux.Handle("/api/tabs", Middleware(a.secret, http.HandlerFunc(a.tabs)))
	mux.Handle("/api/labels", Middleware(a.secret, http.HandlerFunc(a.labels)))
	mux.Handle("/api/modules", Middleware(a.secret, http.HandlerFunc(a.modulesList)))
	mux.Handle("/api/catalog", Middleware(a.secret, http.HandlerFunc(a.catalog)))
	mux.Handle("/api/file", Middleware(a.secret, http.HandlerFunc(a.file)))
	mux.Handle("/api/query", Middleware(a.secret, http.HandlerFunc(a.query)))
	// Вкладки ядра нарисованы в макете до последней подписи, поэтому получают
	// весь набор данных разом, а не по блоку за запрос.
	mux.Handle("/api/core", Middleware(a.secret, http.HandlerFunc(a.всеДанные)))
	// Вход и состояние открыты без куки: иначе панели неоткуда её взять.
	mux.HandleFunc("/api/login", a.login)
	mux.HandleFunc("/api/logout", a.logout)
	mux.HandleFunc("/api/state", a.state)
	return mux
}

// layout отдаёт и сохраняет раскладку вкладки: блоки ядра и блоки модулей
// лежат в одном списке и двигаются вперемешку.
func (a *API) layout(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var в struct {
			Tab    string         `json:"tab"`
			Blocks []blocks.Block `json:"blocks"`
		}
		if err := json.NewDecoder(r.Body).Decode(&в); err != nil || в.Tab == "" {
			http.Error(w, "нужны tab и blocks", http.StatusBadRequest)
			return
		}
		raw, err := json.Marshal(в.Blocks)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_, err = a.s.DB().Exec(`INSERT INTO layout (tab, blocks, updated) VALUES (?,?,?)
			ON CONFLICT(tab) DO UPDATE SET blocks=excluded.blocks, updated=excluded.updated`,
			в.Tab, string(raw), time.Now().Unix())
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		отдать(w, map[string]any{"ok": true})
		return
	}

	tab := r.URL.Query().Get("tab")
	if tab == "" {
		tab = "overview"
	}

	var raw string
	if err := a.s.DB().QueryRow(`SELECT blocks FROM layout WHERE tab=?`, tab).Scan(&raw); err != nil {
		// Своей раскладки ещё нет — отдаём заводскую.
		bs, ok := Default()[tab]
		if ok && tab == "overview" {
			// Плитки модулей кладём на обзор сразу, а не ждём, пока человек
			// найдёт их в каталоге. Ядро считает людей по своим событиям —
			// это те, кого видел SDK; сколько всего учёток заведено, знает
			// только само приложение, и без его плитки главный экран отвечает
			// не на тот вопрос.
			bs = append(append([]blocks.Block{}, bs...), a.плиткиМодулей()...)
		}
		if !ok {
			bs = a.вкладкаМодуля(tab)
		}
		if bs == nil {
			http.Error(w, "нет такой вкладки", http.StatusNotFound)
			return
		}
		отдать(w, map[string]any{"tab": tab, "blocks": bs})
		return
	}

	var bs []blocks.Block
	if err := json.Unmarshal([]byte(raw), &bs); err != nil {
		http.Error(w, "раскладка испорчена", http.StatusInternalServerError)
		return
	}
	отдать(w, map[string]any{"tab": tab, "blocks": bs})
}

// плиткиМодулей — то, что модули предлагают положить на обзор. Порядок как у
// модулей: сперва база приложения, потом деньги, потом модерация.
func (a *API) плиткиМодулей() []blocks.Block {
	ms, _ := modules.Load(a.modulesDir)
	out := []blocks.Block{}
	for _, m := range ms {
		out = append(out, m.Tiles...)
	}
	return out
}

func (a *API) вкладкаМодуля(tab string) []blocks.Block {
	ms, _ := modules.Load(a.modulesDir)
	for _, m := range ms {
		for _, t := range m.Tabs {
			if t.ID == tab {
				return t.Blocks
			}
		}
	}
	return nil
}

func (a *API) block(w http.ResponseWriter, r *http.Request) {
	владелец, ключ, ok := strings.Cut(r.URL.Query().Get("src"), ":")
	if !ok {
		http.Error(w, "адрес источника вида владелец:ключ", http.StatusBadRequest)
		return
	}
	from, to := диапазон(r.URL.Query().Get("range"))
	app := r.URL.Query().Get("app")
	if app == "" {
		app = a.первоеПриложение()
	}

	if владелец == "core" {
		src, ok := a.core[ключ]
		if !ok {
			http.Error(w, "неизвестный источник ядра", http.StatusNotFound)
			return
		}
		data, err := src(app, from, to)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		отдать(w, data)
		return
	}

	// Данные модуля панель читает из базы: она не ждёт, пока чужая программа
	// сходит в четыре чужих API.
	var raw string
	err := a.s.DB().QueryRow(`SELECT json FROM module_data WHERE module=? AND key=?`,
		владелец, ключ).Scan(&raw)
	if err != nil {
		http.Error(w, "модуль ещё не отвечал", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(raw))
}

func (a *API) tabs(w http.ResponseWriter, r *http.Request) {
	вкладки := []map[string]any{
		{"id": "overview", "title": "Обзор", "mod": false},
		{"id": "screens", "title": "Экраны", "mod": false},
		{"id": "people", "title": "Люди", "mod": false},
		{"id": "funnels", "title": "Воронки", "mod": false},
		{"id": "versions", "title": "Версии", "mod": false},
		{"id": "apps", "title": "Приложения", "mod": false},
	}
	ms, _ := modules.Load(a.modulesDir)
	for _, m := range ms {
		for _, t := range m.Tabs {
			вкладки = append(вкладки, map[string]any{"id": t.ID, "title": t.Title, "mod": true})
		}
	}
	отдать(w, вкладки)
}

// labels — словарь имён: ключ из кода приложения против того, что читает
// человек. Пустое имя означает «вернуть ключ», а не «назвать пустотой».
func (a *API) labels(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		var в struct{ App, Key, Title string }
		if err := json.NewDecoder(r.Body).Decode(&в); err != nil || в.Key == "" {
			http.Error(w, "нужны app, key и title", http.StatusBadRequest)
			return
		}
		var err error
		if в.Title == "" {
			_, err = a.s.DB().Exec(`DELETE FROM labels WHERE app=? AND key=?`, в.App, в.Key)
		} else {
			_, err = a.s.DB().Exec(`INSERT INTO labels (app,key,title) VALUES (?,?,?)
				ON CONFLICT(app,key) DO UPDATE SET title=excluded.title`, в.App, в.Key, в.Title)
		}
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		отдать(w, map[string]any{"ok": true})
		return
	}

	rows, err := a.s.DB().Query(`SELECT key, title FROM labels WHERE app=?`,
		r.URL.Query().Get("app"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	словарь := map[string]string{}
	for rows.Next() {
		var k, t string
		if err := rows.Scan(&k, &t); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		словарь[k] = t
	}
	отдать(w, словарь)
}

func (a *API) modulesList(w http.ResponseWriter, r *http.Request) {
	ms, err := modules.Load(a.modulesDir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	out := make([]map[string]any, 0, len(ms))
	for _, m := range ms {
		var свежесть *int64
		a.s.DB().QueryRow(`SELECT max(updated) FROM module_data WHERE module=?`, m.ID).Scan(&свежесть)
		запись := map[string]any{
			"id": m.ID, "name": m.Name, "version": m.Version,
			"tabs": len(m.Tabs), "tiles": len(m.Tiles), "updated": nil,
		}
		if свежесть != nil {
			запись["updated"] = *свежесть
		}
		out = append(out, запись)
	}
	отдать(w, out)
}

// query спрашивает у модуля один блок по требованию, с параметрами. Так
// работают ленты с перелистыванием: собирать двести тысяч кадров заранее
// незачем, да и некуда.
func (a *API) query(w http.ResponseWriter, r *http.Request) {
	владелец, ключ, ok := strings.Cut(r.URL.Query().Get("src"), ":")
	if !ok || владелец == "core" {
		http.Error(w, "адрес вида модуль:ключ", http.StatusBadRequest)
		return
	}
	ms, _ := modules.Load(a.modulesDir)
	for _, m := range ms {
		if m.ID != владелец {
			continue
		}
		параметры := map[string]string{}
		for k, v := range r.URL.Query() {
			if k != "src" && len(v) > 0 {
				параметры[k] = v[0]
			}
		}
		raw, err := modules.Query(m, filepath.Join(a.modulesDir, m.ID), ключ, параметры)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(raw)
		return
	}
	http.Error(w, "нет такого модуля", http.StatusNotFound)
}

// catalog — что можно положить на вкладку: блоки ядра плюс то, что предлагают
// включённые модули. Панель не различает источники, поэтому и список общий.
func (a *API) catalog(w http.ResponseWriter, r *http.Request) {
	out := []map[string]any{}
	for _, b := range blocks.Каталог() {
		out = append(out, map[string]any{"block": b, "owner": "Ядро"})
	}
	ms, _ := modules.Load(a.modulesDir)
	for _, m := range ms {
		for _, b := range m.Tiles {
			out = append(out, map[string]any{"block": b, "owner": m.Name})
		}
		// Блоки со вкладок модуля тоже можно вынести на обзор: модуль
		// предлагает, а раскладывает человек.
		for _, t := range m.Tabs {
			for _, b := range t.Blocks {
				out = append(out, map[string]any{"block": b, "owner": m.Name})
			}
		}
	}
	отдать(w, out)
}

func (a *API) первоеПриложение() string {
	apps, err := a.s.Apps()
	if err != nil || len(apps) == 0 {
		return ""
	}
	return apps[0].ID
}

// диапазон понимает 7d, 15d, 30d, all и пару дат через две точки.
func диапазон(s string) (string, string) {
	конец := time.Now().UTC()
	if s == "all" {
		return "0000-01-01", конец.Format("2006-01-02")
	}
	if from, to, ok := strings.Cut(s, ".."); ok {
		return from, to
	}
	дней := 15
	if n, err := strconv.Atoi(strings.TrimSuffix(s, "d")); err == nil && n > 0 {
		дней = n
	}
	return конец.AddDate(0, 0, -дней+1).Format("2006-01-02"), конец.Format("2006-01-02")
}

func отдать(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}
